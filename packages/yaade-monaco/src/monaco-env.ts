let configured = false

type WorkerFactory = new () => Worker
type WorkerFactoryLoader = () => Promise<WorkerFactory>

export type MonacoWorkerFactories = {
  editor: WorkerFactoryLoader
  json: WorkerFactoryLoader
  css: WorkerFactoryLoader
  html: WorkerFactoryLoader
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
      getWorker: (_moduleId: string, label: string) => Promise<Worker>
    }
  }
  globalSelf.MonacoEnvironment = {
    async getWorker(_moduleId, label) {
      let loadFactory: WorkerFactoryLoader
      switch (label) {
        case "json":
          loadFactory = factories.json
          break
        case "css":
        case "scss":
        case "less":
          loadFactory = factories.css
          break
        case "html":
        case "handlebars":
        case "razor":
          loadFactory = factories.html
          break
        default:
          // TypeScript/JavaScript semantics are provided by external LSPs. The
          // generic worker is sufficient for Monaco's editor services.
          loadFactory = factories.editor
      }
      const Factory = await loadFactory()
      return new Factory()
    },
  }
}

/** No-op: workers must be installed via `configureMonacoWorkers` from the app entry. */
export function ensureMonacoEnvironment(): void {
  // Intentionally empty — do not flip `configured` without a real MonacoEnvironment.
}
