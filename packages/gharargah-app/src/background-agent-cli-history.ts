import type {
  AgentCliHistoryProvider,
  AgentCliHistoryResult,
} from "@gharargah/shared"

const DEFAULT_CONCURRENCY = 2
const DEFAULT_LIMIT = 50

/** Providers that spawn a CLI to list sessions (others resolve instantly). */
export const AGENT_CLI_HISTORY_PREFETCH_PROVIDERS = [
  "codex",
  "opencode",
  "grok",
] as const satisfies readonly AgentCliHistoryProvider[]

export type AgentCliHistoryListFn = (
  req: {
    provider: AgentCliHistoryProvider
    cwd: string
    limit?: number
  },
  signal?: AbortSignal,
) => Promise<AgentCliHistoryResult>

export type AgentCliHistoryPrefetchTarget = {
  readonly provider: AgentCliHistoryProvider
  readonly cwd: string
}

export type AgentCliHistoryPrefetchSummary = {
  readonly eligible: number
  readonly loaded: number
  readonly failed: number
  readonly skipped: number
  readonly maxInFlight: number
  readonly durationMs: number
}

export type AgentCliHistoryPrefetchRun = {
  readonly done: Promise<AgentCliHistoryPrefetchSummary>
  readonly cancel: () => void
}

export type EnsureAgentCliHistoryOptions = {
  readonly listCliSessions: AgentCliHistoryListFn
  readonly provider: AgentCliHistoryProvider
  readonly cwd: string
  readonly limit?: number
  readonly signal?: AbortSignal
}

export type StartAgentCliHistoryPrefetchOptions = {
  readonly listCliSessions: AgentCliHistoryListFn
  readonly targets: readonly AgentCliHistoryPrefetchTarget[]
  readonly concurrency?: number
  readonly limit?: number
  readonly now?: () => number
}

type CacheEntry = {
  readonly result: AgentCliHistoryResult
}

type PrefetchJob = {
  readonly target: AgentCliHistoryPrefetchTarget
  state: "queued" | "running" | "settled"
}

const cache = new Map<string, CacheEntry>()
const inflight = new Map<string, Promise<AgentCliHistoryResult>>()
let currentRun: AgentCliHistoryPrefetchRun | null = null

export function agentCliHistoryCacheKey(
  provider: AgentCliHistoryProvider,
  cwd: string,
): string {
  return `${provider}\u0000${cwd}`
}

export function peekAgentCliHistory(
  provider: AgentCliHistoryProvider,
  cwd: string,
): AgentCliHistoryResult | undefined {
  return cache.get(agentCliHistoryCacheKey(provider, cwd))?.result
}

/** Test helper — clears shared cache + in-flight map. */
export function clearAgentCliHistoryCache(): void {
  cache.clear()
  inflight.clear()
}

function putCache(
  provider: AgentCliHistoryProvider,
  cwd: string,
  result: AgentCliHistoryResult,
): void {
  cache.set(agentCliHistoryCacheKey(provider, cwd), { result })
}

/**
 * Return cached CLI history or fetch once (deduped). Populates the shared
 * cache used by startup prefetch and the new-session picker.
 */
export function ensureAgentCliHistory(
  options: EnsureAgentCliHistoryOptions,
): Promise<AgentCliHistoryResult> {
  const cwd = options.cwd
  const provider = options.provider
  const key = agentCliHistoryCacheKey(provider, cwd)
  const cached = cache.get(key)
  if (cached) return Promise.resolve(cached.result)

  const existing = inflight.get(key)
  if (existing) {
    const signal = options.signal
    if (!signal) return existing
    return new Promise<AgentCliHistoryResult>((resolve, reject) => {
      const onAbort = () => {
        signal.removeEventListener("abort", onAbort)
        reject(signal.reason ?? new DOMException("Aborted", "AbortError"))
      }
      if (signal.aborted) {
        onAbort()
        return
      }
      signal.addEventListener("abort", onAbort, { once: true })
      existing.then(
        result => {
          signal.removeEventListener("abort", onAbort)
          resolve(result)
        },
        error => {
          signal.removeEventListener("abort", onAbort)
          reject(error)
        },
      )
    })
  }

  const pending = options
    .listCliSessions(
      {
        provider,
        cwd,
        limit: options.limit ?? DEFAULT_LIMIT,
      },
      options.signal,
    )
    .then(result => {
      putCache(provider, cwd, result)
      return result
    })
    .finally(() => {
      if (inflight.get(key) === pending) inflight.delete(key)
    })

  inflight.set(key, pending)
  return pending
}

