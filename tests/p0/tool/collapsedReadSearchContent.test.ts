import * as React from 'react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('bun:bundle', () => ({
  feature: () => false,
}))

import { CollapsedReadSearchContent } from '../../../src/components/messages/CollapsedReadSearchContent.js'
import { EMPTY_LOOKUPS } from '../../../src/utils/messages.js'
import { renderToString } from '../../../src/utils/staticRender.js'

function createAssistantToolUseMessage({
  toolUseId,
  toolName,
  input,
}: {
  toolUseId: string
  toolName: string
  input: Record<string, unknown>
}) {
  return {
    type: 'assistant',
    uuid: `assistant-${toolUseId}`,
    timestamp: '2026-04-21T00:00:00.000Z',
    message: {
      id: `msg-${toolUseId}`,
      role: 'assistant',
      model: 'test-model',
      content: [
        {
          type: 'tool_use',
          id: toolUseId,
          name: toolName,
          input,
        },
      ],
      stop_reason: 'tool_use',
      usage: {
        input_tokens: 0,
        output_tokens: 0,
      },
    },
  } as never
}

function createCollapsedGroup({
  isActive,
}: {
  isActive: boolean
}) {
  const assistant = createAssistantToolUseMessage({
    toolUseId: 'toolu_read_1',
    toolName: 'Read',
    input: { file_path: '/tmp/project/src/example.ts' },
  })

  return {
    type: 'collapsed_read_search',
    uuid: 'collapsed-toolu_read_1',
    timestamp: '2026-04-21T00:00:00.000Z',
    searchCount: 1,
    readCount: 2,
    listCount: 1,
    replCount: 0,
    memorySearchCount: 0,
    memoryReadCount: 0,
    memoryWriteCount: 0,
    readFilePaths: [
      '/tmp/project/src/example.ts',
      '/tmp/project/src/other.ts',
    ],
    searchArgs: ['missingImport'],
    latestDisplayHint: isActive ? 'src/example.ts' : undefined,
    messages: [assistant],
    displayMessage: assistant,
    hookCount: 0,
    hookTotalMs: 0,
  } as never
}

function renderCollapsedGroup(isActive: boolean) {
  return renderToString(
    React.createElement(CollapsedReadSearchContent, {
      message: createCollapsedGroup({ isActive }),
      inProgressToolUseIDs: isActive ? new Set(['toolu_read_1']) : new Set(),
      shouldAnimate: false,
      verbose: false,
      tools: [] as never,
      lookups: EMPTY_LOOKUPS,
      isActiveGroup: isActive,
    }),
    120,
  )
}

describe('CollapsedReadSearchContent', () => {
  it('renders an active collapsed group summary in present tense', async () => {
    const output = await renderCollapsedGroup(true)

    expect(output).toContain(
      'Searching for 1 pattern, reading 2 files, listing 1 directory…',
    )
    expect(output).toContain('src/example.ts')
  })

  it('renders a completed collapsed group summary in past tense', async () => {
    const output = await renderCollapsedGroup(false)

    expect(output).toContain(
      'Searched for 1 pattern, read 2 files, listed 1 directory',
    )
  })
})
