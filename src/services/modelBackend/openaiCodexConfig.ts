import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { normalizeOpenAICompatibleModel } from './openaiModelCatalog.js'

type StringMap = Record<string, string>

type CodexProviderConfig = {
  providerId: string
  model: string
  disableResponseStorage: boolean
  baseUrl: string
  wireApi: string
  requiresOpenAIAuth: boolean
  promptCacheRetention?: 'in_memory' | '24h'
  modelContextWindow?: number
  reasoningEffort?: OpenAIReasoningEffort
  envKey?: string
  httpHeaders?: StringMap
  envHttpHeaders?: StringMap
  queryParams?: StringMap
  experimentalBearerToken?: string
}

type CodexAuthMode = 'apikey' | 'chatgpt' | 'chatgptAuthTokens'

type CodexAuthConfig = {
  authMode?: CodexAuthMode
  openaiApiKey?: string
}

export type OpenAIReasoningEffort =
  | 'none'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'

let cachedProviderConfig: CodexProviderConfig | null | undefined
let cachedAuthConfig: CodexAuthConfig | null | undefined

const DEFAULT_MODEL = 'gpt-5.4'
const DEFAULT_BASE_URL = 'https://api.openai.com/v1'

function getCodexConfigPath(): string {
  return join(homedir(), '.codex', 'config.toml')
}

function getCodexAuthPath(): string {
  return join(homedir(), '.codex', 'auth.json')
}

function readIfExists(path: string): string | null {
  try {
    return existsSync(path) ? readFileSync(path, 'utf8') : null
  } catch {
    return null
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function trimToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function matchString(source: string, pattern: RegExp): string | undefined {
  return trimToUndefined(source.match(pattern)?.[1])
}

function matchBoolean(source: string, pattern: RegExp): boolean | undefined {
  const value = source.match(pattern)?.[1]
  if (value === 'true') return true
  if (value === 'false') return false
  return undefined
}

function matchInteger(source: string, pattern: RegExp): number | undefined {
  const value = source.match(pattern)?.[1]
  if (!value) return undefined
  const parsed = parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function normalizePromptCacheRetention(
  value: string | undefined,
): 'in_memory' | '24h' | undefined {
  const normalized = value?.trim().toLowerCase()
  if (normalized === '24h') return '24h'
  if (normalized === 'in_memory' || normalized === 'in-memory') {
    return 'in_memory'
  }
  return undefined
}

function normalizeReasoningEffort(
  value: string | undefined,
): OpenAIReasoningEffort | undefined {
  const normalized = value?.trim().toLowerCase()
  switch (normalized) {
    case 'none':
    case 'minimal':
    case 'low':
    case 'medium':
    case 'high':
    case 'xhigh':
      return normalized
    case 'max':
      return 'xhigh'
    default:
      return undefined
  }
}

function normalizeAuthMode(value: string | undefined): CodexAuthMode | undefined {
  switch (value?.trim()) {
    case 'apikey':
      return 'apikey'
    case 'chatgpt':
      return 'chatgpt'
    case 'chatgptAuthTokens':
      return 'chatgptAuthTokens'
    default:
      return undefined
  }
}

function getTableSection(source: string, tablePath: string): string {
  const escaped = escapeRegex(tablePath)
  const pattern = new RegExp(
    `\\[${escaped}\\]([\\s\\S]*?)(?=\\n\\[[^\\]]+\\]|$)`,
  )
  return source.match(pattern)?.[1] ?? ''
}

function getActiveProfileSection(source: string): string {
  const profileName = matchString(source, /^profile\s*=\s*"([^"]+)"/m)
  if (!profileName) {
    return ''
  }
  return getTableSection(source, `profiles.${profileName}`)
}

function matchInlineTableBody(source: string, key: string): string | undefined {
  const pattern = new RegExp(
    `^\\s*${escapeRegex(key)}\\s*=\\s*\\{([^\\n]*)\\}\\s*$`,
    'm',
  )
  return source.match(pattern)?.[1]
}

function parseInlineStringMap(value: string | undefined): StringMap | undefined {
  if (!value) {
    return undefined
  }

  const entries: StringMap = {}
  const pattern = /(?:"([^"]+)"|([A-Za-z0-9_.-]+))\s*=\s*"([^"]*)"/g

  let match: RegExpExecArray | null
  while ((match = pattern.exec(value)) !== null) {
    const key = match[1] ?? match[2]
    const entryValue = match[3]
    if (!key) {
      continue
    }
    entries[key] = entryValue
  }

  return Object.keys(entries).length > 0 ? entries : undefined
}

function mergeStringMaps(
  ...maps: Array<StringMap | undefined>
): StringMap | undefined {
  const merged: StringMap = {}

  for (const map of maps) {
    if (!map) continue
    for (const [key, value] of Object.entries(map)) {
      const trimmed = trimToUndefined(value)
      if (trimmed) {
        merged[key] = trimmed
      }
    }
  }

  return Object.keys(merged).length > 0 ? merged : undefined
}

function normalizeBaseUrl(baseUrl: string | undefined): string {
  const trimmed = (baseUrl || DEFAULT_BASE_URL).trim().replace(/\/+$/, '')
  if (trimmed.endsWith('/responses')) {
    return trimmed.slice(0, -'/responses'.length)
  }
  return trimmed
}

function getEffectiveProviderId(raw: string, profileSection: string): string {
  return (
    matchString(profileSection, /^\s*model_provider\s*=\s*"([^"]+)"/m) ||
    matchString(raw, /^model_provider\s*=\s*"([^"]+)"/m) ||
    'openai'
  )
}

function getEffectiveModel(raw: string, profileSection: string): string {
  return (
    matchString(profileSection, /^\s*model\s*=\s*"([^"]+)"/m) ||
    matchString(raw, /^model\s*=\s*"([^"]+)"/m) ||
    DEFAULT_MODEL
  )
}

