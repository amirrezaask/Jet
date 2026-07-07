import { CheckIcon, CopyIcon } from "lucide-react"
import { memo, useCallback, useRef, useState } from "react"
import { Button } from "../../components/ui/button.js"
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip.js"
import { cn } from "../../lib/utils.js"

export const MessageCopyButton = memo(function MessageCopyButton(props: {
  text: string
  size?: "xs" | "icon-xs"
  variant?: "outline" | "ghost"
  className?: string
}) {
  const { text, size = "xs", variant = "outline", className } = props
  const [isCopied, setIsCopied] = useState(false)
  const timeoutRef = useRef<number | null>(null)

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text)
      setIsCopied(true)
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current)
      }
      timeoutRef.current = window.setTimeout(() => setIsCopied(false), 1000)
    } catch {
      // ignore clipboard failures in headless/browser tests
    }
  }, [text])

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          aria-label="Copy to clipboard"
          disabled={isCopied}
          onClick={() => void copy()}
          size={size === "icon-xs" ? "icon-xs" : "xs"}
          variant={variant}
          className={cn("text-muted-foreground hover:text-foreground", className)}
        >
          {isCopied ? (
            <CheckIcon className="size-3 text-primary" />
          ) : (
            <CopyIcon className="size-3" />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">
        <p>{isCopied ? "Copied!" : "Copy to clipboard"}</p>
      </TooltipContent>
    </Tooltip>
  )
})
