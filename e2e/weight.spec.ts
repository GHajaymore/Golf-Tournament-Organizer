import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { test, expect, type BrowserContext } from "./coverage";

/**
 * HOW MUCH A PHONE HAS TO DOWNLOAD BEFORE A SCREEN IS THERE.
 *
 * Speed on a golf course is weight. The signal is one bar, and every kilobyte
 * of a screen is time a player stands looking at nothing — and it is the width
 * of the window the slow-delivery fault needs (`slow-page.spec`; CLAUDE.md:
 * "the page's weight is the width of the window"). Nothing measured it, so
 * nothing would have said when a change made a screen half as heavy again.
 *
 * This opens the screens people open most, on a cold cache, and adds up what
 * came down the wire for each — the document, its scripts, its styles, its
 * pictures and fonts — as the bytes actually transferred, compressed.
 *
 * IT IS A BUDGET, HELD AS A RATCHET. `weight-budget.json` beside this file is
 * what each screen weighed when it was last recorded. A screen may weigh up to
 * a tenth more than its line before this fails (a build shifts a few bytes
 * between chunks); past that, something was added, and the failure says what
 * kind — document, script, style or picture — so it is found in a minute
 * rather than a morning. A screen that got lighter passes and says the budget
 * can come down.
 *
 * To record after a deliberate change: `WEIGHT_BUDGET=write`.
 *
 * WHAT THIS CANNOT SEE: how long any of it takes on a real network or a slow
 * phone, and anything loaded after the screen settles. It is the cause, not
 * the stopwatch.
 *
 * Chromium only: the bytes on the wire are read from the browser's own network
 * log, which only that engine hands over.
 */

const BUDGET = "e2e/weight-budget.json";
const WRITE = process.env.WEIGHT_BUDGET === "write";
const ALLOW = 1.1;

type Weight = { document: number; script: number; style: number; other: number; total: number; requests: number };
/** The heaviest things that are not the document, a script or a style sheet: fonts and pictures, by file. */
const heaviest = new Map<string, string[]>();

async function weigh(context: BrowserContext, path: string): Promise<Weight> {
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  const kind = new Map<string, string>();
  const size = new Map<string, number>();
  const address = new Map<string, string>();
  cdp.on("Network.responseReceived", (e) => {
    kind.set(e.requestId, e.type);
    address.set(e.requestId, e.response.url);
  });
  cdp.on("Network.loadingFinished", (e) => size.set(e.requestId, e.encodedDataLength));
  await page.goto(path, { waitUntil: "load" });
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
  const w: Weight = { document: 0, script: 0, style: 0, other: 0, total: 0, requests: 0 };
  for (const [id, bytes] of size) {
    const t = kind.get(id) ?? "Other";
    const bucket = t === "Document" ? "document" : t === "Script" ? "script" : t === "Stylesheet" ? "style" : "other";
    w[bucket] += bytes;
    w.total += bytes;
    w.requests += 1;
  }
  heaviest.set(
    path,
    [...size]
      .filter(([id]) => !["Document", "Script", "Stylesheet"].includes(kind.get(id) ?? ""))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([id, bytes]) => `${(address.get(id) ?? "?").split("/").pop()?.split("?")[0]} ${Math.round(bytes / 1024)} KB`),
  );
  await page.close();
  return w;
}

