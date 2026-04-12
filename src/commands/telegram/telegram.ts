import type { LocalCommandCall } from '../../types/command.js'
import {
  readTelegramConfig,
  saveTelegramConfig,
  deleteTelegramConfig,
} from '../../services/telegram/config.js'
import {
  sendTelegramMessage,
  validateTelegramBot,
} from '../../services/telegram/sender.js'

export const call: LocalCommandCall = async (args) => {
  const parts = args.trim().split(/\s+/)
  const sub = parts[0] || 'show'

  switch (sub) {
    case 'setup':
      return setup()
    case 'show':
      return show()
    case 'save':
      return save(parts[1], parts[2])
    case 'clear':
      return clear()
    case 'test':
      return test()
    default:
      return {
        type: 'text',
        value: `Unknown subcommand: ${sub}\nUsage: /telegram setup | show | save <token> <chat_id> | clear | test`,
      }
  }
}

async function setup(): Promise<{ type: 'text'; value: string }> {
  return {
    type: 'text',
    value: [
      'To set up Telegram notifications:',
      '',
      '1. Create a bot via @BotFather on Telegram and copy the bot token',
      '2. Send a message to your bot, then visit:',
      '   https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates',
      '   to find your chat_id (in result.message.chat.id)',
      '3. Set environment variables (add to your shell profile):',
      '',
      '   export TELEGRAM_BOT_TOKEN=<bot_token>',
      '   export TELEGRAM_CHAT_ID=<chat_id>',
      '',
      'Or save config directly:',
      '   /telegram save <bot_token> <chat_id>',
      '',
      'Then verify with: /telegram test',
    ].join('\n'),
  }
}

function show(): { type: 'text'; value: string } {
  const config = readTelegramConfig()
  if (!config) {
    return {
      type: 'text',
      value: 'Telegram not configured. Run /telegram setup for instructions.',
    }
  }
  const masked = config.botToken
    ? config.botToken.slice(0, 6) + '...' + config.botToken.slice(-4)
    : '(empty)'
  return {
    type: 'text',
    value: [
      `Telegram notifications: ${config.enabled ? 'enabled' : 'disabled'}`,
      `Bot token: ${masked}`,
      `Chat ID: ${config.chatId || '(empty)'}`,
    ].join('\n'),
  }
}

function clear(): { type: 'text'; value: string } {
  const ok = deleteTelegramConfig()
  return {
    type: 'text',
    value: ok
      ? 'Telegram configuration cleared.'
      : 'Failed to clear Telegram configuration.',
  }
}

async function save(
  botToken: string | undefined,
  chatId: string | undefined,
): Promise<{ type: 'text'; value: string }> {
  if (!botToken || !chatId) {
    return {
      type: 'text',
      value: 'Usage: /telegram save <bot_token> <chat_id>',
    }
  }

  const validation = await validateTelegramBot(botToken)
  if (!validation.ok) {
    return {
      type: 'text',
      value: 'Bot token validation failed. Check your token and try again.',
    }
  }

  saveTelegramConfig({ botToken, chatId, enabled: true })
  return {
    type: 'text',
    value: `Telegram configured for @${validation.username || 'unknown'}. Run /telegram test to verify.`,
  }
}

async function test(): Promise<{ type: 'text'; value: string }> {
  const config = readTelegramConfig()
  if (!config || !config.botToken || !config.chatId) {
    return {
      type: 'text',
      value: 'Telegram not configured. Run /telegram setup first.',
    }
  }

  const validation = await validateTelegramBot(config.botToken)
  if (!validation.ok) {
    return {
      type: 'text',
      value: 'Bot token validation failed. Check your token.',
    }
  }

  const sent = await sendTelegramMessage(
    `✅ Claude Code test notification\nBot: @${validation.username || 'unknown'}`,
  )
  return {
    type: 'text',
    value: sent
      ? `Test message sent via @${validation.username || 'unknown'}.`
      : 'Failed to send test message. Check your chat_id.',
  }
}
