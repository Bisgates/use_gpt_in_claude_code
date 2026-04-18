import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('bun:bundle', () => ({
  feature: () => false,
}))

const sleepMock = vi.hoisted(() => vi.fn(async () => {}))
const callModelMock = vi.hoisted(() => vi.fn())
const createUserMessageMock = vi.hoisted(() =>
  vi.fn(({ content, isMeta }: { content: string; isMeta?: boolean }) => ({
    type: 'user',
    message: { content },
    isMeta,
  })),
)
const createAssistantAPIErrorMessageMock = vi.hoisted(() =>
  vi.fn(({ content, error }: { content: string; error?: string }) => ({
    type: 'assistant',
    isApiErrorMessage: true,
    error,
    message: {
      role: 'assistant',
      model: 'mock-model',
      usage: { input_tokens: 0, output_tokens: 0 },
      content: [{ type: 'text', text: content }],
    },
  })),
)

vi.mock('../../../src/utils/sleep.js', () => ({
  sleep: (...args: unknown[]) => sleepMock(...args),
}))

vi.mock('../../../src/bootstrap/state.js', async importOriginal => {
  const actual =
    await importOriginal<typeof import('../../../src/bootstrap/state.js')>()
  return {
    ...actual,
    getCurrentTurnTokenBudget: () => undefined,
    getTurnOutputTokens: () => 0,
    incrementBudgetContinuationCount: vi.fn(),
  }
})

vi.mock('../../../src/Tool.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../src/Tool.js')>()
  return {
    ...actual,
    findToolByName: vi.fn(),
  }
})

vi.mock('../../../src/utils/messages.js', () => ({
  createUserMessage: (...args: unknown[]) => createUserMessageMock(...args),
  createUserInterruptionMessage: vi.fn(({ toolUse }: { toolUse: boolean }) => ({
    type: 'user',
    interruption: toolUse,
  })),
  normalizeMessagesForAPI: (messages: unknown[]) => messages,
  createSystemMessage: vi.fn((content: string, level?: string) => ({
    type: 'system',
    level,
    message: content,
  })),
  createAssistantAPIErrorMessage: (...args: unknown[]) =>
    createAssistantAPIErrorMessageMock(...args),
  getMessagesAfterCompactBoundary: (messages: unknown[]) => messages,
  createToolUseSummaryMessage: vi.fn(),
  createMicrocompactBoundaryMessage: vi.fn(),
  stripSignatureBlocks: (messages: unknown[]) => messages,
  createAttachmentMessage: vi.fn((attachment: unknown) => ({
    type: 'attachment',
    attachment,
  })),
}))

