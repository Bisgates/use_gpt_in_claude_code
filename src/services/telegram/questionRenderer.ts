import type { Question } from '../../tools/AskUserQuestionTool/AskUserQuestionTool.js'
import type {
  TelegramAskUserQuestionSession,
  TelegramQuestionSelection,
} from './questionRegistry.js'
import type { TelegramInlineKeyboardMarkup } from './sender.js'

const MAX_PREVIEW_LENGTH = 900
const OTHER_VALUE = '__other__'

type TelegramQuestionKind = 'preview-single' | 'single' | 'multi'

export function stripTelegramPreview(preview?: string): string | undefined {
  if (!preview) {
    return undefined
  }

  const plain = preview
    .replace(/<[^>]+>/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/[\t ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  if (!plain) {
    return undefined
  }

  if (plain.length <= MAX_PREVIEW_LENGTH) {
    return plain
  }

  return `${plain.slice(0, MAX_PREVIEW_LENGTH - 1).trimEnd()}…`
}

export function getTelegramQuestionKind(question: Question): TelegramQuestionKind {
  if (question.multiSelect) {
    return 'multi'
  }

  return question.options.some(option => !!option.preview)
    ? 'preview-single'
    : 'single'
}

function getSelectedLabels(selection: TelegramQuestionSelection | undefined): string[] {
  if (Array.isArray(selection)) {
    return selection
  }

  return selection ? [selection] : []
}

function getDisplayAnswer(params: {
  question: Question
  selection?: TelegramQuestionSelection
  textInputValue?: string
}): string {
  const kind = getTelegramQuestionKind(params.question)
  const textInput = params.textInputValue?.trim()

  if (kind === 'multi') {
    const labels = getSelectedLabels(params.selection)
      .filter(label => label !== OTHER_VALUE)
      .concat(textInput ? [textInput] : [])

    return labels.length > 0 ? labels.join(', ') : '(none)'
  }

  if (params.selection === OTHER_VALUE) {
    return textInput || 'Other (awaiting text)'
  }

  return typeof params.selection === 'string' && params.selection.length > 0
    ? params.selection
    : '(none)'
}

function getSelectedPreview(params: {
  question: Question
  selection?: TelegramQuestionSelection
}): string | undefined {
  if (getTelegramQuestionKind(params.question) !== 'preview-single') {
    return undefined
  }

  const label = typeof params.selection === 'string' ? params.selection : undefined
  const option = label
    ? params.question.options.find(candidate => candidate.label === label)
    : undefined

  return stripTelegramPreview(option?.preview)
}

export type TelegramQuestionRenderState = {
  sessionId: string
  question: Question
  questionNumber: number
  questionCount: number
  selection?: TelegramQuestionSelection
  textInputValue?: string
  notes?: string
  mode: TelegramAskUserQuestionSession['mode']
  isPlanMode: boolean
}

export function buildTelegramQuestionMessage(
  state: TelegramQuestionRenderState,
): string {
  const selectedText = getDisplayAnswer({
    question: state.question,
    selection: state.selection,
    textInputValue: state.textInputValue,
  })
  const preview = getSelectedPreview({
    question: state.question,
    selection: state.selection,
  })
  const kind = getTelegramQuestionKind(state.question)

  const lines = [
    `❓ ${state.question.question}`,
    '',
    `Selected: ${selectedText}`,
  ]

  if (preview) {
    lines.push('', 'Preview:', preview)
  }

  lines.push('', `Notes: ${state.notes?.trim() || '(none)'}`)

  if (state.mode === 'awaiting_other_text') {
    lines.push(
      '',
      'Other input: send your next Telegram message as the custom answer text.',
    )
  } else if (
    (kind === 'single' && state.selection === OTHER_VALUE && !state.textInputValue?.trim()) ||
    (kind === 'multi' &&
      getSelectedLabels(state.selection).includes(OTHER_VALUE) &&
      !state.textInputValue?.trim())
  ) {
    lines.push('', 'Other input: please send custom answer text.')
  }

  lines.push('', `Question ${state.questionNumber}/${state.questionCount}`)
  lines.push(`Session: ${state.sessionId}`)

  return lines.join('\n')
}

function buildOptionButtonText(label: string, selected: boolean): string {
  return selected ? `${label} ✅` : label
}

export function buildTelegramQuestionKeyboard(params: {
  promptId: string
  question: Question
  selection?: TelegramQuestionSelection
  textInputValue?: string
  isPlanMode: boolean
  isLastQuestion: boolean
}): TelegramInlineKeyboardMarkup {
  const kind = getTelegramQuestionKind(params.question)
  const selectedLabels = getSelectedLabels(params.selection)

  const optionRows = params.question.options.map((option, index) => {
    const selected = selectedLabels.includes(option.label)
    return [
      {
        text: buildOptionButtonText(option.label, selected),
        callback_data:
          kind === 'multi'
            ? `aq:${params.promptId}:toggle:${index}`
            : `aq:${params.promptId}:sel:${index}`,
      },
    ]
  })

  const shouldShowOther = kind !== 'preview-single'
  const otherSelected = selectedLabels.includes(OTHER_VALUE)
  const otherLabel = params.textInputValue?.trim()
    ? `Other: ${params.textInputValue.trim()}`
    : 'Other'

  const actionRows = [
    ...(shouldShowOther
      ? [
          [
            {
              text: buildOptionButtonText(otherLabel, otherSelected),
              callback_data: `aq:${params.promptId}:other`,
            },
          ],
        ]
      : []),
    [{ text: 'Add notes', callback_data: `aq:${params.promptId}:note` }],
    [{ text: 'Chat about this', callback_data: `aq:${params.promptId}:chat` }],
    [
      {
        text: params.isLastQuestion ? 'Submit' : 'Next',
        callback_data: `aq:${params.promptId}:submit`,
      },
    ],
  ]

  if (params.isPlanMode) {
    actionRows.splice(actionRows.length - 1, 0, [
      {
        text: 'Skip interview',
        callback_data: `aq:${params.promptId}:skip`,
      },
    ])
  }

  return {
    inline_keyboard: [...optionRows, ...actionRows],
  }
}
