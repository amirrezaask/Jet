import { Brain, ChevronRight } from "lucide-react"
import { useState } from "react"
import { Button } from "../../components/ui/button.js"

export function ThoughtBlock(props: { text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <section
      className="rounded-lg border border-border bg-muted/30 text-sm"
      data-gharargah-thought=""
      data-gharargah-thought-text={props.text}
    >
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="w-full justify-start text-muted-foreground"
        onClick={() => setOpen(value => !value)}
        aria-expanded={open}
      >
        <ChevronRight className={open ? "size-3 rotate-90" : "size-3"} />
        <Brain className="size-3.5" />
        Thought
      </Button>
      {open ? <p className="whitespace-pre-wrap px-3 pb-3 text-muted-foreground">{props.text}</p> : null}
    </section>
  )
}
