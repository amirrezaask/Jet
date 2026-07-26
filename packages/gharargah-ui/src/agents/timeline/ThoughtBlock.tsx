import { useRecyclingState } from "@legendapp/list/react"
import { Brain, ChevronRight } from "lucide-react"
import { Button } from "../../components/ui/button.js"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../../components/ui/collapsible.js"
import { useTimelineItemLayoutSync } from "./useTimelineItemLayoutSync.js"

export function ThoughtBlock(props: { text: string }) {
  const [open, setOpen] = useRecyclingState(false)
  // open toggles already call triggerLayout via useRecyclingState.
  useTimelineItemLayoutSync([props.text])

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="rounded-lg border border-border bg-muted/30 text-sm"
      data-gharargah-thought=""
      data-gharargah-thought-text={props.text}
    >
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-full justify-start text-muted-foreground"
        >
          <ChevronRight className={open ? "size-3 rotate-90" : "size-3"} />
          <Brain className="size-3.5" />
          Thought
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="overflow-visible data-[state=closed]:hidden">
        <p className="whitespace-pre-wrap px-3 pb-3 text-muted-foreground">{props.text}</p>
      </CollapsibleContent>
    </Collapsible>
  )
}
