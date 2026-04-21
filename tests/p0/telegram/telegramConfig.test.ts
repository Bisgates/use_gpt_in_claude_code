import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TelegramConfig } from 'src/services/telegram/config.js'

const mockReadFileSync = vi.fn()
const mockWriteFileSync = vi.fn()
const mockUnlinkSync = vi.fn()
const mockGetSessionTelegramNotificationsEnabled = vi.fn(() => true)
const mockGetGlobalConfig = vi.fn(() => ({ telegramNotificationsEnabled: undefined }))
const mockSaveGlobalConfig = vi.fn(
  (updater: (current: { telegramNotificationsEnabled?: boolean }) => { telegramNotificationsEnabled?: boolean }) => {
    const next = updater(mockGetGlobalConfig())
    mockGetGlobalConfig.mockReturnValue(next)
  },
)

vi.mock('fs', () => ({
  chmodSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
  unlinkSync: (...args: unknown[]) => mockUnlinkSync(...args),
}))

vi.mock('src/utils/envUtils.js', () => ({
  getClaudeConfigHomeDir: () => '/mock-home/.claude',
}))

vi.mock('src/utils/errors.js', () => ({
  getErrnoCode: (e: unknown) => (e as { code?: string })?.code,
}))

vi.mock('src/bootstrap/state.js', () => ({
  getSessionTelegramNotificationsEnabled: () =>
    mockGetSessionTelegramNotificationsEnabled(),
}))

vi.mock('src/utils/config.js', () => ({
  getGlobalConfig: () => mockGetGlobalConfig(),
  saveGlobalConfig: (updater: (current: { telegramNotificationsEnabled?: boolean }) => { telegramNotificationsEnabled?: boolean }) =>
    mockSaveGlobalConfig(updater),
}))

