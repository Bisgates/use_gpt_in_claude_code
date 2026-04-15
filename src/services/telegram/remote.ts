import { randomUUID } from 'crypto'
import { enqueue } from '../../utils/messageQueueManager.js'
import { logError } from '../../utils/log.js'
import { getTelegramFetchOptions } from './fetchOptions.js'
import {
  sendTelegramInboundQueued,
} from './interactionNotifier.js'
import {
  handleTelegramQuestionCallbackQuery,
  handleTelegramQuestionTextMessage,
} from './questionSession.js'
import {
  getTelegramInteractionSessionId,
  getTelegramLastUpdateId,
  isTelegramRemoteEnabled,
  readTelegramConfig,
  setTelegramLastUpdateId,
  setTelegramRemoteDebugState,
} from './config.js'

const TELEGRAM_API = 'https://api.telegram.org'
const POLL_TIMEOUT_SECONDS = 30
const LOOP_DELAY_MS = 1_000

type TelegramUpdate = {
  update_id: number
  message?: {
    message_id: number
    text?: string
    chat?: { id?: number | string }
  }
  callback_query?: {
    id: string
    data?: string
    message?: {
      message_id: number
      chat?: { id?: number | string }
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function nowIso(): string {
  return new Date().toISOString()
}

function formatError(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error)
  }

  const parts = [error.message]
  const cause = (error as Error & { cause?: unknown }).cause
  if (cause && typeof cause === 'object') {
    const causeMessage = (cause as { message?: unknown }).message
    const causeCode = (cause as { code?: unknown }).code
    if (causeMessage) {
      parts.push(`cause=${String(causeMessage)}`)
    }
    if (causeCode) {
      parts.push(`code=${String(causeCode)}`)
    }
  }

  return parts.join(' | ')
}

function updateDebugState(
  patch: {
    status?: string
    lastPollAt?: string
    lastSuccessAt?: string
    lastErrorAt?: string
    lastError?: string
    lastIgnoredAt?: string
    lastIgnoredReason?: string
    lastInboundAt?: string
    lastInboundText?: string
  },
): void {
  const current = readTelegramConfig()?.remoteDebug ?? {}
  setTelegramRemoteDebugState({
    ...current,
    ...patch,
  })
}

export type TelegramRemoteHandle = {
  stop: () => void
}

async function fetchTelegramUpdates(signal: AbortSignal): Promise<TelegramUpdate[]> {
  const config = readTelegramConfig()
  if (!config?.botToken || !config.chatId) {
    return []
  }

  const offset = getTelegramLastUpdateId()
  const url = `${TELEGRAM_API}/bot${config.botToken}/getUpdates`
  const body: Record<string, unknown> = {
    timeout: POLL_TIMEOUT_SECONDS,
    allowed_updates: ['message', 'callback_query'],
  }
  if (offset !== undefined) {
    body.offset = offset + 1
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
    ...getTelegramFetchOptions(),
  })

  if (!res.ok) {
    throw new Error(`Telegram getUpdates failed (${res.status})`)
  }

  const data = (await res.json()) as {
    ok: boolean
    result?: TelegramUpdate[]
  }

  if (!data.ok || !Array.isArray(data.result)) {
    return []
  }

  return data.result
}

export function startTelegramRemotePolling(sessionId: string): TelegramRemoteHandle {
  let stopped = false
  let controller: AbortController | null = null

  const run = async () => {
    while (!stopped) {
      const config = readTelegramConfig()
      if (!config || !config.botToken || !config.chatId) {
        updateDebugState({
          status: 'idle',
          lastIgnoredAt: nowIso(),
          lastIgnoredReason: 'missing_config',
        })
        await delay(LOOP_DELAY_MS)
        continue
      }
      if (!isTelegramRemoteEnabled()) {
        updateDebugState({
          status: 'idle',
          lastIgnoredAt: nowIso(),
          lastIgnoredReason: 'remote_disabled',
        })
        await delay(LOOP_DELAY_MS)
        continue
      }
      if (getTelegramInteractionSessionId() !== sessionId) {
        updateDebugState({
          status: 'idle',
          lastIgnoredAt: nowIso(),
          lastIgnoredReason: 'session_not_active',
        })
        await delay(LOOP_DELAY_MS)
        continue
      }

      updateDebugState({
        status: 'polling',
        lastPollAt: nowIso(),
      })

      controller = new AbortController()
      try {
        const updates = await fetchTelegramUpdates(controller.signal)
        updateDebugState({
          status: 'ok',
          lastSuccessAt: nowIso(),
        })
        for (const update of updates) {
          setTelegramLastUpdateId(update.update_id)

          const callbackId = update.callback_query?.id
          const callbackData = update.callback_query?.data?.trim()
          const callbackChatId = update.callback_query?.message?.chat?.id
          if (callbackId && callbackData) {
            if (String(callbackChatId) !== String(config.chatId)) {
              updateDebugState({
                lastIgnoredAt: nowIso(),
                lastIgnoredReason: `callback_chat_id_mismatch:${String(callbackChatId)}`,
              })
              continue
            }

            const consumed = await handleTelegramQuestionCallbackQuery({
              sessionId,
              callbackQueryId: callbackId,
              data: callbackData,
            })
            if (consumed) {
              updateDebugState({
                status: 'queued',
                lastInboundAt: nowIso(),
                lastInboundText: callbackData.slice(0, 120),
              })
              continue
            }
          }

          const text = update.message?.text?.trim()
          const chatId = update.message?.chat?.id
          if (!text) {
            updateDebugState({
              lastIgnoredAt: nowIso(),
              lastIgnoredReason: 'message_without_text',
            })
            continue
          }
          if (String(chatId) !== String(config.chatId)) {
            updateDebugState({
              lastIgnoredAt: nowIso(),
              lastIgnoredReason: `chat_id_mismatch:${String(chatId)}`,
            })
            continue
          }

          const handledByQuestionSession = await handleTelegramQuestionTextMessage({
            sessionId,
            text,
          })
          if (handledByQuestionSession) {
            updateDebugState({
              status: 'queued',
              lastInboundAt: nowIso(),
              lastInboundText: text.slice(0, 120),
            })
            continue
          }

          updateDebugState({
            status: 'queued',
            lastInboundAt: nowIso(),
            lastInboundText: text.slice(0, 120),
          })

          enqueue({
            value: text,
            mode: 'prompt',
            uuid: randomUUID(),
            skipSlashCommands: true,
            bridgeOrigin: true,
          })
          void sendTelegramInboundQueued(sessionId, text)
        }
      } catch (error: unknown) {
        if (!stopped && !(error instanceof Error && error.name === 'AbortError')) {
          updateDebugState({
            status: 'error',
            lastErrorAt: nowIso(),
            lastError: formatError(error),
          })
          logError(error)
        }
        await delay(LOOP_DELAY_MS)
      }

      await delay(LOOP_DELAY_MS)
    }
  }

  void run()

  return {
    stop: () => {
      stopped = true
      controller?.abort()
    },
  }
}
