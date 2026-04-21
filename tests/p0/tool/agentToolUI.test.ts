import { readFileSync } from 'fs'
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

  it('keeps the shared search/read summary helper wired into AgentTool UI', () => {
    const source = readFileSync(
      new URL('../../../src/tools/AgentTool/UI.tsx', import.meta.url),
      'utf8',
    )

    expect(source).toMatch(
      /getSearchOrReadFromContent,\s*getSearchReadSummaryText/,
    )
    expect(source).toContain(
      'const summaryText = getSearchReadSummaryText(',
    )
  })
})
