import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import { getSessionId } from '../../bootstrap/state.js'
import { createAssistantAPIErrorMessage, createAssistantMessage, getContentText } from '../../utils/messages.js'
import { logForDebugging } from '../../utils/debug.js'
import { validateBoundedIntEnvVar } from '../../utils/envValidation.js'
import {
  getStrictJsonSchemaIncompatibility,
  getToolInputJsonSchema,
  normalizeJsonSchema,
} from '../../utils/jsonSchema.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import { convertEffortValueToLevel, resolveAppliedEffort } from '../../utils/effort.js'
import type { AssistantMessage, Message, UserMessage } from '../../types/message.js'
import { getEmptyToolPermissionContext, type Tool, type Tools } from '../../Tool.js'
import type { ModelBackend, ModelBackendStream, StreamTurnParams } from './types.js'
import {
  resolveOpenAIModel,
  resolveOpenAIPromptCacheRetention,
  shouldStoreOpenAIResponses,
} from './openaiCodexConfig.js'
import { fetchOpenAIResponse, OpenAIHTTPError } from './openaiApi.js'
import {
  buildOpenAICustomToolCallStreamText,
  buildOpenAIContentPartKey,
  extractOpenAIResponseMessageBlocks,
  extractOpenAIResponseMessageText,
  extractOpenAIResponseReasoningText,
  isOpenAIDisplayOnlyNativeItemType,
  parseOpenAIResponseFunctionArguments,
  summarizeOpenAINativeStreamItem,
  summarizeOpenAINativeOutputItem,
} from './openaiResponsesOutput.js'
import type {
  OpenAIResponse,
  OpenAIResponseAnnotation,
  OpenAIResponseBuiltinToolItem,
  OpenAIResponseCustomToolCall,
  OpenAIResponseFunctionCall,
  OpenAIResponseOutputItem,
  OpenAIResponsesStreamEvent,
} from './openaiResponsesTypes.js'
import { sleep } from '../../utils/sleep.js'

type OpenAIInputItem =
  | {
      role: 'user' | 'assistant'
      content: Array<{ type: 'input_text' | 'output_text'; text: string }>
    }
  | {
      type: 'function_call'
      call_id: string
      name: string
      arguments: string
    }
  | {
      type: 'function_call_output'
      call_id: string
      output: string
    }

type StreamEventMessage = Extract<Message, { type: 'stream_event' }>

function buildResponsesUrl(): string {
  return '/responses'
}

const loggedStrictSchemaDowngrades = new Set<string>()
const loggedResponsesDegradations = new Set<string>()

function maybeLogStrictSchemaDowngrade(name: string, reason: string): void {
  const key = `${name}:${reason}`
  if (loggedStrictSchemaDowngrades.has(key)) {
    return
  }
  loggedStrictSchemaDowngrades.add(key)
  // Log once per schema failure so we can track why strict mode is absent
  // without flooding debug output on every turn.
  logForDebugging(
    `[openaiResponses] strict mode disabled for ${name}: ${reason}`,
  )
}

function maybeLogResponsesDegradation(
  scope: string,
  name: string,
  reason: string,
): void {
  const key = `${scope}:${name}:${reason}`
  if (loggedResponsesDegradations.has(key)) {
    return
  }

  loggedResponsesDegradations.add(key)
  logForDebugging(`[openaiResponses] ${scope} ${name}: ${reason}`)
}

function mapToolToOpenAIFunction(
  tool: Tool,
): Promise<{
  type: 'function'
  name: string
  description: string
  parameters: Record<string, unknown>
  strict?: true
}> {
  return Promise.resolve().then(async () => {
    const parameters = getToolInputJsonSchema(tool)
    const strictCompatibilityError =
      tool.strict === true
        ? getStrictJsonSchemaIncompatibility(parameters)
        : undefined
    if (strictCompatibilityError) {
      maybeLogStrictSchemaDowngrade(tool.name, strictCompatibilityError)
    }

    return {
      type: 'function',
      name: tool.name,
      description: await tool.prompt({
        getToolPermissionContext: async () => getEmptyToolPermissionContext(),
        tools: [] as unknown as Tools,
        agents: [],
      }),
      parameters,
      ...(tool.strict === true && !strictCompatibilityError
        ? { strict: true as const }
        : {}),
    }
  })
}

function extractToolResultOutput(message: UserMessage): OpenAIInputItem[] {
  if (!Array.isArray(message.message.content)) return []

  const outputs: OpenAIInputItem[] = []
  for (const block of message.message.content) {
    if (block.type !== 'tool_result') continue

    const output =
      typeof block.content === 'string'
        ? block.content
        : Array.isArray(block.content)
          ? getContentText(block.content as ContentBlockParam[]) ||
            jsonStringify(block.content)
          : jsonStringify(block.content)

    outputs.push({
      type: 'function_call_output',
      call_id: block.tool_use_id,
      output,
    })
  }

  return outputs
}

function translateMessageToInput(message: Message): OpenAIInputItem[] {
  switch (message.type) {
    case 'user': {
      const toolOutputs = extractToolResultOutput(message)
      if (toolOutputs.length > 0) return toolOutputs

      const text = getContentText(message.message.content)
      if (!text) return []
      return [
        {
          role: 'user',
          content: [{ type: 'input_text', text }],
        },
      ]
    }
    case 'assistant': {
      if (!Array.isArray(message.message.content)) {
        const text = getContentText(message.message.content as ContentBlockParam[])
        if (!text) return []
        return [
          {
            role: 'assistant',
            content: [{ type: 'output_text', text }],
          },
        ]
      }

      const inputs: OpenAIInputItem[] = []
      const text = getContentText(message.message.content as ContentBlockParam[])
      if (text) {
        inputs.push({
          role: 'assistant',
          content: [{ type: 'output_text', text }],
        })
      }

      for (const block of message.message.content) {
        if (block.type !== 'tool_use') continue
        inputs.push({
          type: 'function_call',
          call_id: block.id,
          name: block.name,
          arguments: jsonStringify(block.input || {}),
        })
      }

      return inputs
    }
    default:
      return []
  }
}

