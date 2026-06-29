import { Annotation } from "@codemirror/state"

/** Marks editor transactions that reload content from disk (must not mark dirty). */
export const jetReloadAnnotation = Annotation.define<boolean>()
