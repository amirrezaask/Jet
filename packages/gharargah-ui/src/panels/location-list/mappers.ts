import type { JetProblem } from "@gharargah/shared"
import type { ListItem } from "@gharargah/workspace"
import { pathToFileUri } from "@gharargah/shared"

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
  folderName?: string,
): ListItem {
  const preview = hit.preview.trim() || hit.path
  const pathLabel = folderName ? `${folderName}/${hit.path.replace(/^\/+/, "")}` : hit.path
  return {
    id: `search-${index}-${folderName ?? ""}-${hit.path}-${hit.line}`,
    fileUri: pathToFileUri(`${workspacePath}/${hit.path.replace(/^\/+/, "")}`),
    path: pathLabel,
    line: hit.line,
    column: hit.column,
    label: folderName ? `[${folderName}] ${preview}` : preview,
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
    id: `ref-${index}-${loc.uri}-${loc.range.start.line}-${loc.range.start.character}`,
    fileUri: loc.uri,
    path,
    line: loc.range.start.line + 1,
    column: loc.range.start.character + 1,
    label,
  }
}

export function lspLocationsToListItems(
  locs: { uri: string; range: { start: { line: number; character: number } } }[],
  symbol: string,
): ListItem[] {
  return locs.map((loc, index) => {
    const path = loc.uri.replace(/^file:\/\//, "")
    const base = path.split("/").pop() ?? path
    return lspLocationToListItem(
      loc,
      index,
      `${symbol} — ${base}:${loc.range.start.line + 1}`,
      path,
    )
  })
}
