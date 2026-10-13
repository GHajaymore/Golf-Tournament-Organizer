import { readFileSync } from "node:fs";
import { test, expect, type BrowserContext } from "./coverage";
import { consoleScreens, playerScreens } from "./routes";

/**
 * NO SCREEN DOWNLOADS A FONT IT DOES NOT DRAW.
 *
 * Until 2026-10-13 every screen in the app fetched five font files before it
 * knew which it would use — 248 KB — because all five faces were called from
 * the root layout with their preload on. A player's card draws two of them.
 * The other three were 143 KB of a phone's one bar spent on nothing, on every
 * first visit to every screen.
 *
 * `weight.spec` is what found it, and it can only say that a screen got
 * heavier than its last recorded line. This says the rule itself, of every
 * screen there is: each font file that came down the wire is a face the
 * browser then DREW with. A hint for a face nobody draws fails here by name.
 *
 * AND THREE THINGS THE FIX MUST NOT HAVE COST, each of which fails silently
 * (a fallback face draws in its place and nothing looks broken enough to see):
 *
 *   - the player's Today still hangs its scoreboard in Oswald. That face is
 *     declared by the screen itself now (`scoreboard-face.ts`), so a screen
 *     that forgot to import it would draw the board in squeezed Arial;
 *   - an italic in a heading is still the real italic. It is a separate call
 *     that joins the upright face's family by NAME; a different name is a
 *     different family, and the browser slants the upright letters instead;
 *   - the heading and body faces are there at all.
 *
 * WHAT THIS CANNOT SEE ON A WINDOWS MACHINE. A build made on Windows hints no
 * font at all (`src/app/fonts.ts`, "NOBODY SAW IT"), so here the rule can only
 * be broken by a face fetched some other way, and the run says so in a line
 * rather than passing in silence. On GitHub, and in production, the hints are
 * real and this is the check on them.
 *
 * Chromium only: which bytes came down is read from the browser's network log.
 */

type Look = {
  landed: string;
  fetched: string[];
  hinted: string[];
  /** Font files whose face the page ended up drawing with. */
  drawn: string[];
  /** family/style of every face drawn, for the message. */
  faces: string[];
};

async function look(context: BrowserContext, path: string, then?: (page: import("@playwright/test").Page) => Promise<void>): Promise<Look> {
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  const asked = new Map<string, string>();
  const fetched: string[] = [];
  cdp.on("Network.requestWillBeSent", (e) => {
    const file = e.request.url.split("/").pop()?.split("?")[0] ?? "";
    if (file.endsWith(".woff2") || file.endsWith(".woff")) asked.set(e.requestId, file);
  });
  cdp.on("Network.loadingFinished", (e) => {
    const file = asked.get(e.requestId);
    if (file) fetched.push(file);
  });
  await page.goto(path, { waitUntil: "load" });
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
  if (then) {
    await then(page);
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
  }
  const seen = await page.evaluate(async () => {
    await document.fonts.ready;
    const bare = (s: string) => s.split('"').join("").split("'").join("").trim();
    // "U+0000-00FF" and "U+0-FF" are one range; compare the numbers, not the spelling.
    const range = (r: string) =>
      r
        .split(",")
        .map((t) => {
          const [a, b] = t.trim().slice(2).split("-");
          return `${parseInt(a, 16)}-${parseInt(b ?? a, 16)}`;
        })
        .sort()
        .join(",");
    const rules: Array<{ key: string; file: string }> = [];
    for (const sheet of Array.from(document.styleSheets)) {
      let list: CSSRuleList;
      try {
        list = sheet.cssRules;
      } catch {
        continue;
      }
      for (const rule of Array.from(list)) {
        if (!(rule instanceof CSSFontFaceRule)) continue;
        const src = rule.style.getPropertyValue("src");
        const at = src.indexOf("url(");
        if (at < 0) continue; // a metric-matched fallback: local(), no file
        const file = bare(src.slice(at + 4, src.indexOf(")", at))).split("/").pop() ?? "";
        const family = bare(rule.style.getPropertyValue("font-family"));
        const style = rule.style.getPropertyValue("font-style") || "normal";
        rules.push({ key: `${family}|${style}|${range(rule.style.getPropertyValue("unicode-range") || "U+0-10FFFF")}`, file });
      }
    }
    const loaded = Array.from(document.fonts).filter((f) => f.status === "loaded");
    const keys = new Set(loaded.map((f) => `${bare(f.family)}|${f.style}|${range(f.unicodeRange)}`));
    return {
      rules: rules.length,
      drawn: rules.filter((r) => keys.has(r.key)).map((r) => r.file),
      faces: loaded.map((f) => `${bare(f.family)} ${f.style}`),
      hinted: Array.from(document.querySelectorAll('link[rel="preload"][as="font"]')).map((l) => (l as HTMLLinkElement).href.split("/").pop() ?? ""),
    };
  });
  // CONTROL on the instrument: the page's own font rules were readable. With none, "drawn" is empty for every reason at once.
  expect(seen.rules, `${path}: no @font-face rule could be read from the page`).toBeGreaterThan(5);
  const landed = new URL(page.url()).pathname;
  await page.close();
  return { landed, fetched, hinted: seen.hinted, drawn: seen.drawn, faces: seen.faces };
}

