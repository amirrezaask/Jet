import type { JetProblem } from "@jet/shared"
import type { ListItem } from "@jet/workspace"
import { pathToFileUri } from "@jet/shared"

export function problemsToListItems(problems: JetProblem[]): ListItem[] {
  return problems.map((p, i) => ({
    id: `problem-${i}-${p.uri}-${p.line}`,
    fileUri: p.uri,
    path: p.uri.replace(/^file:\/\//, ""),
    line: p.line,
    column: p.column,
    label: p.message,
    detail: p.severity,
  }))
}

export function searchHitToListItem(
  hit: { path: string; line: number; column: number; preview: string },
  index: number,
  workspacePath: string,
): ListItem {
  return {
    id: `search-${index}-${hit.path}-${hit.line}`,
    fileUri: pathToFileUri(`${workspacePath}/${hit.path.replace(/^\/+/, "")}`),
    path: hit.path,
    line: hit.line,
    column: hit.column,
    label: hit.preview.trim() || hit.path,
  }
}

export function taskErrorsToListItems(errors: ListItem[]): ListItem[] {
  return errors.map((e, i) => ({
    ...e,
    id: e.id || `task-err-${i}-${e.path}-${e.line}`,
  }))
}

export function lspLocationToListItem(
  loc: { uri: string; range: { start: { line: number; character: number } } },
  index: number,
  label: string,
  path: string,
): ListItem {
  return {
    id: `ref-${index}-${loc.uri}-${loc.range.start.line}`,
    fileUri: loc.uri,
    path,
    line: loc.range.start.line + 1,
    column: loc.range.start.character + 1,
    label,
  }
}
