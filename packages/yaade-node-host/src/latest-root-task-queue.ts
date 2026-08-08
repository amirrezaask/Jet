export class SearchAbortedError extends Error {
  constructor(message = "search aborted") {
    super(message)
    this.name = "AbortError"
  }
}

type RootTask = {
  controller: AbortController
  externalSignal?: AbortSignal
  externalAbort?: () => void
  execute: (signal: AbortSignal) => Promise<void>
  reject: (error: unknown) => void
  settled: boolean
}

type RootTaskState = {
  active: RootTask | null
  queued: RootTask | null
}

/**
 * One running task and one latest queued task per root. Enqueuing supersedes
 * both the active task (via AbortSignal) and any older queued task.
 */
export class LatestRootTaskQueue {
  private readonly roots = new Map<string, RootTaskState>()

  isBusy(root: string): boolean {
    return Boolean(this.roots.get(root)?.active)
  }

  run<T>(
    root: string,
    task: (signal: AbortSignal) => Promise<T>,
    externalSignal?: AbortSignal,
  ): Promise<T> {
    if (externalSignal?.aborted) {
      return Promise.reject(new SearchAbortedError())
    }

    return new Promise<T>((resolve, reject) => {
      const entry: RootTask = {
        controller: new AbortController(),
        externalSignal,
        execute: async signal => {
          try {
            const value = await task(signal)
            if (entry.settled) return
            entry.settled = true
            this.removeExternalAbort(entry)
            resolve(value)
          } catch (error) {
            this.rejectTask(entry, error)
          }
        },
        reject,
        settled: false,
      }
      if (externalSignal) {
        entry.externalAbort = () => this.cancel(root, entry)
        externalSignal.addEventListener("abort", entry.externalAbort, { once: true })
      }

      let state = this.roots.get(root)
      if (!state) {
        state = { active: null, queued: null }
        this.roots.set(root, state)
      }
      if (!state.active) {
        this.start(root, state, entry)
        return
      }

      if (state.queued) {
        this.rejectTask(state.queued, new SearchAbortedError("search superseded"))
      }
      state.queued = entry
      state.active.controller.abort(new SearchAbortedError("search superseded"))
    })
  }

  abortRoot(root: string): void {
    const state = this.roots.get(root)
    if (!state) return
    if (state.queued) {
      this.rejectTask(state.queued, new SearchAbortedError())
      state.queued = null
    }
    state.active?.controller.abort(new SearchAbortedError())
  }

  private start(root: string, state: RootTaskState, task: RootTask): void {
    state.active = task
    void task.execute(task.controller.signal).finally(() => {
      if (state.active !== task) return
      state.active = null
      const next = state.queued
      state.queued = null
      if (next) {
        this.start(root, state, next)
      } else if (this.roots.get(root) === state) {
        this.roots.delete(root)
      }
    })
  }

  private cancel(root: string, task: RootTask): void {
    const state = this.roots.get(root)
    if (!state) return
    if (state.queued === task) {
      state.queued = null
      this.rejectTask(task, new SearchAbortedError())
      return
    }
    if (state.active === task) {
      task.controller.abort(new SearchAbortedError())
    }
  }

  private rejectTask(task: RootTask, error: unknown): void {
    if (task.settled) return
    task.settled = true
    this.removeExternalAbort(task)
    task.reject(error)
  }

  private removeExternalAbort(task: RootTask): void {
    if (task.externalSignal && task.externalAbort) {
      task.externalSignal.removeEventListener("abort", task.externalAbort)
    }
  }
}
