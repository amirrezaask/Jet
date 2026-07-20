import { useSyncExternalStore } from "react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
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

let pending: ConfirmOptions | null = null
let resolveFn: ((value: boolean) => void) | null = null
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
    resolveFn?.(false)
    pending = options
    resolveFn = resolve
    emitChange()
  })
}

export function ConfirmDialogHost() {
  const options = useSyncExternalStore(subscribe, () => pending, () => null)
  const open = options != null

  const finish = (value: boolean) => {
    pending = null
    const resolve = resolveFn
    resolveFn = null
    resolve?.(value)
    emitChange()
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={next => {
        if (!next) finish(false)
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{options?.title ?? ""}</AlertDialogTitle>
          <AlertDialogDescription>{options?.description ?? ""}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-gharargah-confirm="cancel" onClick={() => finish(false)}>
            {options?.cancelLabel ?? "Cancel"}
          </AlertDialogCancel>
          <AlertDialogAction
            data-gharargah-confirm="accept"
            className={actionClassForVariant(options?.variant, options?.destructive)}
            onClick={() => finish(true)}
          >
            {options?.confirmLabel ?? "Continue"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