/**
 * Background worker: warm CLI session history for known projects × providers
 * so the new-session picker does not wait on each highlight.
 */
export function startAgentCliHistoryPrefetch(
  options: StartAgentCliHistoryPrefetchOptions,
): AgentCliHistoryPrefetchRun {
  currentRun?.cancel()

  const concurrency = Math.max(
    1,
    Math.min(8, Math.trunc(options.concurrency ?? DEFAULT_CONCURRENCY)),
  )
  const limit = Math.max(
    1,
    Math.min(50, Math.trunc(options.limit ?? DEFAULT_LIMIT)),
  )
  const now = options.now ?? (() => performance.now())
  const startedAt = now()

  const seen = new Set<string>()
  const jobs: PrefetchJob[] = []
  for (const target of options.targets) {
    const key = agentCliHistoryCacheKey(target.provider, target.cwd)
    if (seen.has(key) || cache.has(key) || inflight.has(key)) continue
    seen.add(key)
    jobs.push({ target, state: "queued" })
  }

  let cancelled = false
  let inFlight = 0
  let maxInFlight = 0
  let loaded = 0
  let failed = 0
  let skipped = 0
  let settled = 0
  let resolveDone: (summary: AgentCliHistoryPrefetchSummary) => void = () => {}
  const done = new Promise<AgentCliHistoryPrefetchSummary>(resolve => {
    resolveDone = resolve
  })

  const finishIfDone = () => {
    if (settled !== jobs.length) return
    const summary: AgentCliHistoryPrefetchSummary = {
      eligible: jobs.length,
      loaded,
      failed,
      skipped,
      maxInFlight,
      durationMs: Math.max(0, now() - startedAt),
    }
    if (currentRun === run) currentRun = null
    resolveDone(summary)
  }

  const settle = (job: PrefetchJob) => {
    if (job.state === "settled") return
    job.state = "settled"
    settled += 1
  }

  const pump = () => {
    if (cancelled) {
      for (const job of jobs) {
        if (job.state !== "queued") continue
        skipped += 1
        settle(job)
      }
      finishIfDone()
      return
    }
    for (const job of jobs) {
      if (inFlight >= concurrency) break
      if (job.state !== "queued") continue
      job.state = "running"
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      void ensureAgentCliHistory({
        listCliSessions: options.listCliSessions,
        provider: job.target.provider,
        cwd: job.target.cwd,
        limit,
      })
        .then(() => {
          loaded += 1
        })
        .catch(() => {
          failed += 1
        })
        .finally(() => {
          inFlight -= 1
          settle(job)
          pump()
          finishIfDone()
        })
    }
    finishIfDone()
  }

  const run: AgentCliHistoryPrefetchRun = {
    done,
    cancel: () => {
      cancelled = true
      if (currentRun === run) currentRun = null
      pump()
    },
  }
  currentRun = run
  queueMicrotask(pump)
  return run
}

export function buildAgentCliHistoryPrefetchTargets(
  cwdPaths: readonly string[],
  providers: readonly AgentCliHistoryProvider[] = AGENT_CLI_HISTORY_PREFETCH_PROVIDERS,
): AgentCliHistoryPrefetchTarget[] {
  const targets: AgentCliHistoryPrefetchTarget[] = []
  for (const cwd of cwdPaths) {
    const trimmed = cwd.trim()
    if (!trimmed) continue
    for (const provider of providers) {
      targets.push({ provider, cwd: trimmed })
    }
  }
  return targets
}
