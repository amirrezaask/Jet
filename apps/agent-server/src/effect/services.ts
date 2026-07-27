import { Context, Effect, Layer } from "effect"
import type { OrchestrationCommand } from "@gharargah/agents"
import type { AgentCatalogState, AgentThread } from "@gharargah/agents"
import { AgentStore } from "../persistence/store.js"
import { OrchestrationEngine, type OrchEventSink } from "../orchestration/engine.js"
import type { OrchError } from "./errors.js"
import { AgentCommandError } from "./errors.js"

export class AgentStoreService extends Context.Tag("gharargah/AgentStore")<
  AgentStoreService,
  AgentStore
>() {}

export class EventSinkService extends Context.Tag("gharargah/EventSink")<
  EventSinkService,
  OrchEventSink
>() {}

export class OrchestrationService extends Context.Tag("gharargah/Orchestration")<
  OrchestrationService,
  {
    readonly dispatch: (
      command: OrchestrationCommand,
    ) => Effect.Effect<unknown, OrchError>
    readonly listThreads: (
      workspaceRootUri: string,
      workspaceRootPath: string,
    ) => Effect.Effect<ReturnType<OrchestrationEngine["listThreads"]>>
    readonly readThread: (
      workspaceRootPath: string,
      threadId: string,
    ) => Effect.Effect<AgentThread | null>
    readonly listAgents: () => Effect.Effect<AgentCatalogState>
    readonly refreshAgents: (
      providerId?: string,
    ) => Effect.Effect<AgentCatalogState, OrchError>
    readonly listProviders: () => Effect.Effect<ReturnType<OrchestrationEngine["listProviders"]>>
    readonly refreshProviders: (
      providerId?: string,
    ) => Effect.Effect<
      Awaited<ReturnType<OrchestrationEngine["refreshProviders"]>>,
      OrchError
    >
    readonly close: () => Effect.Effect<void>
  }
>() {}

export const AgentStoreLive = Layer.sync(AgentStoreService, () => new AgentStore())

export function makeOrchestrationLive(sink: OrchEventSink): Layer.Layer<
  OrchestrationService,
  never,
  never
> {
  return Layer.sync(OrchestrationService, () => {
    const engine = new OrchestrationEngine(sink)
    return {
      dispatch: command =>
        Effect.tryPromise({
          try: () => engine.dispatch(command),
          catch: err =>
            new AgentCommandError({
              message: err instanceof Error ? err.message : String(err),
              cause: err,
            }),
        }),
      listThreads: (uri, path) => Effect.sync(() => engine.listThreads(uri, path)),
      readThread: (path, id) => Effect.sync(() => engine.readThread(path, id)),
      listAgents: () => Effect.sync(() => engine.listAgents()),
      refreshAgents: providerId =>
        Effect.tryPromise({
          try: () => engine.refreshAgents(providerId),
          catch: err =>
            new AgentCommandError({
              message: err instanceof Error ? err.message : String(err),
              cause: err,
            }),
        }),
      listProviders: () => Effect.sync(() => engine.listProviders()),
      refreshProviders: providerId =>
        Effect.tryPromise({
          try: () => engine.refreshProviders(providerId),
          catch: err =>
            new AgentCommandError({
              message: err instanceof Error ? err.message : String(err),
              cause: err,
            }),
        }),
      close: () =>
        Effect.sync(() => {
          engine.close()
        }),
    }
  })
}

/** Run an Effect and surface OrchError as a thrown Error for the WS boundary. */
export async function runOrch<A>(effect: Effect.Effect<A, OrchError>): Promise<A> {
  return Effect.runPromise(
    effect.pipe(
      Effect.mapError(err => {
        if ("message" in err && typeof err.message === "string") {
          return new Error(err.message)
        }
        if (err._tag === "ThreadNotFoundError") {
          return new Error(`thread not found: ${err.threadId}`)
        }
        if (err._tag === "TurnAlreadyRunningError") {
          return new Error("turn_already_running")
        }
        if (err._tag === "ApprovalBlockedError") {
          return new Error(`cannot ${err.operation} thread while approvals are open`)
        }
        return new Error(String(err))
      }),
    ),
  )
}
