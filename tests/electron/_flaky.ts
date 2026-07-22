import { test } from "@playwright/test"

/** Re-enable skipped flaky specs: `GHARARGAH_E2E_RUN_FLAKY=1 pnpm test:e2e` */
export const skipFlaky = process.env.GHARARGAH_E2E_RUN_FLAKY !== "1"

export function flakyReason(detail: string): string {
  return `flaky (disabled): ${detail} — see AGENTS.md § Disabled flaky E2E specs`
}

/** Whole describe block skipped when `skipFlaky` (unless `GHARARGAH_E2E_RUN_FLAKY=1`). */
export const describeFlaky = skipFlaky ? test.describe.skip : test.describe

/** Single test skipped when `skipFlaky`. */
export function skipFlakyTest(reason: string): void {
  test.skip(skipFlaky, flakyReason(reason))
}

/** Declare one flaky test without applying the modifier to its whole suite. */
export function flakyTest(
  reason: string,
  title: string,
  body: () => Promise<void>,
): void {
  const declare = skipFlaky ? test.skip : test
  declare(title, body)
}
