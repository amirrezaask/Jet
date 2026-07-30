import { Context, Effect, Layer } from "effect"
import {
  decodeHostRpcRequest,
  HostDisconnectedError,
  HostRpcRequest,
  InvalidRpcPayloadError,
  OperationFailedError,
  PathOutsideRootsError,
  type HostRpcError,
} from "@gharargah/rpc"
import type { GharargahHostTransport } from "./transport.js"

export class HostClient extends Context.Tag("gharargah/HostClient")<
  HostClient,
  {
    readonly invoke: (
      channel: string,
      ...args: unknown[]
    ) => Effect.Effect<unknown, HostRpcError>
    readonly on: (
      channel: string,
      listener: (...args: unknown[]) => void,
    ) => Effect.Effect<() => void>
  }
>() {}

function mapFetchError(message: string, code?: string): HostRpcError {
  if (code === "PATH_OUTSIDE_ALLOWED_ROOTS" || message.includes("PATH_OUTSIDE")) {
    return new PathOutsideRootsError({ message })
  }
  return new OperationFailedError({ message })
}

/** Effect invoke over fetch + Schema request envelope. */
export function invokeHostRpc(
  clientId: string,
  channel: string,
  args: unknown[],
  options?: { signal?: AbortSignal },
): Effect.Effect<unknown, HostRpcError> {
  return Effect.gen(function* () {
    const body = yield* Effect.mapError(
      decodeHostRpcRequest({ channel, args, clientId }),
      cause =>
        new InvalidRpcPayloadError({
          message: "invalid host RPC request",
          cause,
        }),
    )
    const response = yield* Effect.tryPromise({
      try: () =>
        fetch("/api/v1/rpc", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body satisfies HostRpcRequest),
          signal: options?.signal,
        }),
      catch: err => {
        if (
          options?.signal?.aborted ||
          (err instanceof Error && err.name === "AbortError") ||
          (typeof DOMException !== "undefined" &&
            err instanceof DOMException &&
            err.name === "AbortError")
        ) {
          const reason = options?.signal?.reason
          if (reason instanceof HostDisconnectedError) return reason
          return new HostDisconnectedError({
            message: "host invoke aborted",
            cause: err,
          })
        }
        return new OperationFailedError({
          message: err instanceof Error ? err.message : String(err),
          cause: err,
        })
      },
    })
    const payload = (yield* Effect.tryPromise({
      try: () => response.json() as Promise<{ value?: unknown; error?: { message?: string; code?: string } }>,
      catch: err =>
        new OperationFailedError({
          message: err instanceof Error ? err.message : String(err),
          cause: err,
        }),
    })) as { value?: unknown; error?: { message?: string; code?: string } }
    if (!response.ok) {
      return yield* Effect.fail(
        mapFetchError(payload.error?.message ?? `Jet API request failed (${response.status})`, payload.error?.code),
      )
    }
    return payload.value
  })
}

export function HostClientLive(transport: GharargahHostTransport): Layer.Layer<HostClient> {
  const clientId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `client-${Date.now()}`
  return Layer.succeed(HostClient, {
    invoke: (channel, ...args) =>
      // Prefer Schema path; fall back to transport for non-browser tests.
      typeof fetch === "function"
        ? invokeHostRpc(clientId, channel, args)
        : Effect.tryPromise({
            try: () => transport.invoke(channel, ...args),
            catch: err =>
              new OperationFailedError({
                message: err instanceof Error ? err.message : String(err),
                cause: err,
              }),
          }),
    on: (channel, listener) => Effect.sync(() => transport.on(channel, listener)),
  })
}

/** Promise shim used by createGharargahApi during migration. */
export async function runHostInvoke<T>(
  layer: Layer.Layer<HostClient>,
  channel: string,
  ...args: unknown[]
): Promise<T> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* HostClient
      return (yield* client.invoke(channel, ...args)) as T
    }).pipe(Effect.provide(layer)),
  )
}
