import { randomUUID } from 'crypto'
import type { ToolUseConfirm } from '../../components/permissions/PermissionRequest.js'
import type { Question, QuestionOption } from '../../tools/AskUserQuestionTool/AskUserQuestionTool.js'
import { logError } from '../../utils/log.js'
import {
  buildTelegramQuestionKeyboard,
  buildTelegramQuestionMessage,
  getTelegramQuestionKind,
} from './questionRenderer.js'
import {
  clearActiveTelegramAskUserQuestionSession,
  getActiveTelegramAskUserQuestionSession,
  setActiveTelegramAskUserQuestionSession,
  type TelegramAskUserQuestionSession,
  type TelegramQuestionAnnotations,
  type TelegramQuestionSelection,
} from './questionRegistry.js'
import {
  answerTelegramCallbackQuery,
  editTelegramMessage,
  sendTelegramMessage,
} from './sender.js'

const SESSION_TTL_MS = 30 * 60 * 1000
const OTHER_VALUE = '__other__'

type ParsedCallbackData =
  | { promptId: string; action: 'sel' | 'toggle'; index: number }
  | { promptId: string; action: 'other' | 'note' | 'chat' | 'skip' | 'submit' }

function now(): number {
  return Date.now()
}

function isTelegramSelectableQuestion(question: Question): boolean {
  return question.options.length >= 2 && question.options.length <= 4
}

export function canRenderTelegramAskUserQuestion(
  questions: Question[],
): boolean {
  return questions.length > 0 && questions.every(isTelegramSelectableQuestion)
}

function isPlanModeToolUseConfirm(toolUseConfirm: ToolUseConfirm): boolean {
  return toolUseConfirm.toolUseContext.mode === 'plan'
}

function currentQuestion(
  session: TelegramAskUserQuestionSession,
): Question | undefined {
  return session.questions[session.currentQuestionIndex]
}

function getSelection(
  session: TelegramAskUserQuestionSession,
  questionText: string,
): TelegramQuestionSelection | undefined {
  return session.selectedValueByQuestion[questionText]
}

function getSelectedLabels(
  selection: TelegramQuestionSelection | undefined,
): string[] {
  if (Array.isArray(selection)) {
    return selection
  }

  return selection ? [selection] : []
}

function selectedOption(
  session: TelegramAskUserQuestionSession,
  question: Question,
): QuestionOption | undefined {
  const selection = getSelection(session, question.question)
  const label = typeof selection === 'string' ? selection : undefined
  if (!label || label === OTHER_VALUE) {
    return undefined
  }

  return question.options.find(option => option.label === label)
}

function trimTextInput(
  session: TelegramAskUserQuestionSession,
  questionText: string,
): string | undefined {
  const value = session.textInputValueByQuestion[questionText]?.trim()
  return value ? value : undefined
}

function setSelection(
  session: TelegramAskUserQuestionSession,
  questionText: string,
  selection: TelegramQuestionSelection | undefined,
): void {
  if (
    selection === undefined ||
    (Array.isArray(selection) && selection.length === 0)
  ) {
    delete session.selectedValueByQuestion[questionText]
    return
  }

  session.selectedValueByQuestion[questionText] = selection
}

function rebuildAnnotation(
  session: TelegramAskUserQuestionSession,
  question: Question,
): void {
  const notes = session.annotations[question.question]?.notes?.trim()
  const preview = selectedOption(session, question)?.preview

  if (!preview && !notes) {
    delete session.annotations[question.question]
    return
  }

  session.annotations[question.question] = {
    ...(preview ? { preview } : {}),
    ...(notes ? { notes } : {}),
  }
}

function buildQuestionAnswer(
  session: TelegramAskUserQuestionSession,
  question: Question,
): string | undefined {
  const selection = getSelection(session, question.question)
  const textInput = trimTextInput(session, question.question)
  const kind = getTelegramQuestionKind(question)

  if (kind === 'multi') {
    const labels = getSelectedLabels(selection)
      .filter(label => label !== OTHER_VALUE)
      .concat(textInput ? [textInput] : [])

    return labels.length > 0 ? labels.join(', ') : undefined
  }

  if (selection === OTHER_VALUE) {
    return textInput
  }

  return typeof selection === 'string' ? selection : undefined
}

