import type { ProviderInstanceId, ProviderDriverKind } from "../t3contracts.js"
import { memo, useMemo, useState } from "react"
import { CheckIcon } from "lucide-react"
import { Lister, type ListerNode } from "../../lister/index.js"
import { Button } from "@/components/ui/button.js"
import { cn } from "@/lib/utils.js"
import {
  getDisplayModelName,
  type ModelEsque,
} from "./providerIconUtils.js"
import {
  isProviderInstancePickerReady,
  isProviderInstancePickerVisible,
  type ProviderInstanceEntry,
} from "../providerInstances.js"

export type ModelSwitcherItem = {
  instanceId: ProviderInstanceId
  driverKind: ProviderDriverKind
  providerLabel: string
  model: ModelEsque
  label: string
  disabledReason: string | null
}

function buildSwitcherItems(input: {
  instanceEntries: ReadonlyArray<ProviderInstanceEntry>
  modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<ModelEsque>>
  lockedProvider: ProviderDriverKind | null
  getModelDisabledReason?: (instanceId: ProviderInstanceId, model: string) => string | null
}): ModelSwitcherItem[] {
  const items: ModelSwitcherItem[] = []
  for (const entry of input.instanceEntries) {
    if (!isProviderInstancePickerVisible(entry)) continue
    if (input.lockedProvider && entry.driverKind !== input.lockedProvider) continue
    const models =
      input.modelOptionsByInstance.get(entry.instanceId) ??
      entry.models.map(model => ({
        slug: model.slug,
        name: model.name,
        shortName: model.shortName,
      }))
    for (const model of models) {
      const modelName = getDisplayModelName(model)
      const disabledReason =
        !isProviderInstancePickerReady(entry)
          ? entry.message?.trim() || `${entry.displayName} unavailable`
          : (input.getModelDisabledReason?.(entry.instanceId, model.slug) ?? null)
      items.push({
        instanceId: entry.instanceId,
        driverKind: entry.driverKind,
        providerLabel: entry.displayName,
        model,
        label: `${entry.displayName}: ${modelName}`,
        disabledReason,
      })
    }
  }
  return items
}

function isAutoModel(model: ModelEsque): boolean {
  const key = `${model.slug} ${model.name} ${model.shortName ?? ""}`.toLowerCase()
  return /\bauto\b/.test(key)
}

