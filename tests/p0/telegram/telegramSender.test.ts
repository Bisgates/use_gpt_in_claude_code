import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('src/utils/log.js', () => ({
  logError: vi.fn(),
}))

afterEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
})

describe('telegram/sender', () => {
  it('sendTelegramMessage returns false when not configured', async () => {
    vi.resetModules()
    vi.doMock('src/services/telegram/config.js', () => ({
      readTelegramConfig: () => null,
    }))

    const { sendTelegramMessage } = await import(
      'src/services/telegram/sender.js'
    )

    expect(await sendTelegramMessage('test')).toBe(false)
  })

  it('sendTelegramMessage returns false when disabled in legacy config', async () => {
    vi.resetModules()
    vi.doMock('src/services/telegram/config.js', () => ({
      readTelegramConfig: () => ({
        botToken: 'tok',
        chatId: '123',
        enabled: false,
      }),
    }))

    const { sendTelegramMessage } = await import(
      'src/services/telegram/sender.js'
    )

    expect(await sendTelegramMessage('test')).toBe(false)
  })

  it('sendTelegramMessage calls Telegram API and returns true on success', async () => {
    vi.resetModules()
    vi.doMock('src/services/telegram/config.js', () => ({
      readTelegramConfig: () => ({
        botToken: 'test-token',
        chatId: '12345',
        enabled: true,
      }),
      getTelegramProxyUrl: () => undefined,
    }))

    const mockFetch = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', mockFetch)

    const { sendTelegramMessage } = await import(
      'src/services/telegram/sender.js'
    )

    const result = await sendTelegramMessage('hello')
    expect(result).toBe(true)
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.telegram.org/bottest-token/sendMessage',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          chat_id: '12345',
          text: 'hello',
        }),
      }),
    )
  })

  it('sendTelegramMessage returns false on API error', async () => {
    vi.resetModules()
    vi.doMock('src/services/telegram/config.js', () => ({
      readTelegramConfig: () => ({
        botToken: 'tok',
        chatId: '123',
        enabled: true,
      }),
      getTelegramProxyUrl: () => undefined,
    }))

    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve('Unauthorized'),
    })
    vi.stubGlobal('fetch', mockFetch)

    const { sendTelegramMessage } = await import(
      'src/services/telegram/sender.js'
    )

    expect(await sendTelegramMessage('test')).toBe(false)
  })

  it('validateTelegramBot returns ok with username on success', async () => {
    vi.resetModules()
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({ ok: true, result: { username: 'testbot' } }),
    })
    vi.stubGlobal('fetch', mockFetch)

    const { validateTelegramBot } = await import(
      'src/services/telegram/sender.js'
    )

    const result = await validateTelegramBot('test-token')
    expect(result).toEqual({ ok: true, username: 'testbot' })
  })

  it('validateTelegramBot returns not ok on failure', async () => {
    vi.resetModules()
    const mockFetch = vi.fn().mockResolvedValue({ ok: false })
    vi.stubGlobal('fetch', mockFetch)

    const { validateTelegramBot } = await import(
      'src/services/telegram/sender.js'
    )

    expect(await validateTelegramBot('bad-token')).toEqual({ ok: false })
  })
})
