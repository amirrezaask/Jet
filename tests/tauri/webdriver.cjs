/**
 * Lightweight WebDriver client over node:http.
 * Avoids WDIO/undici UND_ERR_INVALID_ARG on Node 26+.
 */
const http = require("node:http")
const { serializeBrowserScript: serializeScript } = require("../shell/browser-fn.cjs")

function createWebDriver(port = 4445) {
  const base = { hostname: "127.0.0.1", port }

  function request(method, path, body) {
    const payload = body == null ? null : JSON.stringify(body)
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          ...base,
          path,
          method,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
          },
        },
        res => {
          const chunks = []
          res.on("data", c => chunks.push(c))
          res.on("end", () => {
            const raw = Buffer.concat(chunks).toString("utf8")
            let parsed
            try {
              parsed = raw ? JSON.parse(raw) : null
            } catch {
              reject(new Error(`invalid JSON from ${method} ${path}: ${raw}`))
              return
            }
            if (res.statusCode && res.statusCode >= 400) {
              reject(new Error(`${method} ${path} → ${res.statusCode}: ${raw.slice(0, 500)}`))
              return
            }
            resolve(parsed?.value ?? parsed)
          })
        },
      )
      req.on("error", reject)
      if (payload) req.write(payload)
      req.end()
    })
  }

  let sessionId = null

  return {
    async newSession() {
      const value = await request("POST", "/session", {
        capabilities: {
          alwaysMatch: {
            browserName: "webview",
            "wdio:enforceWebDriverClassic": true,
            "wdio:tauriServiceOptions": { windowLabel: "main" },
          },
        },
      })
      sessionId = value.sessionId
      if (!sessionId) throw new Error("no sessionId from WebDriver")
      return value
    },

    async deleteSession() {
      if (!sessionId) return
      const id = sessionId
      sessionId = null
      try {
        await request("DELETE", `/session/${id}`)
      } catch {
        /* app may already be gone */
      }
    },

    async execute(script, ...args) {
      if (!sessionId) throw new Error("no session")
      return request("POST", `/session/${sessionId}/execute/sync`, {
        script: serializeScript(script),
        args,
      })
    },

    async executeAsync(script, ...args) {
      if (!sessionId) throw new Error("no session")
      return request("POST", `/session/${sessionId}/execute/async`, {
        script: serializeScript(script),
        args,
      })
    },

    async waitUntil(fn, { timeout = 15_000, interval = 250, timeoutMsg } = {}) {
      const start = Date.now()
      while (true) {
        try {
          const ok = await fn()
          if (ok) return ok
        } catch {
          /* retry */
        }
        if (Date.now() - start > timeout) {
          throw new Error(timeoutMsg ?? "waitUntil timed out")
        }
        await new Promise(r => setTimeout(r, interval))
      }
    },
  }
}

/** Wait for __jetAgent mount + layout ready. */
async function waitForJetReady(wd) {
  await wd.waitUntil(async () => wd.execute(() => window.__jetAgent != null), {
    timeout: 90_000,
    timeoutMsg: "__jetAgent not mounted",
  })
  const result = await wd.executeAsync(done => {
    window.__jetAgent
      .waitForReady()
      .then(() => done(true))
      .catch(err => done({ error: String(err) }))
  })
  if (result && typeof result === "object" && result.error) {
    throw new Error(result.error)
  }
}

module.exports = { createWebDriver, waitForJetReady }
