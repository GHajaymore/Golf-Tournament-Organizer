import { test, expect, type Page, type BrowserContext } from "./coverage";
import { createHmac } from "node:crypto";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { consoleScreens } from "./routes";
import { seed, teardown } from "../scripts/seed-club.mjs";

/**
 * EVERY CHOICE THE CONSOLE OFFERS IS KEPT.
 *
 * The second layer of the across-the-board suite (Ajay, 2026-10-10: "it should
 * cover EVERYTHING IN THE APP"). `everything.spec` opens every screen; this
 * OPERATES them. For every dropdown, every group of choices and every tick-box
 * on every console screen, in every tournament the seeded club has, it makes
 * each choice the screen offers, lets the screen save it the way it saves,
 * reloads, and asks the one question that matters: is the screen still showing
 * what was chosen?
 *
 * It is the browser form of sweep 1 — what a screen OFFERS, the server ACCEPTS
 * and the app then READS must be one list — and it exists because that sweep,
 * done by reading code, found about forty places where they were not, after
 * eleven scripted tournaments had passed three times. Two it would have caught
 * on its own: the colour scheme the picker offered and the save refused, and
 * the two "House defaults" that save and are gone on reload.
 *
 * What it reports for each choice:
 *   kept        chosen, saved, reloaded, still chosen
 *   refused     the screen offered it and then showed an error
 *   lost        saved without complaint and not there after a reload
 *   view        it changed what is shown (the address), not what is stored
 *   in a form   part of an "Add…" form that a button sends — another layer's
 *   silent      nothing was sent and nothing changed: a control that does nothing
 *
 * `refused`, `lost` and `silent` are findings. The run prints its reach — how
 * many controls and how many choices — with its result.
 *
 * LONG: several hundred controls, each choice a save and a reload. It runs when
 * `E2E_EVERYTHING` is set (a full round), not on every push.
 */

const FULL = !!process.env.E2E_EVERYTHING;
/** One tournament by slug, for tuning: `E2E_ONLY_EVENT=medal`. */
const ONLY_EVENT = process.env.E2E_ONLY_EVENT ?? "";
/** One screen, named WITHOUT its slash (`E2E_ONLY_SCREEN=event`): Git Bash rewrites a value that starts with one into a Windows path. */
const ONLY_SCREEN = process.env.E2E_ONLY_SCREEN ? `/${process.env.E2E_ONLY_SCREEN.split("/").filter(Boolean).join("/")}` : "";

const sign = (v: string) =>
  `${v}.${createHmac("sha256", process.env.AUTH_SECRET ?? "dev-secret").update(v).digest("base64url")}`;

type Club = Awaited<ReturnType<typeof seed>>;
let club: Club;

const OUT = join(process.cwd(), ".e2e", "every-control");
const LOG = join(OUT, "ledger.tsv");

test.beforeAll(async () => {
  test.skip(!FULL, "the full crawl runs in a round: set E2E_EVERYTHING=1");
  club = await seed();
  mkdirSync(OUT, { recursive: true });
  writeFileSync(LOG, "outcome\ttournament\tscreen\tkind\tcontrol\tchoice\tnote\n");
});

test.afterAll(async () => {
  if (FULL) await teardown();
});

type Kind = "select" | "radio" | "checkbox";
interface Control {
  kind: Kind;
  /** Position among controls of its kind in `main` — how it is found again after a reload. */
  nth: number;
  /** For a radio group: its `name`, or which un-named box of radios it is. */
  group: string;
  /** For a radio group: where each of its radios sits among every radio in `main`. */
  radios: number[];
  label: string;
  /** What can be chosen: option values for a select, positions for radios, "on"/"off" for a tick-box. */
  choices: string[];
  choiceLabels: string[];
  current: string;
  disabled: boolean;
}

