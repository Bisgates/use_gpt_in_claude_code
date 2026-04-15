import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockSendTelegramMessage = vi.fn()
const mockEditTelegramMessage = vi.fn()
const mockAnswerTelegramCallbackQuery = vi.fn()
const mockLogError = vi.fn()

vi.mock('src/services/telegram/sender.js', () => ({
  sendTelegramMessage: (input: unknown) => mockSendTelegramMessage(input),
  editTelegramMessage: (input: unknown) => mockEditTelegramMessage(input),
  answerTelegramCallbackQuery: (input: unknown) =>
    mockAnswerTelegramCallbackQuery(input),
}))

vi.mock('src/utils/log.js', () => ({
  logError: (error: unknown) => mockLogError(error),
}))

describe('telegram/questionSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSendTelegramMessage.mockResolvedValue({ ok: true, messageId: 10 })
    mockEditTelegramMessage.mockResolvedValue(true)
    mockAnswerTelegramCallbackQuery.mockResolvedValue(true)
  })

  it('starts a Telegram ask-user-question session for preview questions', async () => {
    const onAllow = vi.fn()
    const onReject = vi.fn()
    const onDone = vi.fn()

    const { startTelegramAskUserQuestionSession } = await import(
      'src/services/telegram/questionSession.js'
    )

    const result = await startTelegramAskUserQuestionSession({
      sessionId: 'session-1',
      onDone,
      toolUseConfirm: {
        toolUseID: 'tool-1',
        tool: { name: 'AskUserQuestion' },
        input: {
          questions: [
            {
              question: 'Choose a design?',
              header: 'Design',
              multiSelect: false,
              options: [
                {
                  label: 'Option A',
                  description: 'A',
                  preview: 'preview a',
                },
                {
                  label: 'Option B',
                  description: 'B',
                  preview: 'preview b',
                },
              ],
            },
          ],
        },
        toolUseContext: { mode: 'default' },
        onAllow,
        onReject,
      } as never,
    })

    expect(result).toBe(true)
    expect(onDone).toHaveBeenCalled()
    expect(mockSendTelegramMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('Choose a design?'),
        replyMarkup: expect.objectContaining({
          inline_keyboard: expect.any(Array),
        }),
      }),
    )
  })

  it('records selected preview option and submits answers', async () => {
    const onAllow = vi.fn()
    const onReject = vi.fn()

    const {
      startTelegramAskUserQuestionSession,
      handleTelegramQuestionCallbackQuery,
    } = await import('src/services/telegram/questionSession.js')

    await startTelegramAskUserQuestionSession({
      sessionId: 'session-1',
      onDone: vi.fn(),
      toolUseConfirm: {
        toolUseID: 'tool-1',
        tool: { name: 'AskUserQuestion' },
        input: {
          questions: [
            {
              question: 'Choose a design?',
              header: 'Design',
              multiSelect: false,
              options: [
                {
                  label: 'Option A',
                  description: 'A',
                  preview: 'preview a',
                },
                {
                  label: 'Option B',
                  description: 'B',
                  preview: 'preview b',
                },
              ],
            },
          ],
        },
        toolUseContext: { mode: 'default' },
        onAllow,
        onReject,
      } as never,
    })

    const { getActiveTelegramAskUserQuestionSession } = await import(
      'src/services/telegram/questionRegistry.js'
    )
    const promptId = getActiveTelegramAskUserQuestionSession()?.promptId
    expect(promptId).toBeTruthy()

    await handleTelegramQuestionCallbackQuery({
      sessionId: 'session-1',
      callbackQueryId: 'cb-2',
      data: `aq:${promptId}:sel:1`,
    })

    await handleTelegramQuestionCallbackQuery({
      sessionId: 'session-1',
      callbackQueryId: 'cb-3',
      data: `aq:${promptId}:submit`,
    })

    expect(onAllow).toHaveBeenCalledWith(
      expect.objectContaining({
        answers: { 'Choose a design?': 'Option B' },
        annotations: {
          'Choose a design?': expect.objectContaining({
            preview: 'preview b',
          }),
        },
      }),
      [],
    )
  })

  it('captures notes and sends a fresh prompt when not yet explicitly submitted on non-final flow', async () => {
    const {
      startTelegramAskUserQuestionSession,
      handleTelegramQuestionCallbackQuery,
      handleTelegramQuestionTextMessage,
    } = await import('src/services/telegram/questionSession.js')
    const onAllow = vi.fn()

    await startTelegramAskUserQuestionSession({
      sessionId: 'session-1',
      onDone: vi.fn(),
      toolUseConfirm: {
        toolUseID: 'tool-1b',
        tool: { name: 'AskUserQuestion' },
        input: {
          questions: [
            {
              question: 'Choose a design?',
              header: 'Design',
              multiSelect: false,
              options: [
                {
                  label: 'Option A',
                  description: 'A',
                  preview: 'preview a',
                },
                {
                  label: 'Option B',
                  description: 'B',
                  preview: 'preview b',
                },
              ],
            },
            {
              question: 'Choose a second design?',
              header: 'Design 2',
              multiSelect: false,
              options: [
                {
                  label: 'Option C',
                  description: 'C',
                  preview: 'preview c',
                },
                {
                  label: 'Option D',
                  description: 'D',
                  preview: 'preview d',
                },
              ],
            },
          ],
        },
        toolUseContext: { mode: 'default' },
        onAllow,
        onReject: vi.fn(),
      } as never,
    })

    const { getActiveTelegramAskUserQuestionSession } = await import(
      'src/services/telegram/questionRegistry.js'
    )
    const promptId = getActiveTelegramAskUserQuestionSession()?.promptId

    await handleTelegramQuestionCallbackQuery({
      sessionId: 'session-1',
      callbackQueryId: 'cb-1a',
      data: `aq:${promptId}:sel:0`,
    })
    await handleTelegramQuestionCallbackQuery({
      sessionId: 'session-1',
      callbackQueryId: 'cb-2a',
      data: `aq:${promptId}:note`,
    })
    await handleTelegramQuestionTextMessage({
      sessionId: 'session-1',
      text: 'Prefer explicit config names',
    })

    expect(onAllow).not.toHaveBeenCalled()
    expect(getActiveTelegramAskUserQuestionSession()?.currentQuestionIndex).toBe(0)
    expect(mockSendTelegramMessage).toHaveBeenCalledWith('✅ Notes saved.')
    expect(mockSendTelegramMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('Choose a design?'),
        replyMarkup: expect.objectContaining({
          inline_keyboard: expect.any(Array),
        }),
      }),
    )
  })

  it('auto-submits after saving notes on the final selected question', async () => {
    const {
      startTelegramAskUserQuestionSession,
      handleTelegramQuestionCallbackQuery,
      handleTelegramQuestionTextMessage,
    } = await import('src/services/telegram/questionSession.js')
    const onAllow = vi.fn()

    await startTelegramAskUserQuestionSession({
      sessionId: 'session-1',
      onDone: vi.fn(),
      toolUseConfirm: {
        toolUseID: 'tool-2',
        tool: { name: 'AskUserQuestion' },
        input: {
          questions: [
            {
              question: 'Choose final design?',
              header: 'Design',
              multiSelect: false,
              options: [
                {
                  label: 'Option A',
                  description: 'A',
                  preview: 'preview a',
                },
                {
                  label: 'Option B',
                  description: 'B',
                  preview: 'preview b',
                },
              ],
            },
          ],
        },
        toolUseContext: { mode: 'default' },
        onAllow,
        onReject: vi.fn(),
      } as never,
    })

    const { getActiveTelegramAskUserQuestionSession } = await import(
      'src/services/telegram/questionRegistry.js'
    )
    const promptId = getActiveTelegramAskUserQuestionSession()?.promptId

    await handleTelegramQuestionCallbackQuery({
      sessionId: 'session-1',
      callbackQueryId: 'cb-10',
      data: `aq:${promptId}:sel:0`,
    })
    await handleTelegramQuestionCallbackQuery({
      sessionId: 'session-1',
      callbackQueryId: 'cb-11',
      data: `aq:${promptId}:note`,
    })
    await handleTelegramQuestionTextMessage({
      sessionId: 'session-1',
      text: 'ship this one',
    })

    expect(onAllow).toHaveBeenCalledWith(
      expect.objectContaining({
        answers: { 'Choose final design?': 'Option A' },
        annotations: {
          'Choose final design?': expect.objectContaining({
            notes: 'ship this one',
            preview: 'preview a',
          }),
        },
      }),
      [],
    )
  })

  it('supports normal single-select Other answers', async () => {
    const {
      startTelegramAskUserQuestionSession,
      handleTelegramQuestionCallbackQuery,
      handleTelegramQuestionTextMessage,
    } = await import('src/services/telegram/questionSession.js')
    const onAllow = vi.fn()

    await startTelegramAskUserQuestionSession({
      sessionId: 'session-2',
      onDone: vi.fn(),
      toolUseConfirm: {
        toolUseID: 'tool-3',
        tool: { name: 'AskUserQuestion' },
        input: {
          questions: [
            {
              question: 'Choose transport?',
              header: 'Transport',
              multiSelect: false,
              options: [
                { label: 'Bus', description: 'Bus' },
                { label: 'Train', description: 'Train' },
              ],
            },
          ],
        },
        toolUseContext: { mode: 'default' },
        onAllow,
        onReject: vi.fn(),
      } as never,
    })

    const { getActiveTelegramAskUserQuestionSession } = await import(
      'src/services/telegram/questionRegistry.js'
    )
    const promptId = getActiveTelegramAskUserQuestionSession()?.promptId

    await handleTelegramQuestionCallbackQuery({
      sessionId: 'session-2',
      callbackQueryId: 'cb-20',
      data: `aq:${promptId}:other`,
    })
    await handleTelegramQuestionTextMessage({
      sessionId: 'session-2',
      text: 'Walk',
    })

    expect(onAllow).toHaveBeenCalledWith(
      expect.objectContaining({
        answers: { 'Choose transport?': 'Walk' },
      }),
      [],
    )
  })

  it('supports multi-select answers with Other text', async () => {
    const {
      startTelegramAskUserQuestionSession,
      handleTelegramQuestionCallbackQuery,
      handleTelegramQuestionTextMessage,
    } = await import('src/services/telegram/questionSession.js')
    const onAllow = vi.fn()

    await startTelegramAskUserQuestionSession({
      sessionId: 'session-3',
      onDone: vi.fn(),
      toolUseConfirm: {
        toolUseID: 'tool-4',
        tool: { name: 'AskUserQuestion' },
        input: {
          questions: [
            {
              question: 'Which features do you want?',
              header: 'Features',
              multiSelect: true,
              options: [
                { label: 'Search', description: 'Search' },
                { label: 'Export', description: 'Export' },
              ],
            },
          ],
        },
        toolUseContext: { mode: 'default' },
        onAllow,
        onReject: vi.fn(),
      } as never,
    })

    const { getActiveTelegramAskUserQuestionSession } = await import(
      'src/services/telegram/questionRegistry.js'
    )
    const promptId = getActiveTelegramAskUserQuestionSession()?.promptId

    await handleTelegramQuestionCallbackQuery({
      sessionId: 'session-3',
      callbackQueryId: 'cb-30',
      data: `aq:${promptId}:toggle:0`,
    })
    await handleTelegramQuestionCallbackQuery({
      sessionId: 'session-3',
      callbackQueryId: 'cb-31',
      data: `aq:${promptId}:other`,
    })
    await handleTelegramQuestionTextMessage({
      sessionId: 'session-3',
      text: 'CLI sync',
    })
    await handleTelegramQuestionCallbackQuery({
      sessionId: 'session-3',
      callbackQueryId: 'cb-32',
      data: `aq:${promptId}:submit`,
    })

    expect(onAllow).toHaveBeenCalledWith(
      expect.objectContaining({
        answers: { 'Which features do you want?': 'Search, CLI sync' },
      }),
      [],
    )
  })

  it('rejects submit for unanswered multi-select questions', async () => {
    const {
      startTelegramAskUserQuestionSession,
      handleTelegramQuestionCallbackQuery,
    } = await import('src/services/telegram/questionSession.js')

    await startTelegramAskUserQuestionSession({
      sessionId: 'session-4',
      onDone: vi.fn(),
      toolUseConfirm: {
        toolUseID: 'tool-5',
        tool: { name: 'AskUserQuestion' },
        input: {
          questions: [
            {
              question: 'Which features do you want?',
              header: 'Features',
              multiSelect: true,
              options: [
                { label: 'Search', description: 'Search' },
                { label: 'Export', description: 'Export' },
              ],
            },
          ],
        },
        toolUseContext: { mode: 'default' },
        onAllow: vi.fn(),
        onReject: vi.fn(),
      } as never,
    })

    const { getActiveTelegramAskUserQuestionSession } = await import(
      'src/services/telegram/questionRegistry.js'
    )
    const promptId = getActiveTelegramAskUserQuestionSession()?.promptId

    await handleTelegramQuestionCallbackQuery({
      sessionId: 'session-4',
      callbackQueryId: 'cb-40',
      data: `aq:${promptId}:submit`,
    })

    expect(mockAnswerTelegramCallbackQuery).toHaveBeenLastCalledWith({
      callbackQueryId: 'cb-40',
      text: 'Select at least one option first.',
    })
  })
})
