import {
  getSessionTelegramNotificationsEnabled,
  setSessionTelegramNotificationsEnabled,
} from '../../bootstrap/state.js'
import type { LocalCommandCall } from '../../types/command.js'
import {
  deleteTelegramConfig,
  getTelegramInteractionSessionId,
  getTelegramProxyUrl,
  getTelegramRemoteDebugState,
  hasTelegramCredentials,
  isTelegramEnabledForSession,
  isTelegramGloballyEnabled,
  isTelegramRemoteEnabled,
  readTelegramConfig,
  saveTelegramConfig,
  setTelegramProxyUrl,
  setTelegramGloballyEnabled,
  setTelegramInteractionSession,
  setTelegramRemoteEnabled,
  shouldSendTelegramNotifications,
} from '../../services/telegram/config.js'
import { getSessionId } from '../../bootstrap/state.js'
import {
  sendTelegramInteractionConnected,
  sendTelegramInteractionDisconnected,
  sendTelegramRemoteDisabled,
} from '../../services/telegram/interactionNotifier.js'
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
    case 'enable':
      return enableSession()
    case 'disable':
      return disableSession()
    case 'enable-global':
      return enableGlobal()
    case 'disable-global':
      return disableGlobal()
    case 'test':
      return test()
    case 'remote-on':
      return remoteOn()
    case 'remote-off':
      return remoteOff()
    case 'interaction':
      return interaction(parts.slice(1))
    case 'proxy':
      return proxy(parts.slice(1))
    default:
      return {
        type: 'text',
        value:
          `Unknown subcommand: ${sub}\n` +
          'Usage: /telegram setup | show | save <token> <chat_id> | clear | enable | disable | enable-global | disable-global | test | remote-on | remote-off | interaction | interaction clear | proxy <url> | proxy clear',
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
      'Optional toggles:',
      '   /telegram disable          # disable in this session only',
      '   /telegram disable-global   # disable across sessions',
      '',
      'Then verify with: /telegram test',
    ].join('\n'),
  }
}

