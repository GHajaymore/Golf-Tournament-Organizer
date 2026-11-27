import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";

/**
 * A NAVIGATION THAT STALLS SAYS WHERE (B112, 27 Nov 2026).
 *
 * `page.goto("/stages?bust=…")` got its headers (200, 297 ms) and the body never finished, for
 * about 30 s, with no event anywhere (5 Nov, 14 Nov, 27 Nov). The artifacts could not tell a server
 * that was slow to finish rendering from a runner that stalled. `coverage.ts` wraps every page's
 * `goto` and `reload`; each now runs under `watchNavigation`, which, when one is still pending after
 * `E2E_GOTO_WATCHDOG_MS` (default 10 s; a healthy goto is well under 2 s), LOOKS ONCE and writes:
 *
 *   - the URL and the time of each document response's headers, with its status;
 *   - whether the page's main thread answers (`page.evaluate`, bounded);
 *   - on Chromium, the bytes the browser receives for the next 2 s (a body trickling in is a server
 *     streaming; none at all is a server waiting or a browser that is not reading);
 *   - the server's own lines from the window, from the slow-request log the test server writes
 *     (`scripts/ci/slow-request-log.cjs`): "no line for this request" and "OPEN, headers sent, bytes
 *     not moving" name different causes.
 *
 * IT LOGS ONLY. It never throws, never cancels, never changes a timeout or what the goto waits for;
 * the goto's own result (or its own error) is returned exactly as it was. A goto that returns in time
 * costs one timer and one `response` listener.
 */
const nodeRequire = createRequire(`${process.cwd()}/package.json`);
const slowLog = nodeRequire("./scripts/ci/slow-request-log.cjs") as { logFile: () => string };

const after = () => {
  const n = Number(process.env.E2E_GOTO_WATCHDOG_MS);
  return Number.isFinite(n) && n > 0 ? n : 10_000;
};

const bounded = <T,>(p: Promise<T>, ms: number): Promise<T | "no answer"> =>
  Promise.race([p, new Promise<"no answer">((r) => setTimeout(() => r("no answer"), ms))]).catch(() => "no answer" as const);

/** The server's lines (ISO-stamped) from `sinceMs` on. Never throws. */
export function serverLinesSince(sinceMs: number, file: string = slowLog.logFile()): string[] {
  try {
    return readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => {
        const t = Date.parse(line.slice(0, 24));
        return Number.isFinite(t) && t >= sinceMs;
      })
      .slice(-30);
  } catch {
    return [];
  }
}

async function bytesForTwoSeconds(page: Page): Promise<string> {
  if (page.context().browser()?.browserType().name() !== "chromium") return "bytes: only measured on Chromium";
  let session: Awaited<ReturnType<ReturnType<Page["context"]>["newCDPSession"]>> | undefined;
  try {
    session = await page.context().newCDPSession(page);
    let got = 0;
    let chunks = 0;
    session.on("Network.dataReceived", (e: { dataLength: number }) => {
      got += e.dataLength;
      chunks += 1;
    });
    await session.send("Network.enable");
    await new Promise((r) => setTimeout(r, 2_000));
    return `bytes the browser received in the next 2 s: ${got} in ${chunks} chunks`;
  } catch (e) {
    return `bytes: not measured (${String(e).slice(0, 80)})`;
  } finally {
    await session?.detach().catch(() => undefined);
  }
}

/**
 * Run `run` (a `goto` or a `reload`) and, if it is still pending after the threshold, say what is
 * going on. Returns whatever `run` returns; rethrows whatever it throws.
 */
export async function watchNavigation<T>(page: Page, what: string, run: () => Promise<T>): Promise<T> {
  const started = Date.now();
  const headers: string[] = [];
  const onResponse = (r: { url(): string; status(): number; request(): { isNavigationRequest(): boolean; frame(): unknown } }) => {
    try {
      if (r.request().isNavigationRequest() && r.request().frame() === page.mainFrame()) headers.push(`+${Date.now() - started} ms ${r.status()} ${r.url().slice(0, 140)}`);
    } catch {
      /* observe only */
    }
  };
  page.on("response", onResponse);
  const timer = setTimeout(() => {
    void look().catch(() => undefined);
  }, after());

  async function look(): Promise<void> {
    const waited = Date.now() - started;
    const lines = [`${new Date().toISOString()} [goto-watchdog] ${what} still pending after ${waited} ms (started ${new Date(started).toISOString()}), page at ${page.isClosed() ? "(closed)" : page.url()}`];
    lines.push(headers.length ? `  document responses: ${headers.join(" | ")}` : "  document responses: none yet (no headers from the server)");
    if (!page.isClosed()) {
      const alive = await bounded(page.evaluate(() => `${document.readyState} at page clock ${Math.round(performance.now())} ms`), 3_000);
      lines.push(alive === "no answer" ? "  page.evaluate: no answer in 3 s (the old document is not answering: busy, mid-navigation or hung)" : `  page.evaluate answers: ${alive}`);
      lines.push(`  ${await bounded(bytesForTwoSeconds(page), 5_000)}`);
    }
    const server = serverLinesSince(started - 1_000);
    lines.push(server.length ? `  server's own lines since ${new Date(started - 1_000).toISOString()}:\n    ${server.join("\n    ")}` : "  server's own lines in this window: none (a request this slow would have an OPEN line after the server's threshold; none means it was not open there, or the log is off)");
    console.log(lines.join("\n"));
  }

  try {
    return await run();
  } finally {
    clearTimeout(timer);
    page.off("response", onResponse);
    const took = Date.now() - started;
    if (took >= after()) console.log(`${new Date().toISOString()} [goto-watchdog] ${what} finished after ${took} ms`);
  }
}