vi.mock('../../../src/services/compact/autoCompact.js', () => ({
  calculateTokenWarningState: () => ({ isAtBlockingLimit: false }),
  isAutoCompactEnabled: () => false,
}))
vi.mock('../../../src/services/compact/compact.js', () => ({
  buildPostCompactMessages: vi.fn(),
}))
vi.mock('../../../src/services/toolUseSummary/toolUseSummaryGenerator.js', () => ({
  generateToolUseSummary: vi.fn(),
}))
vi.mock('../../../src/utils/api.js', () => ({
  prependUserContext: (messages: unknown[]) => messages,
  appendSystemContext: (systemPrompt: unknown) => systemPrompt,
}))
vi.mock('../../../src/utils/attachments.js', () => ({
  createAttachmentMessage: vi.fn((attachment: unknown) => ({
    type: 'attachment',
    attachment,
  })),
  filterDuplicateMemoryAttachments: (messages: unknown[]) => messages,
  getAttachmentMessages: async function* () {},
  startRelevantMemoryPrefetch: () => ({
    settledAt: null,
    consumedOnIteration: -1,
    promise: Promise.resolve([]),
    [Symbol.dispose]: () => {},
  }),
}))
vi.mock('../../../src/utils/messageQueueManager.js', () => ({
  remove: vi.fn(),
  getCommandsByMaxPriority: () => [],
  isSlashCommand: () => false,
}))
vi.mock('../../../src/utils/commandLifecycle.js', () => ({
  notifyCommandLifecycle: vi.fn(),
}))
vi.mock('../../../src/utils/headlessProfiler.js', () => ({
  headlessProfilerCheckpoint: vi.fn(),
}))
vi.mock('../../../src/utils/model/model.js', async importOriginal => {
  const actual =
    await importOriginal<typeof import('../../../src/utils/model/model.js')>()
  return {
    ...actual,
    getRuntimeMainLoopModel: () => 'gpt-5.4',
    renderModelName: (model: string) => model,
  }
})
vi.mock('../../../src/utils/tokens.js', () => ({
  doesMostRecentAssistantMessageExceed200k: () => false,
  finalContextTokensFromLastResponse: () => 0,
  tokenCountWithEstimation: () => 0,
}))
vi.mock('../../../src/utils/context.js', () => ({
  ESCALATED_MAX_TOKENS: 64000,
}))
vi.mock('../../../src/services/analytics/growthbook.js', () => ({
  getFeatureValue_CACHED_MAY_BE_STALE: () => false,
}))
vi.mock('../../../src/tools/SleepTool/prompt.js', () => ({
  SLEEP_TOOL_NAME: 'Sleep',
}))
vi.mock('../../../src/utils/hooks/postSamplingHooks.js', () => ({
  executePostSamplingHooks: vi.fn(),
}))
vi.mock('../../../src/utils/hooks.js', () => ({
  executeStopFailureHooks: vi.fn(),
}))
vi.mock('../../../src/query/stopHooks.js', () => ({
  handleStopHooks: async function* () {
    return { preventContinuation: false, blockingErrors: [] }
  },
}))
vi.mock('../../../src/query/config.js', () => ({
  buildQueryConfig: () => ({
    sessionId: 'session-123',
    gates: {
      streamingToolExecution: false,
      emitToolUseSummaries: false,
      isAnt: false,
      fastModeEnabled: false,
    },
  }),
}))
vi.mock('../../../src/query/deps.js', () => ({
  productionDeps: vi.fn(),
}))
vi.mock('../../../src/query/tokenBudget.js', () => ({
  createBudgetTracker: vi.fn(),
  checkTokenBudget: vi.fn(),
}))
vi.mock('../../../src/utils/array.js', () => ({
  count: (items: unknown[], predicate: (item: unknown) => boolean) =>
    items.filter(predicate).length,
}))
vi.mock('../../../src/utils/log.js', () => ({
  logError: vi.fn(),
}))
vi.mock('../../../src/utils/debug.js', () => ({
  logAntError: vi.fn(),
  logForDebugging: vi.fn(),
}))
vi.mock('../../../src/services/api/dumpPrompts.js', () => ({
  createDumpPromptsFetch: vi.fn(),
}))
vi.mock('../../../src/services/tools/StreamingToolExecutor.js', () => ({
  StreamingToolExecutor: class {},
}))
vi.mock('../../../src/utils/queryProfiler.js', () => ({
  queryCheckpoint: vi.fn(),
}))
vi.mock('../../../src/services/tools/toolOrchestration.js', () => ({
  runTools: async function* () {},
}))
vi.mock('../../../src/utils/toolResultStorage.js', () => ({
  applyToolResultBudget: async (messages: unknown[]) => messages,
}))
vi.mock('../../../src/utils/sessionStorage.js', () => ({
  recordContentReplacement: vi.fn(),
}))

import { query } from '../../../src/query.ts'

async function collect(generator: AsyncGenerator<any>) {
  const outputs: any[] = []
  for await (const item of generator) {
    outputs.push(item)
  }
  return outputs
}

function makeRecoverableError(text: string) {
  return {
    type: 'assistant',
    isApiErrorMessage: true,
    error: 'unknown',
    message: {
      role: 'assistant',
      model: 'mock-model',
      usage: { input_tokens: 0, output_tokens: 0 },
      content: [{ type: 'text', text }],
    },
  }
}

function makeToolUseContext() {
  const abortController = new AbortController()
  return {
    options: {
      commands: [],
      debug: false,
      mainLoopModel: 'gpt-5.4',
      tools: [],
      verbose: false,
      thinkingConfig: { type: 'disabled' },
      mcpClients: [],
      mcpResources: {},
      isNonInteractiveSession: false,
      agentDefinitions: { activeAgents: [], allowedAgentTypes: [] },
    },
    abortController,
    readFileState: new Map(),
    getAppState: () => ({
      toolPermissionContext: {
        mode: 'default',
        additionalWorkingDirectories: new Map(),
        alwaysAllowRules: {},
        alwaysDenyRules: {},
        alwaysAskRules: {},
        isBypassPermissionsModeAvailable: false,
      },
      fastMode: false,
      mcp: { tools: [], clients: [] },
      effortValue: undefined,
      advisorModel: undefined,
    }),
    setAppState: vi.fn(),
    setInProgressToolUseIDs: vi.fn(),
    setResponseLength: vi.fn(),
    updateFileHistoryState: vi.fn(),
    updateAttributionState: vi.fn(),
    messages: [],
  } as any
}