function buildInput(messages: Message[]): {
  input: OpenAIInputItem[]
} {
  return {
    input: messages.flatMap(translateMessageToInput),
  }
}

function mapUsage(usage: OpenAIResponse['usage']) {
  if (!usage) return undefined
  const cachedTokens = usage.input_tokens_details?.cached_tokens ?? 0
  const totalInputTokens = usage.input_tokens ?? 0

  return {
    input_tokens: Math.max(0, totalInputTokens - cachedTokens),
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: cachedTokens,
    output_tokens: usage.output_tokens ?? 0,
    server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
    service_tier: null,
    cache_creation: {
      ephemeral_1h_input_tokens: 0,
      ephemeral_5m_input_tokens: 0,
    },
    inference_geo: null,
    iterations: null,
    speed: null,
  }
}

function getPromptCacheKey(): string {
  return getSessionId()
}

function getSharedAssistantMessageId(response: OpenAIResponse): string {
  // Parallel tool calls from one response should stay grouped under a single
  // assistant turn, matching the native streaming transcript shape.
  const outputMessageId = response.output?.find(
    (item): item is OpenAIResponseOutputItem & { id: string } =>
      typeof item.id === 'string' && item.id.trim().length > 0,
  )?.id
  return outputMessageId ?? response.id
}

function getOutputIndexForStreamEvent(
  event: {
    output_index?: number
    item_id?: string
  },
  outputIndexes: Map<string, number>,
): number {
  return (
    event.output_index ??
    (event.item_id ? outputIndexes.get(event.item_id) : undefined) ??
    0
  )
}

function emitTextStreamEvent(
  index: number,
  text: string,
): StreamEventMessage[] {
  return text
    ? [
        createTextBlockStartStreamEvent(index),
        createTextDeltaStreamEvent(index, text),
      ]
    : []
}

function emitThinkingStreamEvent(
  index: number,
  thinking: string,
): StreamEventMessage[] {
  return thinking
    ? [
        createThinkingBlockStartStreamEvent(index),
        createThinkingDeltaStreamEvent(index, thinking),
      ]
    : []
}

function getStreamContentPartKey(
  event: {
    content_index?: number
    item_id?: string
    output_index?: number
  },
  outputIndexes: Map<string, number>,
): string {
  const contentIndex = event.content_index ?? 0
  if (event.item_id) {
    return buildOpenAIContentPartKey(event.item_id, contentIndex)
  }

  return `stream:${getOutputIndexForStreamEvent(event, outputIndexes)}:${contentIndex}`
}

function createAssistantMessagesFromResponse(
  response: OpenAIResponse,
  model: string,
  streamedAnnotations = new Map<string, OpenAIResponseAnnotation[]>(),
): {
  assistantMessages: AssistantMessage[]
  unsupportedItemTypes: string[]
} {
  const assistantMessages: AssistantMessage[] = []
  const unsupportedItemTypes = new Set<string>()
  const sharedMessageId = getSharedAssistantMessageId(response)

  for (const item of response.output || []) {
    if (item.type === 'message') {
      const blocks = extractOpenAIResponseMessageBlocks(item, streamedAnnotations)
      const text = extractOpenAIResponseMessageText(item)

      if (!text || blocks.length === 0) continue
      const message = createAssistantMessage({
        content: blocks as never,
        usage: mapUsage(response.usage) as never,
      }) as AssistantMessage
      message.requestId = response.id
      message.message.model = model
      message.message.id = sharedMessageId
      assistantMessages.push(message)
      continue
    }

    if (item.type === 'function_call') {
      const functionCall = item as OpenAIResponseFunctionCall
      const input = parseOpenAIResponseFunctionArguments(functionCall)

      const message = createAssistantMessage({
        content: [
          {
            type: 'tool_use',
            id: functionCall.call_id,
            name: functionCall.name,
            input,
          } as never,
        ],
        usage: mapUsage(response.usage) as never,
      }) as AssistantMessage
      message.requestId = response.id
      message.message.model = model
      message.message.id = sharedMessageId
      assistantMessages.push(message)
      continue
    }

    if (item.type === 'reasoning') {
      const thinking = extractOpenAIResponseReasoningText(item)
      if (!thinking) {
        continue
      }

      const message = createAssistantMessage({
        content: [
          {
            type: 'thinking',
            thinking,
            signature: '',
          } as never,
        ],
        usage: mapUsage(response.usage) as never,
        // Keep reasoning visible in the transcript without replaying it back
        // into later provider requests with an invalid foreign signature.
        isVirtual: true,
      }) as AssistantMessage
      message.requestId = response.id
      message.message.model = model
      message.message.id = sharedMessageId
      assistantMessages.push(message)
      continue
    }

    if (isOpenAIDisplayOnlyNativeItemType(item.type)) {
      const summary = summarizeOpenAINativeOutputItem(item)
      if (!summary) {
        continue
      }

      const message = createAssistantMessage({
        content: summary,
        usage: mapUsage(response.usage) as never,
        isVirtual: true,
      }) as AssistantMessage
      message.requestId = response.id
      message.message.model = model
      message.message.id = sharedMessageId
      assistantMessages.push(message)
      continue
    }

    unsupportedItemTypes.add(item.type)
    maybeLogResponsesDegradation(
      'unsupported output item',
      item.type,
      'not mapped onto the local Claude-style runtime',
    )
  }

  return {
    assistantMessages,
    unsupportedItemTypes: [...unsupportedItemTypes],
  }
}