const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`;

test("no screen people open most has put on weight", async ({ browser, browserName }, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "weighed once, as the phone that has to carry it");
  test.skip(browserName !== "chromium", "the bytes on the wire are read from Chromium's own network log");
  test.setTimeout(240_000);
  const data = JSON.parse(readFileSync(".e2e/data.json", "utf8")) as { shareToken: string };
  const device = { viewport: testInfo.project.use.viewport ?? { width: 393, height: 851 }, userAgent: testInfo.project.use.userAgent, isMobile: true, hasTouch: true };
  const visits: Array<[name: string, state: string | undefined, path: string]> = [
    ["the front door", undefined, "/"],
    ["the public board", undefined, `/live/${data.shareToken}`],
    ["a player's Today", ".e2e/player.json", "/me"],
    ["a player's card", ".e2e/player.json", "/me/card"],
    ["a player's board", ".e2e/player.json", "/me/board"],
    ["the organizer's dashboard", ".e2e/organizer.json", "/dashboard"],
    ["score entry", ".e2e/organizer.json", "/entry"],
    ["the leaderboard", ".e2e/organizer.json", "/leaderboard"],
  ];
  const measured: Record<string, Weight> = {};
  for (const [name, state, path] of visits) {
    const context = await browser.newContext({ ...device, ...(state ? { storageState: state } : {}) });
    measured[name] = await weigh(context, path);
    // By file, so a difference between two machines can be READ rather than guessed at.
    console.log(`[weight]   ${name}, fonts and pictures by file: ${(heaviest.get(path) ?? []).join(", ")}`);
    await context.close();
  }
  // CONTROL: something real came down for every one of them.
  for (const [name, w] of Object.entries(measured)) {
    expect(w.document, `${name}: no document was weighed`).toBeGreaterThan(2_000);
    expect(w.script, `${name}: no script was weighed`).toBeGreaterThan(20_000);
  }
  for (const [name, w] of Object.entries(measured)) console.log(`[weight] ${name}: ${kb(w.total)} in ${w.requests} requests — document ${kb(w.document)}, script ${kb(w.script)}, style ${kb(w.style)}, other ${kb(w.other)}`);

  /**
   * ONE BUDGET PER KIND OF MACHINE, because the same screen does not weigh the
   * same on each. Recorded on Windows, every app screen was about 105 KB of
   * fonts; the first round on GitHub (Linux, 2026-10-13) weighed 248 KB and
   * failed seven screens for "putting on weight". Nothing had been added.
   *
   * WHY, measured the same day from the files this logs by name. A build made
   * on Windows HINTS NO FONT AT ALL: next/font's manifest plugin looks for its
   * own modules by a path written with forward slashes, on Windows that path
   * has backslashes, and the manifest it writes is empty — so a font comes
   * down only when a letter is drawn in it. A build made on Linux, which is
   * what production is, hints every face its layout calls with the preload
   * on, and until that day those were five: Geist Mono 70 KB, Geist Sans
   * 69 KB, Fraunces italic 45 KB, Fraunces upright 36 KB, Oswald 28 KB, on
   * every screen, three of them for nothing. Given a Linux build's manifest,
   * the Windows build weighed 248 KB too, file for file.
   *
   * The three are no longer hinted (`src/app/fonts.ts`), so the two budgets
   * now agree on the fonts — and they stay two, because the mechanism that
   * could part them again is still there. The Linux line is the one that
   * describes a phone; it can only be recorded from a run on GitHub (the
   * `[weight]` lines of the phone job), and `e2e/fonts.spec.ts` is the rule
   * itself: no screen downloads a font it does not draw.
   */
  const all = existsSync(BUDGET) ? (JSON.parse(readFileSync(BUDGET, "utf8")) as Record<string, Record<string, Weight>>) : {};
  if (WRITE || !all[process.platform]) {
    all[process.platform] = measured;
    writeFileSync(BUDGET, JSON.stringify(all, null, 1) + "\n");
    console.log(`[weight] budget for ${process.platform} written to ${BUDGET}`);
    expect(WRITE, `${BUDGET} had no budget for ${process.platform}, so it has been written from this run — check it in`).toBe(true);
    return;
  }
  const budget = all[process.platform];
  const faults: string[] = [];
  for (const [name, w] of Object.entries(measured)) {
    const was = budget[name];
    if (!was) {
      faults.push(`${name}: is weighed and has no line in the budget — record it`);
      continue;
    }
    if (w.total > was.total * ALLOW) {
      const grew = (["document", "script", "style", "other"] as const)
        .filter((k) => w[k] > was[k] * ALLOW + 2_000)
        .map((k) => `${k} ${kb(was[k])} → ${kb(w[k])}`);
      faults.push(`${name}: ${kb(was.total)} → ${kb(w.total)} (${grew.join(", ") || "spread across kinds"})`);
    } else if (w.total < was.total * 0.85) {
      console.log(`[weight]   lighter than its budget — ${name}: ${kb(was.total)} → ${kb(w.total)}; the budget can come down`);
    }
  }
  expect(faults, `screens that have put on weight:\n${faults.join("\n")}`).toEqual([]);
});
