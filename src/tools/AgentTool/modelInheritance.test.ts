import { describe, expect, test } from 'bun:test'
import { getAgentModel } from '../../utils/model/agent.js'

describe('Agent subagent model inheritance', () => {
  test('defaults an omitted subagent model to the parent model on the OpenAI backend', () => {
    expect(getAgentModel(undefined, 'gpt-5.4', undefined, 'default')).toBe(
      'gpt-5.4',
    )
  })

  test('preserves parent plan/runtime resolution when inheriting', () => {
    expect(getAgentModel(undefined, 'gpt-5.4', 'inherit', 'default')).toBe(
      'gpt-5.4',
    )
  })
})
