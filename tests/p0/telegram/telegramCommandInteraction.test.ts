import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockReadTelegramConfig = vi.fn()
const mockSendTelegramInteractionConnected = vi.fn()
const mockSendTelegramInteractionDisconnected = vi.fn()
const mockSendTelegramRemoteDisabled = vi.fn()
const mockValidateTelegramBot = vi.fn()
const mockSendTelegramMessage = vi.fn()
const mockSetSessionTelegramNotificationsEnabled = vi.fn()
const mockGetSessionTelegramNotificationsEnabled = vi.fn()
const mockSetTelegramGloballyEnabled = vi.fn()
const mockSetTelegramInteractionSession = vi.fn()
const mockSetTelegramRemoteEnabled = vi.fn()
const mockSetTelegramProxyUrl = vi.fn()
const mockDeleteTelegramConfig = vi.fn()
const mockGetTelegramInteractionSessionId = vi.fn()
const mockGetTelegramProxyUrl = vi.fn()
const mockGetTelegramRemoteDebugState = vi.fn()
const mockHasTelegramCredentials = vi.fn()
const mockIsTelegramEnabledForSession = vi.fn()
const mockIsTelegramGloballyEnabled = vi.fn()
const mockIsTelegramRemoteEnabled = vi.fn()
const mockShouldSendTelegramNotifications = vi.fn()
const mockSaveTelegramConfig = vi.fn()
const mockGetSessionId = vi.fn()

vi.mock('src/bootstrap/state.js', () => ({
  getSessionTelegramNotificationsEnabled: () =>
    mockGetSessionTelegramNotificationsEnabled(),
  setSessionTelegramNotificationsEnabled: (enabled: boolean) =>
    mockSetSessionTelegramNotificationsEnabled(enabled),
  getSessionId: () => mockGetSessionId(),
}))

vi.mock('src/services/telegram/config.js', () => ({
  deleteTelegramConfig: () => mockDeleteTelegramConfig(),
  getTelegramInteractionSessionId: () => mockGetTelegramInteractionSessionId(),
  getTelegramProxyUrl: () => mockGetTelegramProxyUrl(),
  getTelegramRemoteDebugState: () => mockGetTelegramRemoteDebugState(),
  hasTelegramCredentials: () => mockHasTelegramCredentials(),
  isTelegramEnabledForSession: () => mockIsTelegramEnabledForSession(),
  isTelegramGloballyEnabled: () => mockIsTelegramGloballyEnabled(),
  isTelegramRemoteEnabled: () => mockIsTelegramRemoteEnabled(),
  readTelegramConfig: () => mockReadTelegramConfig(),
  saveTelegramConfig: (config: unknown) => mockSaveTelegramConfig(config),
  setTelegramGloballyEnabled: (enabled: boolean) =>
    mockSetTelegramGloballyEnabled(enabled),
  setTelegramInteractionSession: (sessionId: string | undefined) =>
    mockSetTelegramInteractionSession(sessionId),
  setTelegramProxyUrl: (url: string | undefined) => mockSetTelegramProxyUrl(url),
  setTelegramRemoteEnabled: (enabled: boolean) =>
    mockSetTelegramRemoteEnabled(enabled),
  shouldSendTelegramNotifications: () => mockShouldSendTelegramNotifications(),
}))

vi.mock('src/services/telegram/sender.js', () => ({
  sendTelegramMessage: (text: string) => mockSendTelegramMessage(text),
  validateTelegramBot: (token: string) => mockValidateTelegramBot(token),
}))

vi.mock('src/services/telegram/interactionNotifier.js', () => ({
  sendTelegramInteractionConnected: (sessionId: string) =>
    mockSendTelegramInteractionConnected(sessionId),
  sendTelegramInteractionDisconnected: (sessionId: string) =>
    mockSendTelegramInteractionDisconnected(sessionId),
  sendTelegramRemoteDisabled: (sessionId: string) =>
    mockSendTelegramRemoteDisabled(sessionId),
}))

