import { chmodSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import {
  getSessionTelegramNotificationsEnabled,
} from '../../bootstrap/state.js'
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { getErrnoCode } from '../../utils/errors.js'

export interface TelegramRemoteDebugState {
  status?: string
  lastPollAt?: string
  lastSuccessAt?: string
  lastErrorAt?: string
  lastError?: string
  lastIgnoredAt?: string
  lastIgnoredReason?: string
  lastInboundAt?: string
  lastInboundText?: string
}

export interface TelegramConfig {
  botToken: string
  chatId: string
  enabled: boolean
  proxyUrl?: string
  remoteEnabled?: boolean
  interactionSessionId?: string
  lastUpdateId?: number
  remoteDebug?: TelegramRemoteDebugState
}

const CONFIG_FILE = 'telegram.json'

function getConfigPath(): string {
  return join(getClaudeConfigHomeDir(), CONFIG_FILE)
}

export function readTelegramConfig(): TelegramConfig | null {
  let fileConfig: TelegramConfig | null = null

  try {
    const data = readFileSync(getConfigPath(), { encoding: 'utf8' })
    fileConfig = JSON.parse(data) as TelegramConfig
  } catch {
    fileConfig = null
  }

  // Env vars take precedence for credentials, but keep remote state from file.
  const envToken = process.env.TELEGRAM_BOT_TOKEN
  const envChat = process.env.TELEGRAM_CHAT_ID
  if (envToken && envChat) {
    return {
      ...(fileConfig ?? {}),
      botToken: envToken,
      chatId: envChat,
      enabled: true,
    }
  }

  return fileConfig
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

export function hasTelegramCredentials(): boolean {
  const config = readTelegramConfig()
  return config !== null && !!config.botToken && !!config.chatId
}

export function isTelegramGloballyEnabled(): boolean {
  const globalValue = getGlobalConfig().telegramNotificationsEnabled
  if (globalValue !== undefined) {
    return globalValue
  }

  const config = readTelegramConfig()
  if (config?.enabled !== undefined) {
    return config.enabled
  }

  return true
}

export function setTelegramGloballyEnabled(enabled: boolean): void {
  saveGlobalConfig(current => ({
    ...current,
    telegramNotificationsEnabled: enabled,
  }))
}

function saveTelegramConfigPatch(
  patch: Partial<TelegramConfig>,
): TelegramConfig | null {
  const current = readTelegramConfig()
  if (!current) {
    return null
  }

  const next: TelegramConfig = {
    ...current,
    ...patch,
  }
  saveTelegramConfig(next)
  return next
}

export function isTelegramRemoteEnabled(): boolean {
  return readTelegramConfig()?.remoteEnabled === true
}

export function setTelegramRemoteEnabled(enabled: boolean): TelegramConfig | null {
  return saveTelegramConfigPatch({ remoteEnabled: enabled })
}

export function getTelegramInteractionSessionId(): string | undefined {
  return readTelegramConfig()?.interactionSessionId
}

export function setTelegramInteractionSession(
  sessionId: string | undefined,
): TelegramConfig | null {
  return saveTelegramConfigPatch({ interactionSessionId: sessionId })
}

export function getTelegramLastUpdateId(): number | undefined {
  return readTelegramConfig()?.lastUpdateId
}

export function setTelegramLastUpdateId(
  lastUpdateId: number,
): TelegramConfig | null {
  return saveTelegramConfigPatch({ lastUpdateId })
}

export function getTelegramProxyUrl(): string | undefined {
  return readTelegramConfig()?.proxyUrl
}

export function setTelegramProxyUrl(
  proxyUrl: string | undefined,
): TelegramConfig | null {
  return saveTelegramConfigPatch({ proxyUrl })
}

export function getTelegramRemoteDebugState(): TelegramRemoteDebugState | undefined {
  return readTelegramConfig()?.remoteDebug
}

export function setTelegramRemoteDebugState(
  remoteDebug: TelegramRemoteDebugState,
): TelegramConfig | null {
  return saveTelegramConfigPatch({ remoteDebug })
}

export function isTelegramEnabledForSession(): boolean {
  return getSessionTelegramNotificationsEnabled()
}

export function isTelegramConfigured(): boolean {
  return hasTelegramCredentials() && isTelegramGloballyEnabled()
}

export function shouldSendTelegramNotifications(): boolean {
  return (
    hasTelegramCredentials() &&
    isTelegramGloballyEnabled() &&
    isTelegramEnabledForSession()
  )
}
