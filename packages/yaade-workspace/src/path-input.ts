export type PathCompletionContext = {
  parentPath: string
  partial: string
  segmentStart: number
  segmentEnd: number
}

export function joinPath(base: string, segment: string): string {
  const sep = base.includes("\\") ? "\\" : "/"
  return `${base.replace(/[/\\]+$/, "")}${sep}${segment.replace(/^[/\\]+/, "")}`
}

export function expandHomePath(input: string, homeDir: string): string {
  if (input === "~") return homeDir
  if (input.startsWith("~/")) return joinPath(homeDir, input.slice(2))
  return input
}

function lastSepBefore(input: string, end: number): number {
  let idx = -1
  for (let i = Math.min(end, input.length) - 1; i >= 0; i--) {
    if (input[i] === "/" || input[i] === "\\") {
      idx = i
      break
    }
  }
  return idx
}

function resolveParentPath(parentPart: string, input: string, homeDir: string): string {
  if (parentPart === "" && input.startsWith("/")) return "/"
  if (parentPart === "" && (input.startsWith("~") || input === "")) return homeDir
  return expandHomePath(parentPart, homeDir)
}

export function parsePathCompletionContext(
  input: string,
  cursor: number,
  homeDir: string,
): PathCompletionContext {
  const segmentEnd = Math.max(0, Math.min(cursor, input.length))
  const sepIdx = lastSepBefore(input, segmentEnd)
  const segmentStart = sepIdx >= 0 ? sepIdx + 1 : 0
  const parentPart = sepIdx >= 0 ? input.slice(0, sepIdx) : ""
  const partial = input.slice(segmentStart, segmentEnd)
  const parentPath = resolveParentPath(parentPart, input, homeDir)

  return { parentPath, partial, segmentStart, segmentEnd }
}

export function applyPathCompletion(
  input: string,
  ctx: PathCompletionContext,
  dirName: string,
): { value: string; cursor: number } {
  const sep = input.includes("\\") ? "\\" : "/"
  const completed = `${dirName}${sep}`
  const value = input.slice(0, ctx.segmentStart) + completed + input.slice(ctx.segmentEnd)
  const cursor = ctx.segmentStart + completed.length
  return { value, cursor }
}

export function deletePathSegmentBackward(
  input: string,
  selectionStart: number,
  selectionEnd: number,
): { value: string; cursor: number } | null {
  if (selectionStart !== selectionEnd) return null

  let end = selectionStart
  if (end <= 0) return null

  let i = end - 1
  while (i >= 0 && (input[i] === "/" || input[i] === "\\")) i--
  while (i >= 0 && input[i] !== "/" && input[i] !== "\\") i--

  const deleteStart = i + 1
  if (deleteStart >= end) return null
  if (deleteStart === 0 && end >= input.length && input[0] === "/") return null

  const value = input.slice(0, deleteStart) + input.slice(end)
  return { value, cursor: deleteStart }
}

export function resolvePathForOpen(input: string, homeDir: string): string {
  const trimmed = input.trim()
  const withoutTrailingSep = trimmed.replace(/[/\\]+$/, "") || trimmed
  return expandHomePath(withoutTrailingSep, homeDir)
}
