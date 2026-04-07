import { afterEach, describe, expect, it, vi } from 'vitest'

const axiosGetMock = vi.hoisted(() => vi.fn())
const getSettingsMock = vi.hoisted(() => vi.fn(() => ({})))
const isOpenAIResponsesBackendEnabledMock = vi.hoisted(() => vi.fn(() => false))
const logErrorMock = vi.hoisted(() => vi.fn())
const logEventMock = vi.hoisted(() => vi.fn())

vi.mock('axios', () => ({
  default: {
    get: (...args: unknown[]) => axiosGetMock(...args),
    isAxiosError: (error: unknown) =>
      typeof error === 'object' && error !== null && 'isAxiosError' in error,
  },
}))
vi.mock('../../../src/services/analytics/index.js', () => ({
  logEvent: (...args: unknown[]) => logEventMock(...args),
}))
vi.mock('../../../src/services/api/claude.js', () => ({
  queryHaiku: vi.fn(),
}))
vi.mock('../../../src/services/modelBackend/openaiCodexConfig.js', () => ({
  isOpenAIResponsesBackendEnabled: () => isOpenAIResponsesBackendEnabledMock(),
}))
vi.mock('../../../src/utils/http.js', () => ({
  getWebFetchUserAgent: () => 'test-agent',
}))
vi.mock('../../../src/utils/log.js', () => ({
  logError: (...args: unknown[]) => logErrorMock(...args),
}))
vi.mock('../../../src/utils/mcpOutputStorage.js', () => ({
  isBinaryContentType: () => false,
  persistBinaryContent: vi.fn(),
}))
vi.mock('../../../src/utils/settings/settings.js', () => ({
  getSettings_DEPRECATED: () => getSettingsMock(),
}))
vi.mock('../../../src/utils/systemPromptType.js', () => ({
  asSystemPrompt: (parts: string[]) => parts,
}))
vi.mock('../../../src/tools/WebFetchTool/preapproved.js', () => ({
  isPreapprovedHost: () => false,
}))

import * as webFetchUtils from '../../../src/tools/WebFetchTool/utils.ts'

afterEach(() => {
  axiosGetMock.mockReset()
  getSettingsMock.mockReset()
  isOpenAIResponsesBackendEnabledMock.mockReset()
  logErrorMock.mockReset()
  logEventMock.mockReset()
  webFetchUtils.clearWebFetchCache()

  getSettingsMock.mockReturnValue({})
  isOpenAIResponsesBackendEnabledMock.mockReturnValue(false)
})

describe('WebFetch fork regressions', () => {
  it('[P0:tool] skips Anthropic domain preflight on the OpenAI backend and still fetches the target URL', async () => {
    isOpenAIResponsesBackendEnabledMock.mockReturnValue(true)

    axiosGetMock.mockResolvedValue({
      data: new TextEncoder().encode('hello world').buffer,
      headers: { 'content-type': 'text/plain' },
      status: 200,
      statusText: 'OK',
    })

    const result = await webFetchUtils.getURLMarkdownContent(
      'https://example.com/docs',
      new AbortController(),
    )

    expect(axiosGetMock).toHaveBeenCalledTimes(1)
    expect(axiosGetMock.mock.calls[0]?.[0]).toBe('https://example.com/docs')
    expect('type' in result).toBe(false)
    if (!('type' in result)) {
      expect(result.code).toBe(200)
      expect(result.content).toBe('hello world')
    }
  })

  it('[P0:tool] still fails closed on the Claude backend when the domain preflight cannot verify the host', async () => {
    isOpenAIResponsesBackendEnabledMock.mockReturnValue(false)

    const transportError = Object.assign(new Error('tls failed'), {
      isAxiosError: true,
    })
    axiosGetMock.mockRejectedValue(transportError)

    await expect(
      webFetchUtils.getURLMarkdownContent(
        'https://example.com/docs',
        new AbortController(),
      ),
    ).rejects.toThrow('Unable to verify if domain example.com is safe to fetch')

    expect(axiosGetMock).toHaveBeenCalledTimes(1)
    expect(String(axiosGetMock.mock.calls[0]?.[0])).toContain(
      'https://api.anthropic.com/api/web/domain_info?domain=example.com',
    )
  })
})
