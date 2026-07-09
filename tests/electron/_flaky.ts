import { test } from "@playwright/test"

/** Re-enable skipped flaky specs: `JET_E2E_RUN_FLAKY=1 pnpm test:electron` */
export const skipFlaky = process.env.JET_E2E_RUN_FLAKY !== "1"

export function flakyReason(detail: string): string {
  return `flaky (disabled): ${detail} — see AGENTS.md § Disabled flaky E2E specs`
}

/** Whole describe block skipped when `skipFlaky` (unless `JET_E2E_RUN_FLAKY=1`). */
export const describeFlaky = skipFlaky ? test.describe.skip : test.describe

/** Single test skipped when `skipFlaky`. */
export function skipFlakyTest(reason: string): void {
  test.skip(skipFlaky, flakyReason(reason))
}
