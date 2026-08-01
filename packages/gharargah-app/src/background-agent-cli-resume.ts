import type { JetElectronTerminal } from "@gharargah/workspace"
import {
  deriveTrustedAgentCliLaunch,
  persistedAgentCliLaunchMatchesTrusted,
} from "./agent-cli-launch.js"
import type { TerminalSessionState } from "./tabs/terminal-session.js"

const DEFAULT_CONCURRENCY = 2
const DEFAULT_ATTEMPTS = 2
const DEFAULT_RETRY_DELAY_MS = 150

type WarmResumeTerminal = Pick<JetElectronTerminal, "create" | "dispose">

type WarmResumeJob = {
  readonly tabId: string
  state: "queued" | "running" | "settled"
}

export type ActiveAgentWarmResumeSummary = {
  readonly eligible: number
  readonly resumed: number
  readonly failed: number
  readonly skipped: number
  readonly maxInFlight: number
  readonly durationMs: number
}

export type ActiveAgentWarmResumeRun = {
  readonly done: Promise<ActiveAgentWarmResumeSummary>
  /** Promote a clicked session ahead of background-only work. */
  readonly prioritize: (tabId: string) => void
  /**
   * Hand a session to the foreground TerminalPanel. Queued jobs are skipped;
   * an in-flight create is disposed when it returns so the panel can spawn.
   */
  readonly releaseToForeground: (tabId: string) => void
  /** Stop queued work. A create already crossing IPC is disposed if it returns. */
  readonly cancel: () => void
  readonly isPending: (tabId: string) => boolean
}

export type ActiveAgentWarmResumeOptions = {
  readonly terminal: WarmResumeTerminal
  readonly sessions: readonly TerminalSessionState[]
  readonly getSession: (tabId: string) => TerminalSessionState | undefined
  readonly onPtyCreated: (tabId: string, ptyId: string) => void
  /** Used to wake a mounted terminal when a failed/cancelled warmup releases it. */
  readonly onJobSettled?: (tabId: string) => void
  readonly concurrency?: number
  readonly attempts?: number
  readonly retryDelayMs?: number
  readonly sleep?: (delayMs: number) => Promise<void>
  readonly now?: () => number
  readonly origin?: string
}

let currentRun: ActiveAgentWarmResumeRun | null = null

function defaultSleep(delayMs: number): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, delayMs))
}

/**
 * Active means "not archived". A persisted provider id and provider-correct
 * resume argv are required; fresh CLI sessions are already owned by their
 * foreground TerminalPanel and must not be duplicated.
 */
export function isActiveAgentWarmResumeCandidate(
  session: TerminalSessionState,
  origin?: string,
): boolean {
  if (session.archivedAt || session.parentSessionTabId || session.ptyId) return false
  if (!session.agentCliSessionId?.trim()) return false
  const trusted = deriveTrustedAgentCliLaunch({
    tabId: session.tabId,
    cwdRootUri: session.cwdRootUri,
    agentId: session.agentId,
    agentCliSessionId: session.agentCliSessionId,
    origin,
  })
  return Boolean(
    trusted &&
      trusted.cliSessionId &&
      persistedAgentCliLaunchMatchesTrusted(session, trusted),
  )
}

