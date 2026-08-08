import { Emitter } from "@yaade/shared"

export type LspUiAction = { title: string }

export type LspUiMessageRequest = {
  id: number
  type: number
  message: string
  actions: readonly LspUiAction[]
}

export type LspUiProgress = {
  connectionId: string
  token: string | number
  kind: "created" | "begin" | "report" | "end"
  title?: string
  message?: string
  percentage?: number
  cancellable?: boolean
}

export type LspUiOutput = {
  connectionId: string
  timestamp: number
  direction: "client" | "server"
  method: string
  kind: "request" | "notification" | "response" | "error"
  message?: string
  data?: unknown
}

export type LspUiSnapshot = {
  revision: number
  request: LspUiMessageRequest | null
  progress: readonly LspUiProgress[]
  output: readonly LspUiOutput[]
}

type PendingRequest = {
  request: LspUiMessageRequest
  resolve: (action: LspUiAction | null) => void
}

const changed = new Emitter<void>()
const pending: PendingRequest[] = []
const progress = new Map<string, LspUiProgress>()
const output: LspUiOutput[] = []
let requestId = 1
let revision = 0
let snapshot: LspUiSnapshot = {
  revision,
  request: null,
  progress: [],
  output: [],
}

function progressKey(event: Pick<LspUiProgress, "connectionId" | "token">): string {
  return `${event.connectionId}:${String(event.token)}`
}

function publish(): void {
  revision += 1
  snapshot = {
    revision,
    request: pending[0]?.request ?? null,
    progress: [...progress.values()],
    output: [...output],
  }
  changed.fire()
}

export function getLspUiSnapshot(): LspUiSnapshot {
  return snapshot
}

export function subscribeLspUi(listener: () => void): () => void {
  const disposable = changed.event(listener)
  return () => disposable.dispose()
}

export function recordLspProgress(event: LspUiProgress): void {
  const key = progressKey(event)
  if (event.kind === "end") progress.delete(key)
  else {
    const previous = progress.get(key)
    progress.set(key, previous ? { ...previous, ...event } : event)
  }
  publish()
}

export function recordLspOutput(entry: LspUiOutput): void {
  output.push(entry)
  if (output.length > 1_000) output.splice(0, output.length - 1_000)
  publish()
}

export function requestLspMessageAction(input: {
  type?: number
  message: string
  actions?: readonly LspUiAction[]
}): Promise<LspUiAction | null> {
  const actions = input.actions
  if (!actions?.length) return Promise.resolve(null)
  return new Promise(resolve => {
    pending.push({
      request: {
        id: requestId++,
        type: input.type ?? 3,
        message: input.message,
        actions,
      },
      resolve,
    })
    publish()
  })
}

export function resolveLspMessageAction(
  requestIdToResolve: number,
  action: LspUiAction | null,
): void {
  const index = pending.findIndex(item => item.request.id === requestIdToResolve)
  if (index < 0) return
  const [item] = pending.splice(index, 1)
  item?.resolve(action)
  publish()
}
