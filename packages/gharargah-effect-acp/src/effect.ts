/**
 * Effect wrappers around AcpClient process lifecycle + JSON-RPC.
 *
 * Lifetime rules:
 * - {@link startAcpClient} / {@link acquireAcpClient} — Scope-bound; release closes the process.
 * - {@link bootstrapAcpClient} — no Scope; for {@link AcpClientPool} (idle reap owns close).
 * - Never put a pooled client inside a turn Scope with acquireRelease — that kills reuse.
 */
import { Effect, type Scope } from "effect"
import { AcpClient, type AcpClientOptions } from "./client.js"

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err))
}

/** Close an ACP client (best-effort). */
export function closeAcpClient(client: AcpClient): Effect.Effect<void> {
  return Effect.promise(async () => {
    await client.close().catch(() => undefined)
  })
}

/**
 * Create, start, and initialize an ACP client without Scope.
 * Caller owns lifetime (pool / force-stop / idle reap).
 */
export function bootstrapAcpClient(
  opts: AcpClientOptions,
): Effect.Effect<AcpClient, Error> {
  return Effect.gen(function* () {
    const client = yield* Effect.sync(() => new AcpClient(opts))
    yield* Effect.tryPromise({
      try: () => client.start(),
      catch: toError,
    })
    yield* Effect.tryPromise({
      try: () => client.initialize(),
      catch: toError,
    })
    return client
  })
}

/**
 * Scope-bound ACP client: bootstrap on acquire, close on release.
 * For ephemeral probes / one-shot scripts — not for the long-lived pool.
 */
export function startAcpClient(
  opts: AcpClientOptions,
): Effect.Effect<AcpClient, Error, Scope.Scope> {
  return Effect.acquireRelease(bootstrapAcpClient(opts), client => closeAcpClient(client))
}

/** @deprecated Prefer {@link startAcpClient} (includes start + initialize). */
export function acquireAcpClient(
  opts: AcpClientOptions,
): Effect.Effect<AcpClient, Error, Scope.Scope> {
  return startAcpClient(opts)
}

/** Effect wrapper around {@link AcpClient.request}. */
export function acpRequest(
  client: AcpClient,
  method: string,
  params?: unknown,
): Effect.Effect<unknown, Error> {
  return Effect.tryPromise({
    try: () => client.request(method, params),
    catch: toError,
  })
}

/** Promise boundary for imperative pool/adapter call sites. */
export function runAcpRequest(
  client: AcpClient,
  method: string,
  params?: unknown,
): Promise<unknown> {
  return Effect.runPromise(acpRequest(client, method, params))
}

/** Promise boundary for pool bootstrap. */
export function runBootstrapAcpClient(opts: AcpClientOptions): Promise<AcpClient> {
  return Effect.runPromise(bootstrapAcpClient(opts))
}