function syncAnswer(
  session: TelegramAskUserQuestionSession,
  question: Question,
): void {
  const answer = buildQuestionAnswer(session, question)
  if (answer) {
    session.answers[question.question] = answer
  } else {
    delete session.answers[question.question]
  }

  rebuildAnnotation(session, question)
}

function isQuestionAnswered(
  session: TelegramAskUserQuestionSession,
  question: Question,
): boolean {
  return !!buildQuestionAnswer(session, question)
}

function updateSession(
  session: TelegramAskUserQuestionSession,
): void {
  session.updatedAt = now()
  setActiveTelegramAskUserQuestionSession(session)
}

async function renderOrSendQuestion(
  session: TelegramAskUserQuestionSession,
  options?: { forceNewMessage?: boolean },
): Promise<boolean> {
  const question = currentQuestion(session)
  if (!question) {
    return false
  }

  const text = buildTelegramQuestionMessage({
    sessionId: session.sessionId,
    question,
    questionNumber: session.currentQuestionIndex + 1,
    questionCount: session.questions.length,
    selection: getSelection(session, question.question),
    textInputValue: session.textInputValueByQuestion[question.question],
    notes: session.annotations[question.question]?.notes,
    mode: session.mode,
    isPlanMode: session.isPlanMode,
  })

  const replyMarkup = buildTelegramQuestionKeyboard({
    promptId: session.promptId,
    question,
    selection: getSelection(session, question.question),
    textInputValue: session.textInputValueByQuestion[question.question],
    isPlanMode: session.isPlanMode,
    isLastQuestion: session.currentQuestionIndex === session.questions.length - 1,
  })

  if (session.telegramMessageId && !options?.forceNewMessage) {
    const edited = await editTelegramMessage({
      messageId: session.telegramMessageId,
      text,
      replyMarkup,
    })
    if (edited) {
      return true
    }
  }

  const sent = await sendTelegramMessage({ text, replyMarkup })
  if (sent.ok && sent.messageId) {
    session.telegramMessageId = sent.messageId
    updateSession(session)
    return true
  }

  return false
}

function buildChatAboutFeedback(
  session: TelegramAskUserQuestionSession,
): string {
  const questionsWithAnswers = session.questions
    .map(question => {
      const answer = session.answers[question.question]
      if (answer) {
        return `- "${question.question}"\n  Answer: ${answer}`
      }
      return `- "${question.question}"\n  (No answer provided)`
    })
    .join('\n')

  return `The user wants to clarify these questions.
This means they may have additional information, context or questions for you.
Take their response into account and then reformulate the questions if appropriate.
Start by asking them what they would like to clarify.

Questions asked:\n${questionsWithAnswers}`
}

function buildSkipInterviewFeedback(
  session: TelegramAskUserQuestionSession,
): string {
  const questionsWithAnswers = session.questions
    .map(question => {
      const answer = session.answers[question.question]
      if (answer) {
        return `- "${question.question}"\n  Answer: ${answer}`
      }
      return `- "${question.question}"\n  (No answer provided)`
    })
    .join('\n')

  return `The user has indicated they have provided enough answers for the plan interview.
Stop asking clarifying questions and proceed to finish the plan with the information you have.

Questions asked and answers provided:\n${questionsWithAnswers}`
}

function buildAnnotationsForSubmit(
  session: TelegramAskUserQuestionSession,
): TelegramQuestionAnnotations | undefined {
  const annotations: TelegramQuestionAnnotations = {}

  for (const question of session.questions) {
    const entry = session.annotations[question.question]
    const notes = entry?.notes?.trim()
    const preview = selectedOption(session, question)?.preview

    if (preview || notes) {
      annotations[question.question] = {
        ...(preview ? { preview } : {}),
        ...(notes ? { notes } : {}),
      }
    }
  }

  return Object.keys(annotations).length > 0 ? annotations : undefined
}

async function completeSubmit(
  session: TelegramAskUserQuestionSession,
): Promise<boolean> {
  session.mode = 'completed'
  session.updatedAt = now()

  const annotations = buildAnnotationsForSubmit(session)
  const updatedInput = {
    ...session.toolUseConfirm.input,
    answers: session.answers,
    ...(annotations ? { annotations } : {}),
  }

  clearActiveTelegramAskUserQuestionSession()
  session.toolUseConfirm.onAllow(updatedInput, [])
  await sendTelegramMessage('✅ Answers submitted to Claude')
  return true
}