/** Every dropdown, choice group and tick-box in the working area — never the sidebar. */
async function controlsOn(page: Page): Promise<Control[]> {
  return page.evaluate(() => {
    const scope = document.querySelector("main") ?? document.body;
    const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
    const labelOf = (el: Element) => {
      const id = el.getAttribute("id");
      const byFor = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
      const field = el.closest(".field");
      return clean(
        el.getAttribute("aria-label") || byFor?.textContent || field?.querySelector("label")?.textContent ||
          el.closest("label")?.textContent || el.getAttribute("title") || el.getAttribute("name"),
      ).slice(0, 70);
    };
    const shown = (el: Element) => {
      const r = (el.closest("label") ?? el).getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const out: Control[] = [];
    [...scope.querySelectorAll("select")].forEach((el, nth) => {
      if (!shown(el)) return;
      const opts = [...el.options].filter((o) => !o.disabled);
      out.push({
        kind: "select", nth, group: "", radios: [], label: labelOf(el), disabled: el.disabled,
        choices: opts.map((o) => o.value), choiceLabels: opts.map((o) => clean(o.textContent).slice(0, 40)), current: el.value,
      });
    });
    // A group is the radios that share a `name` — or, where the screen gives
    // them none (the tournament's settings do not), the radios that share the
    // nearest box holding more than one. The first version read only named
    // groups and so never operated the twenty-odd choices on Tournament
    // details: who may enter scores, how cards are approved, the tee policy.
    const allRadios = [...scope.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    const boxes: Element[] = [];
    const groups = new Map<string, HTMLInputElement[]>();
    for (const el of allRadios) {
      if (!shown(el)) continue;
      let key = el.name ? `name:${el.name}` : "";
      if (!key) {
        let box: Element | null = el.parentElement;
        while (box && box !== scope && box.querySelectorAll('input[type="radio"]').length < 2) box = box.parentElement;
        if (!box || box === scope) continue;
        if (!boxes.includes(box)) boxes.push(box);
        key = `box:${boxes.indexOf(box)}`;
      }
      groups.set(key, [...(groups.get(key) ?? []), el]);
    }
    let g = 0;
    for (const [name, radios] of groups) {
      const fieldset = radios[0].closest("fieldset, .field, .card");
      out.push({
        kind: "radio", nth: g++, group: name, radios: radios.map((r) => allRadios.indexOf(r)), disabled: radios.every((r) => r.disabled),
        label: clean(fieldset?.querySelector("legend, .card-kicker, label, .text-muted")?.textContent).slice(0, 70) || name,
        choices: radios.map((_, i) => String(i)), choiceLabels: radios.map((r) => clean(r.closest("label")?.textContent).slice(0, 40)),
        current: String(radios.findIndex((r) => r.checked)),
      });
    }
    [...scope.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].forEach((el, nth) => {
      if (!shown(el)) return;
      out.push({
        kind: "checkbox", nth, group: "", radios: [], label: labelOf(el), disabled: el.disabled,
        choices: ["on", "off"], choiceLabels: ["ticked", "unticked"], current: el.checked ? "on" : "off",
      });
    });
    return out;
  });
}

/** The same control after a reload: same kind, same place, same label — or it is not the same control. */
async function find(page: Page, was: Control): Promise<Control | null> {
  const now = await controlsOn(page);
  const hit = now.find((c) => c.kind === was.kind && (was.kind === "radio" ? c.radios[0] === was.radios[0] : c.nth === was.nth));
  return hit && hit.label === was.label ? hit : null;
}

async function choose(page: Page, c: Control, choice: string): Promise<void> {
  const scope = page.locator("main");
  if (c.kind === "select") {
    await scope.locator("select").nth(c.nth).selectOption(choice);
  } else if (c.kind === "radio") {
    const radio = scope.locator('input[type="radio"]').nth(c.radios[Number(choice)]);
    // The input is often hidden inside its label: press what a person presses.
    const label = radio.locator("xpath=ancestor::label[1]");
    if (await label.count()) await label.click();
    else await radio.check({ force: true });
  } else {
    const box = scope.locator('input[type="checkbox"]').nth(c.nth);
    const label = box.locator("xpath=ancestor::label[1]");
    const want = choice === "on";
    if ((await box.isChecked()) !== want) {
      if (await label.count()) await label.click();
      else await box.setChecked(want, { force: true });
    }
  }
}

const SAVES = /^(save|apply|update|set|confirm|publish)\b/i;
const SENDS = /^(add|create|send|post|import|draw|generate|start|enter|invite|record|award|make|new|book|sign|join|register)\b/i;
const YES = /^(yes\b|confirm\b|continue anyway|change anyway|i understand|ok$)/i;

interface Outcome {
  outcome: "kept" | "refused" | "lost" | "view" | "in a form" | "blocked" | "silent" | "moved";
  note: string;
}

/**
 * What the screen is saying is WRONG, read off how it says it — an alert, or
 * words set in the danger colour — never off the words themselves.
 *
 * The first version matched new text against a list of unhappy words and
 * reported "How many playing partners must confirm" as a refusal: a heading
 * that appears when a choice opens a further question.
 */
async function complaints(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const scope = document.querySelector("main") ?? document.body;
    for (const el of scope.querySelectorAll<HTMLElement>("*")) {
      if (el.children.length > 3) continue;
      const text = (el.innerText ?? "").replace(/\s+/g, " ").trim();
      if (!text || text.length > 300) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const style = el.getAttribute("style") ?? "";
      const cls = typeof el.className === "string" ? el.className : "";
      const alert = el.getAttribute("role") === "alert";
      if (alert || style.includes("--color-danger") || /\b(error|danger)\b/.test(cls)) out.push(text.slice(0, 200));
    }
    return [...new Set(out)];
  });
}

