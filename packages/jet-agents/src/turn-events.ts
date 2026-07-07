export type TurnTextDeltaEvent = {
  kind: "text-delta"
  assistantMessageId: string
  delta: string
}

export type TurnTextSnapshotEvent = {
  kind: "text-snapshot"
  assistantMessageId: string
  text: string
}

export type TurnCompleteEvent = {
  kind: "turn-complete"
}

export type TurnErrorEvent = {
  kind: "turn-error"
  message: string
}

export type TurnEvent =
  | TurnTextDeltaEvent
  | TurnTextSnapshotEvent
  | TurnCompleteEvent
  | TurnErrorEvent
