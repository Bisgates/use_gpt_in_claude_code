import { describe, expect, it } from 'vitest'

describe('telegram/questionRenderer', () => {
  it('builds Telegram question text and inline keyboard for preview questions', async () => {
    const {
      buildTelegramQuestionKeyboard,
      buildTelegramQuestionMessage,
    } = await import('src/services/telegram/questionRenderer.js')

    const question = {
      question: 'Choose a design?',
      header: 'Design',
      multiSelect: false,
      options: [
        { label: 'Option A', description: 'A', preview: 'preview a' },
        { label: 'Option B', description: 'B', preview: 'preview b' },
      ],
    }

    const text = buildTelegramQuestionMessage({
      sessionId: 'session-1',
      question: question as never,
      questionNumber: 1,
      questionCount: 2,
      selection: 'Option B',
      notes: 'Prefer explicit config names',
      mode: 'idle',
      isPlanMode: true,
    })

    expect(text).toContain('Choose a design?')
    expect(text).toContain('Selected: Option B')
    expect(text).toContain('preview b')
    expect(text).toContain('Prefer explicit config names')

    const keyboard = buildTelegramQuestionKeyboard({
      promptId: 'prompt-1',
      question: question as never,
      selection: 'Option B',
      isPlanMode: true,
      isLastQuestion: false,
    })

    expect(keyboard.inline_keyboard.flat()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: 'Option A', callback_data: 'aq:prompt-1:sel:0' }),
        expect.objectContaining({ text: 'Option B ✅', callback_data: 'aq:prompt-1:sel:1' }),
        expect.objectContaining({ text: 'Add notes', callback_data: 'aq:prompt-1:note' }),
        expect.objectContaining({ text: 'Chat about this', callback_data: 'aq:prompt-1:chat' }),
        expect.objectContaining({ text: 'Skip interview', callback_data: 'aq:prompt-1:skip' }),
        expect.objectContaining({ text: 'Next', callback_data: 'aq:prompt-1:submit' }),
      ]),
    )
  })

  it('renders normal single-select questions with Other', async () => {
    const {
      buildTelegramQuestionKeyboard,
      buildTelegramQuestionMessage,
    } = await import('src/services/telegram/questionRenderer.js')

    const question = {
      question: 'Choose transport?',
      header: 'Transport',
      multiSelect: false,
      options: [
        { label: 'Bus', description: 'Bus' },
        { label: 'Train', description: 'Train' },
      ],
    }

    const text = buildTelegramQuestionMessage({
      sessionId: 'session-2',
      question: question as never,
      questionNumber: 1,
      questionCount: 1,
      selection: '__other__',
      textInputValue: 'Walk',
      notes: undefined,
      mode: 'idle',
      isPlanMode: false,
    })

    expect(text).toContain('Selected: Walk')

    const keyboard = buildTelegramQuestionKeyboard({
      promptId: 'prompt-2',
      question: question as never,
      selection: '__other__',
      textInputValue: 'Walk',
      isPlanMode: false,
      isLastQuestion: true,
    })

    expect(keyboard.inline_keyboard.flat()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: 'Bus', callback_data: 'aq:prompt-2:sel:0' }),
        expect.objectContaining({ text: 'Train', callback_data: 'aq:prompt-2:sel:1' }),
        expect.objectContaining({ text: 'Other: Walk ✅', callback_data: 'aq:prompt-2:other' }),
        expect.objectContaining({ text: 'Submit', callback_data: 'aq:prompt-2:submit' }),
      ]),
    )
  })

  it('renders multi-select questions with toggle actions and waiting Other prompt', async () => {
    const {
      buildTelegramQuestionKeyboard,
      buildTelegramQuestionMessage,
    } = await import('src/services/telegram/questionRenderer.js')

    const question = {
      question: 'Which features do you want?',
      header: 'Features',
      multiSelect: true,
      options: [
        { label: 'Search', description: 'Search' },
        { label: 'Export', description: 'Export' },
      ],
    }

    const text = buildTelegramQuestionMessage({
      sessionId: 'session-3',
      question: question as never,
      questionNumber: 1,
      questionCount: 1,
      selection: ['Search', '__other__'],
      notes: undefined,
      mode: 'awaiting_other_text',
      isPlanMode: false,
    })

    expect(text).toContain('Selected: Search')
    expect(text).toContain('send your next Telegram message as the custom answer text')

    const keyboard = buildTelegramQuestionKeyboard({
      promptId: 'prompt-3',
      question: question as never,
      selection: ['Search', '__other__'],
      isPlanMode: false,
      isLastQuestion: true,
    })

    expect(keyboard.inline_keyboard.flat()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: 'Search ✅', callback_data: 'aq:prompt-3:toggle:0' }),
        expect.objectContaining({ text: 'Export', callback_data: 'aq:prompt-3:toggle:1' }),
        expect.objectContaining({ text: 'Other ✅', callback_data: 'aq:prompt-3:other' }),
        expect.objectContaining({ text: 'Submit', callback_data: 'aq:prompt-3:submit' }),
      ]),
    )
  })
})