export async function startTelegramAskUserQuestionSession(params: {
  sessionId: string
  toolUseConfirm: ToolUseConfirm
  onDone: () => void
}): Promise<boolean> {
  const questions = ((params.toolUseConfirm.input as { questions?: Question[] })
    .questions ?? []) as Question[]

  if (!canRenderTelegramAskUserQuestion(questions)) {
    return false
  }

  const existing = getActiveTelegramAskUserQuestionSession()
  if (existing && existing.sessionId === params.sessionId) {
    existing.mode = 'expired'
    clearActiveTelegramAskUserQuestionSession()
    void sendTelegramMessage('⚠️ Previous Telegram question prompt expired.')
  }

  const session: TelegramAskUserQuestionSession = {
    promptId: randomUUID(),
    sessionId: params.sessionId,
    toolUseConfirm: params.toolUseConfirm,
    questions,
    currentQuestionIndex: 0,
    answers: {},
    annotations: {},
    selectedValueByQuestion: {},
    textInputValueByQuestion: {},
    mode: 'idle',
    isPlanMode: isPlanModeToolUseConfirm(params.toolUseConfirm),
    createdAt: now(),
    updatedAt: now(),
    expiresAt: now() + SESSION_TTL_MS,
  }

  params.onDone()
  setActiveTelegramAskUserQuestionSession(session)
  return renderOrSendQuestion(session)
}

function parseCallbackData(data: string): ParsedCallbackData | null {
  const parts = data.split(':')
  if (parts.length < 3 || parts[0] !== 'aq') {
    return null
  }

  const promptId = parts[1]
  const action = parts[2]

  if ((action === 'sel' || action === 'toggle') && parts[3] !== undefined) {
    const index = Number.parseInt(parts[3], 10)
    if (!Number.isNaN(index)) {
      return { promptId, action, index }
    }
  }

  if (
    action === 'other' ||
    action === 'note' ||
    action === 'chat' ||
    action === 'skip' ||
    action === 'submit'
  ) {
    return { promptId, action }
  }

  return null
}

function shouldAutoSubmitForCurrentQuestion(
  session: TelegramAskUserQuestionSession,
  questionText: string,
): boolean {
  const question = session.questions.find(item => item.question === questionText)
  if (!question) {
    return false
  }

  return (
    session.currentQuestionIndex === session.questions.length - 1 &&
    isQuestionAnswered(session, question)
  )
}

function handleSingleSelection(
  session: TelegramAskUserQuestionSession,
  question: Question,
  option: QuestionOption,
): void {
  setSelection(session, question.question, option.label)
  delete session.textInputValueByQuestion[question.question]
  session.mode = 'idle'
  session.awaitingOtherTextForQuestion = undefined
  syncAnswer(session, question)
}

function toggleMultiSelection(
  session: TelegramAskUserQuestionSession,
  question: Question,
  option: QuestionOption,
): void {
  const selected = new Set(getSelectedLabels(getSelection(session, question.question)))
  if (selected.has(option.label)) {
    selected.delete(option.label)
  } else {
    selected.add(option.label)
  }

  setSelection(session, question.question, [...selected])
  syncAnswer(session, question)
}

function selectOther(
  session: TelegramAskUserQuestionSession,
  question: Question,
): { awaitingText: boolean; toggledOff?: boolean } {
  const kind = getTelegramQuestionKind(question)
  const existingText = trimTextInput(session, question.question)

  if (kind === 'multi') {
    const selected = new Set(getSelectedLabels(getSelection(session, question.question)))
    if (selected.has(OTHER_VALUE)) {
      selected.delete(OTHER_VALUE)
      setSelection(session, question.question, [...selected])
      delete session.textInputValueByQuestion[question.question]
      session.mode = 'idle'
      session.awaitingOtherTextForQuestion = undefined
      syncAnswer(session, question)
      return { awaitingText: false, toggledOff: true }
    }

    selected.add(OTHER_VALUE)
    setSelection(session, question.question, [...selected])
    session.mode = existingText ? 'idle' : 'awaiting_other_text'
    session.awaitingOtherTextForQuestion = question.question
    syncAnswer(session, question)
    return { awaitingText: !existingText }
  }

  setSelection(session, question.question, OTHER_VALUE)
  session.mode = existingText ? 'idle' : 'awaiting_other_text'
  session.awaitingOtherTextForQuestion = question.question
  syncAnswer(session, question)
  return { awaitingText: !existingText }
}