describe('telegram/config', () => {
  const ORIGINAL_TOKEN = process.env.TELEGRAM_BOT_TOKEN
  const ORIGINAL_CHAT = process.env.TELEGRAM_CHAT_ID

  beforeEach(() => {
    delete process.env.TELEGRAM_BOT_TOKEN
    delete process.env.TELEGRAM_CHAT_ID
    vi.clearAllMocks()
    mockGetSessionTelegramNotificationsEnabled.mockReturnValue(true)
    mockGetGlobalConfig.mockReturnValue({ telegramNotificationsEnabled: undefined })
  })

  afterEach(() => {
    if (ORIGINAL_TOKEN !== undefined) process.env.TELEGRAM_BOT_TOKEN = ORIGINAL_TOKEN
    else delete process.env.TELEGRAM_BOT_TOKEN
    if (ORIGINAL_CHAT !== undefined) process.env.TELEGRAM_CHAT_ID = ORIGINAL_CHAT
    else delete process.env.TELEGRAM_CHAT_ID
  })

  it('readTelegramConfig returns null when no file and no env', async () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT')
    })
    vi.resetModules()
    const { readTelegramConfig } = await import(
      'src/services/telegram/config.js'
    )
    expect(readTelegramConfig()).toBeNull()
  })

  it('readTelegramConfig prefers env vars over file', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'env-token'
    process.env.TELEGRAM_CHAT_ID = 'env-chat'
    mockReadFileSync.mockReturnValue(
      JSON.stringify({ botToken: 'file-token', chatId: 'file-chat', enabled: true }),
    )
    vi.resetModules()
    const { readTelegramConfig } = await import(
      'src/services/telegram/config.js'
    )
    const config = readTelegramConfig()
    expect(config).toEqual({
      botToken: 'env-token',
      chatId: 'env-chat',
      enabled: true,
    })
  })

  it('readTelegramConfig reads from file when no env vars', async () => {
    const stored: TelegramConfig = {
      botToken: 'file-token',
      chatId: '12345',
      enabled: true,
      remoteEnabled: true,
      interactionSessionId: 'session-1',
      lastUpdateId: 42,
    }
    mockReadFileSync.mockReturnValue(JSON.stringify(stored))
    vi.resetModules()
    const { readTelegramConfig } = await import(
      'src/services/telegram/config.js'
    )
    expect(readTelegramConfig()).toEqual(stored)
  })

  it('hasTelegramCredentials returns false when not configured', async () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT')
    })
    vi.resetModules()
    const { hasTelegramCredentials } = await import(
      'src/services/telegram/config.js'
    )
    expect(hasTelegramCredentials()).toBe(false)
  })

  it('isTelegramConfigured returns false when legacy config is disabled', async () => {
    mockReadFileSync.mockReturnValue(
      JSON.stringify({ botToken: 'tok', chatId: '123', enabled: false }),
    )
    vi.resetModules()
    const { isTelegramConfigured } = await import(
      'src/services/telegram/config.js'
    )
    expect(isTelegramConfigured()).toBe(false)
  })

  it('shouldSendTelegramNotifications returns false when session toggle is off', async () => {
    mockReadFileSync.mockReturnValue(
      JSON.stringify({ botToken: 'tok', chatId: '123', enabled: true }),
    )
    mockGetSessionTelegramNotificationsEnabled.mockReturnValue(false)
    vi.resetModules()
    const { shouldSendTelegramNotifications } = await import(
      'src/services/telegram/config.js'
    )
    expect(shouldSendTelegramNotifications()).toBe(false)
  })

  it('global toggle overrides env var credentials', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'env-token'
    process.env.TELEGRAM_CHAT_ID = 'env-chat'
    mockGetGlobalConfig.mockReturnValue({ telegramNotificationsEnabled: false })
    vi.resetModules()
    const { shouldSendTelegramNotifications } = await import(
      'src/services/telegram/config.js'
    )
    expect(shouldSendTelegramNotifications()).toBe(false)
  })

  it('setTelegramGloballyEnabled persists the global toggle', async () => {
    vi.resetModules()
    const { setTelegramGloballyEnabled, isTelegramGloballyEnabled } = await import(
      'src/services/telegram/config.js'
    )
    setTelegramGloballyEnabled(false)
    expect(mockSaveGlobalConfig).toHaveBeenCalled()
    expect(isTelegramGloballyEnabled()).toBe(false)
  })

  it('preserves remote state when env vars override credentials', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'env-token'
    process.env.TELEGRAM_CHAT_ID = 'env-chat'
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        botToken: 'file-token',
        chatId: 'file-chat',
        enabled: true,
        remoteEnabled: true,
        interactionSessionId: 'session-1',
        lastUpdateId: 99,
      }),
    )
    vi.resetModules()
    const { readTelegramConfig } = await import(
      'src/services/telegram/config.js'
    )
    expect(readTelegramConfig()).toEqual({
      botToken: 'env-token',
      chatId: 'env-chat',
      enabled: true,
      remoteEnabled: true,
      interactionSessionId: 'session-1',
      lastUpdateId: 99,
    })
  })

  it('isTelegramConfigured returns true when properly configured and globally enabled', async () => {
    mockReadFileSync.mockReturnValue(
      JSON.stringify({ botToken: 'tok', chatId: '123', enabled: true }),
    )
    vi.resetModules()
    const { isTelegramConfigured } = await import(
      'src/services/telegram/config.js'
    )
    expect(isTelegramConfigured()).toBe(true)
  })

  it('saveTelegramConfig writes JSON with correct path', async () => {
    vi.resetModules()
    const { saveTelegramConfig } = await import(
      'src/services/telegram/config.js'
    )
    const config: TelegramConfig = {
      botToken: 'test-token',
      chatId: '999',
      enabled: true,
    }
    saveTelegramConfig(config)
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      '/mock-home/.claude/telegram.json',
      JSON.stringify(config, null, 2),
      { encoding: 'utf8' },
    )
  })

  it('deleteTelegramConfig returns true on success', async () => {
    mockUnlinkSync.mockReturnValue(undefined)
    vi.resetModules()
    const { deleteTelegramConfig } = await import(
      'src/services/telegram/config.js'
    )
    expect(deleteTelegramConfig()).toBe(true)
  })

  it('deleteTelegramConfig returns true when file does not exist', async () => {
    mockUnlinkSync.mockImplementation(() => {
      const err = new Error('ENOENT') as Error & { code: string }
      err.code = 'ENOENT'
      throw err
    })
    vi.resetModules()
    const { deleteTelegramConfig } = await import(
      'src/services/telegram/config.js'
    )
    expect(deleteTelegramConfig()).toBe(true)
  })
})
