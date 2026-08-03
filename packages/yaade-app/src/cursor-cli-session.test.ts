import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { JetElectronTerminal } from "@yaade/workspace"
import { mintCursorAgentChatId } from "./cursor-cli-session.js"

describe("mintCursorAgentChatId", () => {
  it("reads uuid from create-chat PTY output and disposes", async () => {
    const chatId = "aaaaaaaa-1111-4111-8111-bbbbbbbbbbbb"
    let disposed = false
    const terminal: Pick<
      JetElectronTerminal,
      "create" | "attach" | "dispose"
    > = {
      create: async () => ({ id: "pty-mint" }),
      attach: async () => ({
        id: "pty-mint",
        output: `${chatId}\n`,
        lastSequence: 1,
        status: "exited",
        exitCode: 0,
      }),
      dispose: async () => {
        disposed = true
      },
    }

    const minted = await mintCursorAgentChatId(
      "file:///tmp/proj",
      terminal as JetElectronTerminal,
    )
    assert.equal(minted, chatId)
    assert.equal(disposed, true)
  })

  it("returns null when create-chat yields no id", async () => {
    const terminal: Pick<
      JetElectronTerminal,
      "create" | "attach" | "dispose"
    > = {
      create: async () => ({ id: "pty-empty" }),
      attach: async () => ({
        id: "pty-empty",
        output: "error: not logged in\n",
        lastSequence: 1,
        status: "exited",
        exitCode: 1,
      }),
      dispose: async () => {},
    }
    const minted = await mintCursorAgentChatId(
      "file:///tmp/proj",
      terminal as JetElectronTerminal,
      200,
    )
    assert.equal(minted, null)
  })
})
