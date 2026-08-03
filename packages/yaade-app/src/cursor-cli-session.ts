import type { JetElectronTerminal } from "@yaade/workspace"

const UUID_RE =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Mint a Cursor Agent chat id via `cursor-agent create-chat`.
 *
 * Prefer live hooks (`sessionStart` → native session id) for new sessions —
 * open interactive PTY immediately and capture id asynchronously.
 * Keep this helper for tests / manual recovery when hooks are unavailable.
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
    const id = finalSnap?.output.match(UUID_RE)?.[0] ?? null
    if (!id) {
      console.warn(
        "[yaade] cursor-agent create-chat timed out or emitted no chat id",
      )
    }
    return id
  } catch (err) {
    console.warn("[yaade] cursor-agent create-chat failed", err)
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
