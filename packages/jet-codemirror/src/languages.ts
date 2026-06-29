import { LanguageDescription } from "@codemirror/language"
import type { Extension } from "@codemirror/state"
import type { LanguageSupport } from "@codemirror/language"

const cache = new Map<string, LanguageSupport>()

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
]

export async function loadLanguage(languageId: string): Promise<Extension> {
  if (cache.has(languageId)) return cache.get(languageId)!

  let lang: LanguageSupport
  switch (languageId) {
    case "typescript":
    case "mts":
    case "cts": {
      const mod = await import("@codemirror/lang-javascript")
      lang = mod.javascript({ typescript: true })
      break
    }
    case "tsx": {
      const mod = await import("@codemirror/lang-javascript")
      lang = mod.javascript({ typescript: true, jsx: true })
      break
    }
    case "javascript":
    case "mjs":
    case "cjs": {
      const mod = await import("@codemirror/lang-javascript")
      lang = mod.javascript()
      break
    }
    case "jsx": {
      const mod = await import("@codemirror/lang-javascript")
      lang = mod.javascript({ jsx: true })
      break
    }
    case "rust": {
      const mod = await import("@codemirror/lang-rust")
      lang = mod.rust()
      break
    }
    case "json": {
      const mod = await import("@codemirror/lang-json")
      lang = mod.json()
      break
    }
    case "markdown": {
      const mod = await import("@codemirror/lang-markdown")
      lang = mod.markdown({ codeLanguages: markdownCodeLanguages })
      break
    }
    case "css": {
      const mod = await import("@codemirror/lang-css")
      lang = mod.css()
      break
    }
    case "html": {
      const mod = await import("@codemirror/lang-html")
      lang = mod.html()
      break
    }
    case "plaintext":
      return []
    default:
      return []
  }
  cache.set(languageId, lang)
  return lang
}
