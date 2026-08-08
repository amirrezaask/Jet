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

export type SaveDiscardOptions = {
  title: string
  description: string
  saveLabel?: string
  discardLabel?: string
  cancelLabel?: string
}

export type SaveDiscardDecision = "save" | "discard" | "cancel"

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
  options: ConfirmOptions & { alternateLabel?: string }
  resolve: (value: "confirm" | "alternate" | "cancel") => void
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
    pending?.resolve("cancel")
    pending = {
      options,
      resolve: value => resolve(value === "confirm"),
    }
    emitChange()
  })
}

export function requestSaveDiscard(
  options: SaveDiscardOptions,
): Promise<SaveDiscardDecision> {
  return new Promise(resolve => {
    pending?.resolve("cancel")
    pending = {
      options: {
        title: options.title,
        description: options.description,
        confirmLabel: options.saveLabel ?? "Save All",
        alternateLabel: options.discardLabel ?? "Discard All",
        cancelLabel: options.cancelLabel ?? "Cancel",
      },
      resolve: value =>
        resolve(
          value === "confirm"
            ? "save"
            : value === "alternate"
              ? "discard"
              : "cancel",
        ),
    }
    emitChange()
  })
}

export function ConfirmDialogHost() {
  const request = useSyncExternalStore(subscribe, () => pending, () => null)
  const options = request?.options ?? null
  const open = request != null

  const finish = (
    target: PendingConfirm,
    value: "confirm" | "alternate" | "cancel",
  ) => {
    if (pending !== target) return
    pending = null
    target.resolve(value)
    emitChange()
  }

  const finishCurrent = (value: "confirm" | "alternate" | "cancel") => {
    const current = pending
    if (current) finish(current, value)
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={next => {
        if (!next && request) finish(request, "cancel")
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
            onClick={() => finishCurrent("cancel")}
          >
            {options?.cancelLabel ?? "Cancel"}
          </Button>
          {options?.alternateLabel ? (
            <Button
              type="button"
              data-yaade-confirm="alternate"
              variant="destructive"
              onClick={() => finishCurrent("alternate")}
            >
              {options.alternateLabel}
            </Button>
          ) : null}
          <Button
            type="button"
            data-yaade-confirm="accept"
            variant={actionVariant(options?.variant, options?.destructive)}
            onClick={() => finishCurrent("confirm")}
          >
            {options?.confirmLabel ?? "Continue"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
