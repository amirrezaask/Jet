import type { AgentFileReference, AgentToolCall } from "@gharargah/agents"
import { useRecyclingState } from "@legendapp/list/react"
import {
  Brain,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  FilePenLine,
  FileText,
  Globe2,
  Loader2,
  Search,
  Terminal,
  Trash2,
} from "lucide-react"
import { Button } from "../../components/ui/button.js"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../../components/ui/collapsible.js"
import { useTimelineItemLayoutSync } from "./useTimelineItemLayoutSync.js"

function elapsed(toolCall: AgentToolCall): string | null {
  if (!toolCall.startedAt || !toolCall.completedAt) return null
  const milliseconds =
    new Date(toolCall.completedAt).getTime() -
    new Date(toolCall.startedAt).getTime()
  return Number.isFinite(milliseconds)
    ? `${Math.max(0, Math.round(milliseconds / 1000))}s`
    : null
}

function summaryFromValue(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null
  if (Array.isArray(value)) {
    for (const item of value) {
      const summary = summaryFromValue(item)
      if (summary) return summary
    }
    return null
  }
  if (!value || typeof value !== "object") return null
  const record = value as Record<string, unknown>
  for (const key of [
    "path",
    "filePath",
    "file_path",
    "command",
    "cmd",
    "query",
    "pattern",
    "url",
    "uri",
    "name",
  ]) {
    const summary = summaryFromValue(record[key])
    if (summary) return summary
  }
  return null
}

export function summarizeToolCall(toolCall: AgentToolCall): string | null {
  let summary = toolCall.summary?.trim() || null
  if (!summary && toolCall.input) {
    try {
      summary = summaryFromValue(JSON.parse(toolCall.input))
    } catch {
      summary = toolCall.input.trim() || null
    }
  }
  if (
    !summary ||
    toolCall.name.toLocaleLowerCase().includes(summary.toLocaleLowerCase())
  ) {
    return null
  }
  return summary
}

function ToolIcon(props: { kind?: string }) {
  const kind = props.kind?.toLocaleLowerCase() ?? ""
  if (kind.includes("read")) return <FileText aria-hidden />
  if (
    kind.includes("edit") ||
    kind.includes("write") ||
    kind.includes("move")
  ) {
    return <FilePenLine aria-hidden />
  }
  if (kind.includes("delete")) return <Trash2 aria-hidden />
  if (kind.includes("search")) return <Search aria-hidden />
  if (kind.includes("fetch")) return <Globe2 aria-hidden />
  if (kind.includes("think")) return <Brain aria-hidden />
  return <Terminal aria-hidden />
}

function pathFromToolValue(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim()
    if (!trimmed) return null
    if (
      trimmed.startsWith("file://") ||
      trimmed.startsWith("/") ||
      /^[A-Za-z]:[\\/]/.test(trimmed) ||
      /^[.]{1,2}[\\/]/.test(trimmed) ||
      /\.[A-Za-z0-9]{1,12}$/.test(trimmed.split(/[:\s]/)[0] ?? "")
    ) {
      return trimmed.split(/[:\s]/)[0] ?? trimmed
    }
    return null
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const path = pathFromToolValue(item)
      if (path) return path
    }
    return null
  }
  if (!value || typeof value !== "object") return null
  const record = value as Record<string, unknown>
  for (const key of ["path", "filePath", "file_path", "uri", "target", "file"]) {
    const path = pathFromToolValue(record[key])
    if (path) return path
  }
  return null
}

export function fileRefFromToolCall(toolCall: AgentToolCall): AgentFileReference | null {
  let path: string | null = null
  if (toolCall.input) {
    try {
      path = pathFromToolValue(JSON.parse(toolCall.input))
    } catch {
      path = pathFromToolValue(toolCall.input)
    }
  }
  if (!path) path = pathFromToolValue(toolCall.summary)
  if (!path) return null
  return { path }
}

