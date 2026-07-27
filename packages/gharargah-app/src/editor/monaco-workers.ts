/** Configure Monaco workers once, lazily, when the editor first mounts. */
let workersPromise: Promise<void> | null = null

export async function ensureMonacoWorkersConfigured(): Promise<void> {
  if (workersPromise) return workersPromise
  workersPromise = (async () => {
    const [{ configureMonacoWorkers }, EditorWorker, JsonWorker, CssWorker, HtmlWorker, TsWorker] =
      await Promise.all([
        import("@gharargah/monaco"),
        import("monaco-editor/esm/vs/editor/editor.worker?worker"),
        import("monaco-editor/esm/vs/language/json/json.worker?worker"),
        import("monaco-editor/esm/vs/language/css/css.worker?worker"),
        import("monaco-editor/esm/vs/language/html/html.worker?worker"),
        import("monaco-editor/esm/vs/language/typescript/ts.worker?worker"),
      ])
    configureMonacoWorkers({
      editor: EditorWorker.default,
      json: JsonWorker.default,
      css: CssWorker.default,
      html: HtmlWorker.default,
      ts: TsWorker.default,
    })
  })()
  return workersPromise
}