function show(): { type: 'text'; value: string } {
  const config = readTelegramConfig()
  const hasCredentials = hasTelegramCredentials()
  const globalEnabled = isTelegramGloballyEnabled()
  const sessionEnabled = isTelegramEnabledForSession()
  const effectiveEnabled = shouldSendTelegramNotifications()

  if (!config) {
    return {
      type: 'text',
      value: [
        'Telegram not configured. Run /telegram setup for instructions.',
        `Global toggle: ${globalEnabled ? 'enabled' : 'disabled'}`,
        `Session toggle: ${sessionEnabled ? 'enabled' : 'disabled'}`,
        `Effective sending: ${effectiveEnabled ? 'enabled' : 'disabled'}`,
        `Remote bridge: ${isTelegramRemoteEnabled() ? 'enabled' : 'disabled'}`,
        `Interaction session: ${getTelegramInteractionSessionId() || '(none)'}`,
      ].join('\n'),
    }
  }

  const masked = config.botToken
    ? config.botToken.slice(0, 6) + '...' + config.botToken.slice(-4)
    : '(empty)'

  const reasons: string[] = []
  if (!hasCredentials) reasons.push('missing credentials')
  if (!globalEnabled) reasons.push('disabled globally')
  if (!sessionEnabled) reasons.push('disabled in this session')
  const debug = getTelegramRemoteDebugState()

  return {
    type: 'text',
    value: [
      `Telegram credentials: ${hasCredentials ? 'configured' : 'missing'}`,
      `Global toggle: ${globalEnabled ? 'enabled' : 'disabled'}`,
      `Session toggle: ${sessionEnabled ? 'enabled' : 'disabled'}`,
      `Effective sending: ${effectiveEnabled ? 'enabled' : 'disabled'}`,
      `Remote bridge: ${isTelegramRemoteEnabled() ? 'enabled' : 'disabled'}`,
      `Interaction session: ${getTelegramInteractionSessionId() || '(none)'}`,
      `Bot token: ${masked}`,
      `Chat ID: ${config.chatId || '(empty)'}`,
      `Proxy URL: ${getTelegramProxyUrl() || '(none)'}`,
      `Remote status: ${debug?.status || '(unknown)'}`,
      `Last poll at: ${debug?.lastPollAt || '(none)'}`,
      `Last success at: ${debug?.lastSuccessAt || '(none)'}`,
      `Last error: ${debug?.lastError || '(none)'}`,
      `Last error at: ${debug?.lastErrorAt || '(none)'}`,
      `Last ignored reason: ${debug?.lastIgnoredReason || '(none)'}`,
      `Last ignored at: ${debug?.lastIgnoredAt || '(none)'}`,
      `Last inbound text: ${debug?.lastInboundText || '(none)'}`,
      `Last inbound at: ${debug?.lastInboundAt || '(none)'}`,
      ...(reasons.length > 0 ? [`Reason: ${reasons.join(', ')}`] : []),
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

function enableSession(): { type: 'text'; value: string } {
  setSessionTelegramNotificationsEnabled(true)
  return {
    type: 'text',
    value: `Telegram notifications enabled for this session. Global toggle is currently ${isTelegramGloballyEnabled() ? 'enabled' : 'disabled'}.`,
  }
}

function disableSession(): { type: 'text'; value: string } {
  setSessionTelegramNotificationsEnabled(false)
  return {
    type: 'text',
    value: 'Telegram notifications disabled for this session.',
  }
}

function enableGlobal(): { type: 'text'; value: string } {
  setTelegramGloballyEnabled(true)
  return {
    type: 'text',
    value: `Telegram notifications enabled globally. Session toggle is currently ${getSessionTelegramNotificationsEnabled() ? 'enabled' : 'disabled'}.`,
  }
}

function disableGlobal(): { type: 'text'; value: string } {
  setTelegramGloballyEnabled(false)
  return {
    type: 'text',
    value: 'Telegram notifications disabled globally.',
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

  if (!shouldSendTelegramNotifications()) {
    return {
      type: 'text',
      value: 'Telegram is configured, but sending is currently disabled by the global or session toggle.',
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

function remoteOn(): { type: 'text'; value: string } {
  const next = setTelegramRemoteEnabled(true)
  return {
    type: 'text',
    value: next
      ? 'Telegram remote bridge enabled.'
      : 'Telegram not configured. Run /telegram setup first.',
  }
}

function remoteOff(): { type: 'text'; value: string } {
  const currentSessionId = getTelegramInteractionSessionId()
  const next = setTelegramRemoteEnabled(false)
  if (next && currentSessionId) {
    void sendTelegramRemoteDisabled(currentSessionId)
  }
  return {
    type: 'text',
    value: next
      ? 'Telegram remote bridge disabled.'
      : 'Telegram not configured. Run /telegram setup first.',
  }
}

function proxy(args: string[]): { type: 'text'; value: string } {
  const config = readTelegramConfig()
  if (!config || !config.botToken || !config.chatId) {
    return {
      type: 'text',
      value: 'Telegram not configured. Run /telegram setup first.',
    }
  }

  const value = args[0]
  if (!value) {
    return {
      type: 'text',
      value: 'Usage: /telegram proxy <url> | /telegram proxy clear',
    }
  }

  if (value === 'clear') {
    setTelegramProxyUrl(undefined)
    return {
      type: 'text',
      value: 'Telegram proxy cleared.',
    }
  }

  setTelegramProxyUrl(value)
  return {
    type: 'text',
    value: `Telegram proxy set to: ${value}`,
  }
}

function interaction(args: string[]): { type: 'text'; value: string } {
  const config = readTelegramConfig()
  if (!config || !config.botToken || !config.chatId) {
    return {
      type: 'text',
      value: 'Telegram not configured. Run /telegram setup first.',
    }
  }

  const sub = args[0]
  if (sub === 'clear') {
    const currentSessionId = getTelegramInteractionSessionId()
    setTelegramInteractionSession(undefined)
    if (currentSessionId) {
      void sendTelegramInteractionDisconnected(currentSessionId)
    }
    return {
      type: 'text',
      value: 'Telegram interaction session cleared. Telegram input will no longer be consumed by this session.',
    }
  }

  if (args.length > 0) {
    return {
      type: 'text',
      value: 'Usage: /telegram interaction | /telegram interaction clear',
    }
  }

  const sessionId = getSessionId()
  setTelegramRemoteEnabled(true)
  setTelegramInteractionSession(sessionId)
  void sendTelegramInteractionConnected(sessionId)
  return {
    type: 'text',
    value: `Telegram interaction session set to current session: ${sessionId}`,
  }
}
