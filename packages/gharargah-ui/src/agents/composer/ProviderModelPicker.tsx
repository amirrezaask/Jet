import {
  type ProviderInstanceId,
  type ProviderDriverKind,
  type ResolvedKeybindingsConfig,
} from "../t3contracts.js"
import type { AgentSessionConfigOption } from "@gharargah/agents"
import { memo, useEffect, useMemo, useState } from "react"
import type { VariantProps } from "class-variance-authority"
import { ChevronDownIcon } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button.js"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover.js"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip.js"
import { cn } from "@/lib/utils.js"
import { ModelSwitcherPanel } from "./ModelSwitcherPanel.js"
import {
  ModelEsque,
  getTriggerDisplayModelLabel,
  getTriggerDisplayModelName,
} from "./providerIconUtils.js"
import type { ProviderInstanceEntry } from "../providerInstances.js"
import type {
  ComposerInteractionMode,
  ComposerRuntimeMode,
} from "./ComposerModeControls.js"

export const ProviderModelPicker = memo(function ProviderModelPicker(props: {
  activeInstanceId: ProviderInstanceId
  model: string
  lockedProvider: ProviderDriverKind | null
  lockedContinuationGroupKey?: string | null
  instanceEntries: ReadonlyArray<ProviderInstanceEntry>
  keybindings?: ResolvedKeybindingsConfig
  modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<ModelEsque>>
  activeProviderIconClassName?: string
  compact?: boolean
  disabled?: boolean
  shellEnvLoading?: boolean
  terminalOpen?: boolean
  open?: boolean
  triggerVariant?: VariantProps<typeof buttonVariants>["variant"]
  triggerClassName?: string
  onOpenChange?: (open: boolean) => void
  getModelDisabledReason?: (instanceId: ProviderInstanceId, model: string) => string | null
  onInstanceModelChange: (instanceId: ProviderInstanceId, model: string) => void
  runtimeMode: ComposerRuntimeMode
  interactionMode: ComposerInteractionMode
  availableInteractionModes?: ReadonlyArray<{ id: string; name: string }>
  configOptions: ReadonlyArray<AgentSessionConfigOption>
  showRuntime: boolean
  showInteraction: boolean
  onRuntimeModeChange?: (mode: ComposerRuntimeMode) => void
  onInteractionModeChange?: (mode: ComposerInteractionMode) => void
  onConfigOptionChange?: (input: { configId: string; value: string }) => void
  onProvidersRefresh?: (providerId?: string) => void
}) {
  const [uncontrolledIsMenuOpen, setUncontrolledIsMenuOpen] = useState(false)
  const isMenuOpen = props.open ?? uncontrolledIsMenuOpen
  const shellEnvLoading = props.shellEnvLoading ?? false
  const pickerDisabled = Boolean(props.disabled) || shellEnvLoading

  const activeEntry = useMemo(() => {
    return (
      props.instanceEntries.find(entry => entry.instanceId === props.activeInstanceId) ?? null
    )
  }, [props.activeInstanceId, props.instanceEntries])

  const activeInstanceId = props.activeInstanceId
  const selectedInstanceOptions = props.modelOptionsByInstance.get(activeInstanceId) ?? []
  const selectedModel =
    selectedInstanceOptions.find(option => option.slug === props.model) ??
    selectedInstanceOptions[0]
  const triggerTitle = shellEnvLoading
    ? "Loading…"
    : selectedModel
      ? getTriggerDisplayModelName(selectedModel)
      : props.model
  const triggerLabel = shellEnvLoading
    ? "Loading environment"
    : selectedModel
      ? getTriggerDisplayModelLabel(selectedModel)
      : props.model
  const providerLabel = shellEnvLoading
    ? "Agent"
    : (activeEntry?.displayName ?? "Agent")

  const setIsMenuOpen = (open: boolean) => {
    if (shellEnvLoading && open) return
    props.onOpenChange?.(open)
    if (props.open === undefined) {
      setUncontrolledIsMenuOpen(open)
    }
  }

  useEffect(() => {
    if (!isMenuOpen) return

    const { documentElement, body } = document
    const previousDocumentOverscrollBehavior = documentElement.style.overscrollBehavior
    const previousBodyOverflow = body.style.overflow
    const previousBodyPaddingRight = body.style.paddingRight
    const scrollbarWidth = window.innerWidth - documentElement.clientWidth

    documentElement.style.overscrollBehavior = "contain"
    body.style.overflow = "hidden"
    if (scrollbarWidth > 0) {
      body.style.paddingRight = `${scrollbarWidth}px`
    }

    const shouldAllowOverlayScroll = (target: EventTarget | null) => {
      return target instanceof Element && target.closest("[data-model-picker-content]")
    }
    const preventBackgroundWheel = (event: WheelEvent) => {
      if (shouldAllowOverlayScroll(event.target)) return
      event.preventDefault()
    }
    const preventBackgroundTouchMove = (event: TouchEvent) => {
      if (shouldAllowOverlayScroll(event.target)) return
      event.preventDefault()
    }

    document.addEventListener("wheel", preventBackgroundWheel, { capture: true, passive: false })
    document.addEventListener("touchmove", preventBackgroundTouchMove, {
      capture: true,
      passive: false,
    })

    return () => {
      document.removeEventListener("wheel", preventBackgroundWheel, { capture: true })
      document.removeEventListener("touchmove", preventBackgroundTouchMove, { capture: true })
      documentElement.style.overscrollBehavior = previousDocumentOverscrollBehavior
      body.style.overflow = previousBodyOverflow
      body.style.paddingRight = previousBodyPaddingRight
    }
  }, [isMenuOpen])

  const handleInstanceModelChange = (instanceId: ProviderInstanceId, model: string) => {
    if (props.disabled) return
    props.onInstanceModelChange(instanceId, model)
    setIsMenuOpen(false)
  }

  return (
    <Popover
      modal
      open={isMenuOpen}
      onOpenChange={open => {
        if (props.disabled) {
          setIsMenuOpen(false)
          return
        }
        setIsMenuOpen(open)
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant={props.triggerVariant ?? "ghost"}
          data-chat-provider-model-picker="true"
          data-shell-env-loading={shellEnvLoading ? "true" : undefined}
          className={cn(
            "min-w-0 justify-between whitespace-nowrap px-2 text-muted-foreground/70 hover:text-foreground/80",
            props.compact ? "max-w-42 shrink-0" : "max-w-48 shrink sm:max-w-56 sm:px-3",
            props.triggerClassName,
          )}
          disabled={pickerDisabled}
        >
          <span className="flex min-w-0 flex-1 items-center gap-1.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="min-w-0 flex-1 truncate text-left text-xs sm:text-sm">
                  <span className="text-foreground/75">{providerLabel}</span>
                  <span className="px-1 text-muted-foreground/40"> </span>
                  <span className="text-muted-foreground/80">{triggerTitle}</span>
                </span>
              </TooltipTrigger>
              <TooltipContent side="top">
                {providerLabel} · {triggerLabel}
              </TooltipContent>
            </Tooltip>
          </span>
          <span aria-hidden="true" className="flex items-center">
            <ChevronDownIcon
              aria-hidden="true"
              className="!ms-0 !-me-0.5 size-3 shrink-0 opacity-50"
            />
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        className="w-auto border-0 bg-transparent p-0 shadow-none"
      >
        <ModelSwitcherPanel
          activeInstanceId={activeInstanceId}
          model={props.model}
          lockedProvider={props.lockedProvider}
          instanceEntries={props.instanceEntries}
          modelOptionsByInstance={props.modelOptionsByInstance}
          {...(props.getModelDisabledReason
            ? { getModelDisabledReason: props.getModelDisabledReason }
            : {})}
          onInstanceModelChange={handleInstanceModelChange}
          onRequestClose={() => setIsMenuOpen(false)}
          onAddModels={() => {
            props.onProvidersRefresh?.()
            setIsMenuOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
})
