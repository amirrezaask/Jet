import type { AgentUserInputQuestion, AgentUserInputRequest, ResolveAgentUserInputInput } from "@gharargah/agents"
import { MessageCircleQuestion } from "lucide-react"
import { useMemo, useState } from "react"
import { Button } from "../../components/ui/button.js"
import { Checkbox } from "../../components/ui/checkbox.js"
import { Label } from "../../components/ui/label.js"
import { Textarea } from "../../components/ui/textarea.js"

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

function isMultiSelect(question: QuestionExt): boolean {
  return Boolean(question.multiSelect ?? question.allowMultiple)
}

export function UserInputCard(props: {
  userInput: AgentUserInputRequest
  disabled?: boolean
  onResolve: (input: ResolvePayload) => void
}) {
  const { userInput, disabled = false, onResolve } = props
  const [selections, setSelections] = useState<Record<string, string[]>>({})
  const [customAnswers, setCustomAnswers] = useState<Record<string, string>>({})
  const [elicitationContent, setElicitationContent] = useState("")

  const questions = useMemo(
    () => (userInput.questions ?? []) as QuestionExt[],
    [userInput.questions],
  )

  function toggleOption(questionId: string, optionId: string, allowMultiple: boolean) {
    setSelections(current => {
      const existing = current[questionId] ?? []
      if (allowMultiple) {
        const next = existing.includes(optionId)
          ? existing.filter(id => id !== optionId)
          : [...existing, optionId]
        return { ...current, [questionId]: next }
      }
      return { ...current, [questionId]: [optionId] }
    })
  }

  function submitAnswers() {
    onResolve({
      requestId: userInput.id,
      answers: questions.map(question => {
        const opts = question.options ?? []
        if (opts.length === 0) {
          const text = (customAnswers[question.id] ?? "").trim()
          return { questionId: question.id, selected: text ? [text] : [] }
        }
        return {
          questionId: question.id,
          selected: selections[question.id] ?? [],
        }
      }),
    })
  }

  return (
    <section
      data-testid="user-input-card"
      className="rounded-xl border border-border/40 bg-muted/15 p-3"
    >
      <div className="flex items-start gap-2">
        <MessageCircleQuestion className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium">{userInput.title}</h3>
          {userInput.message ? (
            <p className="mt-1 text-xs text-muted-foreground">{userInput.message}</p>
          ) : null}
        </div>
      </div>

      {userInput.kind === "ask_question" ? (
        <div className="mt-3 space-y-3">
          {questions.map(question => {
            const options: QuestionOption[] = question.options
              ? [...question.options]
              : []
            const forceCustom = options.length === 0
            const multi = isMultiSelect(question)
            return (
              <fieldset key={question.id} className="space-y-2">
                {question.header ? (
                  <p className="text-3xs font-medium uppercase tracking-wide text-muted-foreground">
                    {question.header}
                  </p>
                ) : null}
                <legend className="text-xs font-medium text-foreground">{question.prompt}</legend>
                {forceCustom ? (
                  <Textarea
                    value={customAnswers[question.id] ?? ""}
                    disabled={disabled}
                    placeholder="Type your answer…"
                    className="min-h-16 text-sm"
                    onChange={event =>
                      setCustomAnswers(current => ({
                        ...current,
                        [question.id]: event.target.value,
                      }))
                    }
                  />
                ) : (
                  options.map(option => {
                    const selected = (selections[question.id] ?? []).includes(option.id)
                    const inputId = `${userInput.id}-${question.id}-${option.id}`
                    return (
                      <div key={option.id} className="flex items-start gap-2">
                        {multi ? (
                          <Checkbox
                            id={inputId}
                            checked={selected}
                            disabled={disabled}
                            className="mt-0.5"
                            onCheckedChange={() => toggleOption(question.id, option.id, true)}
                          />
                        ) : (
                          <input
                            id={inputId}
                            type="radio"
                            name={`${userInput.id}-${question.id}`}
                            checked={selected}
                            disabled={disabled}
                            className="mt-1 size-3.5 shrink-0 accent-primary"
                            onChange={() => toggleOption(question.id, option.id, false)}
                          />
                        )}
                        <Label htmlFor={inputId} className="min-w-0 flex-1 font-normal">
                          <span className="text-xs">{option.label}</span>
                          {option.description ? (
                            <span className="mt-0.5 block text-3xs text-muted-foreground">
                              {option.description}
                            </span>
                          ) : null}
                        </Label>
                      </div>
                    )
                  })
                )}
              </fieldset>
            )
          })}
          <Button size="xs" disabled={disabled} onClick={submitAnswers}>
            Submit answers
          </Button>
        </div>
      ) : null}

      {userInput.kind === "elicitation" ? (
        <div className="mt-3 space-y-3">
          <Textarea
            value={elicitationContent}
            disabled={disabled}
            placeholder="Enter your response…"
            className="min-h-20 text-sm"
            onChange={event => setElicitationContent(event.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              size="xs"
              disabled={disabled}
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
              size="xs"
              variant="outline"
              disabled={disabled}
              onClick={() => onResolve({ requestId: userInput.id, action: "decline" })}
            >
              Decline
            </Button>
            <Button
              size="xs"
              variant="ghost"
              disabled={disabled}
              onClick={() => onResolve({ requestId: userInput.id, action: "cancel" })}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  )
}
