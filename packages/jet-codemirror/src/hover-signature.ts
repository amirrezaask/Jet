type MarkedString = string | { language?: string; value: string }
type MarkupContent = { kind: "plaintext" | "markdown"; value: string }

export type HoverContents =
  | string
  | MarkupContent
  | MarkedString
  | MarkedString[]

export function hoverContentsToPlain(contents: HoverContents): string {
  if (typeof contents === "string") return contents
  if (Array.isArray(contents)) {
    return contents
      .map(part => (typeof part === "string" ? part : part.value))
      .join("\n\n")
  }
  if ("kind" in contents) return contents.value
  return contents.value
}

export function plainHoverSnippet(text: string): string {
  const line = text
    .split("\n")
    .map(l => l.trim())
    .find(l => l.length > 0)
  return line ?? ""
}

export function extractHoverSignature(text: string): string | null {
  const fenceStart = text.indexOf("```")
  if (fenceStart >= 0) {
    const afterFence = text.slice(fenceStart + 3)
    const bodyStart = afterFence.indexOf("\n")
    const body = bodyStart >= 0 ? afterFence.slice(bodyStart + 1) : afterFence
    const fenceEnd = body.indexOf("```")
    const sig = body
      .slice(0, fenceEnd >= 0 ? fenceEnd : body.length)
      .split(/\s+/)
      .filter(Boolean)
      .join(" ")
    if (sig.length > 0) return sig
  }

  const paragraphs = text
    .split("\n\n")
    .map(p => p.trim())
    .filter(p => p.length > 0)

  const sigParas = paragraphs.length >= 2 ? paragraphs.slice(1) : paragraphs
  const sigLines: string[] = []
  for (const para of sigParas) {
    const first = para[0]
    const isProse = first != null && first === first.toUpperCase() && first !== first.toLowerCase()
    if (isProse) break
    sigLines.push(para)
  }

  const collapsed = sigLines
    .flatMap(p => p.split(/\s+/))
    .filter(Boolean)
    .join(" ")

  return collapsed.length > 0 ? collapsed : null
}
