import { logError } from '../../utils/log.js'
import { getTelegramFetchOptions } from './fetchOptions.js'
import { readTelegramConfig } from './config.js'

const TELEGRAM_API = 'https://api.telegram.org'
const TIMEOUT_MS = 10_000

export type TelegramInlineKeyboardButton = {
  text: string
  callback_data: string
}

export type TelegramInlineKeyboardMarkup = {
  inline_keyboard: TelegramInlineKeyboardButton[][]
}

type TelegramSendMessageParams = {
  text: string
  replyMarkup?: TelegramInlineKeyboardMarkup
}

type TelegramSendMessageResult = {
  ok: boolean
  messageId?: number
}

function normalizeSendParams(
  input: string | TelegramSendMessageParams,
): TelegramSendMessageParams {
  return typeof input === 'string' ? { text: input } : input
}

async function callTelegramApi<T>(
  method: string,
  body: Record<string, unknown>,
): Promise<T | null> {
  const config = readTelegramConfig()
  if (!config || !config.enabled || !config.botToken || !config.chatId) {
    return null
  }

  const url = `${TELEGRAM_API}/bot${config.botToken}/${method}`

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
      ...getTelegramFetchOptions(),
    })

    clearTimeout(timer)

    if (!res.ok) {
      const responseBody = await res.text().catch(() => '')
      logError(`Telegram ${method} failed (${res.status}): ${responseBody}`)
      return null
    }

    try {
      return (await res.json()) as T
    } catch {
      return ({ ok: true } satisfies Record<string, unknown>) as T
    }
  } catch (err: unknown) {
    logError(err)
    return null
  }
}

export async function sendTelegramMessage(text: string): Promise<boolean>
export async function sendTelegramMessage(
  params: TelegramSendMessageParams,
): Promise<TelegramSendMessageResult>
export async function sendTelegramMessage(
  input: string | TelegramSendMessageParams,
): Promise<boolean | TelegramSendMessageResult> {
  const config = readTelegramConfig()
  if (!config || !config.enabled || !config.botToken || !config.chatId) {
    return typeof input === 'string' ? false : { ok: false }
  }

  const params = normalizeSendParams(input)
  const body: Record<string, unknown> = {
    chat_id: config.chatId,
    text: params.text,
  }
  if (params.replyMarkup) {
    body.reply_markup = params.replyMarkup
  }

  const data = await callTelegramApi<{
    ok: boolean
    result?: { message_id?: number }
  }>('sendMessage', body)

  if (!data?.ok) {
    return typeof input === 'string' ? false : { ok: false }
  }

  const result: TelegramSendMessageResult = {
    ok: true,
    messageId: data.result?.message_id,
  }

  return typeof input === 'string' ? true : result
}

export async function editTelegramMessage(params: {
  messageId: number
  text: string
  replyMarkup?: TelegramInlineKeyboardMarkup
}): Promise<boolean> {
  const config = readTelegramConfig()
  if (!config || !config.enabled || !config.botToken || !config.chatId) {
    return false
  }

  const body: Record<string, unknown> = {
    chat_id: config.chatId,
    message_id: params.messageId,
    text: params.text,
  }
  if (params.replyMarkup) {
    body.reply_markup = params.replyMarkup
  }

  const data = await callTelegramApi<{ ok: boolean }>('editMessageText', body)
  return data?.ok === true
}

export async function answerTelegramCallbackQuery(params: {
  callbackQueryId: string
  text?: string
}): Promise<boolean> {
  const body: Record<string, unknown> = {
    callback_query_id: params.callbackQueryId,
  }
  if (params.text) {
    body.text = params.text
  }

  const data = await callTelegramApi<{ ok: boolean }>('answerCallbackQuery', body)
  return data?.ok === true
}

export async function validateTelegramBot(botToken: string): Promise<{ ok: boolean; username?: string }> {
  const url = `${TELEGRAM_API}/bot${botToken}/getMe`
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

    const res = await fetch(url, {
      signal: controller.signal,
      ...getTelegramFetchOptions(),
    })
    clearTimeout(timer)

    if (!res.ok) return { ok: false }

    const data = (await res.json()) as { ok: boolean; result?: { username?: string } }
    return { ok: data.ok, username: data.result?.username }
  } catch {
    return { ok: false }
  }
}