export const ModelSwitcherPanel = memo(function ModelSwitcherPanel(props: {
  activeInstanceId: ProviderInstanceId
  model: string
  lockedProvider: ProviderDriverKind | null
  instanceEntries: ReadonlyArray<ProviderInstanceEntry>
  modelOptionsByInstance: ReadonlyMap<ProviderInstanceId, ReadonlyArray<ModelEsque>>
  getModelDisabledReason?: (instanceId: ProviderInstanceId, model: string) => string | null
  onInstanceModelChange: (instanceId: ProviderInstanceId, model: string) => void
  onRequestClose?: () => void
  onAddModels?: () => void
}) {
  const [autoEnabled, setAutoEnabled] = useState(() => {
    const activeModels = props.modelOptionsByInstance.get(props.activeInstanceId) ?? []
    const active = activeModels.find(model => model.slug === props.model)
    return active ? isAutoModel(active) : false
  })

  const items = useMemo(
    () =>
      buildSwitcherItems({
        instanceEntries: props.instanceEntries,
        modelOptionsByInstance: props.modelOptionsByInstance,
        lockedProvider: props.lockedProvider,
        getModelDisabledReason: props.getModelDisabledReason,
      }),
    [
      props.instanceEntries,
      props.modelOptionsByInstance,
      props.lockedProvider,
      props.getModelDisabledReason,
    ],
  )

  const listerItems = useMemo<ListerNode<ModelSwitcherItem>[]>(
    () =>
      items.map(item => ({
        id: `${item.instanceId}:${item.model.slug}`,
        searchText: `${item.providerLabel} ${item.model.name} ${item.model.slug} ${item.model.shortName ?? ""}`,
        data: item,
      })),
    [items],
  )

  const activeId = `${props.activeInstanceId}:${props.model}`

  const selectItem = (item: ModelSwitcherItem) => {
    if (item.disabledReason) return
    setAutoEnabled(isAutoModel(item.model))
    props.onInstanceModelChange(item.instanceId, item.model.slug)
    props.onRequestClose?.()
  }

  const toggleAuto = () => {
    const next = !autoEnabled
    setAutoEnabled(next)
    if (!next) return
    const autoItem =
      items.find(
        item =>
          item.instanceId === props.activeInstanceId &&
          !item.disabledReason &&
          isAutoModel(item.model),
      ) ??
      items.find(item => !item.disabledReason && isAutoModel(item.model))
    if (autoItem) {
      props.onInstanceModelChange(autoItem.instanceId, autoItem.model.slug)
      props.onRequestClose?.()
    }
  }

  return (
    <div
      className="flex w-[min(22rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-md"
      data-agent-setup-picker="true"
    >
      <div data-model-picker-content="true" className="flex min-h-0 flex-1 flex-col">
      <Lister<ModelSwitcherItem>
        listId="agent-model-switcher"
        mode="flat"
        flatVariant="plain"
        showInput
        autoFocusInput
        placeholder="Search models"
        filter="local"
        items={listerItems}
        activeId={activeId}
        className="h-72 min-h-0 shrink-0"
        listClassName="px-1 py-1"
        role="listbox"
        aria-label="Models"
        betweenInputAndList={
          <div className="flex items-center justify-between gap-3 border-b border-border/60 px-3 py-2">
            <span className="text-sm text-foreground">Auto</span>
            <button
              type="button"
              role="switch"
              aria-checked={autoEnabled}
              data-model-picker-auto=""
              className={cn(
                "relative h-5 w-9 shrink-0 rounded-full transition-colors",
                autoEnabled ? "bg-foreground" : "bg-muted",
              )}
              onClick={toggleAuto}
            >
              <span
                aria-hidden
                className={cn(
                  "absolute top-0.5 size-4 rounded-full bg-background shadow transition-transform",
                  autoEnabled ? "left-4" : "left-0.5",
                )}
              />
            </button>
          </div>
        }
        estimateSize={() => 36}
        emptyState={
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">No models found.</p>
        }
        onActivate={node => {
          if (node.data.disabledReason) return
          selectItem(node.data)
        }}
        render={(node, ctx) => {
          const item = node.data
          const selected = ctx.active || node.id === activeId
          const disabled = Boolean(item.disabledReason)
          return (
            <button
              type="button"
              role="option"
              aria-selected={selected}
              disabled={disabled}
              title={item.disabledReason ?? item.label}
              data-gharargah-list-item=""
              data-model-picker-row=""
              data-model-picker-provider={item.instanceId}
              data-model-slug={item.model.slug}
              data-model-disabled={disabled ? "true" : undefined}
              data-slot="combobox-item"
              className={cn(
                "flex h-9 w-full min-w-0 items-center gap-2 rounded-sm px-2 text-sm outline-none",
                "hover:bg-muted/50 focus-visible:bg-muted/50",
                selected && "bg-muted/50",
                disabled && "cursor-not-allowed opacity-50",
              )}
              onPointerDown={event => {
                if (event.button !== 0) return
                // Keep search focus; select on pointerdown so synthetic
                // Playwright clicks still activate (click can be suppressed
                // after preventDefault on mousedown).
                event.preventDefault()
                selectItem(item)
              }}
            >
              <span className="min-w-0 flex-1 truncate text-left">
                <span className="text-foreground">{item.providerLabel}</span>
                <span className="text-muted-foreground">: </span>
                <span className="text-foreground">
                  {getDisplayModelName(item.model)}
                </span>
              </span>
              {selected ? (
                <CheckIcon className="size-3.5 shrink-0 text-foreground" aria-hidden />
              ) : null}
            </button>
          )
        }}
      />
      <div className="border-t border-border/60 p-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-9 w-full justify-start px-2 font-normal text-muted-foreground"
          data-model-picker-add-models=""
          onClick={() => props.onAddModels?.()}
        >
          Add Models
        </Button>
      </div>
      </div>
    </div>
  )
})
