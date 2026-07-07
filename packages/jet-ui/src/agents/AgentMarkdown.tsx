import type { ReactNode } from "react"
import ReactMarkdown from "react-markdown"
import rehypeRaw from "rehype-raw"
import rehypeSanitize, { defaultSchema } from "rehype-sanitize"
import remarkBreaks from "remark-breaks"
import remarkGfm from "remark-gfm"
import type { Components } from "react-markdown"
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
}

function extractLanguage(className: string | undefined): string {
  const match = className?.match(/language-([^\s]+)/)
  return match?.[1] ?? "text"
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

const markdownComponents: Components = {
  code(props) {
    const { className, children } = props
    const code = String(children).replace(/\n$/, "")
    const language = extractLanguage(className)
    return (
      <code
        className={
          className ??
          "rounded bg-muted px-1.5 py-0.5 font-mono text-[0.9em] text-foreground"
        }
      >
        {code}
      </code>
    )
  },
}

export function AgentMarkdown({ text, theme }: AgentMarkdownProps) {
  const components: Components = {
    ...markdownComponents,
    pre(props) {
      const codeChild = Array.isArray(props.children) ? props.children[0] : props.children
      const element = codeChild as {
        props?: {
          className?: string
          children?: ReactNode
        }
      }
      const code = typeof element?.props?.children === "string"
        ? element.props.children
        : Array.isArray(element?.props?.children)
          ? element.props.children.join("")
          : String(element?.props?.children ?? "")
      const language = extractLanguage(element?.props?.className)
      const patchView = maybeRenderPatch(code, language, theme)
      if (patchView) return patchView
      return (
        <pre className="mt-3 overflow-x-auto rounded-xl border border-input bg-card p-3 text-xs leading-5 text-foreground">
          {props.children}
        </pre>
      )
    },
    a(props) {
      return (
        <a
          {...props}
          className="text-blue-400 underline underline-offset-4 hover:text-blue-300"
          rel="noreferrer"
          target="_blank"
        />
      )
    },
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

  return (
    <div className="prose prose-sm max-w-none text-foreground prose-code:before:content-none prose-code:after:content-none prose-pre:p-0">
      <ReactMarkdown
        components={components}
        rehypePlugins={[
          rehypeRaw,
          [rehypeSanitize, AGENT_MARKDOWN_SANITIZE_SCHEMA],
        ]}
        remarkPlugins={[remarkBreaks, remarkGfm]}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}
