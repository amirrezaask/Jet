export default async function globalTeardown(): Promise<void> {
  // E2E capabilities are enabled through tauri.e2e.conf.json, so teardown has
  // no tracked production configuration to restore.
}
