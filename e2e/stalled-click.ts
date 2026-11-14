import type { Locator, Page, TestInfo } from "@playwright/test";

/**
 * A CLICK THAT NEVER RETURNS, MADE TO EXPLAIN ITSELF (2026-11-14).
 *
 * `organizer-rounds-screen.spec.ts` ("a match-play championship in groups, then a knockout"): the
 * Bracket press logged "performing click action" and then nothing, for 240 s, until the test
 * timeout. No frames, no requests, no console lines, no crash (CI runs 43589900390 and
 * 41950657167). The press only calls two setStates, so a bounded cause is not visible from the
 * source. The next occurrence must say which of these it was:
 *
 *   the page's main thread is busy      the probe below never answers  ("main thread unresponsive")
 *   a native dialog is open             `page.on("dialog")` logs it and dismisses it
 *   the browser process died            `page.on("crash")` logs it
 *   the target is covered / detached    the probe says what is at its centre, and whether it is attached
 *   the page is mid-animation / moving  the probe reads its box twice
 *
 * It does NOT cap the click: the click runs under the test's own timeout exactly as before. A
 * watchdog starts beside it, and only when the press is still pending after `after` ms does it
 * LOOK, once, and write what it saw to the job log and to the test's attachments. A press that
 * returns in time costs one timer.
 */
const watched = new WeakSet<Page>();
const pending = new WeakMap<Page, number>();

/** Log what no assertion will: a crash, a native dialog, a page error, a closed page. Once per page. */
export function watchForStalls(page: Page, label: string): void {
  if (watched.has(page)) return;
  watched.add(page);
  page.on("crash", () => console.log(`[stalled-click] ${label}: PAGE CRASHED (renderer process gone) at ${page.url()}`));
  page.on("close", () => console.log(`[stalled-click] ${label}: page closed`));
  page.on("dialog", (d) => {
    console.log(`[stalled-click] ${label}: native ${d.type()} dialog "${d.message().slice(0, 120)}" — dismissing it`);
    void d.dismiss().catch(() => undefined);
  });
  // Only while a watched step is pending: the rest of the walk's errors are the spec's own to report.
  page.on("pageerror", (e) => pending.get(page) && console.log(`${new Date().toISOString()} [stalled-click] ${label}: pageerror ${String(e).slice(0, 200)}`));
  page.on("requestfailed", (r) => pending.get(page) && console.log(`${new Date().toISOString()} [stalled-click] ${label}: request failed ${r.method()} ${r.url().slice(0, 120)} ${r.failure()?.errorText ?? ""}`));
}

/** Say, in a bounded time, what the page is doing. Never throws, never waits more than a few seconds. */
async function lookAt(page: Page, target: Locator, label: string, testInfo: TestInfo | undefined, waited: number): Promise<void> {
  const lines: string[] = [`[stalled-click] ${label}: still pressing after ${waited} ms, at ${page.url()}`];
  const bounded = <T,>(p: Promise<T>, ms = 5_000): Promise<T | "no answer"> =>
    Promise.race([p, new Promise<"no answer">((r) => setTimeout(() => r("no answer"), ms))]).catch(() => "no answer" as const);

  const alive = await bounded(page.evaluate(() => performance.now()));
  lines.push(alive === "no answer" ? "  main thread unresponsive: page.evaluate did not answer in 5 s (busy loop, or the renderer is hung)" : `  main thread answers (page clock ${Math.round(alive as number)} ms)`);
  lines.push(`  page.isClosed=${page.isClosed()}`);

  if (alive !== "no answer") {
    const state = await bounded(
      target.first().evaluate((el) => {
        const r1 = el.getBoundingClientRect();
        const cx = r1.left + r1.width / 2;
        const cy = r1.top + r1.height / 2;
        const top = document.elementFromPoint(cx, cy);
        const cs = getComputedStyle(el);
        return new Promise<string>((resolve) =>
          requestAnimationFrame(() => {
            const r2 = el.getBoundingClientRect();
            resolve(
              [
                `attached=${el.isConnected}`,
                `disabled=${(el as HTMLButtonElement).disabled === true}`,
                `box=${Math.round(r1.left)},${Math.round(r1.top)} ${Math.round(r1.width)}x${Math.round(r1.height)}`,
                `moved=${r1.left !== r2.left || r1.top !== r2.top}`,
                `visibility=${cs.visibility} pointer-events=${cs.pointerEvents} opacity=${cs.opacity}`,
                `atCentre=${top === el || el.contains(top) ? "the target itself" : top ? `<${top.tagName.toLowerCase()}> "${(top.textContent ?? "").trim().slice(0, 40)}" (covering it)` : "nothing (off screen)"}`,
                `scrollY=${Math.round(window.scrollY)} viewport=${window.innerWidth}x${window.innerHeight}`,
                `readyState=${document.readyState} visibilityState=${document.visibilityState}`,
              ].join("; "),
            );
          }),
        );
      }),
    );
    lines.push(`  target: ${state}`);
    const count = await bounded(target.count());
    lines.push(`  matches for the locator: ${count}`);
  }

  console.log(lines.join("\n"));
  if (testInfo && !page.isClosed()) {
    await testInfo.attach(`stalled-click ${label}`, { body: lines.join("\n"), contentType: "text/plain" }).catch(() => undefined);
    const shot = await bounded(page.screenshot({ timeout: 4_000 }), 6_000);
    if (shot !== "no answer") await testInfo.attach(`stalled-click ${label}.png`, { body: shot as Buffer, contentType: "image/png" }).catch(() => undefined);
    else console.log(`[stalled-click] ${label}: no screenshot in 6 s — the page is not painting`);
  }
}

/**
 * `target.click()`, unchanged in what it waits for and how long, with a look taken if it is still
 * pending after `after` ms (default 20 s: a healthy press is under one).
 */
export async function clickAndExplain(page: Page, target: Locator, label: string, testInfo?: TestInfo, after = 20_000): Promise<void> {
  await whileWatching(page, target, label, testInfo, () => target.click(), after);
}

/**
 * Any step, watched the same way. The CI log of the failure said the test stood in the 10-second
 * `toHaveValue` AFTER the click (a bounded wait that ran 4 minutes): so either the click took the
 * time, or the expect did not keep its bound. Wrapping both, with ISO times stamped at each end,
 * tells the two apart.
 */
export async function whileWatching(page: Page, target: Locator, label: string, testInfo: TestInfo | undefined, step: () => Promise<unknown>, after = 20_000): Promise<void> {
  watchForStalls(page, label);
  const started = Date.now();
  // testInfo.duration is 0 while a test runs, so stamp wall-clock ISO times (compare with the log's own).
  const startedAt = new Date(started).toISOString();
  pending.set(page, (pending.get(page) ?? 0) + 1);
  const timer = setTimeout(() => void lookAt(page, target, label, testInfo, Date.now() - started), after);
  try {
    await step();
  } finally {
    clearTimeout(timer);
    pending.set(page, Math.max(0, (pending.get(page) ?? 1) - 1));
    const took = Date.now() - started;
    if (took > 3_000) console.log(`${new Date().toISOString()} [stalled-click] ${label}: took ${took} ms, started ${startedAt}`);
  }
}