describe('telegram command interaction notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockReadTelegramConfig.mockReturnValue({
      botToken: 'test-token',
      chatId: '12345',
      enabled: true,
      remoteEnabled: true,
      interactionSessionId: 'session-1',
      remoteDebug: {},
    })
    mockGetSessionId.mockReturnValue('session-1')
    mockSetTelegramRemoteEnabled.mockReturnValue(true)
    mockGetTelegramInteractionSessionId.mockReturnValue('session-1')
    mockGetTelegramProxyUrl.mockReturnValue(undefined)
    mockGetTelegramRemoteDebugState.mockReturnValue({})
    mockHasTelegramCredentials.mockReturnValue(true)
    mockIsTelegramEnabledForSession.mockReturnValue(true)
    mockIsTelegramGloballyEnabled.mockReturnValue(true)
    mockIsTelegramRemoteEnabled.mockReturnValue(true)
    mockShouldSendTelegramNotifications.mockReturnValue(true)
    mockGetSessionTelegramNotificationsEnabled.mockReturnValue(true)
  })

  it('sends a Telegram confirmation when inter is bound to the current session', async () => {
    const { call } = await import('src/commands/telegram/telegram.js')

    const result = await call('inter')

    expect(result).toEqual({
      type: 'text',
      value: 'Telegram interaction session set to current session: session-1',
    })
    expect(mockSetTelegramRemoteEnabled).toHaveBeenCalledWith(true)
    expect(mockSetTelegramInteractionSession).toHaveBeenCalledWith('session-1')
    expect(mockSendTelegramInteractionConnected).toHaveBeenCalledWith('session-1')
  })

  it('keeps interaction as a backward-compatible alias', async () => {
    const { call } = await import('src/commands/telegram/telegram.js')

    const result = await call('interaction')

    expect(result).toEqual({
      type: 'text',
      value: 'Telegram interaction session set to current session: session-1',
    })
  })

  it('preserves remote interaction state when save updates credentials', async () => {
    mockReadTelegramConfig.mockReturnValue({
      botToken: 'old-token',
      chatId: '111',
      enabled: true,
      remoteEnabled: true,
      interactionSessionId: 'session-1',
      lastUpdateId: 42,
      remoteDebug: { status: 'ok' },
    })
    mockValidateTelegramBot.mockResolvedValue({ ok: true, username: 'newbot' })

    const { call } = await import('src/commands/telegram/telegram.js')

    const result = await call('save new-token 222')

    expect(result).toEqual({
      type: 'text',
      value: 'Telegram configured for @newbot. Run /telegram test to verify.',
    })
    expect(mockSaveTelegramConfig).toHaveBeenCalledWith({
      botToken: 'new-token',
      chatId: '222',
      enabled: true,
      remoteEnabled: true,
      interactionSessionId: 'session-1',
      lastUpdateId: 42,
      remoteDebug: { status: 'ok' },
    })
  })

  it('sends a Telegram notification when clearing inter session', async () => {
    const { call } = await import('src/commands/telegram/telegram.js')

    const result = await call('inter clear')

    expect(result).toEqual({
      type: 'text',
      value:
        'Telegram interaction session cleared. Telegram input will no longer be consumed by this session.',
    })
    expect(mockSetTelegramInteractionSession).toHaveBeenCalledWith(undefined)
    expect(mockSendTelegramInteractionDisconnected).toHaveBeenCalledWith(
      'session-1',
    )
  })

  it('sends a Telegram notification when remote bridge is disabled', async () => {
    const { call } = await import('src/commands/telegram/telegram.js')

    const result = await call('remote-off')

    expect(result).toEqual({
      type: 'text',
      value: 'Telegram remote bridge disabled.',
    })
    expect(mockSetTelegramRemoteEnabled).toHaveBeenCalledWith(false)
    expect(mockSendTelegramRemoteDisabled).toHaveBeenCalledWith('session-1')
  })
})
