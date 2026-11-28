/**
 * THE ONE PLACE THE E2E SERVER IS TOLD TO KEEP A SLOW-REQUEST LOG (B112, 28 Nov 2026).
 *
 * Every place that starts the browser-test web server (`playwright.config.ts`'s webServer, which is
 * what CI's shards and `verify` use, and `scripts/qa/round.mjs`, which starts its own server and has
 * Playwright reuse it) takes its env from `slowRequestEnv()` here, so the preload and the threshold
 * cannot differ between them. A start site without it is refused by
 * `src/lib/__tests__/slow-request-log.test.ts`.
 *
 * Gate 3 of #1255 found the round's server started WITHOUT it, so the log was never on where the stalls
 * were seen, and nothing said so. So the preload also prints ONE control line when it is on
 * (`<time> [slow-request] on, threshold N ms`) and `controlLineSince()` reads it back: the round refuses
 * to run a layer against a server that never printed it (verdict INCOMPLETE), and `e2e/global-setup.ts`
 * refuses to start a CI run whose server did not.
 */

/** A request open this long (ms) is logged. */
export const SLOW_REQUEST_MS = "5000";

/** The preload, relative to the repository root, where every server is started from. */
export const SLOW_REQUEST_PRELOAD = "./scripts/ci/slow-request-log.cjs";

/**
 * What to add to a test server's environment. `base` is the environment it would otherwise inherit.
 * @param {Record<string, string | undefined>} [base]
 */
export function slowRequestEnv(base = process.env) {
  const have = String(base.NODE_OPTIONS ?? "").trim();
  const options = have.includes(SLOW_REQUEST_PRELOAD) ? have : `${have} --require ${SLOW_REQUEST_PRELOAD}`.trim();
  return { E2E_SLOW_REQUEST_MS: SLOW_REQUEST_MS, NODE_OPTIONS: options };
}

/** The line the preload prints, once, when it is on: `<ISO time> [slow-request] on, threshold 5000 ms`. */
const CONTROL = /^(\S+) \[slow-request\] on, threshold (\d+) ms$/;

/** Whether `text` (a server's log) holds the control line, stamped at or after `sinceMs` (epoch ms; 0 for any). */
export function controlLineSince(text, sinceMs = 0) {
  for (const line of String(text).split(/\r?\n/)) {
    const m = CONTROL.exec(line.trim());
    if (!m) continue;
    const at = Date.parse(m[1]);
    if (Number.isFinite(at) && at >= sinceMs) return true;
  }
  return false;
}

/** Why a server's log shows the slow-request log was not on; null when it was. */
export function controlLineRefusal(text, sinceMs = 0) {
  return controlLineSince(text, sinceMs)
    ? null
    : "the test server never printed '[slow-request] on, threshold N ms', so its slow-request log is OFF (a start site is missing slowRequestEnv() from scripts/ci/slow-request-env.mjs)";
}
