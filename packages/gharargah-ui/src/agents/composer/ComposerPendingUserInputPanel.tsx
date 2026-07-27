import type {
  AgentUserInputQuestion,
  AgentUserInputRequest,
  ResolveAgentUserInputInput,
} from "@gharargah/agents"
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react"
import { Button } from "../../components/ui/button.js"
import { Checkbox } from "../../components/ui/checkbox.js"
import { Label } from "../../components/ui/label.js"
import { Textarea } from "../../components/ui/textarea.js"
import type { PendingActionState } from "./ComposerPrimaryActions.js"

type QuestionOption = {
  id: string
  label: string
  description?: string
}

type QuestionExt = AgentUserInputQuestion & {
  header?: string
  multiSelect?: boolean
  options?: ReadonlyArray<QuestionOption>
}

type ResolvePayload = Pick<
  ResolveAgentUserInputInput,
  "requestId" | "answers" | "action" | "content"
>

export type ComposerPendingUserInputPanelHandle = {
  goNext: () => boolean
  goPrevious: () => void
}

function isMultiSelect(question: QuestionExt): boolean {
  return Boolean(question.multiSelect ?? question.allowMultiple)
}

export const ComposerPendingUserInputPanel = forwardRef<
  ComposerPendingUserInputPanelHandle,
  {
    userInput: AgentUserInputRequest
    pendingCount: number
    isResponding?: boolean
    onResolve: (input: ResolvePayload) => void
    onCancelTurn?: () => void
    onPendingActionChange?: (state: PendingActionState | null) => void
  }
