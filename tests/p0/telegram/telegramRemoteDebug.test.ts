import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockReadTelegramConfig = vi.fn()
const mockGetTelegramLastUpdateId = vi.fn()
const mockSetTelegramLastUpdateId = vi.fn()
const mockIsTelegramRemoteEnabled = vi.fn()
const mockGetTelegramInteractionSessionId = vi.fn()
const mockSetTelegramRemoteDebugState = vi.fn()
const mockEnqueue = vi.fn()
const mockLogError = vi.fn()

const mockGetTelegramProxyUrl = vi.fn()

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
  sendTelegramInboundQueued: vi.fn(),
}))

vi.mock('src/utils/messageQueueManager.js', () => ({
  enqueue: (cmd: unknown) => mockEnqueue(cmd),
}))

vi.mock('src/utils/log.js', () => ({
  logError: (err: unknown) => mockLogError(err),
}))

describe('telegram/remote debug', () => {
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
      remoteDebug: {},
    })
    mockGetTelegramLastUpdateId.mockReturnValue(undefined)
    mockIsTelegramRemoteEnabled.mockReturnValue(true)
    mockGetTelegramInteractionSessionId.mockReturnValue('session-1')
    mockGetTelegramProxyUrl.mockReturnValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.resetModules()
    global.fetch = originalFetch
  })

  it('records queued debug state after inbound text is accepted', async () => {
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

    expect(mockSetTelegramRemoteDebugState).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'queued' }),
    )

    handle.stop()
  })

  it('records ignore reason when session is not active', async () => {
    mockGetTelegramInteractionSessionId.mockReturnValue('other-session')
    const mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)

    const { startTelegramRemotePolling } = await import(
      'src/services/telegram/remote.js'
    )
    const handle = startTelegramRemotePolling('session-1')

    await vi.advanceTimersByTimeAsync(1000)

    expect(mockSetTelegramRemoteDebugState).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'idle',
        lastIgnoredReason: 'session_not_active',
      }),
    )
    expect(mockFetch).not.toHaveBeenCalled()

    handle.stop()
  })
})