export function loadCodexProviderConfig(): CodexProviderConfig {
  if (cachedProviderConfig) return cachedProviderConfig
  if (cachedProviderConfig === null) {
    return {
      providerId: 'openai',
      model: DEFAULT_MODEL,
      disableResponseStorage: true,
      baseUrl: DEFAULT_BASE_URL,
      wireApi: 'responses',
      requiresOpenAIAuth: false,
      promptCacheRetention: undefined,
      modelContextWindow: undefined,
      reasoningEffort: undefined,
      envKey: undefined,
      httpHeaders: undefined,
      envHttpHeaders: undefined,
      queryParams: undefined,
      experimentalBearerToken: undefined,
    }
  }

  const raw = readIfExists(getCodexConfigPath())
  if (!raw) {
    cachedProviderConfig = null
    return loadCodexProviderConfig()
  }

  const profileSection = getActiveProfileSection(raw)
  const providerId = getEffectiveProviderId(raw, profileSection)
  const providerSection = getTableSection(raw, `model_providers.${providerId}`)
  const topLevelModel = getEffectiveModel(raw, profileSection)
  const disableResponseStorage =
    matchBoolean(
      profileSection,
      /^\s*disable_response_storage\s*=\s*(true|false)/m,
    ) ??
    matchBoolean(raw, /^disable_response_storage\s*=\s*(true|false)/m) ??
    true

  const openaiBaseUrl =
    providerId === 'openai'
      ? matchString(profileSection, /^\s*openai_base_url\s*=\s*"([^"]+)"/m) ||
        matchString(raw, /^openai_base_url\s*=\s*"([^"]+)"/m)
      : undefined

  const baseUrl =
    matchString(providerSection, /^\s*base_url\s*=\s*"([^"]+)"/m) ||
    openaiBaseUrl ||
    DEFAULT_BASE_URL
  const wireApi =
    matchString(providerSection, /^\s*wire_api\s*=\s*"([^"]+)"/m) ||
    'responses'
  const requiresOpenAIAuth =
    matchBoolean(
      providerSection,
      /^\s*requires_openai_auth\s*=\s*(true|false)/m,
    ) ?? false
  const promptCacheRetention = normalizePromptCacheRetention(
    matchString(profileSection, /^\s*prompt_cache_retention\s*=\s*"([^"]+)"/m) ||
      matchString(raw, /^prompt_cache_retention\s*=\s*"([^"]+)"/m) ||
      matchString(
        providerSection,
        /^\s*prompt_cache_retention\s*=\s*"([^"]+)"/m,
      ),
  )
  const modelContextWindow =
    matchInteger(profileSection, /^\s*model_context_window\s*=\s*(\d+)/m) ||
    matchInteger(raw, /^model_context_window\s*=\s*(\d+)/m) ||
    matchInteger(providerSection, /^\s*model_context_window\s*=\s*(\d+)/m)
  const reasoningEffort = normalizeReasoningEffort(
    matchString(profileSection, /^\s*model_reasoning_effort\s*=\s*"([^"]+)"/m) ||
      matchString(raw, /^model_reasoning_effort\s*=\s*"([^"]+)"/m) ||
      matchString(
        providerSection,
        /^\s*model_reasoning_effort\s*=\s*"([^"]+)"/m,
      ),
  )
  const envKey = matchString(providerSection, /^\s*env_key\s*=\s*"([^"]+)"/m)
  const httpHeaders = parseInlineStringMap(
    matchInlineTableBody(providerSection, 'http_headers'),
  )
  const envHttpHeaders = parseInlineStringMap(
    matchInlineTableBody(providerSection, 'env_http_headers'),
  )
  const queryParams = parseInlineStringMap(
    matchInlineTableBody(providerSection, 'query_params'),
  )
  const experimentalBearerToken = matchString(
    providerSection,
    /^\s*experimental_bearer_token\s*=\s*"([^"]+)"/m,
  )

  cachedProviderConfig = {
    providerId,
    model: normalizeOpenAICompatibleModel(topLevelModel) ?? topLevelModel,
    disableResponseStorage,
    baseUrl: normalizeBaseUrl(baseUrl),
    wireApi,
    requiresOpenAIAuth,
    promptCacheRetention,
    modelContextWindow,
    reasoningEffort,
    envKey,
    httpHeaders,
    envHttpHeaders,
    queryParams,
    experimentalBearerToken,
  }
  return cachedProviderConfig
}

