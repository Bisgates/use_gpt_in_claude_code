import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
})

describe('prompt mode defaults', () => {
  it('enables opus prompt mode by default', async () => {
    vi.resetModules()
    const { getOpusPromptMode } = await import('src/bootstrap/state.js')

    expect(getOpusPromptMode()).toBe(true)
  })

  it('does not expose the ant slash command', async () => {
    const commandsSource = await import('src/commands.ts?raw')

    expect(commandsSource.default).not.toContain("./commands/ant-mode/index.js")
    expect(commandsSource.default).toContain("./commands/opus-mode/index.js")
  })
})
