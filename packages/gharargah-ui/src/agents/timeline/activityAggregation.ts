import type { AgentToolCall, TurnDiffSummary } from "@gharargah/agents"

export type ActivityBucket = "command" | "file" | "search" | "edit" | "other"

export type ActivityCounts = {
  commands: number
  files: number
  searches: number
  edits: number
  other: number
}

export type ActivityDiffStat = {
  additions: number
  deletions: number
}

export type AggregatedActivity = {
  id: string
  createdAt: string
  label: string
  toolCalls: ReadonlyArray<AgentToolCall>
  counts: ActivityCounts
  diffStat: ActivityDiffStat | null
  editFileCount: number
  changedFiles: ReadonlyArray<import("@gharargah/agents").AgentFileChange>
}

const EMPTY_COUNTS: ActivityCounts = {
  commands: 0,
  files: 0,
  searches: 0,
  edits: 0,
  other: 0,
}

export function classifyToolCall(toolCall: AgentToolCall): ActivityBucket {
  const key = `${toolCall.kind ?? ""} ${toolCall.name}`.toLowerCase()
  if (
    /edit|write|apply[_-]?patch|str[_-]?replace|create[_-]?file|delete|move|rename|patch/.test(
      key,
    )
  ) {
    return "edit"
  }
  if (/search|grep|glob|find|rg|ripgrep/.test(key)) return "search"
  if (/read|explore|list_dir|listdir|cat|open_file|file_read|view/.test(key)) return "file"
  if (/shell|terminal|exec|bash|cmd|run[_-]?command|command|pty|spawn/.test(key)) {
    return "command"
  }
  const name = toolCall.name.toLowerCase()
  if (/^read|^view|^cat|^ls\b|^list/.test(name)) return "file"
  if (/^write|^edit|^apply|^create|^delete|^patch/.test(name)) return "edit"
  if (/^grep|^search|^glob|^find/.test(name)) return "search"
  if (/^run|^bash|^shell|^exec|^command/.test(name)) return "command"
  return "other"
}

export function countActivityBuckets(
  toolCalls: ReadonlyArray<AgentToolCall>,
): ActivityCounts {
  const counts: ActivityCounts = { ...EMPTY_COUNTS }
  for (const toolCall of toolCalls) {
    const bucket = classifyToolCall(toolCall)
    if (bucket === "command") counts.commands += 1
    else if (bucket === "file") counts.files += 1
    else if (bucket === "search") counts.searches += 1
    else if (bucket === "edit") counts.edits += 1
    else counts.other += 1
  }
  return counts
}

function plural(count: number, singular: string, pluralForm: string): string {
  return `${count} ${count === 1 ? singular : pluralForm}`
}

/** Cursor-style activity header from tool counts. */
export function formatActivitySummary(counts: ActivityCounts): string {
  const exploreParts: string[] = []
  if (counts.files > 0) exploreParts.push(plural(counts.files, "file", "files"))
  if (counts.searches > 0) exploreParts.push(plural(counts.searches, "search", "searches"))

  const parts: string[] = []
  if (exploreParts.length > 0) {
    parts.push(`Explored ${exploreParts.join(", ")}`)
  }
  if (counts.commands > 0) {
    const commandPart = `ran ${plural(counts.commands, "command", "commands")}`
    if (parts.length === 0) {
      parts.push(
        counts.commands === 1
          ? "Ran 1 command"
          : `Ran ${counts.commands} commands`,
      )
    } else {
      parts.push(commandPart)
    }
  }
  if (counts.edits > 0 && parts.length === 0 && counts.other === 0) {
    return `Edited ${plural(counts.edits, "file", "files")}`
  }
  if (counts.edits > 0 && parts.length > 0) {
    parts.push(`edited ${plural(counts.edits, "file", "files")}`)
  }
  if (counts.other > 0 && parts.length === 0) {
    return `Ran ${plural(counts.other, "tool", "tools")}`
  }
  if (counts.other > 0) {
    parts.push(`ran ${plural(counts.other, "tool", "tools")}`)
  }
  if (parts.length === 0) return "Worked"
  return parts.join(", ").replace(/^./, c => c.toUpperCase())
}

export function formatEditedFilesLabel(
  fileCount: number,
  diffStat: ActivityDiffStat | null,
): string {
  const base = `Edited ${plural(Math.max(1, fileCount), "file", "files")}`
  if (!diffStat || (diffStat.additions === 0 && diffStat.deletions === 0)) {
    return base
  }
  return base
}

export function aggregateToolCalls(input: {
  id: string
  createdAt: string
  toolCalls: ReadonlyArray<AgentToolCall>
  turnDiffSummary?: TurnDiffSummary | null
}): AggregatedActivity | null {
  if (input.toolCalls.length === 0) return null
  const counts = countActivityBuckets(input.toolCalls)
  const editTools = input.toolCalls.filter(tool => classifyToolCall(tool) === "edit")
  const filesFromDiff = input.turnDiffSummary?.files.length ?? 0
  const editFileCount =
    filesFromDiff > 0 ? filesFromDiff : editTools.length > 0 ? editTools.length : 0

  let label = formatActivitySummary(counts)
  if (editFileCount > 0 && counts.commands === 0 && counts.files === 0 && counts.searches === 0) {
    label = formatEditedFilesLabel(editFileCount, null)
  } else if (editFileCount > 0 && !label.toLowerCase().includes("edit")) {
    label = `${label}, edited ${plural(editFileCount, "file", "files")}`
  }

  const diffStat =
    input.turnDiffSummary && input.turnDiffSummary.files.length > 0
      ? input.turnDiffSummary.files.reduce(
          (acc, file) => ({
            additions: acc.additions + file.additions,
            deletions: acc.deletions + file.deletions,
          }),
          { additions: 0, deletions: 0 },
        )
      : null

  if (editFileCount > 0 && counts.files === 0 && counts.searches === 0 && counts.commands === 0) {
    label = formatEditedFilesLabel(editFileCount, diffStat)
  }

  return {
    id: input.id,
    createdAt: input.createdAt,
    label,
    toolCalls: input.toolCalls,
    counts,
    diffStat:
      diffStat && (diffStat.additions > 0 || diffStat.deletions > 0) ? diffStat : null,
    editFileCount,
    changedFiles: input.turnDiffSummary?.files ?? [],
  }
}