>(function ComposerPendingUserInputPanel(props, ref) {
  const {
    userInput,
    pendingCount,
    isResponding = false,
    onResolve,
    onCancelTurn,
    onPendingActionChange,
  } = props
  const questions = useMemo(
    () => (userInput.questions ?? []) as QuestionExt[],
    [userInput.questions],
  )
  const [questionIndex, setQuestionIndex] = useState(0)
  const [selections, setSelections] = useState<Record<string, string[]>>({})
  const [customAnswers, setCustomAnswers] = useState<Record<string, string>>({})
  const [elicitationContent, setElicitationContent] = useState("")

  useEffect(() => {
    setQuestionIndex(0)
    setSelections({})
    setCustomAnswers({})
    setElicitationContent("")
  }, [userInput.id])

  const currentQuestion = questions[questionIndex] ?? null
  const options: QuestionOption[] = currentQuestion?.options
    ? [...currentQuestion.options]
    : []
  const forceCustom = Boolean(currentQuestion) && options.length === 0
  const multi = currentQuestion ? isMultiSelect(currentQuestion) : false

  const selectedIds = currentQuestion ? (selections[currentQuestion.id] ?? []) : []
  const customText = currentQuestion ? (customAnswers[currentQuestion.id] ?? "") : ""

  const canAdvanceAsk = useMemo(() => {
    if (!currentQuestion) return false
    if (forceCustom) return customText.trim().length > 0
    if (multi) return selectedIds.length > 0
    return selectedIds.length === 1
  }, [currentQuestion, customText, forceCustom, multi, selectedIds.length])

  const isLastQuestion = questionIndex >= Math.max(0, questions.length - 1)
  const isCompleteAsk = useMemo(() => {
    if (userInput.kind !== "ask_question") return false
    return questions.every(question => {
      const opts = question.options ?? []
      if (opts.length === 0) {
        return (customAnswers[question.id] ?? "").trim().length > 0
      }
      return (selections[question.id] ?? []).length > 0
    })
  }, [customAnswers, questions, selections, userInput.kind])

  const emitPendingAction = useCallback(() => {
    if (userInput.kind !== "ask_question" || questions.length === 0) {
      onPendingActionChange?.(null)
      return
    }
    onPendingActionChange?.({
      questionIndex,
      isLastQuestion,
      canAdvance: canAdvanceAsk,
      isResponding,
      isComplete: isCompleteAsk,
    })
  }, [
    canAdvanceAsk,
    isCompleteAsk,
    isLastQuestion,
    isResponding,
    onPendingActionChange,
    questionIndex,
    questions.length,
    userInput.kind,
  ])

  useEffect(() => {
    emitPendingAction()
    return () => onPendingActionChange?.(null)
  }, [emitPendingAction, onPendingActionChange])

  function toggleOption(optionId: string) {
    if (!currentQuestion) return
    setSelections(current => {
      const existing = current[currentQuestion.id] ?? []
      if (multi) {
        const next = existing.includes(optionId)
          ? existing.filter(id => id !== optionId)
          : [...existing, optionId]
        return { ...current, [currentQuestion.id]: next }
      }
      return { ...current, [currentQuestion.id]: [optionId] }
    })
  }

  const goNext = useCallback(() => {
    if (userInput.kind !== "ask_question") return false
    if (isLastQuestion) {
      if (!canAdvanceAsk && !isCompleteAsk) return false
      onResolve({
        requestId: userInput.id,
        answers: questions.map(question => {
          const opts = question.options ?? []
          if (opts.length === 0) {
            const text = (customAnswers[question.id] ?? "").trim()
            return { questionId: question.id, selected: text ? [text] : [] }
          }
          return { questionId: question.id, selected: selections[question.id] ?? [] }
        }),
      })
      return true
    }
    if (!canAdvanceAsk) return false
    setQuestionIndex(index => Math.min(index + 1, questions.length - 1))
    return false
  }, [
    canAdvanceAsk,
    customAnswers,
    isCompleteAsk,
    isLastQuestion,
    onResolve,
    questions,
    selections,
    userInput.id,
    userInput.kind,
  ])

  const goPrevious = useCallback(() => {
    setQuestionIndex(index => Math.max(0, index - 1))
  }, [])

  useImperativeHandle(
    ref,
    () => ({
      goNext,
      goPrevious,
    }),
    [goNext, goPrevious],
  )

  function onKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (userInput.kind !== "ask_question" || !currentQuestion || forceCustom) return
    if (event.metaKey || event.ctrlKey || event.altKey) return
    const digit = Number(event.key)
    if (!Number.isInteger(digit) || digit < 1 || digit > 9) return
    const option = options[digit - 1]
    if (!option) return
    event.preventDefault()
    toggleOption(option.id)
  }

  if (userInput.kind === "elicitation") {
    return (
      <section
        className="mb-2 rounded-xl border border-border/50 bg-muted/20 p-3"
        data-slot="composer-pending-user-input"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-foreground">{userInput.title}</p>
            {userInput.message ? (
              <p className="mt-1 text-xs text-muted-foreground">{userInput.message}</p>
            ) : null}
          </div>
          {pendingCount > 1 ? (
            <span className="shrink-0 text-3xs text-muted-foreground">1/{pendingCount}</span>
          ) : null}
        </div>
        <Textarea
          value={elicitationContent}
          disabled={isResponding}
          placeholder="Enter your response…"
          className="mt-3 min-h-20 text-sm"
          onChange={event => setElicitationContent(event.target.value)}
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            type="button"
            size="xs"
            disabled={isResponding}
            onClick={() =>
              onResolve({
                requestId: userInput.id,
                action: "accept",
                content: { text: elicitationContent },
              })
            }
          >
            Accept
          </Button>
          <Button
            type="button"
            size="xs"
            variant="outline"
            disabled={isResponding}
            onClick={() => onResolve({ requestId: userInput.id, action: "decline" })}
          >
            Decline
          </Button>
          <Button
            type="button"
            size="xs"
            variant="ghost"
            disabled={isResponding}
            onClick={() => {
              if (onCancelTurn) {
                onCancelTurn()
                return
              }
              onResolve({ requestId: userInput.id, action: "cancel" })
            }}
          >
            Cancel
          </Button>
        </div>
      </section>
    )
  }

  return (
    <section
      className="mb-2 rounded-xl border border-border/50 bg-muted/20 p-3"
      data-slot="composer-pending-user-input"
      tabIndex={0}
      onKeyDown={onKeyDown}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-foreground">
            {userInput.title}
            {questions.length > 0 ? (
              <span className="ml-2 font-normal text-muted-foreground">
                {questionIndex + 1}/{questions.length}
              </span>
            ) : null}
          </p>
          {userInput.message ? (
            <p className="mt-1 text-xs text-muted-foreground">{userInput.message}</p>
          ) : null}
        </div>
        {pendingCount > 1 ? (
          <span className="shrink-0 text-3xs text-muted-foreground">1/{pendingCount}</span>
        ) : null}
      </div>

      {currentQuestion ? (
        <div className="mt-3 space-y-2">
          {currentQuestion.header ? (
            <p className="text-3xs font-medium uppercase tracking-wide text-muted-foreground">
              {currentQuestion.header}
            </p>
          ) : null}
          <p className="text-xs font-medium text-foreground">{currentQuestion.prompt}</p>
          {forceCustom ? (
            <Textarea
              value={customText}
              disabled={isResponding}
              placeholder="Type your answer…"
              className="min-h-16 text-sm"
              onChange={event =>
                setCustomAnswers(current => ({
                  ...current,
                  [currentQuestion.id]: event.target.value,
                }))
              }
            />
          ) : (
            <div className="space-y-1.5">
              {options.map((option, index) => {
                const selected = selectedIds.includes(option.id)
                const inputId = `${userInput.id}-${currentQuestion.id}-${option.id}`
                return (
                  <div
                    key={option.id}
                    className="flex items-start gap-2 rounded-md border border-transparent px-1 py-1 hover:bg-muted/40"
                  >
                    {multi ? (
                      <Checkbox
                        id={inputId}
                        checked={selected}
                        disabled={isResponding}
                        className="mt-0.5"
                        onCheckedChange={() => toggleOption(option.id)}
                      />
                    ) : (
                      <input
                        id={inputId}
                        type="radio"
                        name={`${userInput.id}-${currentQuestion.id}`}
                        checked={selected}
                        disabled={isResponding}
                        className="mt-1 size-3.5 shrink-0 accent-primary"
                        onChange={() => toggleOption(option.id)}
                      />
                    )}
                    <Label htmlFor={inputId} className="min-w-0 flex-1 font-normal">
                      <span className="text-xs text-foreground">
                        {index < 9 ? (
                          <span className="mr-1.5 font-mono text-3xs text-muted-foreground">
                            {index + 1}
                          </span>
                        ) : null}
                        {option.label}
                      </span>
                      {option.description ? (
                        <span className="mt-0.5 block text-3xs text-muted-foreground">
                          {option.description}
                        </span>
                      ) : null}
                    </Label>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      ) : null}
    </section>
  )
})
