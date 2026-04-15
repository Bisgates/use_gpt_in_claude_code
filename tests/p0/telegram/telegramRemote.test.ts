import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockReadTelegramConfig = vi.fn()
const mockGetTelegramLastUpdateId = vi.fn()
const mockSetTelegramLastUpdateId = vi.fn()
const mockIsTelegramRemoteEnabled = vi.fn()
const mockGetTelegramInteractionSessionId = vi.fn()
const mockEnqueue = vi.fn()
const mockLogError = vi.fn()

const mockSetTelegramRemoteDebugState = vi.fn()
const mockSendTelegramInboundQueued = vi.fn()
const mockGetTelegramProxyUrl = vi.fn()

const mockHandleTelegramQuestionCallbackQuery = vi.fn()
const mockHandleTelegramQuestionTextMessage = vi.fn()

vi.mock('src/services/telegram/config.js', () => ({
  readTelegramConfig: () => mockReadTelegramConfig(),
  getTelegramLastUpdateId: () => mockGetTelegramLastUpdateId(),
  setTelegramLastUpdateId: (id: number) => mockSetTelegramLastUpdateId(id),
  isTelegramRemoteEnabled: () => mockIsTelegramRemoteEnabled(),
  getTelegramInteractionSessionId: () => mockGetTelegramInteractionSessionId(),
  getTelegramProxyUrl: () => mockGetTelegramProxyUrl(),
  setTelegramRemoteDebugState: (state: unknown) => mockSetTelegramRemoteDebugState(state),
}))

vi.mock('src/services/telegram/interactionNotifier.js', () => ({
  sendTelegramInboundQueued: (sessionId: string, text: string) =>
    mockSendTelegramInboundQueued(sessionId, text),
}))

vi.mock('src/services/telegram/questionSession.js', () => ({
  handleTelegramQuestionCallbackQuery: (params: unknown) =>
    mockHandleTelegramQuestionCallbackQuery(params),
  handleTelegramQuestionTextMessage: (params: unknown) =>
    mockHandleTelegramQuestionTextMessage(params),
}))

vi.mock('src/utils/messageQueueManager.js', () => ({
  enqueue: (cmd: unknown) => mockEnqueue(cmd),
}))

vi.mock('src/utils/log.js', () => ({
  logError: (err: unknown) => mockLogError(err),
}))

describe('telegram/remote', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mockReadTelegramConfig.mockReturnValue({
      botToken: 'test-token',
      chatId: '12345',
      enabled: true,
      remoteEnabled: true,
      interactionSessionId: 'session-1',
    })
    mockGetTelegramLastUpdateId.mockReturnValue(undefined)
    mockIsTelegramRemoteEnabled.mockReturnValue(true)
    mockGetTelegramInteractionSessionId.mockReturnValue('session-1')
    mockGetTelegramProxyUrl.mockReturnValue(undefined)
    mockHandleTelegramQuestionCallbackQuery.mockResolvedValue(false)
    mockHandleTelegramQuestionTextMessage.mockResolvedValue(false)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.resetModules()
    global.fetch = originalFetch
  })

  it('enqueues inbound Telegram text for the active interaction session', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        result: [
          {
            update_id: 77,
            message: {
              message_id: 1,
              text: 'hello from telegram',
              chat: { id: '12345' },
            },
          },
        ],
      }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const { startTelegramRemotePolling } = await import(
      'src/services/telegram/remote.js'
    )
    const handle = startTelegramRemotePolling('session-1')

    await vi.runOnlyPendingTimersAsync()
    await Promise.resolve()

    expect(mockSetTelegramLastUpdateId).toHaveBeenCalledWith(77)
    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        value: 'hello from telegram',
        mode: 'prompt',
        skipSlashCommands: true,
        bridgeOrigin: true,
      }),
    )
    expect(mockSendTelegramInboundQueued).toHaveBeenCalledWith(
      'session-1',
      'hello from telegram',
    )

    handle.stop()
  })

  it('does not enqueue when the current session is not the interaction session', async () => {
    mockGetTelegramInteractionSessionId.mockReturnValue('other-session')
    const mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)

    const { startTelegramRemotePolling } = await import(
      'src/services/telegram/remote.js'
    )
    const handle = startTelegramRemotePolling('session-1')

    await vi.advanceTimersByTimeAsync(5)
    expect(mockFetch).not.toHaveBeenCalled()
    expect(mockEnqueue).not.toHaveBeenCalled()

    handle.stop()
  })

  it('routes Telegram callback queries to the ask-user-question session handler', async () => {
    mockHandleTelegramQuestionCallbackQuery.mockResolvedValue(true)
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        result: [
          {
            update_id: 78,
            callback_query: {
              id: 'cb-1',
              data: 'aq:prompt-1:submit',
              message: { message_id: 7, chat: { id: '12345' } },
            },
          },
        ],
      }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const { startTelegramRemotePolling } = await import(
      'src/services/telegram/remote.js'
    )
    const handle = startTelegramRemotePolling('session-1')

    await vi.runOnlyPendingTimersAsync()
    await Promise.resolve()

    expect(mockHandleTelegramQuestionCallbackQuery).toHaveBeenCalledWith({
      sessionId: 'session-1',
      callbackQueryId: 'cb-1',
      data: 'aq:prompt-1:submit',
    })
    expect(mockEnqueue).not.toHaveBeenCalled()

    handle.stop()
  })

  it('does not enqueue text consumed by the ask-user-question session input handler', async () => {
    mockHandleTelegramQuestionTextMessage.mockResolvedValue(true)
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        result: [
          {
            update_id: 79,
            message: {
              message_id: 2,
              text: 'note from telegram',
              chat: { id: '12345' },
            },
          },
        ],
      }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const { startTelegramRemotePolling } = await import(
      'src/services/telegram/remote.js'
    )
    const handle = startTelegramRemotePolling('session-1')

    await vi.runOnlyPendingTimersAsync()
    await Promise.resolve()

    expect(mockHandleTelegramQuestionTextMessage).toHaveBeenCalledWith({
      sessionId: 'session-1',
      text: 'note from telegram',
    })
    expect(mockEnqueue).not.toHaveBeenCalled()
    expect(mockSendTelegramInboundQueued).not.toHaveBeenCalled()

    handle.stop()
  })
})
