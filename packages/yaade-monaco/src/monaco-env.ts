let configured = false

type WorkerFactory = new () => Worker

export type MonacoWorkerFactories = {
  editor: WorkerFactory
  json: WorkerFactory
  css: WorkerFactory
  html: WorkerFactory
  ts: WorkerFactory
}

/**
 * Call once from the Vite app entry with `?worker` imports.
 * Package code stays TypeScript-clean without Vite-specific imports.
 */
export function configureMonacoWorkers(factories: MonacoWorkerFactories): void {
  if (configured) return
  configured = true
  const globalSelf = self as typeof self & {
    MonacoEnvironment?: {
      getWorker: (_moduleId: string, label: string) => Worker
    }
  }
  globalSelf.MonacoEnvironment = {
    getWorker(_moduleId, label) {
      switch (label) {
        case "json":
          return new factories.json()
        case "css":
        case "scss":
        case "less":
          return new factories.css()
        case "html":
        case "handlebars":
        case "razor":
          return new factories.html()
        case "typescript":
        case "javascript":
          return new factories.ts()
        default:
          return new factories.editor()
      }
    },
  }
}

/** No-op: workers must be installed via `configureMonacoWorkers` from the app entry. */
export function ensureMonacoEnvironment(): void {
  // Intentionally empty — do not flip `configured` without a real MonacoEnvironment.
}