export async function handleTelegramQuestionCallbackQuery(params: {
  sessionId: string
  callbackQueryId: string
  data: string
}): Promise<boolean> {
  const session = getActiveTelegramAskUserQuestionSession()
  if (!session || session.sessionId !== params.sessionId) {
    return false
  }

  if (session.expiresAt <= now()) {
    session.mode = 'expired'
    clearActiveTelegramAskUserQuestionSession()
    await answerTelegramCallbackQuery({
      callbackQueryId: params.callbackQueryId,
      text: 'This prompt has expired.',
    })
    return true
  }

  const parsed = parseCallbackData(params.data)
  if (!parsed || parsed.promptId !== session.promptId) {
    return false
  }

  const question = currentQuestion(session)
  if (!question) {
    return false
  }

  if (parsed.action === 'sel') {
    const option = question.options[parsed.index]
    if (!option) {
      await answerTelegramCallbackQuery({
        callbackQueryId: params.callbackQueryId,
        text: 'Invalid option.',
      })
      return true
    }

    handleSingleSelection(session, question, option)
    updateSession(session)

    await answerTelegramCallbackQuery({
      callbackQueryId: params.callbackQueryId,
      text: `Selected: ${option.label}`,
    })
    await renderOrSendQuestion(session)
    return true
  }

  if (parsed.action === 'toggle') {
    const option = question.options[parsed.index]
    if (!option) {
      await answerTelegramCallbackQuery({
        callbackQueryId: params.callbackQueryId,
        text: 'Invalid option.',
      })
      return true
    }

    toggleMultiSelection(session, question, option)
    updateSession(session)

    const selectedLabels = getSelectedLabels(getSelection(session, question.question))
    await answerTelegramCallbackQuery({
      callbackQueryId: params.callbackQueryId,
      text: selectedLabels.includes(option.label)
        ? `Added: ${option.label}`
        : `Removed: ${option.label}`,
    })
    await renderOrSendQuestion(session)
    return true
  }

  if (parsed.action === 'other') {
    const result = selectOther(session, question)
    updateSession(session)

    await answerTelegramCallbackQuery({
      callbackQueryId: params.callbackQueryId,
      text: result.toggledOff
        ? 'Removed Other.'
        : result.awaitingText
          ? 'Send your next Telegram message as Other text.'
          : 'Selected Other.',
    })

    if (result.awaitingText) {
      await sendTelegramMessage(
        `✍️ Send your custom answer for:\n"${question.question}"\n\nYour next Telegram message will be saved as the Other value. Reply /cancel to cancel text entry.`,
      )
    } else {
      await renderOrSendQuestion(session)
    }
    return true
  }

  if (parsed.action === 'note') {
    session.mode = 'awaiting_note'
    session.awaitingNoteForQuestion = question.question
    updateSession(session)
    await answerTelegramCallbackQuery({
      callbackQueryId: params.callbackQueryId,
      text: 'Send your next Telegram message as notes.',
    })
    await sendTelegramMessage(
      `📝 Send your notes for:\n"${question.question}"\n\nYour next Telegram message will be saved as notes. Reply /cancel to cancel notes entry.`,
    )
    return true
  }

  if (parsed.action === 'chat') {
    session.mode = 'cancelled'
    clearActiveTelegramAskUserQuestionSession()
    await answerTelegramCallbackQuery({
      callbackQueryId: params.callbackQueryId,
      text: 'Switching to free-form clarification.',
    })
    session.toolUseConfirm.onReject(buildChatAboutFeedback(session))
    await sendTelegramMessage(
      '💬 Switched to free-form clarification mode. Send your next Telegram message normally.',
    )
    return true
  }

  if (parsed.action === 'skip') {
    session.mode = 'cancelled'
    clearActiveTelegramAskUserQuestionSession()
    await answerTelegramCallbackQuery({
      callbackQueryId: params.callbackQueryId,
      text: 'Skipping interview.',
    })
    session.toolUseConfirm.onReject(buildSkipInterviewFeedback(session))
    await sendTelegramMessage('⏭️ Interview skipped. Claude will continue planning.')
    return true
  }

  if (parsed.action === 'submit') {
    if (!isQuestionAnswered(session, question)) {
      const kind = getTelegramQuestionKind(question)
      await answerTelegramCallbackQuery({
        callbackQueryId: params.callbackQueryId,
        text:
          kind === 'multi'
            ? 'Select at least one option first.'
            : 'Select an option or fill Other first.',
      })
      return true
    }

    if (session.currentQuestionIndex < session.questions.length - 1) {
      session.currentQuestionIndex += 1
      session.mode = 'idle'
      session.awaitingNoteForQuestion = undefined
      session.awaitingOtherTextForQuestion = undefined
      updateSession(session)
      await answerTelegramCallbackQuery({
        callbackQueryId: params.callbackQueryId,
        text: 'Moving to next question.',
      })
      await renderOrSendQuestion(session)
      return true
    }

    await answerTelegramCallbackQuery({
      callbackQueryId: params.callbackQueryId,
      text: 'Submitting answers.',
    })
    return completeSubmit(session)
  }

  return false
}

