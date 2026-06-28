import type { EditorView } from "@codemirror/view"
import { forEachDiagnostic, type Diagnostic } from "@codemirror/lint"
import type { JetProblem } from "@jet/shared"
import { fileUriToPath } from "@jet/shared"

export function collectProblemsFromViews(
  views: { uri: string; view: EditorView }[],
): JetProblem[] {
  const problems: JetProblem[] = []
  for (const { uri, view } of views) {
    const path = fileUriToPath(uri)
    forEachDiagnostic(view.state, (diag, from, to) => {
      const line = view.state.doc.lineAt(from)
      problems.push({
        uri,
        path,
        line: line.number,
        column: from - line.from + 1,
        severity: severityFromLint(diag.severity),
        message: diag.message,
        source: diag.source,
      })
    })
  }
  return problems.sort(
    (a, b) => a.path.localeCompare(b.path) || a.line - b.line || a.column - b.column,
  )
}

function severityFromLint(severity: Diagnostic["severity"]): JetProblem["severity"] {
  if (severity === "error") return "error"
  if (severity === "warning") return "warning"
  return "info"
}
