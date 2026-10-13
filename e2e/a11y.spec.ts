import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect, type Page } from "./coverage";
import { consoleScreens, playerScreens, entryUrl } from "./routes";

/**
 * CAN IT BE USED BY SOMEBODY WHO CANNOT SEE IT, OR CANNOT USE A MOUSE?
 *
 * The suite measures what a sighted person with a pointer meets: whether a
 * word can be read against its background (`legible.spec`), whether a finger
 * can hit a control (`touch.spec`), whether anything sticks out of the screen
 * (`layout.spec`). Nothing asked the other question — is every control NAMED,
 * every field labelled, every picture described, the page a document a screen
 * reader can move through — and those are the faults that lock a person out
 * of a screen altogether rather than making it awkward.
 *
 * This runs axe (the engine behind most accessibility audits) on every screen
 * the app has — the four public pages, every organizer screen, every player
 * screen, the public board — against WCAG 2.1 A and AA. Contrast is left to
 * `legible.spec`, which measures it against what is really behind each word and
 * to a stricter bar (7:1) than axe's.
 *
 * IT IS A RATCHET, AND SAYS SO. The first run (2026-10-13) was the first time
 * anything had looked, and what it found is written in `a11y-baseline.json`
 * beside this file, screen by screen and rule by rule. From then on:
 *
 *   - a rule broken on a screen where it was not, or broken MORE often, fails;
 *   - a rule broken less often passes, and says the baseline can come down;
 *   - the baseline may only get shorter. Each line in it is a known fault with
 *     a person on the other end of it, not an exemption.
 *
 * To record a baseline after FIXING things: `A11Y_BASELINE=write`.
 *
 * WHAT THIS CANNOT SEE: about a third of accessibility is found by a machine.
 * Whether a label says the right thing, whether the order makes sense, whether
 * a screen reader's user can actually enter a card — those need a person with
 * the screen reader. This is the floor under that, not instead of it.
 *
 * Ajay, 2026-10-13: "anything you can think of. we need a solid testing
 * framework."
 */

const BASELINE = "e2e/a11y-baseline.json";
const WRITE = process.env.A11Y_BASELINE === "write";
const axeSource = readFileSync(join(process.cwd(), "node_modules", "axe-core", "axe.min.js"), "utf8");

type Found = Record<string, number>;
type Baseline = Record<string, Found>;

async function audit(page: Page): Promise<{ found: Found; samples: Record<string, string> }> {
  await page.evaluate(axeSource);
  const violations = await page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (ctx: Document, opts: object) => Promise<{ violations: Array<{ id: string; impact: string | null; help: string; nodes: Array<{ target: string[]; html: string }> }> }> } }).axe;
    const result = await axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
      // Measured by legible.spec against the real background, and to 7:1.
      rules: { "color-contrast": { enabled: false } },
    });
    return result.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, count: v.nodes.length, sample: v.nodes[0]?.html.slice(0, 140) ?? "" }));
  });
  const found: Found = {};
  const samples: Record<string, string> = {};
  for (const v of violations) {
    found[v.id] = v.count;
    samples[v.id] = `${v.impact ?? "?"} — ${v.help} — e.g. ${v.sample}`;
  }
  return { found, samples };
}

async function sweep(page: Page, who: string, paths: string[], record: Baseline, faults: string[], improved: string[]) {
  const baseline: Baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : {};
  let looked = 0;
  for (const path of paths) {
    const res = await page.goto(entryUrl(path), { waitUntil: "domcontentloaded" }).catch(() => null);
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    if (!res || res.status() >= 400) continue;
    // A screen that sent this person elsewhere is audited where it sent them, under its own name, once.
    const landed = new URL(page.url()).pathname;
    if (landed !== path.split("?")[0]) continue;
    looked += 1;
    const key = `${who} ${path}`;
    const { found, samples } = await audit(page);
    record[key] = found;
    const known = baseline[key] ?? {};
    for (const [rule, count] of Object.entries(found)) {
      if (!(rule in known)) faults.push(`${key}: ${rule} ×${count} — ${samples[rule]}`);
      else if (count > known[rule]) faults.push(`${key}: ${rule} ×${count}, was ×${known[rule]} — ${samples[rule]}`);
      else if (count < known[rule]) improved.push(`${key}: ${rule} ×${count}, baseline says ×${known[rule]}`);
    }
    for (const rule of Object.keys(known)) if (!(rule in found)) improved.push(`${key}: ${rule} is fixed — take it off the baseline`);
  }
  return looked;
}

