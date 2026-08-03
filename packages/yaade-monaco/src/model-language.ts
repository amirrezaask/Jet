import * as monaco from "monaco-editor/esm/vs/editor/editor.api.js"
import { monacoLanguageId } from "./language.js"

/** Set Monaco model language from a Yaade language id. */
export function setModelLanguage(model: monaco.editor.ITextModel, languageId: string): void {
  monaco.editor.setModelLanguage(model, monacoLanguageId(languageId))
}
