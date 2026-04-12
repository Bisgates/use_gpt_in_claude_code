import { describe, expect, it, vi } from 'vitest'

vi.mock('bun:bundle', () => ({
  feature: () => false,
}))

import { renderToolResultMessage } from '../../../src/tools/AgentTool/UI.js'

describe('AgentTool UI', () => {
  it('renders completed agent results without throwing', () => {
    expect(() =>
      renderToolResultMessage(
        {
          status: 'completed',
          agentId: 'agent-123',
          totalDurationMs: 1_234,
          totalToolUseCount: 1,
          totalTokens: 42,
          usage: {},
          content: [],
          prompt: '',
        } as never,
        [],
        {
          tools: [] as never,
          verbose: false,
          theme: 'dark',
        },
      ),
    ).not.toThrow()
  })
})
