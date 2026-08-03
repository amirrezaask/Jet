import * as Atom from "@effect-atom/atom/Atom"
import { Option } from "effect"
import type {
  PersistedSessionModal,
  PersistedSessionRoster,
} from "../session-roster-store.js"
import { readSessionRoster, writeSessionRoster } from "../session-roster-store.js"

const emptyRoster = (): PersistedSessionRoster => ({
  version: 2,
  sessions: [],
  modal: null,
})

function initialRoster(): PersistedSessionRoster {
  return typeof localStorage !== "undefined" ? readSessionRoster() : emptyRoster()
}

/** Session roster atom — persists to localStorage on write. */
export const rosterAtom: Atom.Writable<PersistedSessionRoster> = Atom.writable(
  get => Option.getOrElse(get.self(), initialRoster),
  (ctx, next: PersistedSessionRoster) => {
    writeSessionRoster(next)
    ctx.setSelf(next)
  },
)

export const terminalModalAtom: Atom.Writable<PersistedSessionModal | null> = Atom.writable(
  get => get(rosterAtom).modal,
  (ctx, modal: PersistedSessionModal | null) => {
    const current = ctx.get(rosterAtom)
    ctx.set(rosterAtom, { ...current, modal })
  },
)

export const openTerminalTabIdAtom: Atom.Writable<string | null> = Atom.writable(
  get => get(rosterAtom).modal?.tabId ?? null,
  (ctx, tabId: string | null) => {
    const current = ctx.get(rosterAtom)
    const modal: PersistedSessionModal | null = tabId
      ? { tabId, sessionMode: current.modal?.sessionMode ?? "terminal" }
      : null
    ctx.set(rosterAtom, { ...current, modal })
  },
)

export type NotificationCenterState = {
  unreadCount: number
  lastEventAt: string | null
}

export const notificationCenterAtom = Atom.make<NotificationCenterState>({
  unreadCount: 0,
  lastEventAt: null,
})

export function replaceRoster(
  set: <A>(atom: Atom.Writable<A>, value: A) => void,
  roster: PersistedSessionRoster,
): void {
  set(rosterAtom, roster)
}
