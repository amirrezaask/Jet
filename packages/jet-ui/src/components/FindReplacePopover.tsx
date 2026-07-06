import { useEffect, useState } from "react"
import type { PanelId } from "@jet/shared"
import {
  closeJetSearch,
  findNext,
  findPrevious,
  getSearchQuery,
  patchJetSearchQuery,
  replaceAll,
  replaceNext,
  subscribeSearch,
  type JetSearchState,
} from "@jet/codemirror"
import { Button } from "@/components/ui/button.js"
import { JetCaretInput } from "@/motion/useJetCaretOverlay.js"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group.js"
import { PanelFloatingPopover } from "@/dock/PanelFloatingPopover.js"
import { useAutoFocus } from "@/lib/use-auto-focus.js"
import { getEditorView } from "@/tabs/EditorTabHost.js"

export function FindReplacePopover({ panelId }: { panelId: PanelId }) {
  const [state, setState] = useState<JetSearchState | null>(null)

  useEffect(() => subscribeSearch(setState), [])

  const view = state?.view ?? null
  const mode = state?.mode ?? "find"
  const ownsPanel =
    state?.panelId != null
      ? state.panelId === panelId.id
      : Boolean(view && getEditorView(panelId) === view)
  const open = Boolean(state?.open && view && ownsPanel)

  const query = view && state ? getSearchQuery(view.state) : null
  void state?.version

  const findRef = useAutoFocus<HTMLInputElement>(open && mode === "find")
  const replaceRef = useAutoFocus<HTMLInputElement>(open && mode === "replace")

  if (!open || !view) return null

  const toggleValues = [
    ...(query?.caseSensitive ? ["case"] : []),
    ...(query?.regexp ? ["regex"] : []),
    ...(query?.wholeWord ? ["word"] : []),
  ]

  return (
    <PanelFloatingPopover
      panelId={panelId}
      open={open}
      corner="top-right"
      onOpenChange={next => {
        if (!next) closeJetSearch(view)
      }}
    >
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <JetCaretInput
            id="jet-find-input"
            ref={findRef}
            className="h-8 min-w-[10rem] flex-1"
            placeholder="Find"
            value={query?.search ?? ""}
            onChange={e => patchJetSearchQuery(view, { search: e.target.value })}
            onKeyDown={e => {
              if (e.key === "Enter" && e.shiftKey) {
                e.preventDefault()
                findPrevious(view)
                return
              }
              if (e.key === "Enter") {
                e.preventDefault()
                findNext(view)
              }
            }}
            spellCheck={false}
            autoComplete="off"
          />
          {mode === "replace" ? (
            <JetCaretInput
              id="jet-replace-input"
              ref={replaceRef}
              className="h-8 min-w-[10rem] flex-1"
              placeholder="Replace"
              value={query?.replace ?? ""}
              onChange={e => patchJetSearchQuery(view, { replace: e.target.value })}
              spellCheck={false}
              autoComplete="off"
            />
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <ToggleGroup
            type="multiple"
            variant="outline"
            size="sm"
            value={toggleValues}
            onValueChange={values => {
              patchJetSearchQuery(view, {
                caseSensitive: values.includes("case"),
                regexp: values.includes("regex"),
                wholeWord: values.includes("word"),
              })
            }}
          >
            <ToggleGroupItem value="case" className="h-7 px-2 text-xs">
              Aa
            </ToggleGroupItem>
            <ToggleGroupItem value="regex" className="h-7 px-2 text-xs">
              .*
            </ToggleGroupItem>
            <ToggleGroupItem value="word" className="h-7 px-2 text-xs">
              W
            </ToggleGroupItem>
          </ToggleGroup>
          <Button type="button" variant="secondary" size="sm" className="h-7" onClick={() => findPrevious(view)}>
            Previous
          </Button>
          <Button type="button" variant="secondary" size="sm" className="h-7" onClick={() => findNext(view)}>
            Next
          </Button>
          {mode === "replace" ? (
            <>
              <Button type="button" variant="secondary" size="sm" className="h-7" onClick={() => replaceNext(view)}>
                Replace
              </Button>
              <Button type="button" variant="secondary" size="sm" className="h-7" onClick={() => replaceAll(view)}>
                All
              </Button>
            </>
          ) : null}
          <Button type="button" variant="ghost" size="sm" className="h-7" onClick={() => closeJetSearch(view)}>
            Close
          </Button>
        </div>
      </div>
    </PanelFloatingPopover>
  )
}
