import type { Extension } from "@codemirror/state"
import type { LanguageSupport } from "@codemirror/language"

const cache = new Map<string, LanguageSupport>()

export async function loadLanguage(languageId: string): Promise<Extension> {
  if (cache.has(languageId)) return cache.get(languageId)!

  let lang: LanguageSupport
  switch (languageId) {
    case "typescript":
    case "javascript": {
      const mod = await import("@codemirror/lang-javascript")
      lang = mod.javascript({ typescript: languageId === "typescript" })
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
      lang = mod.markdown()
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
    default: {
      const mod = await import("@codemirror/lang-javascript")
      lang = mod.javascript()
    }
  }
  cache.set(languageId, lang)
  return lang
}
