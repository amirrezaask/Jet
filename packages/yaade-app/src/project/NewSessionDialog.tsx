import { useMemo, useState } from "react"
import { SectionLabel } from "@yaade/ui"
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from "@yaade/ui/primitives"

export type NewSessionDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectPath: string
  homeDir: string
  defaultBranch: string
  onCreate: (input: {
    title: string
    worktree?: { branch: string; baseRef?: string }
  }) => Promise<void>
}

function sanitizePreview(branch: string): string {
  return branch
    .trim()
    .replace(/[\\/]+/g, "-")
    .replace(/[^A-Za-z0-9._+-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 80)
}

export function NewSessionDialog({
  open,
  onOpenChange,
  projectPath,
  homeDir,
  defaultBranch,
  onCreate,
}: NewSessionDialogProps) {
  const [title, setTitle] = useState("")
  const [useWorktree, setUseWorktree] = useState(false)
  const [branch, setBranch] = useState("")
  const [baseRef, setBaseRef] = useState(defaultBranch)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const projectSlug =
    projectPath.split("/").filter(Boolean).pop() ?? "project"
  const previewPath = useMemo(() => {
    if (!useWorktree || !branch.trim()) return null
    const seg = sanitizePreview(branch)
    if (!seg) return null
    return `${homeDir}/.yaade/worktrees/${projectSlug}/${seg}`
  }, [branch, homeDir, projectSlug, useWorktree])

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const resolvedTitle =
        title.trim() ||
        (useWorktree && branch.trim() ? branch.trim() : "Session")
      await onCreate({
        title: resolvedTitle,
        ...(useWorktree && branch.trim()
          ? {
              worktree: {
                branch: branch.trim(),
                baseRef: baseRef.trim() || undefined,
              },
            }
          : {}),
      })
      setTitle("")
      setBranch("")
      setUseWorktree(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="picker"
        data-yaade-new-session-dialog=""
        className="gap-4"
      >
        <DialogHeader>
          <DialogTitle>New session</DialogTitle>
          <DialogDescription>
            Open a tiling workspace on this project. Optionally create a git
            worktree so the session has an isolated branch checkout.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="session-title">Title</Label>
            <Input
              id="session-title"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Session"
              autoFocus
            />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={useWorktree}
              onChange={e => setUseWorktree(e.target.checked)}
              data-yaade-use-worktree=""
            />
            Use a git worktree
          </label>

          {useWorktree ? (
            <div className="grid gap-3 rounded-md border border-border p-3">
              <SectionLabel className="mb-0">Worktree</SectionLabel>
              <div className="grid gap-1.5">
                <Label htmlFor="session-branch">Branch</Label>
                <Input
                  id="session-branch"
                  value={branch}
                  onChange={e => setBranch(e.target.value)}
                  placeholder="feat/my-change"
                  data-yaade-worktree-branch=""
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="session-base">Base ref</Label>
                <Input
                  id="session-base"
                  value={baseRef}
                  onChange={e => setBaseRef(e.target.value)}
                  placeholder={defaultBranch}
                />
              </div>
              {previewPath ? (
                <p className="break-all font-mono text-3xs text-muted-foreground">
                  {previewPath}
                </p>
              ) : null}
            </div>
          ) : null}

          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            Cancel
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={busy || (useWorktree && !branch.trim())}
            data-yaade-create-session=""
          >
            {busy ? "Creating…" : "Create session"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
