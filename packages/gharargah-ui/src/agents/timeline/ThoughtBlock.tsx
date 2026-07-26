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
      className="text-sm"
      data-gharargah-thought=""
      data-gharargah-thought-text={props.text}
    >
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-auto w-full justify-start gap-1.5 px-1 py-1 text-agent-feed-muted hover:text-agent-feed-primary"
        >
          <ChevronRight className={open ? "size-3 rotate-90" : "size-3"} />
          <Brain className="size-3.5 opacity-70" />
          Thought
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="overflow-visible data-[state=closed]:hidden">
        <p className="whitespace-pre-wrap px-1 pb-2 ps-6 text-sm leading-relaxed text-agent-feed-muted">
          {props.text}
        </p>
      </CollapsibleContent>
    </Collapsible>
  )
}
