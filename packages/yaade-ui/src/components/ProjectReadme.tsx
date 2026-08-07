import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { Button } from "./ui/button.js"
import { cn } from "../lib/utils.js"

export type ProjectReadmeProps = {
  content: string
  className?: string
  onOpenProjectFile?: (target: string) => void
}

function isExternalLink(href: string): boolean {
  return /^https?:\/\//i.test(href)
}

export function ProjectReadme({
  content,
  className,
  onOpenProjectFile,
}: ProjectReadmeProps) {
  return (
    <div
      className={cn(
        "min-w-0 text-sm leading-6 text-foreground/90",
        "[&_h1]:mb-3 [&_h1]:mt-6 [&_h1]:text-xl [&_h1]:font-semibold [&_h1]:tracking-tight",
        "[&_h2]:mb-2 [&_h2]:mt-6 [&_h2]:border-b [&_h2]:pb-2 [&_h2]:text-base [&_h2]:font-semibold",
        "[&_h3]:mb-2 [&_h3]:mt-5 [&_h3]:font-semibold",
        "[&_p]:my-3 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-5",
        "[&_li]:my-1 [&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-info [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
        "[&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:border [&_pre]:bg-muted/40 [&_pre]:p-3",
        "[&_code]:font-mono [&_code]:text-xs [&_:not(pre)>code]:rounded-sm [&_:not(pre)>code]:bg-muted [&_:not(pre)>code]:px-1",
        "[&_table]:my-3 [&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:bg-muted/40 [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-left",
        "[&_td]:border [&_td]:px-2 [&_td]:py-1.5 [&_hr]:my-5 [&_hr]:border-border",
        className,
      )}
    >
      <Markdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          a({ href = "", children }) {
            if (isExternalLink(href)) {
              return (
                <a
                  href={href}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="font-medium text-primary underline underline-offset-4"
                >
                  {children}
                </a>
              )
            }
            if (href.startsWith("#")) {
              return (
                <a
                  href={href}
                  className="font-medium text-primary underline underline-offset-4"
                >
                  {children}
                </a>
              )
            }
            return (
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto p-0 align-baseline"
                onClick={() => onOpenProjectFile?.(href)}
              >
                {children}
              </Button>
            )
          },
          img({ alt = "" }) {
            return (
              <span className="my-3 block rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                Image omitted{alt ? `: ${alt}` : ""}
              </span>
            )
          },
        }}
      >
        {content}
      </Markdown>
    </div>
  )
}
