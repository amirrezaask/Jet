import type { AgentAvailableCommand, AgentProvidersState } from "@gharargah/agents"
import {
  memo,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react"
import { ImagePlus, X } from "lucide-react"
import { Button } from "@/components/ui/button.js"
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
import type { ProviderInstanceId, ProviderDriverKind } from "../t3contracts.js"

const MAX_COMPOSER_IMAGES = 8

type ComposerImageAttachment = { data: string; mimeType: string; previewUrl: string }

function commandName(command: AgentAvailableCommand): string {
  return command.name.startsWith("/") ? command.name : `/${command.name}`
}

export const ChatComposer = memo(function ChatComposer(props: {
  providers: AgentProvidersState | null
  instanceId: string | null
  model: string | null
  disabled?: boolean
  isRunning?: boolean
  isSendBusy?: boolean
  commands?: ReadonlyArray<AgentAvailableCommand>
  onInstanceModelChange: (instanceId: string, model: string) => void
  onSend: (payload: {
    text: string
    instanceId: string
    model: string
    images?: ReadonlyArray<{ data: string; mimeType: string }>
  }) => Promise<void>
  onInterrupt?: () => void
  onProvidersRefresh?: () => void
  lockedProvider?: ProviderDriverKind | null
  lockedContinuationGroupKey?: string | null
  showPlanFollowUpPrompt?: boolean
  onImplementPlan?: () => void
}) {
  const [draft, setDraft] = useState("")
  const [isComposerFocused, setIsComposerFocused] = useState(false)
  const [isModelPickerOpen, setIsModelPickerOpen] = useState(false)
  const [slashIndex, setSlashIndex] = useState(0)
  const [slashMenuOpen, setSlashMenuOpen] = useState(false)
  const [images, setImages] = useState<ComposerImageAttachment[]>([])
  const promptRef = useRef("")
  const editorRef = useRef<ComposerPromptEditorHandle | null>(null)
  const composerFormRef = useRef<HTMLFormElement | null>(null)
  const composerSurfaceRef = useRef<HTMLDivElement | null>(null)
  const imageInputRef = useRef<HTMLInputElement | null>(null)
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

  const slashQueryActive = draft.startsWith("/") && !draft.includes("\n")
  const filteredCommands = useMemo(() => {
    if (!slashQueryActive || !props.commands?.length) return []
    const query = draft.toLowerCase()
    return props.commands.filter(command => commandName(command).toLowerCase().startsWith(query))
  }, [draft, props.commands, slashQueryActive])

  const showSlashMenu = slashMenuOpen && slashQueryActive && filteredCommands.length > 0

  const hasSendableContent = draft.trim().length > 0 || images.length > 0
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

  useLayoutEffect(() => {
    if (!slashQueryActive || !props.commands?.length) {
      setSlashMenuOpen(false)
      setSlashIndex(0)
      return
    }
    setSlashMenuOpen(true)
    setSlashIndex(0)
  }, [slashQueryActive, props.commands?.length, draft])

  useLayoutEffect(() => {
    if (slashIndex >= filteredCommands.length) {
      setSlashIndex(Math.max(0, filteredCommands.length - 1))
    }
  }, [filteredCommands.length, slashIndex])

  const onPromptChange = useCallback((nextPrompt: string) => {
    promptRef.current = nextPrompt
    setDraft(nextPrompt)
  }, [])

  const applySlashCommand = useCallback(
    (command: AgentAvailableCommand) => {
      const next = `${commandName(command)} `
      promptRef.current = next
      setDraft(next)
      editorRef.current?.setText(next)
      setSlashMenuOpen(false)
      editorRef.current?.focus()
    },
    [],
  )

  const submitComposer = useCallback(
    async (event?: { preventDefault?: () => void }) => {
      event?.preventDefault?.()
      const text = promptRef.current.trim()
      if ((!text && images.length === 0) || !canSend) return
      const outgoingImages = images.map(({ data, mimeType }) => ({ data, mimeType }))
      await props.onSend({
        text,
        instanceId: selection.instanceId,
        model: selection.model,
        ...(outgoingImages.length > 0 ? { images: outgoingImages } : {}),
      })
      for (const image of images) URL.revokeObjectURL(image.previewUrl)
      setImages([])
      promptRef.current = ""
      setDraft("")
      editorRef.current?.clear()
    },
    [canSend, images, props, selection.instanceId, selection.model],
  )

  const onAttachImages = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ""
    if (files.length === 0) return
    const remaining = Math.max(0, MAX_COMPOSER_IMAGES - images.length)
    const nextFiles = files.slice(0, remaining)
    const nextImages = await Promise.all(
      nextFiles.map(
        file =>
          new Promise<ComposerImageAttachment>((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => {
              const result = reader.result
              if (typeof result !== "string") {
                reject(new Error("Failed to read image"))
                return
              }
              const comma = result.indexOf(",")
              resolve({
                data: comma >= 0 ? result.slice(comma + 1) : result,
                mimeType: file.type || "application/octet-stream",
                previewUrl: URL.createObjectURL(file),
              })
            }
            reader.onerror = () => reject(reader.error ?? new Error("Failed to read image"))
            reader.readAsDataURL(file)
          }),
      ),
    )
    setImages(current => [...current, ...nextImages].slice(0, MAX_COMPOSER_IMAGES))
  }, [images.length])

  const removeImage = useCallback((index: number) => {
    setImages(current => {
      const next = [...current]
      const [removed] = next.splice(index, 1)
      if (removed) URL.revokeObjectURL(removed.previewUrl)
      return next
    })
  }, [])

  const onComposerCommandKey = useCallback(
    (event: KeyboardEvent) => {
      if (showSlashMenu) {
        if (event.key === "Enter" || event.key === "Tab") {
          const command = filteredCommands[slashIndex]
          if (command) {
            applySlashCommand(command)
            return true
          }
        }
      }
      if (event.key === "Enter" && !event.shiftKey) {
        void submitComposer()
        return true
      }
      return false
    },
    [applySlashCommand, filteredCommands, showSlashMenu, slashIndex, submitComposer],
  )

  const onSlashMenuKeyDownCapture = useCallback(
    (event: ReactKeyboardEvent) => {
      if (!showSlashMenu) return
      if (event.key === "Escape") {
        event.preventDefault()
        event.stopPropagation()
        setSlashMenuOpen(false)
        return
      }
      if (event.key === "ArrowDown") {
        event.preventDefault()
        event.stopPropagation()
        setSlashIndex(index => (index + 1) % filteredCommands.length)
        return
      }
      if (event.key === "ArrowUp") {
        event.preventDefault()
        event.stopPropagation()
        setSlashIndex(index => (index - 1 + filteredCommands.length) % filteredCommands.length)
        return
      }
      if (event.key === "Tab") {
        const command = filteredCommands[slashIndex]
        if (command) {
          event.preventDefault()
          event.stopPropagation()
          applySlashCommand(command)
        }
      }
    },
    [applySlashCommand, filteredCommands, showSlashMenu, slashIndex],
  )

  return (
    <form
      ref={composerFormRef}
      onSubmit={event => void submitComposer(event)}
      className="mx-auto w-full min-w-0 max-w-3xl"
      data-chat-composer-form="true"
    >
      <div className="group rounded-xl p-px transition-colors duration-[var(--gharargah-motion-menu)]">
        <div
          ref={composerSurfaceRef}
          data-chat-composer-mobile-collapsed="false"
          className={cn(
            "chat-composer-glass rounded-xl border transition-colors duration-[var(--gharargah-motion-menu)] has-focus-visible:border-ring/45",
            isComposerFocused ? "border-ring/45" : "border-border",
          )}
          onFocusCapture={() => setIsComposerFocused(true)}
          onBlurCapture={event => {
            if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
            setIsComposerFocused(false)
          }}
        >
          <div className="relative px-3 pb-2 pt-3.5 sm:px-4 sm:pt-4">
            {images.length > 0 ? (
              <div className="mb-2 flex flex-wrap gap-2">
                {images.map((image, index) => (
                  <div
                    key={`${image.previewUrl}-${index}`}
                    className="relative overflow-hidden rounded-md border border-border"
                  >
                    <img
                      src={image.previewUrl}
                      alt=""
                      className="size-14 object-cover"
                    />
                    <Button
                      type="button"
                      size="icon-xs"
                      variant="secondary"
                      className="absolute top-0.5 right-0.5"
                      aria-label="Remove image"
                      onClick={() => removeImage(index)}
                    >
                      <X className="size-3" />
                    </Button>
                  </div>
                ))}
              </div>
            ) : null}
            <div className="relative" onKeyDownCapture={onSlashMenuKeyDownCapture}>
              {showSlashMenu ? (
                <div
                  data-testid="composer-slash-menu"
                  role="listbox"
                  className="absolute inset-x-0 bottom-full z-20 mb-1 max-h-48 overflow-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
                >
                  {filteredCommands.map((command, index) => {
                    const name = commandName(command)
                    return (
                      <Button
                        key={name}
                        type="button"
                        variant="ghost"
                        size="sm"
                        role="option"
                        aria-selected={index === slashIndex}
                        data-gharargah-list-item=""
                        className={cn(
                          "h-auto w-full justify-start gap-2 px-2 py-1.5 font-normal",
                          index === slashIndex && "bg-accent text-accent-foreground",
                        )}
                        onMouseEnter={() => setSlashIndex(index)}
                        onClick={() => applySlashCommand(command)}
                      >
                        <span className="font-mono text-sm">{name}</span>
                        {command.description ? (
                          <span className="truncate text-xs text-muted-foreground">
                            {command.description}
                          </span>
                        ) : null}
                      </Button>
                    )
                  })}
                </div>
              ) : null}
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
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                multiple
                className="sr-only"
                onChange={event => void onAttachImages(event)}
              />
              <Button
                type="button"
                size="xs"
                variant="ghost"
                data-composer-attach-image="true"
                disabled={props.disabled || props.isSendBusy || images.length >= MAX_COMPOSER_IMAGES}
                onClick={() => imageInputRef.current?.click()}
              >
                <ImagePlus className="size-3.5" />
                Attach
              </Button>
              <ProviderModelPicker
                compact={isComposerFooterCompact}
                activeInstanceId={selection.instanceId}
                model={selection.model}
                lockedProvider={props.lockedProvider ?? null}
                lockedContinuationGroupKey={props.lockedContinuationGroupKey ?? null}
                instanceEntries={instanceEntries}
                modelOptionsByInstance={modelOptionsByInstance}
                open={isModelPickerOpen}
                onOpenChange={open => {
                  setIsModelPickerOpen(open)
                  if (open) props.onProvidersRefresh?.()
                }}
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
                showPlanFollowUpPrompt={props.showPlanFollowUpPrompt ?? false}
                promptHasText={draft.trim().length > 0}
                isSendBusy={props.isSendBusy ?? false}
                isConnecting={false}
                isEnvironmentUnavailable={false}
                isPreparingWorktree={false}
                hasSendableContent={canSend}
                onPreviousPendingQuestion={() => {}}
                onInterrupt={() => props.onInterrupt?.()}
                onImplementPlanInNewThread={() => props.onImplementPlan?.()}
              />
            </div>
          </div>
        </div>
      </div>
    </form>
  )
})
