import type { Message } from '../../types/message.js'
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs'
import { readTelegramConfig } from './config.js'
import { sendTelegramMessage } from './sender.js'

const DEFAULT_PREVIEW_LIMIT = 240

function normalizeTelegramText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function extractContentText(
  content: string | readonly ContentBlockParam[],
): string | null {
  if (typeof content === 'string') {
    return content.trim() || null
  }

  if (!Array.isArray(content)) {
    return null
  }

  const text = content
    .filter((block): block is ContentBlockParam & { type: 'text'; text: string } =>
      block.type === 'text' && typeof block.text === 'string',
    )
    .map(block => block.text)
    .join('\n')
    .trim()

  return text || null
}

export function truncateTelegramText(
  text: string,
  limit = DEFAULT_PREVIEW_LIMIT,
): string {
  const normalized = normalizeTelegramText(text)
  if (normalized.length <= limit) {
    return normalized
  }

  return `${normalized.slice(0, Math.max(0, limit - 1)).trimEnd()}…`
}

export function shouldSendTelegramInteractionUpdates(sessionId: string): boolean {
  const config = readTelegramConfig()
  return Boolean(
    config?.enabled &&
      config.botToken &&
      config.chatId &&
      config.remoteEnabled &&
      config.interactionSessionId === sessionId,
  )
}

function buildTelegramInteractionMessage(
  title: string,
  sessionId: string,
  details: string[] = [],
): string {
  return [title, `Session: ${sessionId}`, ...details.filter(Boolean)].join('\n')
}

async function sendTelegramInteractionUpdate(
  sessionId: string,
  title: string,
  details: string[] = [],
): Promise<boolean> {
  if (!shouldSendTelegramInteractionUpdates(sessionId)) {
    return false
  }

  return sendTelegramMessage(
    buildTelegramInteractionMessage(title, sessionId, details),
  )
}

export async function sendTelegramInteractionConnected(
  sessionId: string,
): Promise<boolean> {
  return sendTelegramInteractionUpdate(
    sessionId,
    '✅ Telegram interaction connected',
    [
      'Reply in this chat to send input to the bound Claude Code session.',
      'You will receive queued, waiting, and completion updates here.',
    ],
  )
}

export async function sendTelegramInteractionDisconnected(
  sessionId: string,
): Promise<boolean> {
  return sendTelegramInteractionUpdate(
    sessionId,
    '⏹️ Telegram interaction disconnected',
    ['This session will stop consuming Telegram replies.'],
  )
}

export async function sendTelegramRemoteDisabled(
  sessionId: string,
): Promise<boolean> {
  return sendTelegramInteractionUpdate(
    sessionId,
    '⏸️ Telegram remote bridge disabled',
    ['Re-enable the remote bridge to continue Telegram interaction.'],
  )
}

export async function sendTelegramInboundQueued(
  sessionId: string,
  text: string,
): Promise<boolean> {
  return sendTelegramInteractionUpdate(
    sessionId,
    '📨 Telegram message queued',
    [
      `Text: ${truncateTelegramText(text, 160)}`,
      'Claude Code is processing it now.',
    ],
  )
}

export async function sendTelegramWaitState(
  sessionId: string,
  reason: string,
  details: string[] = [],
): Promise<boolean> {
  return sendTelegramInteractionUpdate(sessionId, '⏳ Claude Code is waiting', [
    `Reason: ${reason}`,
    ...details,
  ])
}

export function getLatestTelegramAssistantSummary(
  messages: readonly Message[],
): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]
    if (message?.type !== 'assistant') {
      continue
    }

    const text = extractContentText(message.message.content)
    if (!text) {
      continue
    }

    return truncateTelegramText(text)
  }

  return null
}

export async function sendTelegramTurnComplete(
  sessionId: string,
  messages: readonly Message[],
): Promise<boolean> {
  const summary = getLatestTelegramAssistantSummary(messages)

  return sendTelegramInteractionUpdate(
    sessionId,
    '✅ Claude Code turn complete',
    summary
      ? [
          `Summary: ${summary}`,
          'Status: Waiting for your next Telegram message.',
        ]
      : ['Status: Waiting for your next Telegram message.'],
  )
}