function hasRenderableAssistantContent(item: OpenAIResponseOutputItem): boolean {
  if (item.type === 'message') {
    return extractOpenAIResponseMessageBlocks(item).length > 0
  }

  if (item.type === 'reasoning') {
    return extractOpenAIResponseReasoningText(item).length > 0
  }

  if (item.type === 'function_call') {
    return (
      typeof item.call_id === 'string' &&
      item.call_id.length > 0 &&
      typeof item.name === 'string' &&
      item.name.length > 0
    )
  }

  if (isOpenAIDisplayOnlyNativeItemType(item.type)) {
    return summarizeOpenAINativeOutputItem(item).length > 0
  }

  return false
}

function mergeStreamedCompletedOutputItems(
  response: OpenAIResponse,
  streamedCompletedOutputItems: Map<number, OpenAIResponseOutputItem>,
): OpenAIResponse {
  if (streamedCompletedOutputItems.size === 0) {
    return response
  }

  const mergedItems = new Map<number, OpenAIResponseOutputItem>()

  for (const [index, item] of (response.output ?? []).entries()) {
    mergedItems.set(index, item)
  }

  for (const [index, item] of streamedCompletedOutputItems) {
    const existing = mergedItems.get(index)
    if (!existing || !hasRenderableAssistantContent(existing)) {
      mergedItems.set(index, item)
    }
  }

  return {
    ...response,
    output: [...mergedItems.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, item]) => item),
  }
}

function appendStreamText(
  buffer: Map<number, string>,
  index: number,
  text: string,
): void {
  if (!text) {
    return
  }

  buffer.set(index, `${buffer.get(index) ?? ''}${text}`)
}

function synthesizeResponseFromStream({
  responseId,
  streamedCompletedOutputItems,
  streamedTextContent,
  streamedReasoningContent,
  streamedFunctionCalls,
  streamedFunctionArguments,
  streamedNativeItems,
}: {
  responseId: string | undefined
  streamedCompletedOutputItems: Map<number, OpenAIResponseOutputItem>
  streamedTextContent: Map<number, string>
  streamedReasoningContent: Map<number, string>
  streamedFunctionCalls: Map<number, OpenAIResponseFunctionCall>
  streamedFunctionArguments: Map<number, string>
  streamedNativeItems: Map<
    number,
    OpenAIResponseBuiltinToolItem | OpenAIResponseCustomToolCall
  >
}): OpenAIResponse | undefined {
  const indexes = new Set<number>([
    ...streamedCompletedOutputItems.keys(),
    ...streamedTextContent.keys(),
    ...streamedReasoningContent.keys(),
    ...streamedFunctionCalls.keys(),
    ...streamedFunctionArguments.keys(),
    ...streamedNativeItems.keys(),
  ])

  if (indexes.size === 0) {
    return undefined
  }

  const output = [...indexes]
    .sort((left, right) => left - right)
    .map(index => {
      const completedItem = streamedCompletedOutputItems.get(index)
      if (completedItem && hasRenderableAssistantContent(completedItem)) {
        return completedItem
      }

      const text = streamedTextContent.get(index)?.trim()
      if (text) {
        return {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text }],
        } satisfies OpenAIResponseOutputItem
      }

      const thinking = streamedReasoningContent.get(index)?.trim()
      if (thinking) {
        return {
          type: 'reasoning',
          content: [{ type: 'reasoning_text', text: thinking }],
        } satisfies OpenAIResponseOutputItem
      }

      const functionCall = streamedFunctionCalls.get(index)
      if (functionCall?.call_id && functionCall.name) {
        return {
          ...functionCall,
          arguments:
            streamedFunctionArguments.get(index) ?? functionCall.arguments ?? '',
        } satisfies OpenAIResponseOutputItem
      }

      const streamedNativeItem = streamedNativeItems.get(index)
      if (streamedNativeItem && hasRenderableAssistantContent(streamedNativeItem)) {
        return streamedNativeItem
      }

      return completedItem ?? streamedNativeItem
    })
    .filter((item): item is OpenAIResponseOutputItem => item !== undefined)

  if (output.length === 0) {
    return undefined
  }

  const fallbackId =
    responseId ??
    output.find(
      (item): item is OpenAIResponseOutputItem & { id: string } =>
        typeof item.id === 'string' && item.id.trim().length > 0,
    )?.id ??
    'openai-responses-recovered'

  return {
    id: fallbackId,
    output,
  }
}

async function createResponsesRequest(params: StreamTurnParams): Promise<{
  url: string
  request: Record<string, unknown>
  model: string
}> {
  const model = resolveOpenAIModel(params.options.model)
  const { input } = buildInput(params.messages)
  const effort = resolveAppliedEffort(model, params.options.effortValue)
  const promptCacheRetention = resolveOpenAIPromptCacheRetention()
  const serializedTools = await Promise.all(
    params.tools.map(tool => mapToolToOpenAIFunction(tool)),
  )

  const request: Record<string, unknown> = {
    model,
    instructions: params.systemPrompt.join('\n'),
    input,
    store: shouldStoreOpenAIResponses(),
    // Keep repeated turns in the same session sticky to the same cache shard.
    prompt_cache_key: getPromptCacheKey(),
  }

  if (serializedTools.length > 0) {
    request.tools = serializedTools
    if (params.options.toolChoice?.type === 'tool') {
      request.tool_choice = {
        type: 'function',
        name: params.options.toolChoice.name,
      }
    } else {
      request.tool_choice = 'auto'
    }
    request.parallel_tool_calls = true
  }

  if (params.options.outputFormat) {
    const outputSchema = normalizeJsonSchema(
      params.options.outputFormat.schema as Record<string, unknown>,
    )
    const strictCompatibilityError =
      getStrictJsonSchemaIncompatibility(outputSchema)
    if (strictCompatibilityError) {
      maybeLogStrictSchemaDowngrade(
        'claude_code_output_schema',
        strictCompatibilityError,
      )
    }
    request.text = {
      format: {
        type: 'json_schema',
        name: 'claude_code_output_schema',
        ...(strictCompatibilityError ? {} : { strict: true }),
        schema: outputSchema,
      },
    }
  }

  if (promptCacheRetention) {
    request.prompt_cache_retention = promptCacheRetention
  }

  if (params.options.maxOutputTokensOverride) {
    request.max_output_tokens = params.options.maxOutputTokensOverride
  }
  if (effort !== undefined) {
    request.reasoning = {
      effort: convertEffortValueToLevel(effort),
    }
  }

  logForDebugging(
    `[openaiResponses] request ${jsonStringify({
      url: buildResponsesUrl(),
      model,
      inputCount: input.length,
      toolCount: serializedTools.length,
      instructionChars: params.systemPrompt.join('\n').length,
      promptCacheRetention,
      hasReasoning: effort !== undefined,
      hasMaxOutputTokensOverride:
        params.options.maxOutputTokensOverride !== undefined,
    })}`,
  )

  return {
    url: buildResponsesUrl(),
    request,
    model,
  }
}

