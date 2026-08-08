import { randomUUID } from "node:crypto"
import type { Stats } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"
import {
  ConflictError,
  NotFoundError,
  type TrashEntry,
} from "@yaade/rpc"
import { pathToUri, uriToPath } from "./paths.js"
import { assertAllowedPath } from "./sandbox.js"

export const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000
export const TRASH_MAX_BYTES = 1024 * 1024 * 1024

const TRASH_METADATA_VERSION = 1
const TRASH_DIRECTORY_NAME = "trash"
const TRASH_PAYLOAD_NAME = "payload"
const TRASH_METADATA_NAME = "metadata.json"

type TrashMetadata = {
  readonly version: typeof TRASH_METADATA_VERSION
  readonly id: string
  readonly originalPath: string
  readonly name: string
  readonly isDirectory: boolean
  readonly size: number
  readonly trashedAt: number
}

export type FsMutationOptions = {
  readonly dataDir: string
  readonly allowedRoots: readonly string[]
  readonly now?: () => number
  /** Test seam. Production callers use the 1 GiB default. */
  readonly trashMaxBytes?: number
  /** Test seam. Production callers use the 30-day default. */
  readonly trashRetentionMs?: number
}

export type FsMutationStat = {
  readonly uri: string
  readonly isDirectory: boolean
  readonly size: number
}

export type RestoreTrashResult = {
  readonly entry: TrashEntry
  readonly uri: string
}

export type EmptyTrashResult = {
  readonly removed: number
  readonly bytes: number
}

const trashLocks = new Map<string, Promise<void>>()

function nodeErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined
  }
  return typeof error.code === "string" ? error.code : undefined
}

function conflict(message: string): ConflictError {
  return new ConflictError({ message })
}

function notFound(resource: string): NotFoundError {
  return new NotFoundError({
    message: `not found: ${resource}`,
    resource,
  })
}

async function lstatOrNotFound(filePath: string): Promise<Stats> {
  try {
    return await fs.lstat(filePath)
  } catch (error) {
    if (nodeErrorCode(error) === "ENOENT") throw notFound(filePath)
    throw error
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.lstat(filePath)
    return true
  } catch (error) {
    if (nodeErrorCode(error) === "ENOENT") return false
    throw error
  }
}

function mutationStat(uri: string, fileStat: Stats): FsMutationStat {
  return {
    uri,
    isDirectory: fileStat.isDirectory(),
    size: fileStat.size,
  }
}

async function assertMutationPath(uri: string, options: FsMutationOptions): Promise<string> {
  const filePath = uriToPath(uri)
  return assertAllowedPath(filePath, [...options.allowedRoots])
}

function trashRoot(options: FsMutationOptions): string {
  return path.join(path.resolve(options.dataDir), TRASH_DIRECTORY_NAME)
}

function pathsOverlap(left: string, right: string): boolean {
  const a = path.resolve(left)
  const b = path.resolve(right)
  return (
    a === b ||
    a.startsWith(`${b}${path.sep}`) ||
    b.startsWith(`${a}${path.sep}`)
  )
}

function assertOutsideTrashStorage(filePath: string, options: FsMutationOptions): void {
  if (pathsOverlap(filePath, trashRoot(options))) {
    throw conflict("YAADE trash storage cannot be mutated through workspace file operations")
  }
}

