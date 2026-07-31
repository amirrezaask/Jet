import { memo, useMemo, type ReactNode } from "react"
import ReactMarkdown from "react-markdown"
import rehypeRaw from "rehype-raw"
import rehypeSanitize, { defaultSchema } from "rehype-sanitize"
import remarkBreaks from "remark-breaks"
import remarkGfm from "remark-gfm"
import type { Components } from "react-markdown"
import type { AgentFileReference } from "@gharargah/agents"
import { fileUriToPath } from "@gharargah/shared"
import { AgentPatchView } from "./AgentPatchView.js"

const AGENT_MARKDOWN_SANITIZE_SCHEMA = {
  ...defaultSchema,
  protocols: {
    ...defaultSchema.protocols,
    href: [...(defaultSchema.protocols?.href ?? []), "file"],
  },
} satisfies Parameters<typeof rehypeSanitize>[0]

type AgentMarkdownProps = {
  text: string
  theme: "light" | "dark"
  onOpenFile?: (ref: AgentFileReference) => void
}

function extractLanguage(className: string | undefined): string {
  const match = className?.match(/language-([^\s]+)/)
  return match?.[1] ?? "text"
}

function parseFileHref(href: string): AgentFileReference | null {
  if (!href.startsWith("file://")) return null
  const withoutScheme = href.slice("file://".length)
  const hashIndex = withoutScheme.indexOf("#")
  const pathPart = hashIndex >= 0 ? withoutScheme.slice(0, hashIndex) : withoutScheme
  const fragment = hashIndex >= 0 ? withoutScheme.slice(hashIndex + 1) : ""
  const path = fileUriToPath(`file://${pathPart}`)
  const ref: AgentFileReference = { path }
  const lineMatch = fragment.match(/^L(\d+)(?:C(\d+))?$/i)
  if (lineMatch) {
    ref.line = Number.parseInt(lineMatch[1] ?? "0", 10)
    if (lineMatch[2]) ref.column = Number.parseInt(lineMatch[2], 10)
  }
  return ref
}

function maybeRenderPatch(code: string, language: string, theme: "light" | "dark"): ReactNode | null {
  if (language !== "diff" && !code.includes("\n@@ ") && !code.includes("\ndiff --git ")) {
    return null
  }
  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-input bg-card">
      <AgentPatchView patch={code} theme={theme} />
    </div>
  )
}

const markdownCodeComponent: Components["code"] = props => {
  const { className, children } = props
  const code = String(children).replace(/\n$/, "")
  return (
    <code
      className={
        className ??
        "rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[0.9em] text-agent-feed-primary"
      }
    >
      {code}
    </code>
  )
}

const staticMarkdownComponents: Components = {
  code: markdownCodeComponent,
  table(props) {
    return (
      <div className="mt-3 overflow-x-auto rounded-xl border border-input">
        <table {...props} className="min-w-full text-sm" />
      </div>
    )
  },
  th(props) {
    return <th {...props} className="border-b border-input bg-muted/50 px-3 py-2 text-left" />
  },
  td(props) {
    return <td {...props} className="border-b border-input px-3 py-2 align-top" />
  },
}

function createMarkdownComponents(input: {
  theme: "light" | "dark"
  onOpenFile?: (ref: AgentFileReference) => void
}): Components {
  return {
    ...staticMarkdownComponents,
    pre(props) {
      const codeChild = Array.isArray(props.children) ? props.children[0] : props.children
      const element = codeChild as {
        props?: {
          className?: string
          children?: ReactNode
        }
      }
      const code =
        typeof element?.props?.children === "string"
          ? element.props.children
          : Array.isArray(element?.props?.children)
            ? element.props.children.join("")
            : String(element?.props?.children ?? "")
      const language = extractLanguage(element?.props?.className)
      const patchView = maybeRenderPatch(code, language, input.theme)
      if (patchView) return patchView
      return (
        <pre className="mt-3 overflow-x-auto rounded-xl border border-input bg-card p-3 text-xs leading-5 text-foreground">
          {props.children}
        </pre>
      )
    },
    a(props) {
      const href = props.href ?? ""
      const fileRef = input.onOpenFile ? parseFileHref(href) : null
      if (fileRef && input.onOpenFile) {
        return (
          <a
            {...props}
            href="#"
            className="text-blue-400 underline underline-offset-4 hover:text-blue-300"
            onClick={event => {
              event.preventDefault()
              input.onOpenFile?.(fileRef)
            }}
          />
        )
      }
      return (
        <a
          {...props}
          className="text-blue-400 underline underline-offset-4 hover:text-blue-300"
          rel="noreferrer"
          target="_blank"
        />
      )
    },
  }
}

export const AgentMarkdown = memo(function AgentMarkdown({
  text,
  theme,
  onOpenFile,
}: AgentMarkdownProps) {
  const components = useMemo(
    () => createMarkdownComponents({ theme, onOpenFile }),
    [theme, onOpenFile],
  )

  return (
    <div className="prose prose-sm max-w-none text-foreground prose-code:before:content-none prose-code:after:content-none prose-pre:p-0">
      <ReactMarkdown
        components={components}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, AGENT_MARKDOWN_SANITIZE_SCHEMA]]}
        remarkPlugins={[remarkBreaks, remarkGfm]}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
})
