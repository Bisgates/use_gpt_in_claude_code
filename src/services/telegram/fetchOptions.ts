import type { Dispatcher } from 'undici'
import { getTelegramProxyUrl } from './config.js'

let proxyDispatcher: Dispatcher | undefined
let proxyDispatcherUrl: string | undefined

function getProxyUrl(): string | undefined {
  return (
    getTelegramProxyUrl() ||
    process.env.https_proxy ||
    process.env.HTTPS_PROXY ||
    process.env.http_proxy ||
    process.env.HTTP_PROXY ||
    process.env.ALL_PROXY ||
    process.env.all_proxy
  )
}

export function getTelegramFetchOptions(): {
  dispatcher?: Dispatcher
  proxy?: string
} {
  const proxyUrl = getProxyUrl()
  if (!proxyUrl) {
    return {}
  }

  if (typeof Bun !== 'undefined') {
    return { proxy: proxyUrl }
  }

  if (proxyDispatcher && proxyDispatcherUrl === proxyUrl) {
    return { dispatcher: proxyDispatcher }
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { ProxyAgent } = require('undici') as typeof import('undici')
  proxyDispatcher = new ProxyAgent(proxyUrl)
  proxyDispatcherUrl = proxyUrl
  return { dispatcher: proxyDispatcher }
}