test("no screen downloads a font it does not draw", async ({ browser, browserName }, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "asked once, as the phone that has to carry it");
  test.skip(browserName !== "chromium", "the bytes on the wire are read from Chromium's own network log");
  test.setTimeout(480_000);
  const data = JSON.parse(readFileSync(".e2e/data.json", "utf8")) as { shareToken: string };
  const device = { viewport: testInfo.project.use.viewport ?? { width: 393, height: 851 }, userAgent: testInfo.project.use.userAgent, isMobile: true, hasTouch: true };
  const visits: Array<[state: string | undefined, path: string]> = [
    [undefined, "/"],
    [undefined, "/faq"],
    [undefined, "/play"],
    [undefined, `/live/${data.shareToken}`],
    ...playerScreens().map((p) => [".e2e/player.json", p] as [string, string]),
    ...consoleScreens().map((p) => [".e2e/organizer.json", p] as [string, string]),
  ];
  const faults: string[] = [];
  let hints = 0;
  let today: Look | null = null;
  for (const [state, path] of visits) {
    const context = await browser.newContext({ ...device, ...(state ? { storageState: state } : {}) });
    const seen = await look(context, path);
    await context.close();
    hints += seen.hinted.length;
    if (path === "/me") today = seen;
    // CONTROL: this was the screen asked for, not the sign-in page every refused screen becomes.
    if (path !== "/" && (seen.landed === "/" || seen.landed === "/login")) {
      faults.push(`${path}: was sent to ${seen.landed} — nothing about its fonts was learned`);
      continue;
    }
    // CONTROL: something was fetched and drawn. Every screen has words on it.
    if (seen.drawn.length === 0) faults.push(`${path}: draws with no font this app serves (fetched: ${seen.fetched.join(", ") || "none"})`);
    const idle = seen.fetched.filter((f) => !seen.drawn.includes(f));
    if (idle.length > 0) faults.push(`${path}: downloaded ${idle.join(", ")} and drew nothing with ${idle.length === 1 ? "it" : "them"} (it draws with: ${seen.faces.join(", ")}; hinted: ${seen.hinted.join(", ") || "none"})`);
  }
  console.log(`[fonts] ${visits.length} screens; ${hints} font hints between them`);
  if (hints === 0) {
    const note = "this build hints no font on any screen — a build made on Windows never does (src/app/fonts.ts) — so the rule about hints was NOT exercised here; GitHub's run is the one that asks it";
    console.log(`[fonts] ${note}`);
    testInfo.annotations.push({ type: "not exercised", description: note });
  }
  expect(faults, `fonts downloaded for nothing, or screens not reached:\n${faults.join("\n")}`).toEqual([]);

  // The scoreboard is hung in its own face, by the screen that declares it.
  expect(today, "the player's Today was not among the screens").not.toBeNull();
  expect(today!.faces, "the player's Today draws nothing in the scoreboard's face — is the fixture's round gone, or the face not imported?").toContain("oswaldLatin normal");
});

test("a heading's italic is the real one, and it waits to be asked for", async ({ browser, browserName }, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "asked once");
  test.skip(browserName !== "chromium", "the bytes on the wire are read from Chromium's own network log");
  const device = { viewport: testInfo.project.use.viewport ?? { width: 393, height: 851 }, userAgent: testInfo.project.use.userAgent, isMobile: true, hasTouch: true };
  const context = await browser.newContext({ ...device, storageState: ".e2e/player.json" });
  let asked: { family: string; styles: string[] } = { family: "", styles: [] };
  const seen = await look(context, "/me/card", async (page) => {
    asked = await page.evaluate(async () => {
      const heading = document.querySelector("h1");
      if (!heading) return { family: "", styles: [] };
      const stack = getComputedStyle(heading).fontFamily;
      const first = stack.split(",")[0].split('"').join("").split("'").join("").trim();
      // The heading's own family and no further. Asked for the whole stack, the browser also tries the
      // metric-matched fallback, which is `local("Times New Roman")`: a Linux machine has no such font,
      // and the whole request is refused with "NetworkError" — which is how GitHub's first run of this failed.
      const faces = await document.fonts.load(`italic 600 24px "${first}"`, "Aa");
      return { family: first, styles: faces.map((f) => f.style) };
    });
  });
  await context.close();
  // CONTROL: the heading is set in the heading face, and the upright one is drawn.
  expect(asked.family, "the card has no h1, or it is not in the heading face").toBe("frauncesLatin");
  expect(seen.faces).toContain("frauncesLatin normal");
  // Asked for an italic, the heading's own family answers with an italic face — not with its upright one, slanted.
  expect(asked.styles, "the heading family has no italic of its own: the italic call no longer joins the upright face's family").toEqual(["italic"]);
  expect(seen.faces).toContain("frauncesLatin italic");
});