export function startActiveAgentCliWarmResume(
  options: ActiveAgentWarmResumeOptions,
): ActiveAgentWarmResumeRun {
  currentRun?.cancel()

  const concurrency = Math.max(
    1,
    Math.min(8, Math.trunc(options.concurrency ?? DEFAULT_CONCURRENCY)),
  )
  const attempts = Math.max(
    1,
    Math.min(4, Math.trunc(options.attempts ?? DEFAULT_ATTEMPTS)),
  )
  const retryDelayMs = Math.max(
    0,
    Math.min(5_000, Math.trunc(options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS)),
  )
  const sleep = options.sleep ?? defaultSleep
  const now = options.now ?? (() => performance.now())
  const startedAt = now()
  const queue: WarmResumeJob[] = options.sessions
    .filter(session => isActiveAgentWarmResumeCandidate(session, options.origin))
    .map(session => ({ tabId: session.tabId, state: "queued" }))
  const jobsByTab = new Map(queue.map(job => [job.tabId, job]))

  let cancelled = false
  let inFlight = 0
  let maxInFlight = 0
  let resumed = 0
  let failed = 0
  let skipped = 0
  let settled = 0
  const releasedToForeground = new Set<string>()
  let resolveDone: (summary: ActiveAgentWarmResumeSummary) => void = () => {}
  const done = new Promise<ActiveAgentWarmResumeSummary>(resolve => {
    resolveDone = resolve
  })

  const finishIfDone = () => {
    if (settled !== jobsByTab.size) return
    const summary: ActiveAgentWarmResumeSummary = {
      eligible: jobsByTab.size,
      resumed,
      failed,
      skipped,
      maxInFlight,
      durationMs: Math.max(0, now() - startedAt),
    }
    if (currentRun === run) currentRun = null
    resolveDone(summary)
  }

  const settle = (job: WarmResumeJob) => {
    if (job.state === "settled") return
    job.state = "settled"
    settled += 1
    options.onJobSettled?.(job.tabId)
  }

  const runJob = async (job: WarmResumeJob): Promise<void> => {
    let lastAttemptFailed = false
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const session = options.getSession(job.tabId)
      if (
        cancelled ||
        releasedToForeground.has(job.tabId) ||
        !session ||
        !isActiveAgentWarmResumeCandidate(session, options.origin)
      ) {
        skipped += 1
        settle(job)
        return
      }

      const trusted = deriveTrustedAgentCliLaunch({
        tabId: session.tabId,
        cwdRootUri: session.cwdRootUri,
        agentId: session.agentId,
        agentCliSessionId: session.agentCliSessionId,
        origin: options.origin,
      })
      if (!trusted) {
        skipped += 1
        settle(job)
        return
      }

      try {
        const created = await options.terminal.create(session.cwdRootUri, {
          command: trusted.command,
          args: trusted.args,
          env: trusted.env,
          // Background sessions have no measured viewport yet. TerminalPanel
          // performs the authoritative resize when the user opens one.
          cols: 80,
          rows: 24,
        })
        const latest = options.getSession(job.tabId)
        if (
          cancelled ||
          releasedToForeground.has(job.tabId) ||
          !latest ||
          latest.archivedAt ||
          (latest.ptyId && latest.ptyId !== created.id)
        ) {
          await options.terminal.dispose(created.id).catch(() => undefined)
          skipped += 1
          settle(job)
          return
        }
        options.onPtyCreated(job.tabId, created.id)
        resumed += 1
        settle(job)
        return
      } catch {
        lastAttemptFailed = true
        if (
          attempt + 1 < attempts &&
          !cancelled &&
          !releasedToForeground.has(job.tabId)
        ) {
          await sleep(retryDelayMs * (attempt + 1))
        }
      }
    }

    if (lastAttemptFailed) failed += 1
    else skipped += 1
    settle(job)
  }

  const pump = () => {
    if (cancelled) {
      for (const job of queue.splice(0)) {
        skipped += 1
        settle(job)
      }
      finishIfDone()
      return
    }

    while (inFlight < concurrency) {
      const job = queue.shift()
      if (!job) break
      if (job.state !== "queued") continue
      if (releasedToForeground.has(job.tabId)) {
        skipped += 1
        settle(job)
        continue
      }
      job.state = "running"
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      void runJob(job).finally(() => {
        inFlight -= 1
        pump()
        finishIfDone()
      })
    }
    finishIfDone()
  }

  const run: ActiveAgentWarmResumeRun = {
    done,
    prioritize(tabId) {
      const job = jobsByTab.get(tabId)
      if (!job || job.state !== "queued") return
      if (releasedToForeground.has(tabId)) return
      const index = queue.indexOf(job)
      if (index <= 0) return
      queue.splice(index, 1)
      queue.unshift(job)
      pump()
    },
    releaseToForeground(tabId) {
      const job = jobsByTab.get(tabId)
      if (!job || job.state === "settled") return
      releasedToForeground.add(tabId)
      if (job.state === "queued") {
        const index = queue.indexOf(job)
        if (index >= 0) queue.splice(index, 1)
        skipped += 1
        settle(job)
        return
      }
      // In-flight create: wake the panel now; dispose when create returns.
      options.onJobSettled?.(tabId)
    },
    cancel() {
      if (cancelled) return
      cancelled = true
      pump()
    },
    isPending(tabId) {
      if (releasedToForeground.has(tabId)) return false
      const state = jobsByTab.get(tabId)?.state
      return state === "queued" || state === "running"
    },
  }

  currentRun = run
  // Leave the bootstrap call stack before crossing IPC. This keeps roster
  // hydration/first paint responsive while still beginning in the same tick.
  queueMicrotask(pump)
  return run
}

export function prioritizeActiveAgentWarmResume(tabId: string): void {
  currentRun?.prioritize(tabId)
}

/** Let the open TerminalPanel own spawn; drop this tab from warm-resume deferral. */
export function releaseActiveAgentWarmResumeToForeground(tabId: string): void {
  currentRun?.releaseToForeground(tabId)
}

export function isActiveAgentWarmResumePending(tabId: string): boolean {
  return currentRun?.isPending(tabId) ?? false
}
