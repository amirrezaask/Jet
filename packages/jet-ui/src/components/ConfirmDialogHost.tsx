import { useEffect, useState } from "react"
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
import type { JetVariant } from "../toast.js"
import { buttonVariants } from "@/components/ui/button.js"
import { cn } from "@/lib/utils.js"

export type ConfirmOptions = {
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  variant?: JetVariant
}

function actionClassForVariant(variant: JetVariant | undefined, destructive: boolean | undefined): string {
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
let notify: (() => void) | null = null

export function requestConfirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise(resolve => {
    pending = options
    resolveFn = resolve
    notify?.()
  })
}

export function ConfirmDialogHost() {
  const [, bump] = useState(0)

  useEffect(() => {
    notify = () => bump(n => n + 1)
    return () => {
      notify = null
    }
  }, [])

  const options = pending
  const open = options != null

  const finish = (value: boolean) => {
    pending = null
    const resolve = resolveFn
    resolveFn = null
    resolve?.(value)
    bump(n => n + 1)
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
          <AlertDialogCancel onClick={() => finish(false)}>
            {options?.cancelLabel ?? "Cancel"}
          </AlertDialogCancel>
          <AlertDialogAction
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