export function ToolCallCard(props: {
  toolCall: AgentToolCall
  flat?: boolean
  onOpenFile?: (ref: AgentFileReference) => void
}) {
  const { toolCall, flat = false, onOpenFile } = props
  const [open, setOpen] = useRecyclingState(false)
  // open toggles already call triggerLayout via useRecyclingState.
  useTimelineItemLayoutSync([
    toolCall.status,
    toolCall.input,
    toolCall.output,
    toolCall.error,
  ])
  const summary = summarizeToolCall(toolCall)
  const fileRef = onOpenFile ? fileRefFromToolCall(toolCall) : null
  const showFilePathButton = Boolean(summary && fileRef && onOpenFile)
  const StatusIcon =
    toolCall.status === "completed"
      ? CheckCircle2
      : toolCall.status === "failed"
        ? CircleAlert
        : toolCall.status === "running"
          ? Loader2
          : null
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className={flat ? "rounded-md" : "rounded-lg border border-border/50 bg-transparent"}
      data-gharargah-tool-call=""
      data-timeline-tool=""
      data-tool-name={toolCall.name}
      data-tool-summary={summary ?? undefined}
    >
      <div className="flex w-full min-w-0 items-center gap-1.5 px-2 text-agent-feed-muted">
        <CollapsibleTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-tool-call-toggle=""
            className={
              showFilePathButton
                ? "h-auto min-h-0 shrink-0 justify-start gap-1.5 px-0 text-agent-feed-muted hover:bg-transparent"
                : "h-auto min-h-0 min-w-0 flex-1 justify-start gap-1.5 px-0 text-agent-feed-muted hover:bg-transparent"
            }
            aria-label={`${open ? "Collapse" : "Expand"} ${toolCall.name}${summary ? `, ${summary}` : ""}`}
          >
            <ChevronRight
              className={open ? "size-3 shrink-0 rotate-90" : "size-3 shrink-0"}
            />
            <span className="shrink-0 text-muted-foreground [&_svg]:size-3.5">
              <ToolIcon kind={toolCall.kind} />
            </span>
            <span className="min-w-0 shrink-0 truncate text-left text-xs font-medium text-agent-feed-primary">
              {toolCall.name}
            </span>
            {!showFilePathButton && summary ? (
              <>
                <span className="shrink-0 text-muted-foreground/45" aria-hidden>
                  ·
                </span>
                <span
                  className="min-w-0 flex-1 truncate text-left font-mono text-xs text-agent-feed-muted"
                  title={summary}
                >
                  {summary}
                </span>
              </>
            ) : !showFilePathButton ? (
              <span className="min-w-0 flex-1" />
            ) : null}
          </Button>
        </CollapsibleTrigger>
        {showFilePathButton && summary ? (
          <>
            <span className="shrink-0 text-muted-foreground/45" aria-hidden>
              ·
            </span>
            <button
              type="button"
              className="min-w-0 flex-1 truncate text-left font-mono text-xs text-agent-feed-muted underline-offset-2 hover:underline"
              title={summary}
              data-gharargah-tool-path=""
              onClick={event => {
                event.preventDefault()
                onOpenFile!(fileRef!)
              }}
            >
              {summary}
            </button>
          </>
        ) : null}
        {!summary ? <span className="min-w-0 flex-1" /> : null}
        {StatusIcon ? (
          <StatusIcon
            className={
              toolCall.status === "running"
                ? "size-3.5 shrink-0 animate-spin text-muted-foreground"
                : toolCall.status === "failed"
                  ? "size-3.5 shrink-0 text-destructive"
                  : "size-3.5 shrink-0 text-muted-foreground"
            }
            aria-hidden
          />
        ) : null}
        <span className="shrink-0 text-3xs text-agent-feed-muted">
          {elapsed(toolCall) ?? toolCall.status}
        </span>
      </div>
      <CollapsibleContent className="overflow-visible data-[state=closed]:hidden">
        <div className={flat ? "space-y-3 px-2 py-2" : "space-y-3 border-t border-border/40 px-3 py-2.5"}>
          {toolCall.input ? (
            <ToolDetail label="Input" value={toolCall.input} />
          ) : null}
          {toolCall.output ? (
            <ToolDetail label="Output" value={toolCall.output} />
          ) : null}
          {toolCall.error ? (
            <ToolDetail label="Error" value={toolCall.error} destructive />
          ) : null}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function ToolDetail(props: {
  label: string
  value: string
  destructive?: boolean
}) {
  return (
    <section>
      <h4 className="mb-1 text-3xs font-medium uppercase tracking-[0.1em] text-muted-foreground">
        {props.label}
      </h4>
      <pre
        className={
          props.destructive
            ? "max-h-80 overflow-auto whitespace-pre-wrap font-mono text-xs text-destructive"
            : "max-h-80 overflow-auto whitespace-pre-wrap font-mono text-xs text-muted-foreground"
        }
      >
        {props.value}
      </pre>
    </section>
  )
}
