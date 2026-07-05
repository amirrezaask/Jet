import { useEffect, useRef, useState } from "react"
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
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from "@/components/ui/drawer.js"
import { Input } from "@/components/ui/input.js"
import { Label } from "@/components/ui/label.js"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group.js"

export function FindReplaceDrawer() {
  const [state, setState] = useState<JetSearchState | null>(null)
  const findRef = useRef<HTMLInputElement>(null)

  useEffect(() => subscribeSearch(setState), [])

  const view = state?.view ?? null
  const open = state?.open ?? false
  const mode = state?.mode ?? "find"

  const query = view && state ? getSearchQuery(view.state) : null
  void state?.version

  useEffect(() => {
    if (open) findRef.current?.focus()
  }, [open, mode])

  const toggleValues = [
    ...(query?.caseSensitive ? ["case"] : []),
    ...(query?.regexp ? ["regex"] : []),
    ...(query?.wholeWord ? ["word"] : []),
  ]

  return (
    <Drawer
      open={open}
      direction="top"
      modal={false}
      onOpenChange={next => {
        if (!next && view) closeJetSearch(view)
      }}
    >
      <DrawerContent className="mx-auto max-w-3xl px-4 pb-4 pt-2 [&>div:first-child]:hidden">
        <DrawerTitle className="sr-only">
          {mode === "replace" ? "Find and replace" : "Find"}
        </DrawerTitle>
        <DrawerDescription className="sr-only">Search in the current buffer</DrawerDescription>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex min-w-[12rem] flex-1 flex-col gap-1">
            <Label htmlFor="jet-find-input" className="text-xs text-muted-foreground">
              Find
            </Label>
            <Input
              id="jet-find-input"
              ref={findRef}
              value={query?.search ?? ""}
              onChange={e => {
                if (!view) return
                patchJetSearchQuery(view, { search: e.target.value })
              }}
              onKeyDown={e => {
                if (!view) return
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
          </div>
          {mode === "replace" ? (
            <div className="flex min-w-[12rem] flex-1 flex-col gap-1">
              <Label htmlFor="jet-replace-input" className="text-xs text-muted-foreground">
                Replace
              </Label>
              <Input
                id="jet-replace-input"
                value={query?.replace ?? ""}
                onChange={e => {
                  if (!view) return
                  patchJetSearchQuery(view, { replace: e.target.value })
                }}
                spellCheck={false}
                autoComplete="off"
              />
            </div>
          ) : null}
          <ToggleGroup
            type="multiple"
            variant="outline"
            size="sm"
            className="shrink-0"
            value={toggleValues}
            onValueChange={values => {
              if (!view) return
              patchJetSearchQuery(view, {
                caseSensitive: values.includes("case"),
                regexp: values.includes("regex"),
                wholeWord: values.includes("word"),
              })
            }}
          >
            <ToggleGroupItem value="case" className="h-8 px-2 text-xs">
              Case
            </ToggleGroupItem>
            <ToggleGroupItem value="regex" className="h-8 px-2 text-xs">
              Regex
            </ToggleGroupItem>
            <ToggleGroupItem value="word" className="h-8 px-2 text-xs">
              Word
            </ToggleGroupItem>
          </ToggleGroup>
          <div className="flex shrink-0 flex-wrap items-center gap-1">
            <Button type="button" variant="secondary" size="sm" onClick={() => view && findPrevious(view)}>
              Previous
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={() => view && findNext(view)}>
              Next
            </Button>
            {mode === "replace" ? (
              <>
                <Button type="button" variant="secondary" size="sm" onClick={() => view && replaceNext(view)}>
                  Replace
                </Button>
                <Button type="button" variant="secondary" size="sm" onClick={() => view && replaceAll(view)}>
                  All
                </Button>
              </>
            ) : null}
            <Button type="button" variant="ghost" size="sm" onClick={() => view && closeJetSearch(view)}>
              Close
            </Button>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  )
}