/**
 * Make one choice the way a person would, and say what became of it.
 */
async function exercise(page: Page, path: string, c: Control, choice: string): Promise<Outcome> {
  const startUrl = page.url();
  let actions = 0;
  const onRequest = (r: { headers(): Record<string, string> }) => {
    if (r.headers()["next-action"]) actions += 1;
  };
  page.on("request", onRequest);
  const textBefore = await page.locator("main").innerText().catch(() => "");
  const complaintsBefore = await complaints(page);
  try {
    await choose(page, c, choice);
    // Some screens save a choice as it is made.
    await page.waitForTimeout(700);
    if (actions === 0 && page.url() === startUrl) {
      // Others have a Save button in the same card or form.
      const control =
        c.kind === "select" ? page.locator("main select").nth(c.nth)
        : c.kind === "radio" ? page.locator('main input[type="radio"]').nth(c.radios[0])
        : page.locator('main input[type="checkbox"]').nth(c.nth);
      const box = control.locator("xpath=ancestor::*[self::form or contains(concat(' ', normalize-space(@class), ' '), ' card ')][1]");
      const tidy = (t: string) => t.replace(/\s+/g, " ").trim();
      let buttons = box.locator("button:enabled");
      let labels = (await buttons.allInnerTexts().catch(() => [])).map(tidy);
      if (!labels.some((t) => SAVES.test(t) || SENDS.test(t))) {
        // A long form keeps its Save at the foot, outside the card the choice
        // sits in: the next Save after the control, in the order of the page.
        // Only a SAVE is looked for this far away: an "Add a course" button
        // further down the page is another form's, not this choice's.
        buttons = control.locator("xpath=following::button[not(@disabled)]");
        labels = (await buttons.allInnerTexts().catch(() => [])).map(tidy);
        const next = labels.findIndex((t) => SAVES.test(t));
        labels = next >= 0 ? labels.slice(0, next + 1) : [];
      }
      const save = labels.findIndex((t) => SAVES.test(t));
      if (save >= 0) {
        await buttons.nth(save).click();
        await page.waitForTimeout(900);
      } else if (labels.some((t) => SENDS.test(t))) {
        return { outcome: "in a form", note: labels.find((t) => SENDS.test(t)) ?? "" };
      } else {
        // A Save that is THERE and cannot be pressed: a launched tournament's
        // setup is locked, and the form says so. That is an answer — provided
        // the screen gives it. A choice that can be made and never saved, with
        // nothing said, is a control that does nothing.
        const dead = (await control.locator("xpath=following::button[@disabled]").allInnerTexts().catch(() => [])).map(tidy);
        if (dead.some((t) => SAVES.test(t) || /^saved$/i.test(t))) {
          const after = await page.locator("main").innerText().catch(() => "");
          const said = after.split("\n").map((l) => l.trim()).find((l) => l && !textBefore.includes(l) && /lock|can.t be changed|read.only|finished|completed/i.test(l));
          return said ? { outcome: "blocked", note: said.slice(0, 140) } : { outcome: "silent", note: "its Save button is disabled and nothing says why" };
        }
      }
    }
    // A choice that changes a played round asks first.
    const yes = page.locator("button:visible").filter({ hasText: YES }).first();
    if (await yes.count()) {
      await yes.click().catch(() => {});
      await page.waitForTimeout(900);
    }
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});

    if (page.url() !== startUrl && actions === 0) return { outcome: "view", note: new URL(page.url()).search };
    const textAfter = await page.locator("main").innerText().catch(() => "");
    const fresh = textAfter.split("\n").filter((line) => line.trim() && !textBefore.includes(line.trim()));
    const trouble = (await complaints(page)).find((line) => !complaintsBefore.includes(line));
    if (actions === 0) {
      return fresh.length ? { outcome: "view", note: "changed what is shown, sent nothing" } : { outcome: "silent", note: "" };
    }
    if (trouble) return { outcome: "refused", note: trouble.trim().slice(0, 160) };

    await page.goto(`${path}?kept=${Date.now()}`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
    const again = await find(page, c);
    if (!again) return { outcome: "moved", note: "the control is not where it was after the save" };
    return again.current === choice
      ? { outcome: "kept", note: "" }
      : { outcome: "lost", note: `shows "${again.choiceLabels[again.choices.indexOf(again.current)] ?? again.current}" after a reload` };
  } finally {
    page.off("request", onRequest);
  }
}

