import type { ToolUseConfirm } from '../../components/permissions/PermissionRequest.js'
import type { Question } from '../../tools/AskUserQuestionTool/AskUserQuestionTool.js'

export type TelegramQuestionAnnotations = Record<
  string,
  {
    preview?: string
    notes?: string
  }
>

export type TelegramQuestionSelection = string | string[]

export type TelegramAskUserQuestionSession = {
  promptId: string
  sessionId: string
  toolUseConfirm: ToolUseConfirm
  questions: Question[]
  currentQuestionIndex: number
  answers: Record<string, string>
  annotations: TelegramQuestionAnnotations
  selectedValueByQuestion: Record<string, TelegramQuestionSelection>
  textInputValueByQuestion: Record<string, string>
  mode:
    | 'idle'
    | 'awaiting_note'
    | 'awaiting_other_text'
    | 'completed'
    | 'cancelled'
    | 'expired'
  telegramMessageId?: number
  awaitingNoteForQuestion?: string
  awaitingOtherTextForQuestion?: string
  isPlanMode: boolean
  createdAt: number
  updatedAt: number
  expiresAt: number
}

let activeSession: TelegramAskUserQuestionSession | null = null

export function getActiveTelegramAskUserQuestionSession(): TelegramAskUserQuestionSession | null {
  return activeSession
}

export function setActiveTelegramAskUserQuestionSession(
  session: TelegramAskUserQuestionSession | null,
): void {
  activeSession = session
}

export function clearActiveTelegramAskUserQuestionSession(): void {
  activeSession = null
}

export function isTelegramAskUserQuestionSessionActive(
  sessionId: string,
): boolean {
  return (
    activeSession?.sessionId === sessionId &&
    activeSession.mode !== 'completed' &&
    activeSession.mode !== 'cancelled' &&
    activeSession.mode !== 'expired'
  )
}
