import { useSyncExternalStore } from "react"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog.js"
import type { YaadeVariant } from "../toast.js"
import { Button } from "@/components/ui/button.js"

export type ConfirmOptions = {
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  variant?: YaadeVariant
}

function actionVariant(
  variant: YaadeVariant | undefined,
  destructive: boolean | undefined,
): "default" | "destructive" | "warning" {
  const resolved = variant ?? (destructive ? "destructive" : "default")
  switch (resolved) {
    case "destructive":
      return "destructive"
    case "warning":
      return "warning"
    default:
      return "default"
  }
}

type PendingConfirm = {
  options: ConfirmOptions
  resolve: (value: boolean) => void
}

let pending: PendingConfirm | null = null
const listeners = new Set<() => void>()

function emitChange(): void {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function requestConfirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise(resolve => {
    pending?.resolve(false)
    pending = { options, resolve }
    emitChange()
  })
}

export function ConfirmDialogHost() {
  const request = useSyncExternalStore(subscribe, () => pending, () => null)
  const options = request?.options ?? null
  const open = request != null

  const finish = (target: PendingConfirm, value: boolean) => {
    if (pending !== target) return
    pending = null
    target.resolve(value)
    emitChange()
  }

  const finishCurrent = (value: boolean) => {
    const current = pending
    if (current) finish(current, value)
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={next => {
        if (!next && request) finish(request, false)
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{options?.title ?? ""}</AlertDialogTitle>
          <AlertDialogDescription>{options?.description ?? ""}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button
            type="button"
            data-yaade-confirm="cancel"
            variant="outline"
            onClick={() => finishCurrent(false)}
          >
            {options?.cancelLabel ?? "Cancel"}
          </Button>
          <Button
            type="button"
            data-yaade-confirm="accept"
            variant={actionVariant(options?.variant, options?.destructive)}
            onClick={() => finishCurrent(true)}
          >
            {options?.confirmLabel ?? "Continue"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
