import { describe, expect, it, vi } from 'vitest'

const mockReadTelegramConfig = vi.fn()
const mockSendTelegramMessage = vi.fn()

vi.mock('src/services/telegram/config.js', () => ({
  readTelegramConfig: () => mockReadTelegramConfig(),
}))

vi.mock('src/services/telegram/sender.js', () => ({
  sendTelegramMessage: (text: string) => mockSendTelegramMessage(text),
}))

describe('telegram/interactionNotifier', () => {
  it('truncates long text with an ellipsis', async () => {
    mockReadTelegramConfig.mockReturnValue(null)

    const { truncateTelegramText } = await import(
      'src/services/telegram/interactionNotifier.js'
    )

    expect(truncateTelegramText('a'.repeat(30), 10)).toBe('aaaaaaaaa…')
  })

  it('detects whether the current session should receive rich interaction updates', async () => {
    mockReadTelegramConfig.mockReturnValue({
      botToken: 'test-token',
      chatId: '12345',
      enabled: true,
      remoteEnabled: true,
      interactionSessionId: 'session-1',
    })

    const { shouldSendTelegramInteractionUpdates } = await import(
      'src/services/telegram/interactionNotifier.js'
    )

    expect(shouldSendTelegramInteractionUpdates('session-1')).toBe(true)
    expect(shouldSendTelegramInteractionUpdates('session-2')).toBe(false)
  })

  it('builds the latest assistant summary from transcript messages', async () => {
    mockReadTelegramConfig.mockReturnValue(null)

    const { getLatestTelegramAssistantSummary } = await import(
      'src/services/telegram/interactionNotifier.js'
    )

    const summary = getLatestTelegramAssistantSummary([
      {
        type: 'user',
        message: { content: 'hello' },
      },
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'First line' },
            { type: 'text', text: 'Second line' },
          ],
        },
      },
    ] as never)

    expect(summary).toBe('First line Second line')
  })
})