async function withTrashLock<A>(
  root: string,
  operation: () => Promise<A>,
): Promise<A> {
  const previous = trashLocks.get(root) ?? Promise.resolve()
  let releaseCurrent = () => {}
  const current = new Promise<void>(resolve => {
    releaseCurrent = resolve
  })
  const tail = previous.then(() => current)
  trashLocks.set(root, tail)
  await previous
  try {
    return await operation()
  } finally {
    releaseCurrent()
    if (trashLocks.get(root) === tail) trashLocks.delete(root)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function decodeTrashMetadata(value: unknown): TrashMetadata | null {
  if (!isRecord(value)) return null
  if (
    value.version !== TRASH_METADATA_VERSION ||
    typeof value.id !== "string" ||
    typeof value.originalPath !== "string" ||
    typeof value.name !== "string" ||
    typeof value.isDirectory !== "boolean" ||
    typeof value.size !== "number" ||
    !Number.isFinite(value.size) ||
    value.size < 0 ||
    typeof value.trashedAt !== "number" ||
    !Number.isFinite(value.trashedAt)
  ) {
    return null
  }
  return {
    version: TRASH_METADATA_VERSION,
    id: value.id,
    originalPath: value.originalPath,
    name: value.name,
    isDirectory: value.isDirectory,
    size: value.size,
    trashedAt: value.trashedAt,
  }
}

function publicTrashEntry(metadata: TrashMetadata): TrashEntry {
  return {
    id: metadata.id,
    originalUri: pathToUri(metadata.originalPath),
    name: metadata.name,
    isDirectory: metadata.isDirectory,
    size: metadata.size,
    trashedAt: metadata.trashedAt,
  }
}

async function readTrashMetadata(entryDirectory: string): Promise<TrashMetadata | null> {
  try {
    const raw = await fs.readFile(path.join(entryDirectory, TRASH_METADATA_NAME), "utf8")
    return decodeTrashMetadata(JSON.parse(raw))
  } catch (error) {
    if (nodeErrorCode(error) === "ENOENT" || error instanceof SyntaxError) return null
    throw error
  }
}

async function directorySize(filePath: string): Promise<number> {
  const fileStat = await fs.lstat(filePath)
  if (!fileStat.isDirectory()) return fileStat.size
  let total = 0
  const entries = await fs.readdir(filePath, { withFileTypes: true })
  for (const entry of entries) {
    total += await directorySize(path.join(filePath, entry.name))
  }
  return total
}

async function readTrashEntries(root: string): Promise<Array<{
  readonly directory: string
  readonly metadata: TrashMetadata
}>> {
  let directoryNames: string[]
  try {
    directoryNames = await fs.readdir(root)
  } catch (error) {
    if (nodeErrorCode(error) === "ENOENT") return []
    throw error
  }
  const entries: Array<{ directory: string; metadata: TrashMetadata }> = []
  for (const directoryName of directoryNames) {
    const directory = path.join(root, directoryName)
    const directoryStat = await fs.lstat(directory)
    if (!directoryStat.isDirectory()) continue
    const metadata = await readTrashMetadata(directory)
    if (!metadata || metadata.id !== directoryName) continue
    if (!(await pathExists(path.join(directory, TRASH_PAYLOAD_NAME)))) continue
    entries.push({ directory, metadata })
  }
  return entries
}

async function purgeExpiredTrash(root: string, options: FsMutationOptions): Promise<void> {
  const cutoff = (options.now?.() ?? Date.now()) -
    (options.trashRetentionMs ?? TRASH_RETENTION_MS)
  const entries = await readTrashEntries(root)
  await Promise.all(
    entries
      .filter(entry => entry.metadata.trashedAt < cutoff)
      .map(entry => fs.rm(entry.directory, { recursive: true, force: true })),
  )
}

async function metadataAllowed(
  metadata: TrashMetadata,
  options: FsMutationOptions,
): Promise<boolean> {
  try {
    await assertAllowedPath(metadata.originalPath, [...options.allowedRoots])
    return true
  } catch {
    return false
  }
}

export async function createFile(
  uri: string,
  options: FsMutationOptions,
): Promise<FsMutationStat> {
  const filePath = await assertMutationPath(uri, options)
  assertOutsideTrashStorage(filePath, options)
  try {
    const handle = await fs.open(filePath, "wx")
    await handle.close()
  } catch (error) {
    if (nodeErrorCode(error) === "EEXIST") throw conflict(`path already exists: ${filePath}`)
    if (nodeErrorCode(error) === "ENOENT") throw notFound(path.dirname(filePath))
    throw error
  }
  return mutationStat(uri, await fs.lstat(filePath))
}

export async function createDirectory(
  uri: string,
  options: FsMutationOptions,
): Promise<FsMutationStat> {
  const directoryPath = await assertMutationPath(uri, options)
  assertOutsideTrashStorage(directoryPath, options)
  try {
    await fs.mkdir(directoryPath)
  } catch (error) {
    if (nodeErrorCode(error) === "EEXIST") {
      throw conflict(`path already exists: ${directoryPath}`)
    }
    if (nodeErrorCode(error) === "ENOENT") throw notFound(path.dirname(directoryPath))
    throw error
  }
  return mutationStat(uri, await fs.lstat(directoryPath))
}

export async function renamePath(
  sourceUri: string,
  targetUri: string,
  options: FsMutationOptions,
): Promise<FsMutationStat> {
  const sourcePath = await assertMutationPath(sourceUri, options)
  const targetPath = await assertMutationPath(targetUri, options)
  assertOutsideTrashStorage(sourcePath, options)
  assertOutsideTrashStorage(targetPath, options)
  if (sourcePath === targetPath) return mutationStat(targetUri, await lstatOrNotFound(sourcePath))
  await lstatOrNotFound(sourcePath)
  if (await pathExists(targetPath)) throw conflict(`path already exists: ${targetPath}`)
  try {
    await fs.rename(sourcePath, targetPath)
  } catch (error) {
    if (nodeErrorCode(error) === "EXDEV") {
      throw conflict("cross-filesystem rename is not supported")
    }
    if (["EEXIST", "ENOTEMPTY"].includes(nodeErrorCode(error) ?? "")) {
      throw conflict(`path already exists: ${targetPath}`)
    }
    if (nodeErrorCode(error) === "ENOENT") throw notFound(sourcePath)
    throw error
  }
  return mutationStat(targetUri, await fs.lstat(targetPath))
}

export async function trashPath(
  uri: string,
  options: FsMutationOptions,
): Promise<TrashEntry> {
  const sourcePath = await assertMutationPath(uri, options)
  assertOutsideTrashStorage(sourcePath, options)
  const root = trashRoot(options)
  return withTrashLock(root, async () => {
    const sourceStat = await lstatOrNotFound(sourcePath)
    const payloadSize = await directorySize(sourcePath)
    await fs.mkdir(root, { recursive: true })
    await purgeExpiredTrash(root, options)
    const entries = await readTrashEntries(root)
    const usedBytes = entries.reduce((total, entry) => total + entry.metadata.size, 0)
    const maxBytes = options.trashMaxBytes ?? TRASH_MAX_BYTES
    if (payloadSize > maxBytes - usedBytes) {
      throw conflict(
        `YAADE trash capacity exceeded (${usedBytes + payloadSize} bytes; max ${maxBytes})`,
      )
    }

    const id = randomUUID()
    const entryDirectory = path.join(root, id)
    const metadata: TrashMetadata = {
      version: TRASH_METADATA_VERSION,
      id,
      originalPath: sourcePath,
      name: path.basename(sourcePath),
      isDirectory: sourceStat.isDirectory(),
      size: payloadSize,
      trashedAt: options.now?.() ?? Date.now(),
    }
    await fs.mkdir(entryDirectory)
    try {
      await fs.writeFile(
        path.join(entryDirectory, TRASH_METADATA_NAME),
        JSON.stringify(metadata),
        { encoding: "utf8", flag: "wx" },
      )
      try {
        await fs.rename(sourcePath, path.join(entryDirectory, TRASH_PAYLOAD_NAME))
      } catch (error) {
        if (nodeErrorCode(error) === "EXDEV") {
          throw conflict(
            "YAADE trash is on a different filesystem; the original was not deleted",
          )
        }
        throw error
      }
    } catch (error) {
      await fs.rm(entryDirectory, { recursive: true, force: true })
      throw error
    }
    return publicTrashEntry(metadata)
  })
}

export async function listTrash(options: FsMutationOptions): Promise<TrashEntry[]> {
  const root = trashRoot(options)
  return withTrashLock(root, async () => {
    await purgeExpiredTrash(root, options)
    const entries = await readTrashEntries(root)
    const visible: TrashEntry[] = []
    for (const entry of entries) {
      if (await metadataAllowed(entry.metadata, options)) {
        visible.push(publicTrashEntry(entry.metadata))
      }
    }
    visible.sort((left, right) => right.trashedAt - left.trashedAt)
    return visible
  })
}

function validateTrashId(id: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw notFound(id)
  }
}

export async function restoreTrash(
  id: string,
  targetUri: string | undefined,
  options: FsMutationOptions,
): Promise<RestoreTrashResult> {
  validateTrashId(id)
  const root = trashRoot(options)
  return withTrashLock(root, async () => {
    await purgeExpiredTrash(root, options)
    const entryDirectory = path.join(root, id)
    const metadata = await readTrashMetadata(entryDirectory)
    const payloadPath = path.join(entryDirectory, TRASH_PAYLOAD_NAME)
    if (!metadata || metadata.id !== id || !(await pathExists(payloadPath))) {
      throw notFound(id)
    }
    if (!(await metadataAllowed(metadata, options))) {
      throw new Error(`Path not allowed: ${metadata.originalPath}`)
    }
    const restorePath = targetUri
      ? await assertMutationPath(targetUri, options)
      : await assertAllowedPath(metadata.originalPath, [...options.allowedRoots])
    assertOutsideTrashStorage(restorePath, options)
    if (await pathExists(restorePath)) {
      throw conflict(`restore target already exists: ${restorePath}`)
    }
    await fs.mkdir(path.dirname(restorePath), { recursive: true })
    await assertAllowedPath(restorePath, [...options.allowedRoots])
    try {
      await fs.rename(payloadPath, restorePath)
    } catch (error) {
      if (nodeErrorCode(error) === "EXDEV") {
        throw conflict(
          "YAADE trash is on a different filesystem; the trashed item was preserved",
        )
      }
      if (["EEXIST", "ENOTEMPTY"].includes(nodeErrorCode(error) ?? "")) {
        throw conflict(`restore target already exists: ${restorePath}`)
      }
      throw error
    }
    await fs.rm(entryDirectory, { recursive: true, force: true }).catch(() => undefined)
    return {
      entry: publicTrashEntry(metadata),
      uri: pathToUri(restorePath),
    }
  })
}

export async function emptyTrash(options: FsMutationOptions): Promise<EmptyTrashResult> {
  const root = trashRoot(options)
  return withTrashLock(root, async () => {
    const entries = await readTrashEntries(root)
    let removed = 0
    let bytes = 0
    for (const entry of entries) {
      if (!(await metadataAllowed(entry.metadata, options))) continue
      await fs.rm(entry.directory, { recursive: true, force: true })
      removed++
      bytes += entry.metadata.size
    }
    return { removed, bytes }
  })
}
