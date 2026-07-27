const LANGUAGE_ALIASES: Record<string, string> = {
  tsx: "typescript",
  jsx: "javascript",
  mts: "typescript",
  cts: "typescript",
  mjs: "javascript",
  cjs: "javascript",
  plaintext: "plaintext",
  text: "plaintext",
  md: "markdown",
  yml: "yaml",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  rs: "rust",
  py: "python",
  rb: "ruby",
  cs: "csharp",
  cpp: "cpp",
  hpp: "cpp",
  h: "cpp",
  kt: "kotlin",
  swift: "swift",
  sql: "sql",
  dockerfile: "dockerfile",
  toml: "ini",
}

/** Map Gharargah language ids to Monaco editor language ids. */
export function monacoLanguageId(languageId: string): string {
  const normalized = languageId.trim().toLowerCase()
  if (!normalized) return "plaintext"
  return LANGUAGE_ALIASES[normalized] ?? normalized
}

/** Skip expensive editor features for very large buffers. */
export function isLargeFile(content: string): boolean {
  if (content.length > 4 * 1024 * 1024) return true
  let lines = 0
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 10 && ++lines > 200_000) return true
  }
  return false
}
