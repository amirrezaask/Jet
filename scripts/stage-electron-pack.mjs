#!/usr/bin/env node
/**
 * Stage self-contained runtime for Electron packaging:
 *   apps/gharargah-electron/pack/{web,backend,node}
 *
 * - web: Vite SPA dist
 * - backend: esbuild-bundled host/agent + native npm deps (node-pty, fff)
 * - node: official Node binary matching process.version (ABI-safe for natives)
 */
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import fs from "node:fs"
import https from "node:https"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const electronDir = path.join(repoRoot, "apps/gharargah-electron")
const packDir = path.join(electronDir, "pack")
const webSrc = path.join(repoRoot, "apps/gharargah/dist")
const webDest = path.join(packDir, "web")
const backendDir = path.join(packDir, "backend")
const nodeDest = path.join(packDir, "node")

function run(command, args, cwd = repoRoot) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", env: process.env })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function resolveEsbuild() {
  const vitePkg = path.dirname(
    require.resolve("vite/package.json", { paths: [path.join(repoRoot, "apps/gharargah")] }),
  )
  return require(require.resolve("esbuild", { paths: [vitePkg] }))
}

async function bundleBackends() {
  const esbuild = resolveEsbuild()
  const includeAgentChat = process.env.GHARARGAH_ENABLE_AGENT_CHAT === "1"
  fs.mkdirSync(backendDir, { recursive: true })
  for (const stale of ["host-server.mjs", "agent-server.mjs", "host-server.cjs", "agent-server.cjs"]) {
    fs.rmSync(path.join(backendDir, stale), { force: true })
  }
  // Banner defines `require` before esbuild's __require shim so CJS deps (ws) resolve.
  const banner = {
    js: `import { createRequire as __gharargahCreateRequire } from "node:module";
const require = __gharargahCreateRequire(import.meta.url);
`,
  }
  const common = {
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    packages: "bundle",
    banner,
    external: ["node-pty", "@ff-labs/fff-node", "@ff-labs/fff-node/*"],
    logLevel: "warning",
  }
  await esbuild.build({
    ...common,
    entryPoints: [path.join(repoRoot, "apps/host-server/src/bin.ts")],
    outfile: path.join(backendDir, "host-server.mjs"),
  })
  if (includeAgentChat) {
    await esbuild.build({
      ...common,
      entryPoints: [path.join(repoRoot, "apps/agent-server/src/bin.ts")],
      outfile: path.join(backendDir, "agent-server.mjs"),
    })
  }
  console.log(
    includeAgentChat
      ? "Bundled host-server.mjs + agent-server.mjs"
      : "Bundled host-server.mjs (agent chat disabled)",
  )
}

function writeBackendPackageJson() {
  const pkg = {
    name: "gharargah-backend-runtime",
    private: true,
    type: "module",
    dependencies: {
      "@ff-labs/fff-node": "^0.9.6",
      "node-pty": "^1.1.0",
    },
  }
  fs.writeFileSync(path.join(backendDir, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`)
}

function installBackendNatives() {
  writeBackendPackageJson()
  // Fresh install against the Node we will ship (system Node during build — same major).
  run("npm", ["install", "--omit=dev", "--no-fund", "--no-audit"], backendDir)
  console.log("Installed backend native deps")
}

function nodePlatformTriple() {
  const platform = process.platform
  const arch = process.arch
  if (platform === "darwin" && arch === "arm64") return "darwin-arm64"
  if (platform === "darwin" && arch === "x64") return "darwin-x64"
  if (platform === "linux" && arch === "arm64") return "linux-arm64"
  if (platform === "linux" && arch === "x64") return "linux-x64"
  throw new Error(`Unsupported Node download target: ${platform}-${arch}`)
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest)
    https
      .get(url, res => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          file.close()
          fs.unlinkSync(dest)
          download(res.headers.location, dest).then(resolve, reject)
          return
        }
        if (res.statusCode !== 200) {
          reject(new Error(`GET ${url} → ${res.statusCode}`))
          return
        }
        res.pipe(file)
        file.on("finish", () => file.close(() => resolve()))
      })
      .on("error", err => {
        try {
          fs.unlinkSync(dest)
        } catch {
          /* ignore */
        }
        reject(err)
      })
  })
}

async function ensureNodeRuntime() {
  const version = process.version.replace(/^v/, "")
  const triple = nodePlatformTriple()
  const base = `node-v${version}-${triple}`
  const cacheDir = path.join(os.homedir(), ".cache", "gharargah-node")
  fs.mkdirSync(cacheDir, { recursive: true })
  const tarball = path.join(cacheDir, `${base}.tar.gz`)
  const url = `https://nodejs.org/dist/v${version}/${base}.tar.gz`

  if (!fs.existsSync(tarball)) {
    console.log(`Downloading Node ${version} (${triple})…`)
    await download(url, tarball)
  } else {
    console.log(`Using cached Node tarball ${tarball}`)
  }

  fs.rmSync(nodeDest, { recursive: true, force: true })
  const extractParent = packDir
  // Clear any previous extract dir with the same name
  fs.rmSync(path.join(extractParent, base), { recursive: true, force: true })
  run("tar", ["-xzf", tarball, "-C", extractParent])
  const extracted = path.join(extractParent, base)
  if (!fs.existsSync(extracted)) {
    throw new Error(`Node extract missing: ${extracted}`)
  }
  fs.renameSync(extracted, nodeDest)
  const nodeBin = path.join(nodeDest, "bin", "node")
  if (!fs.existsSync(nodeBin)) throw new Error(`node binary missing at ${nodeBin}`)
  fs.chmodSync(nodeBin, 0o755)
  console.log(`Node runtime ready: ${nodeBin}`)
}

function copyWebDist() {
  if (!fs.existsSync(path.join(webSrc, "index.html"))) {
    throw new Error(`Frontend dist missing at ${webSrc}; run vite build first`)
  }
  fs.rmSync(webDest, { recursive: true, force: true })
  fs.cpSync(webSrc, webDest, { recursive: true })
  console.log(`Copied SPA → ${webDest}`)
}

async function main() {
  fs.mkdirSync(packDir, { recursive: true })
  copyWebDist()
  await bundleBackends()
  installBackendNatives()
  await ensureNodeRuntime()
  console.log(`Pack staged at ${packDir}`)
}

await main()