function createStreamEventMessage(
  event: StreamEventMessage['event'],
): StreamEventMessage {
  return {
    type: 'stream_event',
    event,
  } as StreamEventMessage
}

function createMessageStartStreamEvent(): StreamEventMessage {
  return createStreamEventMessage({
    type: 'message_start',
    message: {
      usage: {
        input_tokens: 0,
        output_tokens: 0,
      },
    },
  } as StreamEventMessage['event'])
}

function createMessageStopStreamEvent(): StreamEventMessage {
  return createStreamEventMessage({
    type: 'message_stop',
  } as StreamEventMessage['event'])
}

function createTextBlockStartStreamEvent(index: number): StreamEventMessage {
  return createStreamEventMessage({
    type: 'content_block_start',
    index,
    content_block: {
      type: 'text',
      text: '',
    },
  } as StreamEventMessage['event'])
}

function createTextDeltaStreamEvent(
  index: number,
  text: string,
): StreamEventMessage {
  return createStreamEventMessage({
    type: 'content_block_delta',
    index,
    delta: {
      type: 'text_delta',
      text,
    },
  } as StreamEventMessage['event'])
}

function createThinkingBlockStartStreamEvent(index: number): StreamEventMessage {
  return createStreamEventMessage({
    type: 'content_block_start',
    index,
    content_block: {
      type: 'thinking',
      thinking: '',
      signature: '',
    },
  } as StreamEventMessage['event'])
}

function createThinkingDeltaStreamEvent(
  index: number,
  thinking: string,
): StreamEventMessage {
  return createStreamEventMessage({
    type: 'content_block_delta',
    index,
    delta: {
      type: 'thinking_delta',
      thinking,
    },
  } as StreamEventMessage['event'])
}

function createToolUseStartStreamEvent(
  index: number,
  item: OpenAIResponseFunctionCall,
): StreamEventMessage {
  return createStreamEventMessage({
    type: 'content_block_start',
    index,
    content_block: {
      type: 'tool_use',
      id: item.call_id,
      name: item.name,
      input: {},
    },
  } as StreamEventMessage['event'])
}

function createToolUseDeltaStreamEvent(
  index: number,
  partialJson: string,
): StreamEventMessage {
  return createStreamEventMessage({
    type: 'content_block_delta',
    index,
    delta: {
      type: 'input_json_delta',
      partial_json: partialJson,
    },
  } as StreamEventMessage['event'])
}

function createBlockStopStreamEvent(index: number): StreamEventMessage {
  return createStreamEventMessage({
    type: 'content_block_stop',
    index,
  } as StreamEventMessage['event'])
}

function getStreamEventErrorMessage(event: OpenAIResponsesStreamEvent): string {
  if (event.type === 'response.incomplete') {
    return (
      event.response?.incomplete_details?.reason ||
      'OpenAI Responses stream ended before completion.'
    )
  }
  return (
    event.response?.error?.message ||
    'OpenAI Responses returned a failed streaming event.'
  )
}

function isRecoverableOpenAIResponsesErrorMessage(message: string): boolean {
  const normalized = message.toLowerCase()
  return (
    normalized.includes('fetch failed') ||
    normalized.includes('network error') ||
    normalized.includes('stream disconnected') ||
    normalized.includes('connection reset') ||
    normalized.includes('stream ended before completion') ||
    normalized.includes('temporarily unavailable') ||
    normalized.includes('processing your request') ||
    normalized.includes('internal server error') ||
    normalized.includes('bad gateway') ||
    normalized.includes('gateway timeout') ||
    normalized.includes('service unavailable') ||
    normalized.includes('timeout')
  )
}

function isRecoverableOpenAIResponsesHttpError(error: OpenAIHTTPError): boolean {
  return (
    error.status === 408 ||
    error.status === 409 ||
    error.status === 429 ||
    error.status >= 500 ||
    isRecoverableOpenAIResponsesErrorMessage(error.message)
  )
}

const OPENAI_RESPONSES_REQUEST_RETRY_DELAYS_MS = [250, 1000]

function shouldRetryOpenAIResponsesRequest(
  error: unknown,
  attemptIndex: number,
  emittedVisibleOutput: boolean,
): boolean {
  if (emittedVisibleOutput) {
    return false
  }

  if (attemptIndex >= OPENAI_RESPONSES_REQUEST_RETRY_DELAYS_MS.length) {
    return false
  }

  if (error instanceof OpenAIHTTPError) {
    return isRecoverableOpenAIResponsesHttpError(error)
  }

  const message = error instanceof Error ? error.message : String(error)
  return isRecoverableOpenAIResponsesErrorMessage(message)
}

