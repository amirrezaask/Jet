import { useSyncExternalStore } from "react"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog.js"
import type { GharargahVariant } from "../toast.js"
import { buttonVariants } from "@/components/ui/button.js"
import { cn } from "@/lib/utils.js"

export type ConfirmOptions = {
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  variant?: GharargahVariant
}

function actionClassForVariant(variant: GharargahVariant | undefined, destructive: boolean | undefined): string {
  const resolved = variant ?? (destructive ? "destructive" : "default")
  switch (resolved) {
    case "destructive":
      return cn(buttonVariants({ variant: "destructive" }))
    case "warning":
      return cn(buttonVariants({ variant: "warning" }))
    default:
      return cn(buttonVariants())
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
          <button
            type="button"
            data-gharargah-confirm="cancel"
            className={buttonVariants({ variant: "outline" })}
            onClick={() => finishCurrent(false)}
          >
            {options?.cancelLabel ?? "Cancel"}
          </button>
          <button
            type="button"
            data-gharargah-confirm="accept"
            className={actionClassForVariant(options?.variant, options?.destructive)}
            onClick={() => finishCurrent(true)}
          >
            {options?.confirmLabel ?? "Continue"}
          </button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
