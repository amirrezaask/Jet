import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, it } from "node:test"
import { pathToFileURL } from "node:url"
import {
  exists,
  MAX_READ_BYTES,
  MAX_WRITE_BYTES,
  readFile,
  writeFile,
  writeTempDrop,
} from "./fs.js"

describe("fs size gates", () => {
  it("rejects reads above MAX_READ_BYTES", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ghar-fs-"))
    const path = join(dir, "big.bin")
    // Sparse-ish: write a file just over the limit without filling RAM twice.
    const over = MAX_READ_BYTES + 1
    writeFileSync(path, Buffer.alloc(over, 0x61))
    const uri = pathToFileURL(path).href
    await assert.rejects(() => readFile(uri), /file too large/)
    rmSync(dir, { recursive: true, force: true })
  })

  it("reads files within the limit", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ghar-fs-"))
    const path = join(dir, "ok.txt")
    writeFileSync(path, "hello", "utf8")
    const text = await readFile(pathToFileURL(path).href)
    assert.equal(text, "hello")
    rmSync(dir, { recursive: true, force: true })
  })

  it("probes missing files without rejecting", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ghar-fs-"))
    const present = join(dir, "present.txt")
    writeFileSync(present, "hello", "utf8")
    assert.equal(await exists(pathToFileURL(present).href), true)
    assert.equal(await exists(pathToFileURL(join(dir, "missing.txt")).href), false)
    rmSync(dir, { recursive: true, force: true })
  })

  it("rejects oversized writeFile and writeTempDrop", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ghar-fs-"))
    const path = join(dir, "out.txt")
    const big = "x".repeat(MAX_WRITE_BYTES + 1)
    await assert.rejects(
      () => writeFile(pathToFileURL(path).href, big),
      /write too large/,
    )
    const b64 = Buffer.alloc(MAX_WRITE_BYTES + 1, 0x62).toString("base64")
    await assert.rejects(() => writeTempDrop("drop.bin", b64), /temp drop too large/)
    rmSync(dir, { recursive: true, force: true })
  })
})
