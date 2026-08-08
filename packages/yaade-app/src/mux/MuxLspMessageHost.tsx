import { useSyncExternalStore } from "react"
import {
  getLspUiSnapshot,
  resolveLspMessageAction,
  subscribeLspUi,
} from "../lsp-ui-store.js"
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@yaade/ui/primitives"

export function MuxLspMessageHost() {
  const snapshot = useSyncExternalStore(
    subscribeLspUi,
    getLspUiSnapshot,
    getLspUiSnapshot,
  )
  const request = snapshot.request

  return (
    <Dialog
      open={request != null}
      onOpenChange={open => {
        if (!open && request) resolveLspMessageAction(request.id, null)
      }}
    >
      <DialogContent
        motion="instant"
        size="prompt"
        data-yaade-lsp-message-request=""
      >
        <DialogHeader>
          <DialogTitle>Language Server</DialogTitle>
          <DialogDescription>{request?.message ?? ""}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-wrap">
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              if (request) resolveLspMessageAction(request.id, null)
            }}
          >
            Dismiss
          </Button>
          {request?.actions.map((action, index) => (
            <Button
              key={`${action.title}:${index}`}
              type="button"
              variant={index === 0 ? "default" : "secondary"}
              onClick={() => resolveLspMessageAction(request.id, action)}
            >
              {action.title}
            </Button>
          ))}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
