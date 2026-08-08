/** Keep LSP output useful without retaining whole documents or workspace edits. */
export function structuredOutputData(method: string, data: unknown): unknown {
  if (!data || typeof data !== "object") return data
  if (method === "textDocument/didSave") {
    const text = Reflect.get(data, "text")
    return {
      textDocument: Reflect.get(data, "textDocument"),
      includeText: typeof text === "string",
      ...(typeof text === "string" ? { textLength: text.length } : {}),
    }
  }
  if (method === "textDocument/publishDiagnostics") {
    const diagnostics = Reflect.get(data, "diagnostics")
    return {
      uri: Reflect.get(data, "uri"),
      version: Reflect.get(data, "version"),
      diagnosticCount: Array.isArray(diagnostics) ? diagnostics.length : 0,
    }
  }
  if (method === "workspace/applyEdit") {
    const edit = Reflect.get(data, "edit")
    const changes = edit && typeof edit === "object" ? Reflect.get(edit, "changes") : undefined
    const documentChanges = edit && typeof edit === "object"
      ? Reflect.get(edit, "documentChanges")
      : undefined
    return {
      changedDocumentCount: changes && typeof changes === "object"
        ? Object.keys(changes).length
        : 0,
      documentChangeCount: Array.isArray(documentChanges) ? documentChanges.length : 0,
    }
  }
  return data
}