function getRecoverableOpenAIResponsesRetryDelayMs(
  error: unknown,
  attemptIndex: number,
): number {
  if (error instanceof OpenAIHTTPError && error.retryAfterMs !== null) {
    return Math.max(0, error.retryAfterMs)
  }

  return OPENAI_RESPONSES_REQUEST_RETRY_DELAYS_MS[
    Math.min(attemptIndex, OPENAI_RESPONSES_REQUEST_RETRY_DELAYS_MS.length - 1)
  ]!
}

function formatOpenAIResponsesError(
  error: unknown,
): {
  content: string
  errorDetails?: string
  recoverable: boolean
} {
  if (error instanceof OpenAIHTTPError) {
    const recoverable = isRecoverableOpenAIResponsesHttpError(error)
    const requestIdSuffix = error.requestId ? ` (request ${error.requestId})` : ''
    const content =
      recoverable && !isRecoverableOpenAIResponsesErrorMessage(error.message)
        ? `OpenAI Responses temporarily unavailable${requestIdSuffix}: ${error.message}`
        : error.message

    return {
      content,
      recoverable,
      errorDetails: `status=${error.status}${error.requestId ? ` request_id=${error.requestId}` : ''}`,
    }
  }

  const content =
    error instanceof Error ? error.message : 'OpenAI Responses request failed'

  return {
    content,
    recoverable: isRecoverableOpenAIResponsesErrorMessage(content),
  }
}

const OPENAI_RESPONSES_TRUNCATED_STREAM_ERROR =
  'OpenAI Responses stream disconnected mid-event'

function parseSseChunk(chunk: string): OpenAIResponsesStreamEvent | null {
  const lines = chunk
    .split('\n')
    .map(line => line.trimEnd())
    .filter(Boolean)

  if (lines.length === 0) return null

  let eventName = ''
  const dataLines: string[] = []

  for (const line of lines) {
    if (line.startsWith('event:')) {
      eventName = line.slice('event:'.length).trim()
      continue
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trimStart())
    }
  }

  const data = dataLines.join('\n').trim()
  if (!data || data === '[DONE]') {
    return null
  }

  try {
    const parsed = JSON.parse(data) as { type?: string }
    if (!parsed.type && eventName) {
      parsed.type = eventName
    }
    return parsed as OpenAIResponsesStreamEvent
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(OPENAI_RESPONSES_TRUNCATED_STREAM_ERROR)
    }
    throw error
  }
}

export async function* parseResponsesStream(
  response: Response,
): AsyncGenerator<OpenAIResponsesStreamEvent> {
  const reader = response.body?.getReader()
  if (!reader) {
    throw new Error('OpenAI Responses stream did not provide a readable body')
  }

  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { value, done } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')

    let boundaryIndex = buffer.indexOf('\n\n')
    while (boundaryIndex !== -1) {
      const chunk = buffer.slice(0, boundaryIndex).trim()
      buffer = buffer.slice(boundaryIndex + 2)
      if (chunk) {
        const event = parseSseChunk(chunk)
        if (event) {
          yield event
        }
      }
      boundaryIndex = buffer.indexOf('\n\n')
    }
  }

  const trailing = buffer.trim()
  if (trailing) {
    const event = parseSseChunk(trailing)
    if (event) {
      yield event
    }
  }
}

async function streamResponse(
  url: string,
  request: Record<string, unknown>,
  signal: AbortSignal,
): Promise<Response> {
  return fetchOpenAIResponse(url, {
    method: 'POST',
    headers: {
      accept: 'text/event-stream',
    },
    body: {
      ...request,
      stream: true,
    },
    signal,
  })
}

