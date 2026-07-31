import type {
  AgentAvailableCommand,
  AgentComposerCapabilities,
  AgentPermissionRequest,
  AgentProvidersState,
  AgentSessionConfigOption,
  AgentUserInputRequest,
  ResolveAgentPermissionInput,
  ResolveAgentUserInputInput,
} from "@gharargah/agents"
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react"
import { FileText, Mic, Plus, X } from "lucide-react"
import {
  Attachment,
  AttachmentAction,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/ui/attachment.js"
import { Button } from "@/components/ui/button.js"
import { cn } from "@/lib/utils.js"
import {
  type ComposerInteractionMode,
  type ComposerRuntimeMode,
} from "./ComposerModeControls.js"
import { ComposerPendingApprovalPanel } from "./ComposerPendingApprovalPanel.js"
import {
  ComposerPendingUserInputPanel,
  type ComposerPendingUserInputPanelHandle,
} from "./ComposerPendingUserInputPanel.js"
import {
  ComposerPrimaryActions,
  type PendingActionState,
} from "./ComposerPrimaryActions.js"
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
import type { ProviderInstanceId, ProviderDriverKind } from "@gharargah/agents"

const MAX_COMPOSER_ATTACHMENTS = 8
const MAX_INLINE_FILE_BYTES = 512 * 1024

type ComposerImageAttachment = {
  data: string
  mimeType: string
  name: string
  previewUrl: string
}

type ComposerFileAttachment = {
  name: string
  mimeType: string
  path?: string
  data?: string
  size: number
}

function commandName(command: AgentAvailableCommand): string {
  return command.name.startsWith("/") ? command.name : `/${command.name}`
}

function normalizedOptionKey(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, "")
}

function isInteractionConfigOption(option: AgentSessionConfigOption): boolean {
  const key = normalizedOptionKey(`${option.id} ${option.name} ${option.category ?? ""}`)
  if (!key.includes("mode")) return false
  const values = option.values?.map(value => normalizedOptionKey(value.value)) ?? []
  return values.some(value => ["agent", "build", "implement", "plan", "ask"].includes(value))
}

function configValueForInteraction(
  option: AgentSessionConfigOption,
  mode: ComposerInteractionMode,
): string | null {
  const aliases =
    mode === "implement" ? ["implement", "build", "agent", "default", "chat", "code"] : [mode]
  return (
    option.values?.find(value => aliases.includes(normalizedOptionKey(value.value)))?.value ?? null
  )
}

