import type { AgentUserInputRequest, ResolveAgentUserInputInput } from "@gharargah/agents"
import { MessageCircleQuestion } from "lucide-react"
import { useMemo, useState } from "react"
import { Button } from "../../components/ui/button.js"
import { Checkbox } from "../../components/ui/checkbox.js"
import { Label } from "../../components/ui/label.js"
import { Textarea } from "../../components/ui/textarea.js"

type ResolvePayload = Pick<
  ResolveAgentUserInputInput,
  "requestId" | "answers" | "action" | "content"
>

export function UserInputCard(props: {
  userInput: AgentUserInputRequest
  disabled?: boolean
  onResolve: (input: ResolvePayload) => void
}) {
  const { userInput, disabled = false, onResolve } = props
  const [selections, setSelections] = useState<Record<string, string[]>>({})
  const [elicitationContent, setElicitationContent] = useState("")

  const questions = useMemo(() => userInput.questions ?? [], [userInput.questions])

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
      answers: questions.map(question => ({
        questionId: question.id,
        selected: selections[question.id] ?? [],
      })),
    })
  }

  return (
    <section
      data-testid="user-input-card"
      className="rounded-lg border border-border bg-card p-3"
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
          {questions.map(question => (
            <fieldset key={question.id} className="space-y-2">
              <legend className="text-xs font-medium text-foreground">{question.prompt}</legend>
              {(question.options ?? []).map(option => {
                const selected = (selections[question.id] ?? []).includes(option.id)
                const inputId = `${userInput.id}-${question.id}-${option.id}`
                return (
                  <div key={option.id} className="flex items-center gap-2">
                    {question.allowMultiple ? (
                      <Checkbox
                        id={inputId}
                        checked={selected}
                        disabled={disabled}
                        onCheckedChange={() =>
                          toggleOption(question.id, option.id, true)
                        }
                      />
                    ) : (
                      <input
                        id={inputId}
                        type="radio"
                        name={`${userInput.id}-${question.id}`}
                        checked={selected}
                        disabled={disabled}
                        className="size-3.5 shrink-0 accent-primary"
                        onChange={() => toggleOption(question.id, option.id, false)}
                      />
                    )}
                    <Label htmlFor={inputId} className="text-xs font-normal">
                      {option.label}
                    </Label>
                  </div>
                )
              })}
            </fieldset>
          ))}
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
