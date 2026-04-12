import { chmodSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { getErrnoCode } from '../../utils/errors.js'

export interface TelegramConfig {
  botToken: string
  chatId: string
  enabled: boolean
}

const CONFIG_FILE = 'telegram.json'

function getConfigPath(): string {
  return join(getClaudeConfigHomeDir(), CONFIG_FILE)
}

export function readTelegramConfig(): TelegramConfig | null {
  // Env vars take precedence
  const envToken = process.env.TELEGRAM_BOT_TOKEN
  const envChat = process.env.TELEGRAM_CHAT_ID
  if (envToken && envChat) {
    return { botToken: envToken, chatId: envChat, enabled: true }
  }

  try {
    const data = readFileSync(getConfigPath(), { encoding: 'utf8' })
    return JSON.parse(data)
  } catch {
    return null
  }
}

export function saveTelegramConfig(config: TelegramConfig): void {
  const dir = getClaudeConfigHomeDir()
  try {
    mkdirSync(dir, { recursive: true })
  } catch (e: unknown) {
    if (getErrnoCode(e) !== 'EEXIST') throw e
  }
  const path = getConfigPath()
  writeFileSync(path, JSON.stringify(config, null, 2), { encoding: 'utf8' })
  chmodSync(path, 0o600)
}

export function deleteTelegramConfig(): boolean {
  try {
    unlinkSync(getConfigPath())
    return true
  } catch (e: unknown) {
    if (getErrnoCode(e) === 'ENOENT') return true
    return false
  }
}

export function isTelegramConfigured(): boolean {
  const config = readTelegramConfig()
  return config !== null && config.enabled && !!config.botToken && !!config.chatId
}