export const ChatComposer = memo(function ChatComposer(props: {
  providers: AgentProvidersState | null
  instanceId: string | null
  model: string | null
  disabled?: boolean
  /** Login-shell PATH still resolving — agent switcher stays loading. */
  shellEnvLoading?: boolean
  isRunning?: boolean
  isSendBusy?: boolean
  isRespondingPermission?: boolean
  commands?: ReadonlyArray<AgentAvailableCommand>
  runtimeMode?: ComposerRuntimeMode
  interactionMode?: ComposerInteractionMode
  availableInteractionModes?: ReadonlyArray<{ id: string; name: string }>
  configOptions?: ReadonlyArray<AgentSessionConfigOption>
  onRuntimeModeChange?: (mode: ComposerRuntimeMode) => void
  onInteractionModeChange?: (mode: ComposerInteractionMode) => void
  onConfigOptionChange?: (input: { configId: string; value: string }) => void
  onInstanceModelChange: (instanceId: string, model: string) => void
  onSend: (payload: {
    text: string
    instanceId: string
    model: string
    images?: ReadonlyArray<{ data: string; mimeType: string; name?: string }>
    files?: ReadonlyArray<{
      name: string
      mimeType?: string
      path?: string
      data?: string
    }>
  }) => Promise<void>
  onInterrupt?: () => void
  onProvidersRefresh?: (providerId?: string) => void
  lockedProvider?: ProviderDriverKind | null
  lockedContinuationGroupKey?: string | null
  showPlanFollowUpPrompt?: boolean
  onImplementPlan?: () => void
  capabilities?: AgentComposerCapabilities | null
  droppedFileBatch?: { id: number; files: File[] } | null
  pendingPermission?: AgentPermissionRequest | null
  pendingUserInput?: AgentUserInputRequest | null
  pendingActionCount?: number
  onResolvePermission?: (
    input: Pick<
      ResolveAgentPermissionInput,
      "permissionId" | "decision" | "optionId" | "approvalDecision"
    >,
  ) => void
  onResolveUserInput?: (
    input: Pick<ResolveAgentUserInputInput, "requestId" | "answers" | "action" | "content">,
  ) => void
  onCancelTurn?: () => void
}) {
  const [draft, setDraft] = useState("")
  const [isComposerFocused, setIsComposerFocused] = useState(false)
  const [isModelPickerOpen, setIsModelPickerOpen] = useState(false)
  const [slashIndex, setSlashIndex] = useState(0)
  const [slashMenuOpen, setSlashMenuOpen] = useState(false)
  const [images, setImages] = useState<ComposerImageAttachment[]>([])
  const [files, setFiles] = useState<ComposerFileAttachment[]>([])
  const [sendError, setSendError] = useState<string | null>(null)
  const [pendingAction, setPendingAction] = useState<PendingActionState | null>(null)
  const promptRef = useRef("")
  const imagesRef = useRef<ComposerImageAttachment[]>([])
  const lastDroppedFileBatchIdRef = useRef<number | null>(null)
  const editorRef = useRef<ComposerPromptEditorHandle | null>(null)
  const composerFormRef = useRef<HTMLFormElement | null>(null)
  const composerSurfaceRef = useRef<HTMLDivElement | null>(null)
  const imageInputRef = useRef<HTMLInputElement | null>(null)
  const userInputPanelRef = useRef<ComposerPendingUserInputPanelHandle | null>(null)
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

  const effectiveConfigOptions = useMemo(() => {
    const catalogOptions =
      instanceEntries
        .find(entry => entry.instanceId === selection.instanceId)
        ?.models.find(model => model.slug === selection.model)
        ?.configOptions ?? []
    const liveById = new Map((props.configOptions ?? []).map(option => [option.id, option]))
    const merged = catalogOptions.map(option => liveById.get(option.id) ?? option)
    for (const option of props.configOptions ?? []) {
      if (!merged.some(candidate => candidate.id === option.id)) merged.push(option)
    }
    return merged
  }, [instanceEntries, props.configOptions, selection.instanceId, selection.model])

  const interactionConfigOption = useMemo(
    () => effectiveConfigOptions.find(isInteractionConfigOption) ?? null,
    [effectiveConfigOptions],
  )
  const nonModelConfigOptions = useMemo(
    () =>
      effectiveConfigOptions.filter(
        option =>
          option.category?.toLowerCase() !== "model" &&
          option.id !== "model" &&
          !isInteractionConfigOption(option),
      ),
    [effectiveConfigOptions],
  )
  const capabilities = props.capabilities
  const showRuntime = Boolean(props.onRuntimeModeChange) && (capabilities?.showRuntime ?? true)
  const showInteraction =
    Boolean(props.onInteractionModeChange) && (capabilities?.showInteraction ?? true)
  const showAttach = capabilities?.showAttachments ?? true
  const isComposerFooterCompact = shouldUseCompactComposerFooter(footerWidth)
  const isComposerPrimaryActionsCompact = shouldUseCompactComposerPrimaryActions(footerWidth, {
    hasWideActions: false,
  })
  const runtimeMode = props.runtimeMode ?? "approval-required"
  const interactionMode = props.interactionMode ?? "implement"
  const handleInteractionModeChange = useCallback(
    (mode: ComposerInteractionMode) => {
      props.onInteractionModeChange?.(mode)
      if (!interactionConfigOption || !props.onConfigOptionChange) return
      const value = configValueForInteraction(interactionConfigOption, mode)
      if (value) {
        props.onConfigOptionChange({ configId: interactionConfigOption.id, value })
      }
    },
    [interactionConfigOption, props.onConfigOptionChange, props.onInteractionModeChange],
  )

  const slashQueryActive = draft.startsWith("/") && !draft.includes("\n")
  const filteredCommands = useMemo(() => {
    if (!slashQueryActive || !props.commands?.length) return []
    const query = draft.toLowerCase()
    return props.commands.filter(command => commandName(command).toLowerCase().startsWith(query))
  }, [draft, props.commands, slashQueryActive])

  const showSlashMenu = slashMenuOpen && slashQueryActive && filteredCommands.length > 0

  const attachmentCount = images.length + files.length
  const hasSendableContent = draft.trim().length > 0 || attachmentCount > 0
  const canSend =
    hasSendableContent &&
    !props.disabled &&
    !props.isRunning &&
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

  imagesRef.current = images
  useEffect(
    () => () => {
      for (const image of imagesRef.current) URL.revokeObjectURL(image.previewUrl)
    },
    [],
  )

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
      if (props.pendingPermission) {
        return
      }
      if (props.pendingUserInput && !props.pendingPermission) {
        userInputPanelRef.current?.goNext()
        return
      }
      const text = promptRef.current.trim()
      if ((!text && attachmentCount === 0) || !canSend) return
      const outgoingImages = images.map(({ data, mimeType, name }) => ({ data, mimeType, name }))
      const outgoingFiles = files.map(({ name, mimeType, path, data }) => ({
        name,
        mimeType,
        ...(path ? { path } : {}),
        ...(data ? { data } : {}),
      }))
      setSendError(null)
      try {
        await props.onSend({
          text,
          instanceId: selection.instanceId,
          model: selection.model,
          ...(outgoingImages.length > 0 ? { images: outgoingImages } : {}),
          ...(outgoingFiles.length > 0 ? { files: outgoingFiles } : {}),
        })
        for (const image of images) URL.revokeObjectURL(image.previewUrl)
        setImages([])
        setFiles([])
        promptRef.current = ""
        setDraft("")
        editorRef.current?.clear()
      } catch (error) {
        setSendError(error instanceof Error ? error.message : String(error))
        editorRef.current?.focus()
      }
    },
    [
      attachmentCount,
      canSend,
      files,
      images,
      props,
      selection.instanceId,
      selection.model,
    ],
  )

  const attachFiles = useCallback(
    async (pickedFiles: File[]) => {
      if (pickedFiles.length === 0) return
      const remaining = Math.max(0, MAX_COMPOSER_ATTACHMENTS - attachmentCount)
      const nextFiles = pickedFiles.slice(0, remaining)
      const nextImages: ComposerImageAttachment[] = []
      const nextDocuments: ComposerFileAttachment[] = []
      setSendError(null)

      for (const file of nextFiles) {
        const path = (file as File & { path?: string }).path
        const isImage =
          file.type.startsWith("image/") ||
          /\.(?:gif|jpe?g|png|webp)$/i.test(file.name)
        if (isImage) {
          const result = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () =>
              typeof reader.result === "string"
                ? resolve(reader.result)
                : reject(new Error(`Could not read ${file.name}`))
            reader.onerror = () =>
              reject(reader.error ?? new Error(`Could not read ${file.name}`))
            reader.readAsDataURL(file)
          })
          const comma = result.indexOf(",")
          nextImages.push({
            data: comma >= 0 ? result.slice(comma + 1) : result,
            mimeType: file.type || "image/png",
            name: file.name || "Image",
            previewUrl: URL.createObjectURL(file),
          })
          continue
        }

        if (path) {
          nextDocuments.push({
            name: file.name || path.split(/[/\\]/).pop() || "File",
            mimeType: file.type || "application/octet-stream",
            path,
            size: file.size,
          })
          continue
        }

        const isInlineText =
          file.type.startsWith("text/") ||
          /(?:json|javascript|typescript|xml|yaml|toml|graphql)/i.test(file.type) ||
          /\.(?:c|cc|cpp|css|go|h|hpp|html|java|js|jsx|json|md|py|rs|sh|sql|svelte|toml|ts|tsx|txt|vue|xml|ya?ml)$/i.test(
            file.name,
          )
        if (!isInlineText) {
          setSendError(`Attach ${file.name} from its local path; inline binary files aren’t supported`)
          continue
        }
        if (file.size > MAX_INLINE_FILE_BYTES) {
          setSendError(`${file.name} is larger than the 512 KB inline attachment limit`)
          continue
        }
        const result = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () =>
            typeof reader.result === "string"
              ? resolve(reader.result)
              : reject(new Error(`Could not read ${file.name}`))
          reader.onerror = () =>
            reject(reader.error ?? new Error(`Could not read ${file.name}`))
          reader.readAsDataURL(file)
        })
        const comma = result.indexOf(",")
        nextDocuments.push({
          name: file.name || "File",
          mimeType: file.type || "text/plain",
          data: comma >= 0 ? result.slice(comma + 1) : result,
          size: file.size,
        })
      }

      if (nextImages.length > 0) {
        setImages(current =>
          [...current, ...nextImages].slice(0, MAX_COMPOSER_ATTACHMENTS),
        )
      }
      if (nextDocuments.length > 0) {
        setFiles(current =>
          [...current, ...nextDocuments].slice(
            0,
            Math.max(0, MAX_COMPOSER_ATTACHMENTS - images.length - nextImages.length),
          ),
        )
      }
      editorRef.current?.focus()
    },
    [attachmentCount, images.length],
  )

  const onAttachFiles = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const pickedFiles = Array.from(event.target.files ?? [])
      event.target.value = ""
      await attachFiles(pickedFiles)
    },
    [attachFiles],
  )

  useEffect(() => {
    const batch = props.droppedFileBatch
    if (!batch || lastDroppedFileBatchIdRef.current === batch.id) return
    lastDroppedFileBatchIdRef.current = batch.id
    void attachFiles(batch.files)
  }, [attachFiles, props.droppedFileBatch])

  const removeImage = useCallback((index: number) => {
    setImages(current => {
      const next = [...current]
      const [removed] = next.splice(index, 1)
      if (removed) URL.revokeObjectURL(removed.previewUrl)
      return next
    })
  }, [])

  const removeFile = useCallback((index: number) => {
    setFiles(current => current.filter((_, candidateIndex) => candidateIndex !== index))
  }, [])

  const onComposerCommandKey = useCallback(
    (event: KeyboardEvent) => {
      if (props.pendingPermission) {
        if (event.key === "Enter" && !event.shiftKey) {
          props.onResolvePermission?.({
            permissionId: props.pendingPermission.id,
            decision: "allow_once",
            approvalDecision: "accept",
          })
          return true
        }
        if (event.key === "Escape") {
          props.onResolvePermission?.({
            permissionId: props.pendingPermission.id,
            decision: "reject_once",
            approvalDecision: "decline",
          })
          return true
        }
      }
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
    [applySlashCommand, filteredCommands, props, showSlashMenu, slashIndex, submitComposer],
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
      {props.pendingPermission ? (
        <ComposerPendingApprovalPanel
          permission={props.pendingPermission}
          pendingCount={props.pendingActionCount ?? 1}
          isResponding={props.isRespondingPermission ?? props.isSendBusy}
          onResolve={input => props.onResolvePermission?.(input)}
          onCancelTurn={props.onCancelTurn}
        />
      ) : props.pendingUserInput ? (
        <ComposerPendingUserInputPanel
          ref={userInputPanelRef}
          userInput={props.pendingUserInput}
          pendingCount={props.pendingActionCount ?? 1}
          isResponding={props.isSendBusy}
          onResolve={input => props.onResolveUserInput?.(input)}
          onCancelTurn={props.onCancelTurn}
          onPendingActionChange={setPendingAction}
        />
      ) : null}

      <div className="group rounded-[var(--agent-composer-radius)] p-px transition-colors duration-[var(--gharargah-motion-menu)]">
        <div
          ref={composerSurfaceRef}
          data-chat-composer-mobile-collapsed="false"
          className={cn(
            "chat-composer-glass border transition-colors duration-[var(--gharargah-motion-menu)] has-focus-visible:border-ring/40",
            isComposerFocused ? "border-ring/40" : "border-border/60",
          )}
          onFocusCapture={() => setIsComposerFocused(true)}
          onBlurCapture={event => {
            if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
            setIsComposerFocused(false)
          }}
        >
          {attachmentCount > 0 ? (
            <div className="px-3 pt-3 sm:px-4">
              <AttachmentGroup
                className="mb-1"
                data-composer-attachments="true"
                data-composer-attachment-count={attachmentCount}
              >
                {images.map((image, index) => (
                  <Attachment
                    key={`${image.previewUrl}-${index}`}
                    size="xs"
                    data-composer-attachment="image"
                  >
                    <AttachmentMedia>
                      <img src={image.previewUrl} alt="" />
                    </AttachmentMedia>
                    <AttachmentContent>
                      <AttachmentTitle>{image.name}</AttachmentTitle>
                      <AttachmentDescription>Image</AttachmentDescription>
                    </AttachmentContent>
                    <AttachmentAction
                      type="button"
                      aria-label={`Remove ${image.name}`}
                      onClick={() => removeImage(index)}
                    >
                      <X data-icon="inline-start" />
                    </AttachmentAction>
                  </Attachment>
                ))}
                {files.map((file, index) => (
                  <Attachment
                    key={`${file.path ?? file.name}-${index}`}
                    size="xs"
                    data-composer-attachment="file"
                  >
                    <AttachmentMedia>
                      <FileText aria-hidden="true" />
                    </AttachmentMedia>
                    <AttachmentContent>
                      <AttachmentTitle>{file.name}</AttachmentTitle>
                      <AttachmentDescription>
                        {file.path ? "Local file" : "Attached text"}
                      </AttachmentDescription>
                    </AttachmentContent>
                    <AttachmentAction
                      type="button"
                      aria-label={`Remove ${file.name}`}
                      onClick={() => removeFile(index)}
                    >
                      <X data-icon="inline-start" />
                    </AttachmentAction>
                  </Attachment>
                ))}
              </AttachmentGroup>
            </div>
          ) : null}

          <div
            data-chat-composer-footer="true"
            data-chat-composer-footer-compact={isComposerFooterCompact ? "true" : "false"}
            className="flex min-w-0 items-end gap-1.5 px-2 py-2 sm:gap-2 sm:px-2.5 sm:py-2"
          >
            <input
              ref={imageInputRef}
              type="file"
              multiple
              className="sr-only"
              onChange={event => void onAttachFiles(event)}
            />
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              className="mb-0.5 size-8 shrink-0 rounded-full text-muted-foreground hover:text-foreground"
              data-composer-attach-image="true"
              data-composer-attach-file="true"
              disabled={
                !showAttach ||
                props.disabled ||
                attachmentCount >= MAX_COMPOSER_ATTACHMENTS
              }
              aria-label="Add attachment"
              onClick={() => imageInputRef.current?.click()}
            >
              <Plus className="size-4" />
            </Button>

            <div
              className="relative min-w-0 flex-1 self-center"
              onKeyDownCapture={onSlashMenuKeyDownCapture}
            >
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
                disabled={props.disabled}
                placeholder="Send follow-up"
                onChange={onPromptChange}
                onCommandKeyDown={onComposerCommandKey}
              />
              {sendError ? (
                <p className="mt-1 text-xs text-destructive" role="alert">
                  Message wasn&apos;t sent: {sendError}. Your draft is still here.
                </p>
              ) : null}
            </div>

            <div
              data-chat-composer-actions="right"
              data-chat-composer-primary-actions-compact={
                isComposerPrimaryActionsCompact ? "true" : "false"
              }
              className="mb-0.5 flex shrink-0 flex-nowrap items-center justify-end gap-0.5 sm:gap-1"
            >
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
                disabled={props.disabled}
                shellEnvLoading={props.shellEnvLoading}
                triggerClassName="max-w-40 px-1.5 text-xs text-muted-foreground/80 sm:max-w-52"
                onInstanceModelChange={(instanceId, model) =>
                  props.onInstanceModelChange(instanceId, model)
                }
                runtimeMode={runtimeMode}
                interactionMode={interactionMode}
                availableInteractionModes={props.availableInteractionModes}
                configOptions={nonModelConfigOptions}
                showRuntime={showRuntime}
                showInteraction={showInteraction}
                onRuntimeModeChange={props.onRuntimeModeChange}
                onInteractionModeChange={handleInteractionModeChange}
                onConfigOptionChange={props.onConfigOptionChange}
                onProvidersRefresh={props.onProvidersRefresh}
              />
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                className="size-8 rounded-full text-muted-foreground/50"
                disabled
                aria-label="Voice input unavailable"
                title="Voice input unavailable"
                data-composer-mic-stub="true"
              >
                <Mic className="size-4" />
              </Button>
              <ComposerPrimaryActions
                compact={isComposerPrimaryActionsCompact}
                pendingAction={
                  props.pendingUserInput && !props.pendingPermission ? pendingAction : null
                }
                isRunning={props.isRunning ?? false}
                showPlanFollowUpPrompt={props.showPlanFollowUpPrompt ?? false}
                promptHasText={draft.trim().length > 0}
                isSendBusy={props.isSendBusy ?? false}
                isConnecting={false}
                isEnvironmentUnavailable={false}
                isPreparingWorktree={false}
                hasSendableContent={canSend}
                onPreviousPendingQuestion={() => userInputPanelRef.current?.goPrevious()}
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
