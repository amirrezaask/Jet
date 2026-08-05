import { useMemo } from "react"
import { DEFAULT_THEMES, parseDiffFromFile } from "@pierre/diffs"
import {
  FileDiff,
  Virtualizer,
  WorkerPoolContextProvider,
} from "@pierre/diffs/react"
// Vite resolves `?worker&url` to a built worker asset URL (requires worker.format: "es").
import pierreWorkerUrl from "@pierre/diffs/worker/worker.js?worker&url"
import type { YaadeTheme } from "@yaade/shared"

import { cn } from "@/lib/utils.js"

export type YaadeDiffViewerProps = {
  path: string
  original: string
  modified: string
  /** Unified (stacked) or split (side-by-side). */
  mode: "unified" | "split"
  theme: YaadeTheme
  /** Editor font size in px (default 13). */
  fontSize?: number
  className?: string
}

/** Vite-bundled Pierre Shiki worker (see https://diffs.com/docs → Worker Pool). */
function pierreWorkerFactory(): Worker {
  return new Worker(pierreWorkerUrl, { type: "module" })
}

const workerPoolAvailable = typeof Worker !== "undefined"

/** Cheap stable content identity for Worker Pool AST LRU. */
function contentCacheKey(side: "old" | "new", path: string, contents: string): string {
  let hash = 2166136261
  for (let i = 0; i < contents.length; i++) {
    hash ^= contents.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return `${side}:${path}:${contents.length}:${(hash >>> 0).toString(36)}`
}

/**
 * Read-only git file diff via `@pierre/diffs`.
 * Callers own chrome (path/status toolbar); Pierre’s file header is disabled.
 *
 * Scroll + line virtualization live on `Virtualizer`; Shiki runs in the worker pool.
 */
export function YaadeDiffViewer(props: YaadeDiffViewerProps) {
  const { path, original, modified, mode, theme, fontSize = 13, className } = props
  const themeType = theme.scheme === "light" ? "light" : "dark"

  const fileDiff = useMemo(() => {
    const diff = parseDiffFromFile(
      {
        name: path,
        contents: original,
        cacheKey: contentCacheKey("old", path, original),
      },
      {
        name: path,
        contents: modified,
        cacheKey: contentCacheKey("new", path, modified),
      },
    )
    diff.cacheKey = `${path}:${contentCacheKey("old", path, original)}:${contentCacheKey("new", path, modified)}`
    return diff
  }, [path, original, modified])

  const options = useMemo(
    () => ({
      theme: DEFAULT_THEMES,
      themeType: themeType as "light" | "dark",
      diffStyle: mode,
      disableFileHeader: true,
      diffIndicators: "classic" as const,
      unsafeCSS: [
        `pre, code { font-size: ${fontSize}px; font-family: var(--font-mono, 'Commit Mono', ui-monospace, monospace); }`,
      ].join("\n"),
    }),
    [themeType, mode, fontSize],
  )

  const metrics = useMemo(
    () => ({
      hunkLineCount: 50,
      // Pierre default lineHeight is 20 at 13px; scale with our font size.
      lineHeight: Math.max(1, Math.ceil(fontSize * (20 / 13))),
      // Header disabled — keep region estimate at 0 via defaults + disableFileHeader.
      diffHeaderHeight: 0,
      spacing: 8,
    }),
    [fontSize],
  )

  const highlighterOptions = useMemo(
    () => ({
      theme: DEFAULT_THEMES,
    }),
    [],
  )

  const poolOptions = useMemo(
    () => ({
      workerFactory: pierreWorkerFactory,
    }),
    [],
  )

  const diff = (
    <Virtualizer className="h-full min-h-0 w-full min-w-0 overflow-auto">
      <FileDiff fileDiff={fileDiff} options={options} metrics={metrics} />
    </Virtualizer>
  )

  return (
    <div
      data-yaade-pierre-diff=""
      className={cn("h-full min-h-0 w-full min-w-0", className)}
    >
      {workerPoolAvailable ? (
        <WorkerPoolContextProvider
          poolOptions={poolOptions}
          highlighterOptions={highlighterOptions}
        >
          {diff}
        </WorkerPoolContextProvider>
      ) : (
        diff
      )}
    </div>
  )
}
