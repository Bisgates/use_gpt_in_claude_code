import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { resolveTeammateModel } from './spawnMultiAgent.js'
import { loadCodexProviderConfig } from '../../services/modelBackend/openaiCodexConfig.js'
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js'

const originalOpenAIModel = process.env.OPENAI_MODEL
const originalTeammateDefaultModel = getGlobalConfig().teammateDefaultModel

beforeEach(() => {
  saveGlobalConfig(current => ({
    ...current,
    teammateDefaultModel: undefined,
  }))
})

afterEach(() => {
  if (originalOpenAIModel === undefined) {
    delete process.env.OPENAI_MODEL
  } else {
    process.env.OPENAI_MODEL = originalOpenAIModel
  }

  saveGlobalConfig(current => ({
    ...current,
    teammateDefaultModel: originalTeammateDefaultModel,
  }))
})

describe('resolveTeammateModel', () => {
  test('inherits the leader model when no teammate model is configured', () => {
    expect(resolveTeammateModel(undefined, 'gpt-5.4')).toBe('gpt-5.4')
  })

  test('inherits the leader model when input model is inherit', () => {
    expect(resolveTeammateModel('inherit', 'gpt-5.4')).toBe('gpt-5.4')
  })

  test('falls back to provider default when leader model is unavailable', () => {
    process.env.OPENAI_MODEL = 'gpt-5.4'
    expect(resolveTeammateModel(undefined, null)).toBe(
      loadCodexProviderConfig().model,
    )
  })
})
