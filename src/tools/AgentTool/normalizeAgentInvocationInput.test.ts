import { afterEach, describe, expect, test } from 'bun:test'
import {
  normalizeAgentInvocationInput,
  normalizeOptionalAgentString,
} from './normalizeAgentInvocationInput.js'
import type { AgentDefinition } from './loadAgentsDir.js'

const originalModelBackend = process.env.CLAUDE_CODE_MODEL_BACKEND

function makeAgent(agentType: string): AgentDefinition {
  return {
    agentType,
    whenToUse: `Use ${agentType}`,
    source: 'built-in',
    baseDir: 'built-in',
    getSystemPrompt: () => '',
  }
}

afterEach(() => {
  if (originalModelBackend === undefined) {
    delete process.env.CLAUDE_CODE_MODEL_BACKEND
  } else {
    process.env.CLAUDE_CODE_MODEL_BACKEND = originalModelBackend
  }
})

describe('normalizeOptionalAgentString', () => {
  test('trims non-empty values', () => {
    expect(normalizeOptionalAgentString('  default  ')).toBe('default')
  })

  test('returns undefined for empty or whitespace-only values', () => {
    expect(normalizeOptionalAgentString('')).toBeUndefined()
    expect(normalizeOptionalAgentString('   ')).toBeUndefined()
    expect(normalizeOptionalAgentString(undefined)).toBeUndefined()
  })
})

describe('normalizeAgentInvocationInput', () => {
  test('rewrites misplaced model tokens into the model field on the OpenAI backend', () => {
    delete process.env.CLAUDE_CODE_MODEL_BACKEND

    expect(
      normalizeAgentInvocationInput({
        subagentType: ' gpt-5.4-mini ',
        activeAgents: [],
      }),
    ).toEqual({
      subagentType: 'general-purpose',
      model: 'gpt-5.4-mini',
    })
  })

  test('does not rewrite a matching real agent type', () => {
    delete process.env.CLAUDE_CODE_MODEL_BACKEND

    expect(
      normalizeAgentInvocationInput({
        subagentType: 'gpt-5.4-mini',
        activeAgents: [makeAgent('gpt-5.4-mini')],
      }),
    ).toEqual({
      subagentType: 'gpt-5.4-mini',
      model: undefined,
    })
  })

  test('does not rewrite misplaced model tokens on the Claude backend', () => {
    process.env.CLAUDE_CODE_MODEL_BACKEND = 'claude'

    expect(
      normalizeAgentInvocationInput({
        subagentType: 'gpt-5.4-mini',
        activeAgents: [],
      }),
    ).toEqual({
      subagentType: 'gpt-5.4-mini',
      model: undefined,
    })
  })

  test('preserves an explicit model override when correcting subagent_type', () => {
    delete process.env.CLAUDE_CODE_MODEL_BACKEND

    expect(
      normalizeAgentInvocationInput({
        subagentType: 'gpt-5.4-mini',
        model: 'gpt-5.4',
        activeAgents: [],
      }),
    ).toEqual({
      subagentType: 'general-purpose',
      model: 'gpt-5.4',
    })
  })
})
