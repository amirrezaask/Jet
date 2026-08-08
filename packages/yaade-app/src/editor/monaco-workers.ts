/** Configure Monaco workers once, lazily, when the editor first mounts. */
let workersPromise: Promise<void> | null = null

export async function ensureMonacoWorkersConfigured(): Promise<void> {
  if (workersPromise) return workersPromise
  workersPromise = (async () => {
    const { configureMonacoWorkers } = await import("@yaade/monaco/environment")
    configureMonacoWorkers({
      editor: () =>
        import("monaco-editor/esm/vs/editor/editor.worker?worker").then(
          module => module.default,
        ),
      json: () =>
        import("monaco-editor/esm/vs/language/json/json.worker?worker").then(
          module => module.default,
        ),
      css: () =>
        import("monaco-editor/esm/vs/language/css/css.worker?worker").then(
          module => module.default,
        ),
      html: () =>
        import("monaco-editor/esm/vs/language/html/html.worker?worker").then(
          module => module.default,
        ),
    })
  })()
  return workersPromise
}
