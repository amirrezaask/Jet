import type { AgentProvidersState } from "@jet/agents"
import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react"
import { cn } from "@/lib/utils.js"
import { ComposerPrimaryActions } from "./ComposerPrimaryActions.js"
import {
  ComposerPromptEditor,
  type ComposerPromptEditorHandle,
} from "./ComposerPromptEditor.js"
import { ProviderModelPicker } from "./ProviderModelPicker.js"
import {
  shouldUseCompactComposerFooter,
  shouldUseCompactComposerPrimaryActions,
} from "./composerFooterLayout.js"
import {
  deriveProviderInstanceEntries,
  getCustomModelOptionsByInstance,
  resolveDefaultProviderSelection,
} from "../providerInstances.js"
import type { ProviderInstanceId } from "../t3contracts.js"

export const ChatComposer = memo(function ChatComposer(props: {
  providers: AgentProvidersState | null
  instanceId: string | null
  model: string | null
  disabled?: boolean
  isRunning?: boolean
  isSendBusy?: boolean
  onInstanceModelChange: (instanceId: string, model: string) => void
  onSend: (payload: { text: string; instanceId: string; model: string }) => Promise<void>
  onInterrupt?: () => void
}) {
  const [draft, setDraft] = useState("")
  const [isComposerFocused, setIsComposerFocused] = useState(false)
  const [isModelPickerOpen, setIsModelPickerOpen] = useState(false)
  const promptRef = useRef("")
  const editorRef = useRef<ComposerPromptEditorHandle | null>(null)
  const composerFormRef = useRef<HTMLFormElement | null>(null)
  const composerSurfaceRef = useRef<HTMLDivElement | null>(null)
  const [footerWidth, setFooterWidth] = useState<number | null>(null)

  const instanceEntries = useMemo(
    () => deriveProviderInstanceEntries(props.providers),
    [props.providers],
  )
  const modelOptionsByInstance = useMemo(
    () => getCustomModelOptionsByInstance(instanceEntries),
    [instanceEntries],
  )

  const selection = useMemo(
    () =>
      resolveDefaultProviderSelection(instanceEntries, props.instanceId, props.model) ?? {
        instanceId: (props.instanceId ?? "") as ProviderInstanceId,
        model: props.model ?? "",
      },
    [instanceEntries, props.instanceId, props.model],
  )

  const isComposerFooterCompact = shouldUseCompactComposerFooter(footerWidth)
  const isComposerPrimaryActionsCompact = shouldUseCompactComposerPrimaryActions(footerWidth, {
    hasWideActions: false,
  })

  const hasSendableContent = draft.trim().length > 0
  const canSend =
    hasSendableContent &&
    !props.disabled &&
    !props.isSendBusy &&
    Boolean(selection.instanceId && selection.model)

  useLayoutEffect(() => {
    const node = composerFormRef.current
    if (!node) return
    const updateWidth = () => {
      const width = node.getBoundingClientRect().width
      if (width > 0) setFooterWidth(width)
    }
    updateWidth()
    const observer = new ResizeObserver(updateWidth)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const onPromptChange = useCallback((nextPrompt: string) => {
    promptRef.current = nextPrompt
    setDraft(nextPrompt)
  }, [])

  const submitComposer = useCallback(
    async (event?: { preventDefault?: () => void }) => {
      event?.preventDefault?.()
      const text = promptRef.current.trim()
      if (!text || !canSend) return
      await props.onSend({
        text,
        instanceId: selection.instanceId,
        model: selection.model,
      })
      promptRef.current = ""
      setDraft("")
      editorRef.current?.clear()
    },
    [canSend, props, selection.instanceId, selection.model],
  )

  const onComposerCommandKey = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "Enter" && !event.shiftKey) {
        void submitComposer()
        return true
      }
      return false
    },
    [submitComposer],
  )

  return (
    <form
      ref={composerFormRef}
      onSubmit={event => void submitComposer(event)}
      className="mx-auto w-full min-w-0 max-w-3xl"
      data-chat-composer-form="true"
    >
      <div className="group rounded-[22px] p-px transition-colors duration-200">
        <div
          ref={composerSurfaceRef}
          data-chat-composer-mobile-collapsed="false"
          className={cn(
            "chat-composer-glass rounded-[20px] border transition-colors duration-200 has-focus-visible:border-ring/45",
            isComposerFocused ? "border-ring/45" : "border-border",
          )}
          onFocusCapture={() => setIsComposerFocused(true)}
          onBlurCapture={event => {
            if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
            setIsComposerFocused(false)
          }}
        >
          <div className="relative px-3 pb-2 pt-3.5 sm:px-4 sm:pt-4">
            <div className="relative">
              <ComposerPromptEditor
                editorRef={editorRef}
                value={draft}
                disabled={props.disabled || props.isSendBusy}
                placeholder="Ask anything, @tag files/folders, $use skills, or / for commands"
                onChange={onPromptChange}
                onCommandKeyDown={onComposerCommandKey}
              />
            </div>
          </div>

          <div
            data-chat-composer-footer="true"
            data-chat-composer-footer-compact={isComposerFooterCompact ? "true" : "false"}
            className={cn(
              "flex min-w-0 flex-nowrap items-center justify-between gap-2 overflow-visible px-2.5 pb-2.5 sm:px-3 sm:pb-3",
              isComposerFooterCompact ? "gap-1.5" : "gap-2 sm:gap-0",
            )}
          >
            <div className="-m-1 flex min-w-0 flex-1 items-center gap-1 overflow-x-auto p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <ProviderModelPicker
                compact={isComposerFooterCompact}
                activeInstanceId={selection.instanceId}
                model={selection.model}
                lockedProvider={null}
                instanceEntries={instanceEntries}
                modelOptionsByInstance={modelOptionsByInstance}
                open={isModelPickerOpen}
                onOpenChange={setIsModelPickerOpen}
                disabled={props.disabled || props.isSendBusy}
                onInstanceModelChange={(instanceId, model) =>
                  props.onInstanceModelChange(instanceId, model)
                }
              />
            </div>

            <div
              data-chat-composer-actions="right"
              data-chat-composer-primary-actions-compact={
                isComposerPrimaryActionsCompact ? "true" : "false"
              }
              className="flex shrink-0 flex-nowrap items-center justify-end gap-2"
            >
              <ComposerPrimaryActions
                compact={isComposerPrimaryActionsCompact}
                pendingAction={null}
                isRunning={props.isRunning ?? false}
                showPlanFollowUpPrompt={false}
                promptHasText={draft.trim().length > 0}
                isSendBusy={props.isSendBusy ?? false}
                isConnecting={false}
                isEnvironmentUnavailable={false}
                isPreparingWorktree={false}
                hasSendableContent={canSend}
                onPreviousPendingQuestion={() => {}}
                onInterrupt={() => props.onInterrupt?.()}
                onImplementPlanInNewThread={() => {}}
              />
            </div>
          </div>
        </div>
      </div>
    </form>
  )
})