async function signIn(context: BrowserContext, baseURL: string, session: string, eventId: string) {
  await context.clearCookies();
  await context.addCookies([
    { name: "ng_session", value: session, url: baseURL },
    { name: "ng_active_event", value: sign(eventId), url: baseURL },
  ]);
}

test("every dropdown, choice and tick-box on every console screen keeps what is chosen", async ({ page, context, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "the console's controls are operated at the desktop width");
  test.setTimeout(6 * 60 * 60 * 1000);

  const screens = consoleScreens().filter((p) => !ONLY_SCREEN || p === ONLY_SCREEN);
  const events = club.events.filter((e) => !ONLY_EVENT || e.slug === ONLY_EVENT);
  const tally: Record<string, number> = {};
  const findings: string[] = [];
  /** A control met on one tournament is not re-operated on the next: the screen and label are the control. */
  const done = new Set<string>();
  const met = new Set<string>();
  /** Controls no tournament ever let the crawl save — reported, so "everything" is not claimed for them. */
  const unsettled = new Map<string, string>();
  let controls = 0;
  let choices = 0;

  for (const event of events) {
    await signIn(context, baseURL!, club.organizer.session, event.id);
    for (const path of screens) {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
      if (new URL(page.url()).pathname !== path) continue;
      const here = (await controlsOn(page)).filter((c) => !c.disabled && c.choices.length > 1);
      for (const c of here) {
        const key = `${path}|${c.kind}|${c.label}|${c.choices.length}`;
        if (done.has(key)) continue;
        // Counted once, but only SETTLED once it has actually been saved
        // somewhere: a control that is locked on a live tournament is met
        // again on the draft, where it can be.
        if (!met.has(key)) controls += 1;
        met.add(key);
        // Every choice of a short list; the first, middle and last of a long one.
        const others = c.choices.filter((v) => v !== c.current);
        const picks = others.length <= 6 ? others : [others[0], others[Math.floor(others.length / 2)], others[others.length - 1]];
        for (const pick of picks) {
          // A fresh page for each choice: the last one may have re-drawn the screen.
          await page.goto(path, { waitUntil: "domcontentloaded" });
          await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
          const now = await find(page, c);
          if (!now || now.disabled || !now.choices.includes(pick)) continue;
          choices += 1;
          const result = await exercise(page, path, now, pick).catch((e) => ({ outcome: "silent" as const, note: `threw: ${String(e).slice(0, 120)}` }));
          tally[result.outcome] = (tally[result.outcome] ?? 0) + 1;
          if (result.outcome === "kept" || result.outcome === "lost" || result.outcome === "refused" || result.outcome === "in a form") {
            done.add(key);
            unsettled.delete(key);
          } else if (!done.has(key)) {
            unsettled.set(key, result.outcome);
          }
          const choiceName = c.choiceLabels[c.choices.indexOf(pick)] ?? pick;
          appendFileSync(LOG, [result.outcome, event.slug, path, c.kind, c.label, choiceName, result.note].join("\t") + "\n");
          if (result.outcome === "refused" || result.outcome === "lost" || result.outcome === "silent") {
            findings.push(`${result.outcome.toUpperCase()} · ${event.slug} ${path} · ${c.label || c.kind} → ${choiceName}${result.note ? ` · ${result.note}` : ""}`);
          }
          // Put it back, so the next control meets the tournament as it was.
          if (result.outcome === "kept" || result.outcome === "lost") {
            await page.goto(path, { waitUntil: "domcontentloaded" });
            await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
            const back = await find(page, c);
            if (back && back.current !== c.current && back.choices.includes(c.current)) await exercise(page, path, back, c.current).catch(() => {});
          }
        }
      }
    }
  }

  console.log(`[every-control] ${controls} controls, ${choices} choices made: ${JSON.stringify(tally)}; ${findings.length} findings`);
  const never = [...unsettled.entries()].map(([k, why]) => `${k.split("|").slice(0, 3).join(" · ")} (${why})`);
  console.log(`[every-control] ${never.length} controls were never saved on any tournament (views, or locked everywhere):`);
  console.log(never.map((n) => `[every-control]   ${n}`).join("\n"));
  console.log(findings.map((f) => `[every-control]   ${f}`).join("\n"));
  // CONTROL: a crawl that operated almost nothing passes by doing nothing.
  if (!ONLY_EVENT && !ONLY_SCREEN) expect(controls, "the crawl found almost no controls").toBeGreaterThan(150);
  expect(tally.kept ?? 0, "nothing was ever kept — the crawl is not saving anything").toBeGreaterThan(0);
  expect(findings, `${findings.length} findings across ${choices} choices on ${controls} controls`).toEqual([]);
});
