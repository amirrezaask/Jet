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
      // Keep long lines on one row; scroll inside [data-code], not wrap.
      overflow: "scroll" as const,
      disableFileHeader: true,
      diffIndicators: "classic" as const,
      unsafeCSS: [
        // Custom element host defaults to inline — block + bounded width so
        // Pierre's overflow-x:scroll on [data-code] can engage.
        `:host { display: block; width: 100%; max-width: 100%; min-width: 0; overflow-x: hidden; }`,
        // Default `1fr` tracks are minmax(auto, 1fr) and grow with long lines,
        // which expands the host and gets clipped by our overflow-hidden parents.
        `[data-diff], [data-file] { --diffs-code-grid: var(--diffs-grid-number-column-width) minmax(0, 1fr); }`,
        `[data-diff-type="split"][data-overflow="scroll"] { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }`,
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
    // Vertical scroll on Virtualizer; horizontal scroll stays on Pierre's
    // [data-code] panes (overflow-x:hidden here so trackpad swipes aren't eaten).
    <Virtualizer className="h-full min-h-0 w-full min-w-0 overflow-x-hidden overflow-y-auto">
      <FileDiff
        fileDiff={fileDiff}
        options={options}
        metrics={metrics}
        className="block h-full w-full min-w-0 max-w-full"
      />
    </Virtualizer>
  )

  return (
    <div
      data-yaade-pierre-diff=""
      className={cn(
        "h-full min-h-0 w-full min-w-0 [&_diffs-container]:block [&_diffs-container]:h-full [&_diffs-container]:w-full [&_diffs-container]:min-w-0 [&_diffs-container]:max-w-full",
        className,
      )}
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