beforeEach(() => {
  sleepMock.mockReset()
  sleepMock.mockResolvedValue(undefined)
  callModelMock.mockReset()
  createUserMessageMock.mockClear()
  createAssistantAPIErrorMessageMock.mockClear()
})

describe('query recoverable interruption retry', () => {
  it('[P0:model] retries a recoverable interruption immediately on first attempt and resumes the same task', async () => {
    callModelMock
      .mockImplementationOnce(async function* () {
        yield makeRecoverableError('Network connection failed')
      })
      .mockImplementationOnce(async function* () {
        yield {
          type: 'assistant',
          message: {
            role: 'assistant',
            model: 'mock-model',
            usage: { input_tokens: 0, output_tokens: 1 },
            content: [{ type: 'text', text: 'done' }],
          },
        }
      })

    const toolUseContext = makeToolUseContext()
    const outputs = await collect(
      query({
        messages: [],
        systemPrompt: ['system'],
        userContext: {},
        systemContext: {},
        canUseTool: vi.fn(),
        toolUseContext,
        querySource: 'repl_main_thread',
        deps: {
          callModel: callModelMock,
          microcompact: async messages => ({ messages, compactionInfo: undefined }),
          autocompact: async () => ({ compactionResult: null, consecutiveFailures: undefined }),
          uuid: () => 'uuid-1',
        },
      } as any),
    )

    expect(sleepMock).not.toHaveBeenCalled()
    expect(callModelMock).toHaveBeenCalledTimes(2)
    expect(createUserMessageMock).toHaveBeenCalledWith({
      content:
        'Recoverable request interruption detected (Network connection failed). Continue the same unfinished task. This is not a new task. Resume from where you were interrupted. Do not restart analysis, do not recap, and do not re-read already opened source unless necessary. Only stop when the task is complete or user input is actually required.',
      isMeta: true,
    })
    expect(outputs.at(-1)).toMatchObject({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'done' }] },
    })
  })

  it('[P0:model] stops after 3 consecutive recoverable retries and then surfaces the interruption error', async () => {
    callModelMock.mockImplementation(async function* () {
      yield makeRecoverableError('Network connection failed')
    })

    const outputs = await collect(
      query({
        messages: [],
        systemPrompt: ['system'],
        userContext: {},
        systemContext: {},
        canUseTool: vi.fn(),
        toolUseContext: makeToolUseContext(),
        querySource: 'repl_main_thread',
        deps: {
          callModel: callModelMock,
          microcompact: async messages => ({ messages, compactionInfo: undefined }),
          autocompact: async () => ({ compactionResult: null, consecutiveFailures: undefined }),
          uuid: () => 'uuid-1',
        },
      } as any),
    )

    expect(sleepMock).toHaveBeenNthCalledWith(
      1,
      1000,
      expect.any(AbortSignal),
    )
    expect(sleepMock).toHaveBeenNthCalledWith(
      2,
      3000,
      expect.any(AbortSignal),
    )
    expect(sleepMock).toHaveBeenCalledTimes(2)
    expect(callModelMock).toHaveBeenCalledTimes(4)
    expect(outputs.at(-1)).toMatchObject({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Network connection failed' }] },
    })
  })

  it('[P0:model] cancels cleanly if the user aborts during a delayed recoverable retry wait', async () => {
    callModelMock.mockImplementationOnce(async function* () {
      yield makeRecoverableError('Network connection failed')
    }).mockImplementationOnce(async function* () {
      yield makeRecoverableError('Network connection failed')
    })

    const toolUseContext = makeToolUseContext()
    sleepMock.mockImplementationOnce(async (_ms: number, signal?: AbortSignal) => {
      toolUseContext.abortController.abort('interrupt')
      if (signal?.aborted) {
        return undefined
      }
    })

    const outputs = await collect(
      query({
        messages: [],
        systemPrompt: ['system'],
        userContext: {},
        systemContext: {},
        canUseTool: vi.fn(),
        toolUseContext,
        querySource: 'repl_main_thread',
        deps: {
          callModel: callModelMock,
          microcompact: async messages => ({ messages, compactionInfo: undefined }),
          autocompact: async () => ({ compactionResult: null, consecutiveFailures: undefined }),
          uuid: () => 'uuid-1',
        },
      } as any),
    )

    expect(sleepMock).toHaveBeenCalledTimes(1)
    expect(callModelMock).toHaveBeenCalledTimes(2)
    expect(createUserMessageMock).toHaveBeenCalledTimes(1)
    expect(outputs.some(output => output?.isApiErrorMessage)).toBe(false)
  })
})