export function isOpenAIResponsesBackendEnabled(): boolean {
  const configured =
    process.env.CUBENCE_MODEL_BACKEND ??
    process.env.CLAUDE_CODE_MODEL_BACKEND ??
    'openaiResponses'
  return configured.toLowerCase() !== 'claude'
}

export function loadCodexAuthConfig(): CodexAuthConfig {
  if (cachedAuthConfig) return cachedAuthConfig
  if (cachedAuthConfig === null) return {}

  const raw = readIfExists(getCodexAuthPath())
  if (!raw) {
    cachedAuthConfig = null
    return {}
  }

  try {
    const parsed = JSON.parse(raw) as {
      auth_mode?: string
      OPENAI_API_KEY?: string
    }
    const authMode = normalizeAuthMode(parsed.auth_mode)
    cachedAuthConfig = {
      authMode,
      openaiApiKey:
        authMode === 'chatgpt' || authMode === 'chatgptAuthTokens'
          ? undefined
          : parsed.OPENAI_API_KEY?.trim() || undefined,
    }
    return cachedAuthConfig
  } catch {
    cachedAuthConfig = null
    return {}
  }
}

export function getOpenAIApiKey(): string | undefined {
  const envKey = process.env.OPENAI_API_KEY?.trim()
  if (envKey) return envKey

  const providerConfig = loadCodexProviderConfig()
  const providerEnvKeyName = providerConfig.envKey?.trim()
  if (providerEnvKeyName) {
    const providerEnvKey = process.env[providerEnvKeyName]?.trim()
    if (providerEnvKey) {
      return providerEnvKey
    }
  }

  if (providerConfig.experimentalBearerToken?.trim()) {
    return providerConfig.experimentalBearerToken.trim()
  }

  return loadCodexAuthConfig().openaiApiKey
}

export function resolveOpenAIBaseUrl(): string {
  return normalizeBaseUrl(
    process.env.OPENAI_BASE_URL || loadCodexProviderConfig().baseUrl,
  )
}

export function resolveOpenAIProviderHeaders(): StringMap | undefined {
  const config = loadCodexProviderConfig()
  const envHeaders = Object.fromEntries(
    Object.entries(config.envHttpHeaders ?? {}).flatMap(([headerName, envName]) => {
      const value = process.env[envName]?.trim()
      return value ? [[headerName, value]] : []
    }),
  )

  return mergeStringMaps(config.httpHeaders, envHeaders)
}

export function resolveOpenAIProviderQueryParams(): StringMap | undefined {
  return loadCodexProviderConfig().queryParams
}

export function shouldUseOpenAIOfficialClientHeaders(): boolean {
  return loadCodexProviderConfig().requiresOpenAIAuth
}

export function resolveOpenAIModel(currentModel: string | undefined): string {
  const candidate = normalizeOpenAICompatibleModel(currentModel)
  if (candidate) {
    return candidate
  }
  return (
    normalizeOpenAICompatibleModel(process.env.OPENAI_MODEL) ||
    normalizeOpenAICompatibleModel(loadCodexProviderConfig().model) ||
    DEFAULT_MODEL
  )
}

export function shouldStoreOpenAIResponses(): boolean {
  if (process.env.CUBENCE_DISABLE_RESPONSE_STORAGE === '1') {
    return false
  }
  return !loadCodexProviderConfig().disableResponseStorage
}

export function resolveOpenAIConfiguredContextWindow(
  currentModel?: string,
): number | undefined {
  const envWindow = matchInteger(
    process.env.OPENAI_MODEL_CONTEXT_WINDOW || '',
    /^(\d+)$/,
  )
  if (envWindow) {
    return envWindow
  }

  const config = loadCodexProviderConfig()
  if (!config.modelContextWindow) {
    return undefined
  }
  if (!currentModel) {
    return config.modelContextWindow
  }

  const configuredModel = resolveOpenAIModel(config.model)
  const normalizedCurrentModel = resolveOpenAIModel(currentModel)
  return normalizedCurrentModel === configuredModel
    ? config.modelContextWindow
    : undefined
}

export function resolveOpenAIPromptCacheRetention():
  | 'in_memory'
  | '24h'
  | undefined {
  return normalizePromptCacheRetention(
    process.env.OPENAI_PROMPT_CACHE_RETENTION ||
      loadCodexProviderConfig().promptCacheRetention,
  )
}

export function resolveOpenAIReasoningEffort():
  | OpenAIReasoningEffort
  | undefined {
  return normalizeReasoningEffort(
    process.env.OPENAI_REASONING_EFFORT ||
      loadCodexProviderConfig().reasoningEffort,
  )
}
