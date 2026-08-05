import { useEffect, useRef, useState } from "react"
import type { GitCommit, GitCommitDetail, GitCommitFile, YaadeTheme } from "@yaade/shared"
import { languageIdFromPath } from "@yaade/shared"
import { MonacoDiffEditorHost, monacoLanguageId } from "@yaade/monaco"
import { FileDiffIcon, HistoryIcon } from "lucide-react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty.js"
import { Spinner } from "@/components/ui/spinner.js"
import { cn } from "@/lib/utils.js"
import { loadCommitDiffContents } from "./commit-diff.js"

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
})

export type CommitChangesDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  rootUri: string
  hash: string
  theme: YaadeTheme
  fontSize?: number
  /** Optional row metadata when already known from a history list. */
  commit?: Pick<GitCommit, "shortHash" | "author" | "authoredAt" | "subject">
}

type DiffContents = { original: string; modified: string }

export function CommitChangesDialog(props: CommitChangesDialogProps) {
  const { open, onOpenChange, rootUri, hash, theme, fontSize = 13, commit } = props
  const api = window.yaade?.git
  const [detail, setDetail] = useState<GitCommitDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [diffContents, setDiffContents] = useState<DiffContents | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)
  const [diffError, setDiffError] = useState<string | null>(null)
  const detailRequest = useRef(0)
  const diffRequest = useRef(0)

  useEffect(() => {
    if (!open || !api || !hash) {
      setDetail(null)
      setSelectedPath(null)
      setDiffContents(null)
      setDetailError(null)
      setDiffError(null)
      return
    }
    const request = ++detailRequest.current
    setDetailLoading(true)
    setDetailError(null)
    setDetail(null)
    setSelectedPath(null)
    setDiffContents(null)
    setDiffError(null)
    void api
      .commitFiles(rootUri, hash)
      .then(next => {
        if (request !== detailRequest.current) return
        setDetail(next)
        setSelectedPath(next.files[0]?.path ?? null)
      })
      .catch(err => {
        if (request !== detailRequest.current) return
        setDetailError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (request === detailRequest.current) setDetailLoading(false)
      })
  }, [open, api, rootUri, hash])

  const selectedFile =
    detail?.files.find(file => file.path === selectedPath) ?? detail?.files[0] ?? null

  useEffect(() => {
    if (!open || !api || !hash || !selectedFile) {
      setDiffContents(null)
      setDiffError(null)
      return
    }
    const file = selectedFile
    const request = ++diffRequest.current
    setDiffLoading(true)
    setDiffError(null)
    void loadCommitDiffContents(api, rootUri, hash, file)
      .then(contents => {
        if (request !== diffRequest.current) return
        setDiffContents(contents)
      })
      .catch(err => {
        if (request !== diffRequest.current) return
        setDiffContents(null)
        setDiffError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (request === diffRequest.current) setDiffLoading(false)
      })
  }, [
    open,
    api,
    rootUri,
    hash,
    selectedFile?.path,
    selectedFile?.status,
    selectedFile?.originalPath,
  ])

  const subject = detail?.subject ?? commit?.subject ?? "Commit"
  const shortHash = commit?.shortHash ?? hash.slice(0, 7)
  const author = commit?.author
  const authoredAt = commit?.authoredAt

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="wide"
        data-yaade-commit-changes-dialog=""
        className="flex h-[min(90dvh,52rem)] max-h-[90dvh] w-[min(96vw,72rem)] max-w-[min(96vw,72rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(96vw,72rem)]"
      >
        <DialogHeader className="shrink-0 gap-1 border-b border-border px-4 py-3 pr-12 text-left">
          <DialogTitle className="truncate text-base">{subject}</DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-2xs text-muted-foreground">
            <span>{shortHash}</span>
            {author ? <span>· {author}</span> : null}
            {authoredAt != null ? (
              <span>· {dateFormatter.format(new Date(authoredAt))}</span>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 overflow-hidden">
          {detailLoading && !detail ? (
            <div className="flex flex-1 items-center justify-center gap-2 text-xs text-muted-foreground">
              <Spinner /> Loading commit…
            </div>
          ) : detailError ? (
            <div className="flex flex-1 items-center justify-center p-6 text-sm text-destructive">
              {detailError}
            </div>
          ) : !detail ? (
            <CenteredEmpty
              title="Commit unavailable"
              description="Could not load this commit’s changes."
            />
          ) : (
            <>
              <aside
                data-yaade-list-panel="commit-changes-files"
                className="flex w-[min(40%,18rem)] shrink-0 flex-col border-r border-border bg-transparent"
              >
                <div className="shrink-0 px-3 py-2 font-mono text-3xs tracking-wide text-muted-foreground uppercase">
                  {detail.files.length} {detail.files.length === 1 ? "file" : "files"}
                </div>
                {detail.body ? (
                  <pre className="mx-3 mb-2 max-h-24 overflow-auto rounded-md bg-muted/40 p-2 font-mono text-3xs whitespace-pre-wrap text-foreground/90">
                    {detail.body}
                  </pre>
                ) : null}
                <ul className="min-h-0 flex-1 overflow-auto px-1 pb-2">
                  {detail.files.length === 0 ? (
                    <li className="px-2 py-3 text-2xs text-muted-foreground">
                      No files changed in this commit.
                    </li>
                  ) : (
                    detail.files.map(file => {
                      const active = file.path === selectedFile?.path
                      return (
                        <li key={`${file.status}:${file.path}`}>
                          <button
                            type="button"
                            data-yaade-list-item=""
                            data-active={active ? "" : undefined}
                            onClick={() => setSelectedPath(file.path)}
                            className={cn(
                                "flex w-full shrink-0 items-center gap-2 rounded-sm px-2 py-1.5 text-left text-2xs outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
                              active
                                ? "bg-primary/10 text-foreground"
                                : "text-muted-foreground hover:bg-accent/35 hover:text-foreground",
                            )}
                          >
                            <span
                              className={cn(
                                "w-3 shrink-0 text-center font-mono font-medium",
                                statusColor(file.status),
                              )}
                              title={file.status}
                            >
                              {statusLetter(file.status)}
                            </span>
                            <span className="min-w-0 flex-1 truncate font-mono">{file.path}</span>
                          </button>
                        </li>
                      )
                    })
                  )}
                </ul>
              </aside>

              <div data-yaade-git-diff="" className="flex min-h-0 min-w-0 flex-1 flex-col">
                {selectedFile ? (
                  <>
                    <div
                      data-yaade-liquid-glass="chrome"
                      className="flex h-7 shrink-0 items-center gap-2 border-b border-transparent px-3"
                    >
                      <FileDiffIcon className="text-muted-foreground" aria-hidden />
                      <span className="min-w-0 flex-1 truncate font-mono text-2xs">
                        {selectedFile.path}
                      </span>
                      <span className="shrink-0 font-mono text-3xs text-muted-foreground">
                        {selectedFile.status}
                      </span>
                    </div>
                    <div className="min-h-0 flex-1 overflow-hidden">
                      {diffLoading ? (
                        <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
                          <Spinner /> Loading diff…
                        </div>
                      ) : diffError ? (
                        <CenteredEmpty title="Failed to load diff" description={diffError} />
                      ) : diffContents &&
                        (diffContents.original.length > 0 || diffContents.modified.length > 0) ? (
                        <MonacoDiffEditorHost
                          originalUri={`git-commit://${hash}/${selectedFile.path}?side=original`}
                          modifiedUri={`git-commit://${hash}/${selectedFile.path}?side=modified`}
                          originalContent={diffContents.original}
                          modifiedContent={diffContents.modified}
                          languageId={monacoLanguageId(languageIdFromPath(selectedFile.path))}
                          theme={theme}
                          fontSize={fontSize}
                          readOnly
                          renderSideBySide
                          className="h-full min-h-0"
                        />
                      ) : (
                        <CenteredEmpty
                          title="No textual diff"
                          description="This file may be binary or empty in this commit."
                        />
                      )}
                    </div>
                  </>
                ) : (
                  <CenteredEmpty
                    title="Select a file"
                    description="Choose a file from this commit to inspect its diff."
                  />
                )}
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function CenteredEmpty({ title, description }: { title: string; description: string }) {
  return (
    <Empty className="h-full rounded-none border-0">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <HistoryIcon aria-hidden />
        </EmptyMedia>
        <EmptyTitle className="text-sm">{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

function statusLetter(status: GitCommitFile["status"]): string {
  return status === "modified"
    ? "M"
    : status === "added"
      ? "A"
      : status === "deleted"
        ? "D"
        : status === "renamed"
          ? "R"
          : status === "untracked"
            ? "U"
            : "!"
}

function statusColor(status: GitCommitFile["status"]): string {
  if (status === "conflict") return "text-[color:var(--yaade-git-conflict)]"
  if (status === "deleted") return "text-[color:var(--yaade-git-deleted)]"
  if (status === "added" || status === "untracked") return "text-[color:var(--yaade-git-added)]"
  return "text-[color:var(--yaade-git-modified)]"
}