export async function* runOpenAIResponses(
  params: StreamTurnParams,
): ModelBackendStream {
  const { url, request, model } = await createResponsesRequest(params)

  for (let attemptIndex = 0; ; attemptIndex++) {
    let emittedVisibleOutput = false
    const emit = <T>(value: T): T => {
      emittedVisibleOutput = true
      return value
    }

    try {
      const streamedResponse = await streamResponse(url, request, params.signal)
      const outputIndexes = new Map<string, number>()
      const outputItemTypes = new Map<number, string>()
      const streamedNativeItems = new Map<
        number,
        OpenAIResponseBuiltinToolItem | OpenAIResponseCustomToolCall
      >()
      const streamedAnnotations = new Map<string, OpenAIResponseAnnotation[]>()
      const startedTextBlockIndexes = new Set<number>()
      const startedThinkingBlockIndexes = new Set<number>()
      const openToolUseBlockIndexes = new Set<number>()
      const streamedCompletedOutputItems = new Map<number, OpenAIResponseOutputItem>()
      const streamedTextContent = new Map<number, string>()
      const streamedReasoningContent = new Map<number, string>()
      const streamedFunctionCalls = new Map<number, OpenAIResponseFunctionCall>()
      const streamedFunctionArguments = new Map<number, string>()
      const customToolInputStreamedIndexes = new Set<number>()
      const audioTranscriptStreamedParts = new Set<string>()
      const reasoningSummaryPartCounts = new Map<number, number>()
      const reasoningSummarySeenIndexes = new Set<number>()
      let startedAssistantMessage = false
      let completedResponse: OpenAIResponse | undefined
      let responseIdFromStream: string | undefined

      for await (const event of parseResponsesStream(streamedResponse)) {
        switch (event.type) {
          case 'response.created':
          case 'response.in_progress': {
            responseIdFromStream = event.response?.id ?? responseIdFromStream
            if (!startedAssistantMessage) {
              startedAssistantMessage = true
              yield emit(createMessageStartStreamEvent())
            }
            break
          }
          case 'response.output_item.added': {
            if (!startedAssistantMessage) {
              startedAssistantMessage = true
              yield emit(createMessageStartStreamEvent())
            }

            const index = event.output_index ?? 0
            if (event.item_id) {
              outputIndexes.set(event.item_id, index)
            }
            if (event.item?.id) {
              outputIndexes.set(event.item.id, index)
            }
            if (event.item?.type) {
              outputItemTypes.set(index, event.item.type)
            }

            if (event.item?.type === 'function_call') {
              const functionCall = event.item as OpenAIResponseFunctionCall
              streamedFunctionCalls.set(index, functionCall)
              openToolUseBlockIndexes.add(index)
              yield emit(createToolUseStartStreamEvent(index, functionCall))
            } else if (
              event.item?.type &&
              isOpenAIDisplayOnlyNativeItemType(event.item.type)
            ) {
              streamedNativeItems.set(
                index,
                event.item as
                  | OpenAIResponseBuiltinToolItem
                  | OpenAIResponseCustomToolCall,
              )
            } else if (
              event.item?.type &&
              event.item.type !== 'message' &&
              event.item.type !== 'reasoning' &&
              event.item.type !== 'function_call'
            ) {
              maybeLogResponsesDegradation(
                'unsupported output item',
                event.item.type,
                'streamed item is not mapped onto the local Claude-style runtime',
              )
            }
            break
          }
          case 'response.content_part.added': {
            const index = getOutputIndexForStreamEvent(event, outputIndexes)
            const partType = event.part?.type
            if (
              (partType === 'output_text' || partType === 'refusal') &&
              !startedTextBlockIndexes.has(index)
            ) {
              startedTextBlockIndexes.add(index)
              yield emit(createTextBlockStartStreamEvent(index))
            } else if (
              partType &&
              outputItemTypes.get(index) === 'message' &&
              partType !== 'output_text' &&
              partType !== 'output_audio' &&
              partType !== 'refusal'
            ) {
              maybeLogResponsesDegradation(
                'unsupported message content part',
                partType,
                'streamed content part is not projected into Claude-style text blocks',
              )
            }
            break
          }
          case 'response.output_text.delta': {
            const text = event.delta || ''
            if (!text) break
            const index = getOutputIndexForStreamEvent(event, outputIndexes)
            appendStreamText(streamedTextContent, index, text)
            if (!startedTextBlockIndexes.has(index)) {
              startedTextBlockIndexes.add(index)
              yield emit(createTextBlockStartStreamEvent(index))
            }
            yield emit(createTextDeltaStreamEvent(index, text))
            break
          }
          case 'response.output_text.done': {
            break
          }
          case 'response.output_audio.delta':
          case 'response.output_audio.done': {
            break
          }
          case 'response.output_audio_transcript.delta': {
            const text = event.delta || ''
            if (!text) break
            const index = getOutputIndexForStreamEvent(event, outputIndexes)
            audioTranscriptStreamedParts.add(
              getStreamContentPartKey(event, outputIndexes),
            )
            appendStreamText(streamedTextContent, index, text)
            if (!startedTextBlockIndexes.has(index)) {
              startedTextBlockIndexes.add(index)
              yield emit(createTextBlockStartStreamEvent(index))
            }
            yield emit(createTextDeltaStreamEvent(index, text))
            break
          }
          case 'response.output_audio_transcript.done': {
            const text = event.transcript || ''
            if (!text) break
            const key = getStreamContentPartKey(event, outputIndexes)
            if (audioTranscriptStreamedParts.has(key)) {
              break
            }

            audioTranscriptStreamedParts.add(key)
            const index = getOutputIndexForStreamEvent(event, outputIndexes)
            appendStreamText(streamedTextContent, index, text)
            if (!startedTextBlockIndexes.has(index)) {
              startedTextBlockIndexes.add(index)
              yield emit(createTextBlockStartStreamEvent(index))
            }
            yield emit(createTextDeltaStreamEvent(index, text))
            break
          }
          case 'response.refusal.delta': {
            const text = event.delta || ''
            if (!text) break
            const index = getOutputIndexForStreamEvent(event, outputIndexes)
            appendStreamText(streamedTextContent, index, text)
            if (!startedTextBlockIndexes.has(index)) {
              startedTextBlockIndexes.add(index)
              yield emit(createTextBlockStartStreamEvent(index))
            }
            yield emit(createTextDeltaStreamEvent(index, text))
            break
          }
          case 'response.refusal.done':
          case 'response.content_part.done':
            break
          case 'response.reasoning_summary_part.added': {
            const index = getOutputIndexForStreamEvent(event, outputIndexes)
            const partCount = reasoningSummaryPartCounts.get(index) ?? 0
            reasoningSummaryPartCounts.set(index, partCount + 1)
            reasoningSummarySeenIndexes.add(index)

            if (!startedThinkingBlockIndexes.has(index)) {
              startedThinkingBlockIndexes.add(index)
              yield emit(createThinkingBlockStartStreamEvent(index))
            }

            if (partCount > 0) {
              appendStreamText(streamedReasoningContent, index, '\n\n')
              yield emit(createThinkingDeltaStreamEvent(index, '\n\n'))
            }
            break
          }
          case 'response.reasoning_summary_part.done':
            break
          case 'response.reasoning_summary_text.delta': {
            const thinking = event.delta || ''
            if (!thinking) break
            const index = getOutputIndexForStreamEvent(event, outputIndexes)
            reasoningSummarySeenIndexes.add(index)
            appendStreamText(streamedReasoningContent, index, thinking)
            if (!startedThinkingBlockIndexes.has(index)) {
              startedThinkingBlockIndexes.add(index)
              yield emit(createThinkingBlockStartStreamEvent(index))
            }
            yield emit(createThinkingDeltaStreamEvent(index, thinking))
            break
          }
          case 'response.reasoning_summary_text.done':
            break
          case 'response.reasoning_text.delta': {
            const thinking = event.delta || ''
            if (!thinking) break
            const index = getOutputIndexForStreamEvent(event, outputIndexes)
            if (reasoningSummarySeenIndexes.has(index)) {
              break
            }
            appendStreamText(streamedReasoningContent, index, thinking)
            if (!startedThinkingBlockIndexes.has(index)) {
              startedThinkingBlockIndexes.add(index)
              yield emit(createThinkingBlockStartStreamEvent(index))
            }
            yield emit(createThinkingDeltaStreamEvent(index, thinking))
            break
          }
          case 'response.reasoning_text.done':
            break
          case 'response.function_call_arguments.delta': {
            const partialJson = event.delta || ''
            if (!partialJson) break
            const index = getOutputIndexForStreamEvent(event, outputIndexes)
            appendStreamText(streamedFunctionArguments, index, partialJson)
            yield emit(createToolUseDeltaStreamEvent(index, partialJson))
            break
          }
          case 'response.function_call_arguments.done': {
            const index = getOutputIndexForStreamEvent(event, outputIndexes)
            if (event.item?.type === 'function_call') {
              streamedFunctionCalls.set(index, event.item)
            }
            if (openToolUseBlockIndexes.delete(index)) {
              yield emit(createBlockStopStreamEvent(index))
            }
            break
          }
          case 'response.custom_tool_call_input.delta':
          case 'response.custom_tool_call_input.done': {
            const index = getOutputIndexForStreamEvent(event, outputIndexes)
            const streamedItem = event.item ?? streamedNativeItems.get(index)
            if (streamedItem) {
              streamedNativeItems.set(index, streamedItem)
            }

            if (
              event.type === 'response.custom_tool_call_input.done' &&
              customToolInputStreamedIndexes.has(index)
            ) {
              break
            }

            const inputChunk =
              event.type === 'response.custom_tool_call_input.done'
                ? event.input || ''
                : event.delta || ''
            if (
              event.type === 'response.custom_tool_call_input.delta' &&
              inputChunk
            ) {
              customToolInputStreamedIndexes.add(index)
            }
            appendStreamText(streamedTextContent, index, inputChunk)
            if (!startedTextBlockIndexes.has(index)) {
              const initialText = streamedItem
                ? buildOpenAICustomToolCallStreamText(streamedItem, inputChunk)
                : inputChunk
              const streamEvents = emitTextStreamEvent(index, initialText)
              if (streamEvents.length === 0) {
                break
              }
              startedTextBlockIndexes.add(index)
              for (const streamEvent of streamEvents) {
                yield emit(streamEvent)
              }
              break
            }

            if (inputChunk) {
              yield emit(createTextDeltaStreamEvent(index, inputChunk))
            }
            break
          }
          case 'response.image_generation_call.in_progress':
          case 'response.image_generation_call.generating':
          case 'response.image_generation_call.completed': {
            const index = getOutputIndexForStreamEvent(event, outputIndexes)
            const existing = streamedNativeItems.get(index)
            const status = event.type.slice(
              'response.image_generation_call.'.length,
            )
            streamedNativeItems.set(index, {
              ...(existing?.type === 'image_generation_call' ? existing : {}),
              type: 'image_generation_call',
              ...(event.item_id ? { id: event.item_id } : {}),
              status,
            })
            break
          }
          case 'response.image_generation_call.partial_image': {
            const index = getOutputIndexForStreamEvent(event, outputIndexes)
            const existing = streamedNativeItems.get(index)
            const previousCount =
              existing?.type === 'image_generation_call' &&
              typeof existing.partial_image_count === 'number'
                ? existing.partial_image_count
                : 0
            const partialImageCount =
              typeof event.partial_image_index === 'number'
                ? Math.max(previousCount, event.partial_image_index + 1)
                : previousCount + 1

            streamedNativeItems.set(index, {
              ...(existing?.type === 'image_generation_call' ? existing : {}),
              type: 'image_generation_call',
              ...(event.item_id ? { id: event.item_id } : {}),
              status: 'generating',
              partial_image_count: partialImageCount,
            })
            break
          }
          case 'response.output_text.annotation.added': {
            if (!event.annotation || !event.item_id) {
              break
            }

            const key = buildOpenAIContentPartKey(
              event.item_id,
              event.content_index ?? 0,
            )
            streamedAnnotations.set(key, [
              ...(streamedAnnotations.get(key) ?? []),
              event.annotation,
            ])
            break
          }
          case 'response.output_item.done': {
            const index = getOutputIndexForStreamEvent(event, outputIndexes)
            if (event.item) {
              streamedCompletedOutputItems.set(index, event.item)
            }
            if (event.item?.id) {
              outputIndexes.set(event.item.id, index)
            }
            if (event.item?.type) {
              outputItemTypes.set(index, event.item.type)
            }
            if (event.item?.type === 'function_call') {
              streamedFunctionCalls.set(index, event.item)
            }
            const itemType = event.item?.type ?? outputItemTypes.get(index)
            if (itemType === 'message') {
              const text =
                event.item?.type === 'message'
                  ? extractOpenAIResponseMessageText(event.item)
                  : ''
              if (text) {
                appendStreamText(streamedTextContent, index, text)
                const streamEvents = startedTextBlockIndexes.has(index)
                  ? [createTextDeltaStreamEvent(index, text)]
                  : emitTextStreamEvent(index, text)
                if (streamEvents.length > 0) {
                  startedTextBlockIndexes.add(index)
                  for (const streamEvent of streamEvents) {
                    yield emit(streamEvent)
                  }
                }
              }
              if (startedTextBlockIndexes.delete(index)) {
                yield emit(createBlockStopStreamEvent(index))
              }
            } else if (itemType === 'reasoning') {
              const thinking =
                event.item?.type === 'reasoning'
                  ? extractOpenAIResponseReasoningText(event.item)
                  : ''
              if (thinking) {
                appendStreamText(streamedReasoningContent, index, thinking)
                const streamEvents = startedThinkingBlockIndexes.has(index)
                  ? [createThinkingDeltaStreamEvent(index, thinking)]
                  : emitThinkingStreamEvent(index, thinking)
                if (streamEvents.length > 0) {
                  startedThinkingBlockIndexes.add(index)
                  for (const streamEvent of streamEvents) {
                    yield emit(streamEvent)
                  }
                }
              }
              if (startedThinkingBlockIndexes.delete(index)) {
                yield emit(createBlockStopStreamEvent(index))
              }
            } else if (itemType === 'function_call') {
              if (openToolUseBlockIndexes.delete(index)) {
                yield emit(createBlockStopStreamEvent(index))
              }
            } else if (isOpenAIDisplayOnlyNativeItemType(itemType)) {
              const streamedItem =
                (event.item as OpenAIResponseOutputItem | undefined) ??
                streamedNativeItems.get(index)
              if (
                streamedItem &&
                isOpenAIDisplayOnlyNativeItemType(streamedItem.type) &&
                !startedTextBlockIndexes.has(index)
              ) {
                const summary =
                  streamedItem.type === 'custom_tool_call'
                    ? buildOpenAICustomToolCallStreamText(streamedItem)
                    : summarizeOpenAINativeStreamItem(streamedItem)
                appendStreamText(streamedTextContent, index, summary || '')
                const streamEvents = emitTextStreamEvent(index, summary || '')
                if (streamEvents.length > 0) {
                  startedTextBlockIndexes.add(index)
                  for (const streamEvent of streamEvents) {
                    yield emit(streamEvent)
                  }
                }
              }

              if (startedTextBlockIndexes.delete(index)) {
                yield emit(createBlockStopStreamEvent(index))
              }
              streamedNativeItems.delete(index)
              customToolInputStreamedIndexes.delete(index)
            }
            break
          }
          case 'error': {
            const content =
              event.error?.message ||
              'OpenAI Responses returned an error streaming event.'
            yield emit(
              createAssistantAPIErrorMessage({
                content,
                ...(isRecoverableOpenAIResponsesErrorMessage(content)
                  ? { error: 'unknown' }
                  : {}),
              }),
            )
            return
          }
          case 'response.failed':
          case 'response.incomplete': {
            const content = getStreamEventErrorMessage(event)
            yield emit(
              createAssistantAPIErrorMessage({
                content,
                ...(isRecoverableOpenAIResponsesErrorMessage(content)
                  ? { error: 'unknown' }
                  : {}),
              }),
            )
            return
          }
          case 'response.completed': {
            responseIdFromStream = event.response.id
            completedResponse = event.response
            yield emit(createMessageStopStreamEvent())
            break
          }
          default:
            maybeLogResponsesDegradation(
              'unknown stream event',
              event.type,
              'event will be ignored unless mapped explicitly',
            )
            break
        }
      }

      if (!completedResponse) {
        completedResponse = synthesizeResponseFromStream({
          responseId: responseIdFromStream,
          streamedCompletedOutputItems,
          streamedTextContent,
          streamedReasoningContent,
          streamedFunctionCalls,
          streamedFunctionArguments,
          streamedNativeItems,
        })

        if (completedResponse) {
          if (startedAssistantMessage) {
            yield emit(createMessageStopStreamEvent())
          }
        } else {
          throw new Error(
            'OpenAI Responses stream finished without a completed response payload.',
          )
        }
      } else {
        completedResponse = mergeStreamedCompletedOutputItems(
          completedResponse,
          streamedCompletedOutputItems,
        )
      }

      const { assistantMessages, unsupportedItemTypes } =
        createAssistantMessagesFromResponse(
          completedResponse,
          model,
          streamedAnnotations,
        )

      if (assistantMessages.length === 0) {
        yield emit(
          createAssistantAPIErrorMessage({
            content:
              unsupportedItemTypes.length > 0
                ? `OpenAI Responses returned only unsupported output item types for this backend: ${unsupportedItemTypes.join(', ')}`
                : completedResponse.error?.message ||
                  'OpenAI Responses returned no assistant output.',
          }),
        )
        return
      }

      for (const message of assistantMessages) {
        yield emit(message)
      }
      return
    } catch (error) {
      if (
        shouldRetryOpenAIResponsesRequest(
          error,
          attemptIndex,
          emittedVisibleOutput,
        )
      ) {
        const delayMs = getRecoverableOpenAIResponsesRetryDelayMs(
          error,
          attemptIndex,
        )
        logForDebugging(
          `[openaiResponses] recoverable request retry ${attemptIndex + 1}/${OPENAI_RESPONSES_REQUEST_RETRY_DELAYS_MS.length + 1} after ${delayMs}ms: ${error instanceof Error ? error.message : String(error)}`,
        )
        if (delayMs > 0) {
          await sleep(delayMs, params.signal)
          if (params.signal.aborted) {
            return
          }
        }
        continue
      }

      const { content, errorDetails, recoverable } =
        formatOpenAIResponsesError(error)
      yield emit(
        createAssistantAPIErrorMessage({
          content,
          ...(recoverable ? { error: 'unknown' } : {}),
          ...(errorDetails ? { errorDetails } : {}),
        }),
      )
      return
    }
  }
}

export const openaiResponsesModelBackend: ModelBackend = {
  id: 'openaiResponses',
  streamTurn(params) {
    return runOpenAIResponses(params)
  },
  getMaxOutputTokens(_model) {
    return validateBoundedIntEnvVar(
      'CLAUDE_CODE_MAX_OUTPUT_TOKENS',
      process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS,
      32_000,
      64_000,
    ).effective
  },
}
