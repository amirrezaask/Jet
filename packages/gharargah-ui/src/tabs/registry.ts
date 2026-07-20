import type { ReactNode } from "react"
import { Emitter } from "@gharargah/shared"
import type { PanelId } from "@gharargah/shared"

export type TabInstance<S = unknown> = {
  id: string
  typeId: string
  state: S
}

export type TabRenderCtx = {
  panelId: PanelId
  focused: boolean
  isActive: boolean
}

export type TabType<S = unknown> = {
  id: string
  title: (state: S) => string
  icon?: (state: S) => ReactNode
  dirty?: (state: S) => boolean
  render: (instance: TabInstance<S>, ctx: TabRenderCtx) => ReactNode
  dispose?: (instance: TabInstance<S>) => void
  keepMounted?: boolean
}

export class TabTypeRegistry {
  private types = new Map<string, TabType<unknown>>()
  readonly onDidChange = new Emitter<{ typeId: string }>()

  register<S>(type: TabType<S>): void {
    this.types.set(type.id, type as TabType<unknown>)
    this.onDidChange.fire({ typeId: type.id })
  }

  get(typeId: string): TabType<unknown> | undefined {
    return this.types.get(typeId)
  }

  getTyped<S>(typeId: string): TabType<S> | undefined {
    return this.types.get(typeId) as TabType<S> | undefined
  }

  has(typeId: string): boolean {
    return this.types.has(typeId)
  }
}

export class TabStore {
  private instances = new Map<string, TabInstance<unknown>>()
  private counter = 1
  readonly onDidChange = new Emitter<{ id: string }>()

  constructor(private readonly registry: TabTypeRegistry) {}

  allocId(prefix = "tab"): string {
    return `${prefix}-${this.counter++}`
  }

  create<S>(typeId: string, state: S, id?: string): TabInstance<S> {
    const tabId = id ?? this.allocId(typeId)
    const existing = this.instances.get(tabId)
    if (existing) {
      existing.state = state
      this.onDidChange.fire({ id: tabId })
      return existing as TabInstance<S>
    }
    const instance: TabInstance<S> = { id: tabId, typeId, state }
    this.instances.set(tabId, instance as TabInstance<unknown>)
    this.onDidChange.fire({ id: tabId })
    return instance
  }

  get(id: string): TabInstance<unknown> | undefined {
    return this.instances.get(id)
  }

  getTyped<S>(id: string): TabInstance<S> | undefined {
    return this.instances.get(id) as TabInstance<S> | undefined
  }

  typeOf(id: string): TabType<unknown> | undefined {
    const inst = this.instances.get(id)
    if (!inst) return undefined
    return this.registry.get(inst.typeId)
  }

  typeIdOf(id: string): string | undefined {
    return this.instances.get(id)?.typeId
  }

  update<S>(id: string, next: S | ((prev: S) => S)): void {
    const inst = this.getTyped<S>(id)
    if (!inst) return
    inst.state = typeof next === "function" ? (next as (prev: S) => S)(inst.state) : next
    this.onDidChange.fire({ id })
  }

  dispose(id: string): void {
    const inst = this.instances.get(id)
    if (!inst) return
    const type = this.registry.get(inst.typeId)
    type?.dispose?.(inst)
    this.instances.delete(id)
    this.onDidChange.fire({ id })
  }

  title(id: string, fallback = id): string {
    const inst = this.instances.get(id)
    if (!inst) return fallback
    const type = this.registry.get(inst.typeId)
    return type?.title(inst.state) ?? fallback
  }

  dirty(id: string): boolean {
    const inst = this.instances.get(id)
    if (!inst) return false
    const type = this.registry.get(inst.typeId)
    return type?.dirty?.(inst.state) ?? false
  }

  icon(id: string): ReactNode | undefined {
    const inst = this.instances.get(id)
    if (!inst) return undefined
    const type = this.registry.get(inst.typeId)
    return type?.icon?.(inst.state)
  }
}
