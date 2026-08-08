import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { resolveDirtyBufferClose } from "./dirty-buffer-close.js"

describe("resolveDirtyBufferClose", () => {
  it("saves every unique dirty buffer before allowing closure", async () => {
    const saved: string[] = []
    const closed = await resolveDirtyBufferClose(["a", "b", "a"], {
      choose: async () => "save",
      save: async uri => {
        saved.push(uri)
      },
      discard: async () => {},
    })
    assert.equal(closed, true)
    assert.deepEqual(saved, ["a", "b"])
  })

  it("aborts on cancel or the first failed save", async () => {
    assert.equal(
      await resolveDirtyBufferClose(["a"], {
        choose: async () => "cancel",
        save: async () => {},
        discard: async () => {},
      }),
      false,
    )
    const attempted: string[] = []
    assert.equal(
      await resolveDirtyBufferClose(["a", "b", "c"], {
        choose: async () => "save",
        save: async uri => {
          attempted.push(uri)
          if (uri === "b") throw new Error("disk full")
        },
        discard: async () => {},
      }),
      false,
    )
    assert.deepEqual(attempted, ["a", "b"])
  })

  it("discards all buffers only after explicit confirmation", async () => {
    const discarded: string[] = []
    assert.equal(
      await resolveDirtyBufferClose(["a", "b"], {
        choose: async () => "discard",
        save: async () => {},
        discard: async uri => {
          discarded.push(uri)
        },
      }),
      true,
    )
    assert.deepEqual(discarded, ["a", "b"])
  })
})