function settle(record: Baseline, faults: string[], improved: string[], project: string) {
  if (WRITE) {
    const all: Baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : {};
    // This project's screens replace their old lines; the other project's lines are left alone.
    for (const [k, v] of Object.entries(record)) {
      if (Object.keys(v).length) all[k] = v;
      else delete all[k];
    }
    const sorted = Object.fromEntries(Object.keys(all).sort().map((k) => [k, Object.fromEntries(Object.keys(all[k]).sort().map((r) => [r, all[k][r]]))]));
    writeFileSync(BASELINE, JSON.stringify(sorted, null, 1) + "\n");
    console.log(`[a11y] ${project}: baseline written — ${Object.values(record).reduce((n, v) => n + Object.keys(v).length, 0)} rule(s) broken across ${Object.keys(record).length} screens`);
    return;
  }
  const broken = Object.values(record).reduce((n, v) => n + Object.values(v).reduce((a, b) => a + b, 0), 0);
  console.log(`[a11y] ${project}: ${Object.keys(record).length} screens audited, ${broken} known fault(s) still standing, ${faults.length} new, ${improved.length} fixed and still listed`);
  for (const line of improved.slice(0, 20)) console.log(`[a11y]   can come off the baseline — ${line}`);
  expect(faults, `accessibility faults that were not there before:\n${faults.join("\n")}`).toEqual([]);
}

test.describe("as the organizer", () => {
  test.use({ storageState: ".e2e/organizer.json" });
  test("the organizer's screens and the public pages can be used without sight or a mouse", async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "the console is audited at the width it is worked at");
  test.setTimeout(600_000);
  const record: Baseline = {};
  const faults: string[] = [];
  const improved: string[] = [];
  const anon = await browser.newContext();
  const data = JSON.parse(readFileSync(".e2e/data.json", "utf8")) as { shareToken: string };
  const publicLooked = await sweep(await anon.newPage(), "public", ["/", "/faq", "/privacy", "/terms", "/play", `/live/${data.shareToken}`], record, faults, improved);
  await anon.close();
  const consoleLooked = await sweep(page, "organizer", consoleScreens(), record, faults, improved);
  // CONTROL: the screens were really opened and really audited.
  expect(publicLooked, "the public pages did not open").toBeGreaterThanOrEqual(5);
  expect(consoleLooked, "the organizer's screens did not open — not signed in?").toBeGreaterThan(15);
  settle(record, faults, improved, "desktop");
  });
});

test.describe("as a player", () => {
  test.use({ storageState: ".e2e/player.json" });
  test("a player's screens can be used without sight or a mouse", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "the player's app is audited at a phone's width");
  test.setTimeout(300_000);
  const record: Baseline = {};
  const faults: string[] = [];
  const improved: string[] = [];
  const looked = await sweep(page, "player", playerScreens(), record, faults, improved);
  expect(looked, "the player's screens did not open — not signed in?").toBeGreaterThan(3);
  settle(record, faults, improved, "phone");
  });
});

test("CONTROL: the audit finds a control with no name, a picture with no words and a field with no label", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "one project");
  await page.setContent(`<!doctype html><html lang="en"><head><title>t</title></head><body><main><h1>t</h1>
    <button></button><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw="><input type="text"></main></body></html>`);
  const { found } = await audit(page);
  expect(Object.keys(found).sort()).toEqual(expect.arrayContaining(["button-name", "image-alt", "label"]));
});
