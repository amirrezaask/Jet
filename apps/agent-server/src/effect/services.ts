import { Cause, Context, Effect, Exit, Layer, Option } from "effect"
import type { OrchestrationCommand } from "@gharargah/agents"
import type { AgentCatalogState, AgentThread } from "@gharargah/agents"
import { AgentStore } from "../persistence/store.js"
import { OrchestrationEngine, type OrchEventSink } from "../orchestration/engine.js"
import type { OrchError } from "./errors.js"
import {
  AgentCommandError,
  ApprovalBlockedError,
  ThreadNotFoundError,
  TurnAlreadyRunningError,
} from "./errors.js"
import { UnknownDriverError } from "../provider/registry.js"

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

export function EventSinkLive(sink: OrchEventSink): Layer.Layer<EventSinkService> {
  return Layer.succeed(EventSinkService, sink)
}

function mapUnknownToOrchError(err: unknown): OrchError {
  if (err instanceof UnknownDriverError) {
    return err
  }
  if (err && typeof err === "object" && "_tag" in err) {
    const tag = String((err as { _tag: string })._tag)
    if (tag === "UnknownDriverError") {
      return err as UnknownDriverError
    }
  }
  if (
    err instanceof AgentCommandError ||
    err instanceof ThreadNotFoundError ||
    err instanceof TurnAlreadyRunningError ||
    err instanceof ApprovalBlockedError ||
    err instanceof UnknownDriverError
  ) {
    return err
  }
  if (err && typeof err === "object" && "_tag" in err) {
    const tag = String((err as { _tag: string })._tag)
    if (
      tag === "AgentCommandError" ||
      tag === "ThreadNotFoundError" ||
      tag === "TurnAlreadyRunningError" ||
      tag === "ApprovalBlockedError" ||
      tag === "UnknownDriverError"
    ) {
      return err as OrchError
    }
  }
  return new AgentCommandError({
    message: err instanceof Error ? err.message : String(err),
    cause: err,
  })
}

export const OrchestrationLive = Layer.effect(
  OrchestrationService,
  Effect.gen(function* () {
    const store = yield* AgentStoreService
    const sink = yield* EventSinkService
    const engine = new OrchestrationEngine(sink, store)
    return {
      dispatch: (command: OrchestrationCommand) =>
        Effect.tryPromise({
          try: () => engine.dispatch(command),
          catch: mapUnknownToOrchError,
        }),
      listThreads: (uri: string, path: string) =>
        Effect.sync(() => engine.listThreads(uri, path)),
      readThread: (path: string, id: string) => Effect.sync(() => engine.readThread(path, id)),
      listAgents: () => Effect.sync(() => engine.listAgents()),
      refreshAgents: (providerId?: string) =>
        Effect.tryPromise({
          try: () => engine.refreshAgents(providerId),
          catch: mapUnknownToOrchError,
        }),
      listProviders: () => Effect.sync(() => engine.listProviders()),
      refreshProviders: (providerId?: string) =>
        Effect.tryPromise({
          try: () => engine.refreshProviders(providerId),
          catch: mapUnknownToOrchError,
        }),
      close: () =>
        Effect.sync(() => {
          engine.close()
        }),
    }
  }),
)

/** Composed app layer: store + sink + orchestration. */
export function makeOrchestrationLive(sink: OrchEventSink): Layer.Layer<OrchestrationService> {
  return OrchestrationLive.pipe(
    Layer.provide(AgentStoreLive),
    Layer.provide(EventSinkLive(sink)),
  )
}

/**
 * Run an Effect and surface OrchError to the WS boundary (mapped in rpc/server).
 *
 * `Effect.runPromise` rejects with a `FiberFailure` that hides the typed error
 * inside its cause, which would leave the boundary mapping tags by message
 * regex. Unwrapping here keeps `_tag` intact all the way to the client.
 */
export async function runOrch<A>(effect: Effect.Effect<A, OrchError>): Promise<A> {
  const exit = await Effect.runPromiseExit(effect)
  if (Exit.isSuccess(exit)) return exit.value
  const failure = Cause.failureOption(exit.cause)
  if (Option.isSome(failure)) throw failure.value
  throw Cause.squash(exit.cause)
}
