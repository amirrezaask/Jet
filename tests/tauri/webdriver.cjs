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

  function sessionRequest(method, path, body) {
    if (!sessionId) throw new Error("no session")
    return request(method, `/session/${sessionId}${path}`, body)
  }

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
      const value = await sessionRequest("POST", "/execute/sync", {
        script: serializeScript(script),
        args,
      })
      // tauri-plugin-wdio-webdriver currently wraps script results twice.
      // Unwrap only the protocol-shaped single-key object so ordinary domain
      // objects containing a `value` field keep their shape.
      return value && typeof value === "object" && Object.keys(value).length === 1 && "value" in value
        ? value.value
        : value
    },

    async executeAsync(script, ...args) {
      const value = await sessionRequest("POST", "/execute/async", {
        script: serializeScript(script),
        args,
      })
      return value && typeof value === "object" && Object.keys(value).length === 1 && "value" in value
        ? value.value
        : value
    },

    async performActions(actions) {
      await sessionRequest("POST", "/actions", { actions })
    },

    async releaseActions() {
      await sessionRequest("DELETE", "/actions")
    },

    async sendKeys(text) {
      if (!text) return
      await this.execute(keys => {
        const active = document.activeElement
        if (!active) throw new Error("active element not found")
        if (active.isContentEditable) {
          document.execCommand("insertText", false, keys)
          return
        }
        if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
          const proto =
            active instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
          const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set
          setter?.call(active, `${active.value}${keys}`)
          active.dispatchEvent(new InputEvent("input", { bubbles: true, data: keys, inputType: "insertText" }))
          active.dispatchEvent(new Event("change", { bubbles: true }))
          return
        }
        document.execCommand("insertText", false, keys)
      }, text)
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
