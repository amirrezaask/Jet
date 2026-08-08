import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { randomUUID } from "node:crypto"
import {
  FileChangedError,
  PayloadTooLargeError,
  type TextFileReadResult,
  type TextFileWriteOptions,
  type TextFileWriteResult,
} from "@yaade/rpc"
import { pathToUri, uriToPath } from "./paths.js"

export { uriToPath, pathToUri }

/** Reject whole-file reads above this size (editor / Mission Control). */
export const MAX_READ_BYTES = 16 * 1024 * 1024
/** Cap write / temp-drop payloads (aligns with host HTTP JSON body 2 MiB). */
export const MAX_WRITE_BYTES = 2 * 1024 * 1024
/** Dedicated versioned text-file reads and writes use a raw HTTP body. */
export const MAX_TEXT_FILE_BYTES = 16 * 1024 * 1024

const textFileWriteLocks = new Map<string, Promise<void>>()

export type NodeHostDirEntry = {
  uri: string
  name: string
  isDirectory: boolean
}

export type NodeHostStat = {
  uri: string
  isDirectory: boolean
  size: number
}

export async function readFile(uri: string): Promise<string> {
  const p = uriToPath(uri)
  const fileStat = await fs.stat(p)
  if (fileStat.isDirectory()) {
    throw new Error(`not a file: ${p}`)
  }
  if (fileStat.size > MAX_READ_BYTES) {
    throw new Error(
      `file too large: ${fileStat.size} bytes (max ${MAX_READ_BYTES})`,
    )
  }
  return fs.readFile(p, "utf8")
}

export async function writeFile(uri: string, content: string): Promise<void> {
  const byteLength = Buffer.byteLength(content, "utf8")
  if (byteLength > MAX_WRITE_BYTES) {
    throw new Error(
      `write too large: ${byteLength} bytes (max ${MAX_WRITE_BYTES})`,
    )
  }
  const p = uriToPath(uri)
  await fs.mkdir(path.dirname(p), { recursive: true })
  await fs.writeFile(p, content, "utf8")
}

function nodeErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined
  }
  return typeof error.code === "string" ? error.code : undefined
}

function textFilePath(uri: string): string {
  if (!uri.startsWith("file://")) throw new Error("text file URI must use file://")
  const filePath = uriToPath(uri)
  if (!path.isAbsolute(filePath)) throw new Error("text file URI must be absolute")
  return filePath
}

function textFileVersion(stat: {
  readonly mtimeNs: bigint
  readonly ctimeNs: bigint
  readonly size: bigint
  readonly ino: bigint
}): string {
  return `${stat.mtimeNs}:${stat.ctimeNs}:${stat.size}:${stat.ino}`
}

async function currentTextFileVersion(filePath: string): Promise<string> {
  try {
    const fileStat = await fs.stat(filePath, { bigint: true })
    if (fileStat.isDirectory()) return "directory"
    return textFileVersion(fileStat)
  } catch (error) {
    if (nodeErrorCode(error) === "ENOENT") return "missing"
    throw error
  }
}

function validateTextFileWriteOptions(options: TextFileWriteOptions): void {
  const hasExpectedVersion =
    "expectedVersion" in options && typeof options.expectedVersion === "string"
  const isCreate = "create" in options && options.create === true
  if (hasExpectedVersion === isCreate) {
    throw new Error("text file write requires exactly one of expectedVersion or create")
  }
}

/** Read one UTF-8 document and return the opaque disk version used for save preflights. */
export async function readTextFile(uri: string): Promise<TextFileReadResult> {
  const filePath = textFilePath(uri)
  const handle = await fs.open(filePath, "r")
  try {
    const fileStat = await handle.stat({ bigint: true })
    if (fileStat.isDirectory()) throw new Error(`not a file: ${filePath}`)
    if (fileStat.size > BigInt(MAX_TEXT_FILE_BYTES)) {
      throw new PayloadTooLargeError({
        message: `file too large: ${fileStat.size} bytes (max ${MAX_TEXT_FILE_BYTES})`,
      })
    }
    const content = await handle.readFile({ encoding: "utf8" })
    return {
      content,
      version: textFileVersion(fileStat),
      size: Number(fileStat.size),
    }
  } finally {
    await handle.close()
  }
}

async function syncDirectory(directoryPath: string): Promise<void> {
  try {
    const handle = await fs.open(directoryPath, "r")
    try {
      await handle.sync()
    } finally {
      await handle.close()
    }
  } catch (error) {
    // Windows and some network filesystems do not support opening/fsyncing a
    // directory. The temporary file itself was already flushed before rename.
    if (["EINVAL", "EISDIR", "ENOTSUP", "EPERM"].includes(nodeErrorCode(error) ?? "")) {
      return
    }
    throw error
  }
}

async function acquireTextFileWriteLock(filePath: string): Promise<() => void> {
  const previous = textFileWriteLocks.get(filePath) ?? Promise.resolve()
  let releaseCurrent = () => {}
  const current = new Promise<void>(resolve => {
    releaseCurrent = resolve
  })
  const tail = previous.then(() => current)
  textFileWriteLocks.set(filePath, tail)
  await previous
  return () => {
    releaseCurrent()
    if (textFileWriteLocks.get(filePath) === tail) {
      textFileWriteLocks.delete(filePath)
    }
  }
}

