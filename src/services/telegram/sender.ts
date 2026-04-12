import { logError } from '../../utils/log.js'
import { readTelegramConfig } from './config.js'

const TELEGRAM_API = 'https://api.telegram.org'
const TIMEOUT_MS = 10_000

export async function sendTelegramMessage(text: string): Promise<boolean> {
  const config = readTelegramConfig()
  if (!config || !config.enabled || !config.botToken || !config.chatId) {
    return false
  }

  const url = `${TELEGRAM_API}/bot${config.botToken}/sendMessage`

  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: config.chatId,
        text,
      }),
      signal: controller.signal,
    })

    clearTimeout(timer)

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      logError(`Telegram send failed (${res.status}): ${body}`)
      return false
    }

    return true
  } catch (err: unknown) {
    logError(err)
    return false
  }
}

export async function validateTelegramBot(botToken: string): Promise<{ ok: boolean; username?: string }> {
  const url = `${TELEGRAM_API}/bot${botToken}/getMe`
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

    const res = await fetch(url, { signal: controller.signal })
    clearTimeout(timer)

    if (!res.ok) return { ok: false }

    const data = (await res.json()) as { ok: boolean; result?: { username?: string } }
    return { ok: data.ok, username: data.result?.username }
  } catch {
    return { ok: false }
  }
}
