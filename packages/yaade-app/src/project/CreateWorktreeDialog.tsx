import { useEffect, useMemo, useState } from "react"
import { SectionLabel } from "@yaade/ui/project"
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

export type CreateWorktreeDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectPath: string
  homeDir: string
  defaultBranch: string
  onCreate: (input: {
    branch: string
    baseRef?: string
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

export function CreateWorktreeDialog({
  open,
  onOpenChange,
  projectPath,
  homeDir,
  defaultBranch,
  onCreate,
}: CreateWorktreeDialogProps) {
  const [branch, setBranch] = useState("")
  const [baseRef, setBaseRef] = useState(defaultBranch)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) setBaseRef(defaultBranch)
  }, [defaultBranch, open])

  const projectSlug =
    projectPath.split("/").filter(Boolean).pop() ?? "project"
  const previewPath = useMemo(() => {
    if (!branch.trim()) return null
    const seg = sanitizePreview(branch)
    if (!seg) return null
    return `${homeDir}/.yaade/worktrees/${projectSlug}/${seg}`
  }, [branch, homeDir, projectSlug])

  const submit = async () => {
    if (!branch.trim()) return
    setBusy(true)
    setError(null)
    try {
      await onCreate({
        branch: branch.trim(),
        baseRef: baseRef.trim() || undefined,
      })
      setBranch("")
      setBaseRef(defaultBranch)
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
        data-yaade-create-worktree-dialog=""
        className="gap-4"
      >
        <DialogHeader>
          <DialogTitle>Create worktree</DialogTitle>
          <DialogDescription>
            Create a git worktree and open a tiling workspace on that checkout.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid gap-3 rounded-md border border-border p-3">
            <SectionLabel className="mb-0">Worktree</SectionLabel>
            <div className="grid gap-1.5">
              <Label htmlFor="worktree-branch">Branch</Label>
              <Input
                id="worktree-branch"
                value={branch}
                onChange={e => setBranch(e.target.value)}
                placeholder="feat/my-change"
                autoFocus
                data-yaade-worktree-branch=""
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="worktree-base">Base ref</Label>
              <Input
                id="worktree-base"
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
            disabled={busy || !branch.trim()}
            data-yaade-create-worktree=""
          >
            {busy ? "Creating…" : "Create & open"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
