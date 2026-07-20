import { LanguageDescription } from "@codemirror/language"
import type { Extension } from "@codemirror/state"

const cache = new Map<string, Extension>()

const markdownCodeLanguages = [
  LanguageDescription.of({
    name: "javascript",
    load: () => import("@codemirror/lang-javascript").then(m => m.javascript()),
  }),
  LanguageDescription.of({
    name: "typescript",
    load: () => import("@codemirror/lang-javascript").then(m => m.javascript({ typescript: true })),
  }),
  LanguageDescription.of({
    name: "json",
    load: () => import("@codemirror/lang-json").then(m => m.json()),
  }),
  LanguageDescription.of({
    name: "css",
    load: () => import("@codemirror/lang-css").then(m => m.css()),
  }),
  LanguageDescription.of({
    name: "html",
    load: () => import("@codemirror/lang-html").then(m => m.html()),
  }),
  LanguageDescription.of({
    name: "rust",
    load: () => import("@codemirror/lang-rust").then(m => m.rust()),
  }),
  LanguageDescription.of({
    name: "go",
    load: () => import("@codemirror/lang-go").then(m => m.go()),
  }),
]

export async function loadLanguage(languageId: string): Promise<Extension> {
  const cached = cache.get(languageId)
  if (cached) return cached

  let ext: Extension
  switch (languageId) {
    case "typescript":
    case "mts":
    case "cts": {
      const mod = await import("@codemirror/lang-javascript")
      ext = mod.javascript({ typescript: true })
      break
    }
    case "tsx": {
      const mod = await import("@codemirror/lang-javascript")
      ext = [mod.javascript({ typescript: true, jsx: true }), mod.autoCloseTags]
      break
    }
    case "javascript":
    case "mjs":
    case "cjs": {
      const mod = await import("@codemirror/lang-javascript")
      ext = mod.javascript()
      break
    }
    case "jsx": {
      const mod = await import("@codemirror/lang-javascript")
      ext = [mod.javascript({ jsx: true }), mod.autoCloseTags]
      break
    }
    case "rust": {
      const mod = await import("@codemirror/lang-rust")
      ext = mod.rust()
      break
    }
    case "go": {
      const mod = await import("@codemirror/lang-go")
      ext = mod.go()
      break
    }
    case "json": {
      const mod = await import("@codemirror/lang-json")
      ext = mod.json()
      break
    }
    case "markdown": {
      const mod = await import("@codemirror/lang-markdown")
      ext = mod.markdown({ codeLanguages: markdownCodeLanguages })
      break
    }
    case "css": {
      const mod = await import("@codemirror/lang-css")
      ext = mod.css()
      break
    }
    case "html": {
      const mod = await import("@codemirror/lang-html")
      ext = mod.html({ autoCloseTags: true })
      break
    }
    case "plaintext":
      return []
    default:
      return []
  }
  cache.set(languageId, ext)
  return ext
}
