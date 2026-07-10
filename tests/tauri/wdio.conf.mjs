import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const WEBDRIVER_PORT = 4445

export const config = {
  runner: "local",
  specs: ["./specs/**/*.e2e.mjs"],
  maxInstances: 1,
  logLevel: "info",
  bail: 0,
  hostname: "127.0.0.1",
  port: WEBDRIVER_PORT,
  path: "/",
  waitforTimeout: 15_000,
  connectionRetryTimeout: 120_000,
  connectionRetryCount: 2,
  framework: "mocha",
  mochaOpts: {
    ui: "bdd",
    timeout: 120_000,
  },
  reporters: ["spec"],
  capabilities: [
    {
      browserName: "webview",
      "wdio:enforceWebDriverClassic": true,
      "wdio:tauriServiceOptions": {
        windowLabel: "main",
      },
    },
  ],
  autoCompileOpts: {
    autoCompile: false,
  },
}
