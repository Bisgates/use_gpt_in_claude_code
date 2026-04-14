import { describe, expect, it, vi } from 'vitest'

vi.mock('src/utils/log.js', () => ({
  logError: vi.fn(),
}))

describe('telegram proxy support', () => {
  it('sendTelegramMessage passes proxy fetch options', async () => {
    vi.doMock('src/services/telegram/config.js', () => ({
      readTelegramConfig: () => ({
        botToken: 'test-token',
        chatId: '12345',
        enabled: true,
      }),
    }))
    vi.doMock('src/services/telegram/fetchOptions.js', () => ({
      getTelegramFetchOptions: () => ({ dispatcher: 'proxy-dispatcher' }),
    }))
    const mockFetch = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', mockFetch)
    vi.resetModules()

    const { sendTelegramMessage } = await import('src/services/telegram/sender.js')
    await sendTelegramMessage('hello')

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.telegram.org/bottest-token/sendMessage',
      expect.objectContaining({ dispatcher: 'proxy-dispatcher' }),
    )
  })

  it('remote poller passes proxy fetch options', async () => {
    const mockReadTelegramConfig = vi.fn().mockReturnValue({
      botToken: 'test-token',
      chatId: '12345',
      enabled: true,
      remoteEnabled: true,
      interactionSessionId: 'session-1',
      remoteDebug: {},
    })
    vi.doMock('src/services/telegram/config.js', () => ({
      readTelegramConfig: () => mockReadTelegramConfig(),
      getTelegramLastUpdateId: () => undefined,
      setTelegramLastUpdateId: vi.fn(),
      isTelegramRemoteEnabled: () => true,
      getTelegramInteractionSessionId: () => 'session-1',
      setTelegramRemoteDebugState: vi.fn(),
    }))
    vi.doMock('src/services/telegram/fetchOptions.js', () => ({
      getTelegramFetchOptions: () => ({ dispatcher: 'proxy-dispatcher' }),
    }))
    vi.doMock('src/services/telegram/interactionNotifier.js', () => ({
      sendTelegramInboundQueued: vi.fn(),
    }))
    vi.doMock('src/utils/messageQueueManager.js', () => ({
      enqueue: vi.fn(),
    }))
    vi.doMock('src/utils/log.js', () => ({
      logError: vi.fn(),
    }))

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, result: [] }),
    })
    vi.stubGlobal('fetch', mockFetch)
    vi.useFakeTimers()
    vi.resetModules()

    const { startTelegramRemotePolling } = await import('src/services/telegram/remote.js')
    const handle = startTelegramRemotePolling('session-1')
    await vi.runOnlyPendingTimersAsync()
    await Promise.resolve()

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.telegram.org/bottest-token/getUpdates',
      expect.objectContaining({ dispatcher: 'proxy-dispatcher' }),
    )

    handle.stop()
    vi.useRealTimers()
  })
})
