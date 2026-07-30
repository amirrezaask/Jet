import type { JetElectronTerminal } from "@gharargah/workspace"

const UUID_RE =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Mint a Cursor Agent chat id via `cursor-agent create-chat`.
 *
 * Cursor has no session-scoped notify hook; the interactive TUI also does not
 * reliably print `session_id`. Pre-minting lets ADE launch with `--resume=<id>`
 * from the first spawn so refresh can restore the same chat.
 */
export async function mintCursorAgentChatId(
  cwdRootUri: string,
  terminalApi: JetElectronTerminal,
  timeoutMs = 15_000,
): Promise<string | null> {
  let ptyId: string | null = null
  try {
    const created = await terminalApi.create(cwdRootUri, {
      command: "cursor-agent",
      args: ["create-chat"],
      cols: 40,
      rows: 8,
    })
    ptyId = created.id
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const snap = await terminalApi.attach(ptyId)
      if (!snap) return null
      const id = snap.output.match(UUID_RE)?.[0] ?? null
      if (snap.status === "exited") return id
      if (id) {
        // create-chat prints then exits — give it a moment to settle.
        await sleep(40)
        const again = await terminalApi.attach(ptyId)
        if (!again || again.status === "exited") return id
      }
      await sleep(50)
    }
    const finalSnap = await terminalApi.attach(ptyId)
    return finalSnap?.output.match(UUID_RE)?.[0] ?? null
  } catch {
    return null
  } finally {
    if (ptyId) {
      try {
        await terminalApi.dispose(ptyId)
      } catch {
        /* host may already be gone */
      }
    }
  }
}
