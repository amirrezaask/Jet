import type { Page } from "@playwright/test"

/** Problems list tab uses a stable well-known id. */
export const PROBLEMS_PANEL = '[data-jet-list-panel="jet:problems"]'

/** Search (and other ephemeral list tabs) use allocListId() — prefix match. */
export const SEARCH_LIST_PANEL = '[data-jet-list-panel^="list-"]'

export function searchListItems(panelSel = SEARCH_LIST_PANEL): string {
  return `${panelSel} [data-jet-list-item]`
}

export function problemsListItems(): string {
  return `${PROBLEMS_PANEL} [data-jet-list-item]`
}

export async function waitForSearchListPanel(page: Page): Promise<string> {
  const handle = page.locator(SEARCH_LIST_PANEL).first()
  await handle.waitFor({ state: "visible", timeout: 15_000 })
  const id = await handle.getAttribute("data-jet-list-panel")
  if (!id) throw new Error("search list panel missing data-jet-list-panel")
  return id
}