export async function handleTelegramQuestionTextMessage(params: {
  sessionId: string
  text: string
}): Promise<boolean> {
  const session = getActiveTelegramAskUserQuestionSession()
  if (!session || session.sessionId !== params.sessionId) {
    return false
  }

  const text = params.text.trim()
  if (!text) {
    return true
  }

  if (text === '/cancel') {
    if (session.mode === 'awaiting_note') {
      session.mode = 'idle'
      session.awaitingNoteForQuestion = undefined
      updateSession(session)
      await sendTelegramMessage('📝 Note entry cancelled.')
      await renderOrSendQuestion(session)
      return true
    }

    if (session.mode === 'awaiting_other_text') {
      session.mode = 'idle'
      session.awaitingOtherTextForQuestion = undefined
      const questionText = currentQuestion(session)?.question
      if (questionText) {
        const question = session.questions.find(item => item.question === questionText)
        if (question && getTelegramQuestionKind(question) === 'single') {
          delete session.textInputValueByQuestion[questionText]
          delete session.selectedValueByQuestion[questionText]
          syncAnswer(session, question)
        }
      }
      updateSession(session)
      await sendTelegramMessage('✍️ Other entry cancelled.')
      await renderOrSendQuestion(session)
      return true
    }

    return false
  }

  if (session.mode === 'awaiting_note' && session.awaitingNoteForQuestion) {
    const questionText = session.awaitingNoteForQuestion
    session.annotations[questionText] = {
      ...(session.annotations[questionText] ?? {}),
      notes: text,
    }
    session.mode = 'idle'
    session.awaitingNoteForQuestion = undefined
    updateSession(session)

    try {
      await sendTelegramMessage('✅ Notes saved.')
      if (shouldAutoSubmitForCurrentQuestion(session, questionText)) {
        await sendTelegramMessage('✅ Final answer complete. Submitting to Claude…')
        await completeSubmit(session)
      } else {
        await renderOrSendQuestion(session, { forceNewMessage: true })
      }
    } catch (error: unknown) {
      logError(error)
    }

    return true
  }

  if (
    session.mode === 'awaiting_other_text' &&
    session.awaitingOtherTextForQuestion
  ) {
    const questionText = session.awaitingOtherTextForQuestion
    const question = session.questions.find(item => item.question === questionText)
    if (!question) {
      return false
    }

    session.textInputValueByQuestion[questionText] = text
    session.mode = 'idle'
    session.awaitingOtherTextForQuestion = undefined
    syncAnswer(session, question)
    updateSession(session)

    try {
      await sendTelegramMessage('✅ Other answer saved.')
      if (shouldAutoSubmitForCurrentQuestion(session, questionText)) {
        await sendTelegramMessage('✅ Final answer complete. Submitting to Claude…')
        await completeSubmit(session)
      } else {
        await renderOrSendQuestion(session, { forceNewMessage: true })
      }
    } catch (error: unknown) {
      logError(error)
    }

    return true
  }

  return false
}