/**
 * Flush a same-directory temporary file, validate the optimistic version, then
 * publish it atomically. Create uses a hard link so an existing target is never
 * replaced; versioned writes use rename after the final disk-version preflight.
 */
export async function writeTextFile(
  uri: string,
  content: string,
  options: TextFileWriteOptions,
): Promise<TextFileWriteResult> {
  validateTextFileWriteOptions(options)
  const size = Buffer.byteLength(content, "utf8")
  if (size > MAX_TEXT_FILE_BYTES) {
    throw new PayloadTooLargeError({
      message: `write too large: ${size} bytes (max ${MAX_TEXT_FILE_BYTES})`,
    })
  }

  const filePath = textFilePath(uri)
  const releaseWriteLock = await acquireTextFileWriteLock(filePath)
  const directoryPath = path.dirname(filePath)
  const temporaryPath = path.join(
    directoryPath,
    `.${path.basename(filePath)}.yaade-write-${randomUUID()}.tmp`,
  )
  try {
    await fs.mkdir(directoryPath, { recursive: true })
    let temporaryExists = false
    let mode: number | undefined
    try {
      try {
        const existing = await fs.stat(filePath)
        if (!existing.isDirectory()) mode = existing.mode
      } catch (error) {
        if (nodeErrorCode(error) !== "ENOENT") throw error
      }

      const handle = await fs.open(temporaryPath, "wx", mode)
      temporaryExists = true
      try {
        await handle.writeFile(content, "utf8")
        await handle.sync()
      } finally {
        await handle.close()
      }

      const actualVersion = await currentTextFileVersion(filePath)
      if ("create" in options && options.create === true) {
        if (actualVersion !== "missing") {
          throw new FileChangedError({
            message: "file already exists",
            uri,
            actualVersion,
          })
        }
        try {
          await fs.link(temporaryPath, filePath)
        } catch (error) {
          if (nodeErrorCode(error) === "EEXIST") {
            throw new FileChangedError({
              message: "file already exists",
              uri,
              actualVersion: await currentTextFileVersion(filePath),
            })
          }
          throw error
        }
        await fs.unlink(temporaryPath)
        temporaryExists = false
      } else if ("expectedVersion" in options) {
        if (actualVersion !== options.expectedVersion) {
          throw new FileChangedError({
            message: "file changed on disk",
            uri,
            expectedVersion: options.expectedVersion,
            actualVersion,
          })
        }
        await fs.rename(temporaryPath, filePath)
        temporaryExists = false
      }

      await syncDirectory(directoryPath)
      const version = await currentTextFileVersion(filePath)
      return { version, size }
    } finally {
      if (temporaryExists) {
        await fs.unlink(temporaryPath).catch(error => {
          if (nodeErrorCode(error) !== "ENOENT") throw error
        })
      }
    }
  } finally {
    releaseWriteLock()
  }
}

/** Persist a browser File blob (base64) under the OS temp dir; return absolute path. */
export async function writeTempDrop(name: string, contentBase64: string): Promise<string> {
  // Rough pre-check before allocating the decoded buffer (base64 expands ~4/3).
  if (contentBase64.length > MAX_WRITE_BYTES * 2) {
    throw new Error(`temp drop too large (max ${MAX_WRITE_BYTES} decoded bytes)`)
  }
  const bytes = Buffer.from(contentBase64, "base64")
  if (bytes.byteLength > MAX_WRITE_BYTES) {
    throw new Error(
      `temp drop too large: ${bytes.byteLength} bytes (max ${MAX_WRITE_BYTES})`,
    )
  }
  const dir = path.join(os.tmpdir(), "yaade-drops")
  await fs.mkdir(dir, { recursive: true })
  const safe = path
    .basename(name || "drop.bin")
    .replace(/[^a-zA-Z0-9._-]/g, "_") || "drop.bin"
  const out = path.join(dir, `${randomUUID()}-${safe}`)
  await fs.writeFile(out, bytes)
  return out
}

export async function readDir(uri: string): Promise<NodeHostDirEntry[]> {
  const dirPath = uriToPath(uri)
  const entries = await fs.readdir(dirPath, { withFileTypes: true })
  return entries.map(entry => ({
    uri: pathToUri(path.join(dirPath, entry.name)),
    name: entry.name,
    isDirectory: entry.isDirectory(),
  }))
}

export async function stat(uri: string): Promise<NodeHostStat> {
  const p = uriToPath(uri)
  const fileStat = await fs.stat(p)
  return {
    uri,
    isDirectory: fileStat.isDirectory(),
    size: fileStat.size,
  }
}

/** Non-throwing existence probe for expected misses (for example LSP root markers). */
export async function exists(uri: string): Promise<boolean> {
  try {
    await fs.stat(uriToPath(uri))
    return true
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error.code === "ENOENT" || error.code === "ENOTDIR")
    ) {
      return false
    }
    throw error
  }
}
