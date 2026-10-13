import { test, expect, type Page, type BrowserContext } from "./coverage";
import { createHmac } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { consoleScreens, playerScreens } from "./routes";
import { watchPageErrors } from "./page-errors";
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
 *   ruled       refused by a rule somebody decided, with the reason shown
 *               (`RULED` lists each one and why)
 *   asks first  the screen put a question before doing something it will not
 *               undo; the crawl does not answer it
 *   lost        saved without complaint and not there after a reload
 *   view        it changed what is shown, not what is stored
 *   in a form   part of an "Add…" form that a button sends — another layer's
 *   blocked     its Save is disabled and the screen says why (setup is locked)
 *   silent      nothing was sent and nothing changed: a control that does nothing
 *   moved       after saving, the control is no longer on the screen
 *   stuck       nothing came back in a minute
 *
 * `refused`, `lost`, `silent`, `moved` and `stuck` are findings. Every saved
 * choice names the server action that took it. The run prints its reach — how
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
    // OPEN WHAT A PERSON WOULD OPEN. "League settings" folds itself away once
    // the league is on, and a control inside a closed disclosure is on the
    // page and not on the screen: the crawl found it, could not operate it,
    // and that is the control the first full run waited on for ever.
    scope.querySelectorAll<HTMLDetailsElement>("details:not([open])").forEach((d) => {
      d.open = true;
    });
    const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
    /**
     * A LABEL WRAPPED ROUND ITS CONTROL IS NAMED BY ITS FIRST LINE.
     *
     * Such a label often carries a sentence under the name saying what the
     * setting does, and the sentence may change with the setting: "Require a
     * mobile number" reads "…but accepts an entry without one" unticked and
     * "…and won't accept an entry without one" ticked. Named by its whole text,
     * that control had one name before the tick and another after, and `find`
     * — same kind, same place, same name — reported it gone: three "moved"
     * findings in the first round after the seeded club went onto a paid plan,
     * which is what unlocked the tick (round G29-1, 2026-10-13). The control
     * had not moved. Its description had done what a description is for.
     *
     * Whichever label is the one that names it — its own, or the first in its
     * field, which for this tick is the same element: the first attempt at this
     * changed only the last rung below, and the rung above it had already
     * answered with the whole text. Only for a tick-box or a choice: a label
     * wrapped round a dropdown has the dropdown's options in its text, and those
     * names are keys in the tables further down.
     */
    const nameOf = (label: Element | null | undefined, el: Element) => {
      if (!label) return null;
      const wrapsATick = label.contains(el) && el instanceof HTMLInputElement;
      if (!wrapsATick) return label.textContent;
      return ((label as HTMLElement).innerText ?? "").split("\n").find((line) => line.trim()) ?? label.textContent;
    };
    const labelOf = (el: Element) => {
      const id = el.getAttribute("id");
      const byFor = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
      const field = el.closest(".field");
      return clean(
        el.getAttribute("aria-label") || nameOf(byFor, el) || nameOf(field?.querySelector("label"), el) ||
          nameOf(el.closest("label"), el) || el.getAttribute("title") || el.getAttribute("name"),
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
const SENDS = /^(add|create|send|post|import|draw|generate|start|enter|invite|record|award|make|new|book|sign|join|register|disqualify|reinstate|withdraw|approve|issue|pair|swap|move)\b/i;
const YES = /^(yes\b|confirm\b|continue anyway|change anyway|i understand|ok$)/i;
/** A question the screen puts before doing something it will not undo. Not pressed: being asked is the answer. */
const ASKS = /\banyway\b|are you sure/i;

/**
 * CONTROLS THAT CHOOSE WHAT A FORM IS ABOUT, not what is stored — keyed on
 * screen and label, each with its reason. A crawl that presses Save after
 * choosing one saves an untouched card for somebody and then reports the
 * picker "lost" when a reload shows the first name again (first full run,
 * 2026-10-10).
 */
const PICKERS: Record<string, string> = {
  "/entry|Player": "whose card is on screen",
  // Two unplayed league weeks look the same, so switching between them
  // changes no word on the page and read as a control that does nothing.
  "/entry|Round to enter scores for": "which round's scores are on screen",
  // The same, between two brackets nobody has been drawn into yet.
  "/bracket|name:brk": "which of the two brackets is drawn",
};

/**
 * INPUTS TO SOMETHING THAT IS BUILT AND THEN SAVED WHOLE, keyed the same way.
 * The tee sheet's group size is not a setting: it shapes the draw, and what
 * is saved is the sheet. Once a sheet is saved the builder is put away until
 * "Re-draw", so a crawl that saves and reloads finds the control gone and
 * calls it moved.
 */
const BUILDERS: Record<string, string> = {
  "/foursomes|Group size": "an input to the draw; what is saved is the sheet it draws",
  "/foursomes|Start": "one tee or two — an input to the draw, saved as the sheet it draws",
};

/**
 * REFUSALS THAT ARE THE RULE. The screen offers the choice, refuses it and
 * says why in words a secretary can act on. Each is a decision somebody
 * made; anything not listed here is a finding.
 */
const RULED: Array<{ screen: string; says: RegExp; why: string }> = [
  { screen: "/organization", says: /only Commissioner/i, why: "a club keeps at least one Commissioner; the refusal names the remedy" },
  { screen: "/access", says: /only organi[sz]er/i, why: "a tournament keeps at least one organizer; the warning names the remedy" },
  { screen: "/foursomes", says: /Hole \d+: Paces/i, why: "a pin's side means nothing without its paces; the refusal names the hole" },
];

/** Server action id → its exported name, off the build the crawl is running against. */
const ACTION_NAMES: Record<string, string> = (() => {
  try {
    const manifest = JSON.parse(
      readFileSync(join(process.cwd(), process.env.NEXT_DIST_DIR ?? ".next-e2e", "server", "server-reference-manifest.json"), "utf8"),
    ) as { node?: Record<string, { exportedName?: string }> };
    return Object.fromEntries(Object.entries(manifest.node ?? {}).map(([id, e]) => [id, e.exportedName ?? "?"]));
  } catch {
    return {};
  }
})();

interface Outcome {
  outcome: "kept" | "refused" | "ruled" | "asks first" | "lost" | "view" | "in a form" | "blocked" | "silent" | "moved" | "stuck";
  note: string;
}

/**
 * What the screen is saying is WRONG, read off how it says it — an alert, or
 * words set in the danger colour — never off the words themselves.
 *
 * The first version matched new text against a list of unhappy words and
 * reported "How many playing partners must confirm" as a refusal: a heading
 * that appears when a choice opens a further question. The second read a
 * BUTTON's label as a complaint — "Delete this society" is drawn in the
 * danger colour and its wording follows the club's kind — so anything that is
 * a control, or inside one, is not a message.
 */
async function complaints(page: Page, c: Control): Promise<string[]> {
  const selector = c.kind === "select" ? "select" : c.kind === "radio" ? 'input[type="radio"]' : 'input[type="checkbox"]';
  const index = c.kind === "radio" ? c.radios[0] : c.nth;
  return page.evaluate(({ selector, index }) => {
    const out: string[] = [];
    const scope = document.querySelector("main") ?? document.body;
    const control = scope.querySelectorAll(selector)[index] ?? null;
    for (const el of scope.querySelectorAll<HTMLElement>("*")) {
      if (el.children.length > 3) continue;
      if (el.closest("button, a, [role=button], select, label")) continue;
      // ABOUT THIS CONTROL: in its own part of the screen, or in no card at
      // all (a banner over the page). Red words in somebody else's card are
      // that card's — "Delete this society" is a heading in the danger
      // colour whose wording follows the club's kind, and was read as the
      // screen refusing a change it had just made.
      const home = el.closest("form, section, .card");
      if (home && control && !home.contains(control) && el.getAttribute("role") !== "alert") continue;
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
  }, { selector, index });
}

/**
 * How the control's own part of the screen is saved, worked out the way a
 * person would: the Save in the same card; failing that the form's own
 * button; failing that a Save further out that is not somebody else's.
 *
 *   save      a Save that can be pressed — marked `data-crawl-save` to press
 *   form      the card sends with an Add / Create / Invite… button: the
 *             choice is one field of a form, and is another layer's to test
 *   locked    a Save that is there and disabled
 *   none      nothing saves this by a button — it saves as it is made, or
 *             it is a view
 *
 * THE FAR SAVE IS NEVER ANOTHER CARD'S. The first full run pressed "Save pin
 * sheet" for the tee sheet's "Group 1" tick-box, three cards up the page,
 * and reported forty-three choices lost. A Save outside the control's own
 * card counts only if it sits in no card of its own (the foot of a long
 * form) or in one that contains the control.
 */
async function saveFor(page: Page, c: Control): Promise<{ how: "save" | "form" | "locked" | "none"; label: string }> {
  const selector = c.kind === "select" ? "select" : c.kind === "radio" ? 'input[type="radio"]' : 'input[type="checkbox"]';
  const index = c.kind === "radio" ? c.radios[0] : c.nth;
  return page.evaluate(
    ({ selector, index, saves, sends }) => {
      const scope = document.querySelector("main") ?? document.body;
      const control = scope.querySelectorAll(selector)[index];
      if (!control) return { how: "none" as const, label: "" };
      const SAVE = new RegExp(saves, "i");
      const SEND = new RegExp(sends, "i");
      const tidy = (el: Element) => (el.textContent ?? "").replace(/\s+/g, " ").trim();
      const BOX = "form, section, .card";
      document.querySelectorAll("[data-crawl-save]").forEach((el) => el.removeAttribute("data-crawl-save"));

      const box = control.closest(BOX);
      const inBox = box ? [...box.querySelectorAll<HTMLButtonElement>("button")] : [];
      const open = inBox.filter((b) => !b.disabled);
      const save = open.find((b) => SAVE.test(tidy(b)));
      if (save) {
        save.setAttribute("data-crawl-save", "1");
        return { how: "save" as const, label: tidy(save) };
      }
      const send = inBox.find((b) => SEND.test(tidy(b)));
      // Enabled or not: an Add button waiting on a name is still the form's.
      if (send) return { how: "form" as const, label: tidy(send) };
      const shut = inBox.find((b) => b.disabled && (SAVE.test(tidy(b)) || /^saved$/i.test(tidy(b))));
      if (shut) return { how: "locked" as const, label: tidy(shut) };

      // Further out: the next Save down the page that is not another card's.
      const after = [...scope.querySelectorAll<HTMLButtonElement>("button")].filter(
        (b) => control.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING,
      );
      for (const b of after) {
        const label = tidy(b);
        if (!SAVE.test(label) && !/^saved$/i.test(label)) continue;
        const home = b.closest(BOX);
        if (home && !home.contains(control)) continue;
        if (b.disabled) return { how: "locked" as const, label };
        b.setAttribute("data-crawl-save", "1");
        return { how: "save" as const, label };
      }
      return { how: "none" as const, label: "" };
    },
    { selector, index, saves: SAVES.source, sends: SENDS.source },
  );
}

/**
 * Make one choice the way a person would, and say what became of it.
 */
async function exercise(page: Page, path: string, c: Control, choice: string): Promise<Outcome> {
  const picker = PICKERS[`${path}|${c.label}`];
  const startUrl = page.url();
  const fired: string[] = [];
  const onRequest = (r: { headers(): Record<string, string> }) => {
    const id = r.headers()["next-action"];
    if (id) fired.push(ACTION_NAMES[id] ?? id.slice(0, 8));
  };
  page.on("request", onRequest);
  const textBefore = await page.locator("main").innerText().catch(() => "");
  const complaintsBefore = await complaints(page, c);
  const buttonsBefore = (await page.locator("main button:visible").allInnerTexts().catch(() => [])).map((t) => t.trim());
  const by = () => (fired.length ? [...new Set(fired)].join(", ") : "");
  try {
    await choose(page, c, choice);
    // Some screens save a choice as it is made.
    await page.waitForTimeout(700);
    if (picker) return { outcome: "view", note: `chooses ${picker}` };
    const builder = BUILDERS[`${path}|${c.label}`];
    if (builder) return { outcome: "in a form", note: builder };
    if (fired.length === 0 && page.url() === startUrl) {
      const save = await saveFor(page, c);
      if (save.how === "form") return { outcome: "in a form", note: save.label };
      if (save.how === "save") {
        await page.locator("[data-crawl-save]").first().click();
        await page.waitForTimeout(900);
      } else if (save.how === "locked") {
        // A Save that is THERE and cannot be pressed: a launched tournament's
        // setup is locked, and the form says so. That is an answer — provided
        // the screen gives it. A choice that can be made and never saved, with
        // nothing said, is a control that does nothing.
        const after = await page.locator("main").innerText().catch(() => "");
        const said = after.split("\n").map((l) => l.trim()).find((l) => l && !textBefore.includes(l) && /lock|can.t be changed|read.only|finished|completed/i.test(l));
        return said ? { outcome: "blocked", note: said.slice(0, 140) } : { outcome: "silent", note: `its "${save.label}" button is disabled and nothing says why` };
      }
    }
    // A choice that changes a played round asks first.
    const yes = page.locator("button:visible").filter({ hasText: YES }).first();
    if (await yes.count()) {
      await yes.click().catch(() => {});
      await page.waitForTimeout(900);
    }
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});

    if (page.url() !== startUrl && fired.length === 0) return { outcome: "view", note: new URL(page.url()).search };
    const textAfter = await page.locator("main").innerText().catch(() => "");
    const fresh = textAfter.split("\n").filter((line) => line.trim() && !textBefore.includes(line.trim()));
    const trouble = (await complaints(page, c)).find((line) => !complaintsBefore.includes(line));
    // A question with its own button, that this does not press: the screen
    // asked before doing something it would not undo.
    const question = (await page.locator("main button:visible").allInnerTexts().catch(() => []))
      .map((t) => t.trim())
      .find((t) => ASKS.test(t) && !buttonsBefore.includes(t));
    if (question) return { outcome: "asks first", note: `${question}${trouble ? ` · ${trouble.trim().slice(0, 110)}` : ""}` };
    if (trouble) {
      const rule = RULED.find((r) => r.screen === path && r.says.test(trouble));
      return { outcome: rule ? "ruled" : "refused", note: `${trouble.trim().slice(0, 160)}${by() ? ` · ${by()}` : ""}` };
    }
    if (fired.length === 0) {
      return fresh.length ? { outcome: "view", note: "changed what is shown, sent nothing" } : { outcome: "silent", note: "" };
    }

    await page.goto(`${path}?kept=${Date.now()}`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
    const again = await find(page, c);
    if (!again) return { outcome: "moved", note: `the control is not where it was after ${by()}` };
    return again.current === choice
      ? { outcome: "kept", note: by() }
      : { outcome: "lost", note: `shows "${again.choiceLabels[again.choices.indexOf(again.current)] ?? again.current}" after a reload · ${by()}` };
  } finally {
    page.off("request", onRequest);
  }
}

/** `exercise`, held to a time: one control that never answers must not stop the other six hundred. */
async function exerciseWithin(page: Page, path: string, c: Control, choice: string, ms = 60_000): Promise<Outcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<Outcome>((resolve) => {
    timer = setTimeout(() => resolve({ outcome: "stuck", note: `nothing came back in ${ms / 1000}s` }), ms);
  });
  try {
    return await Promise.race([exercise(page, path, c, choice).catch((e) => ({ outcome: "stuck" as const, note: `threw: ${String(e).slice(0, 140)}` })), late]);
  } finally {
    clearTimeout(timer);
  }
}

/** Outcomes after which a control has been answered for, and is not operated again on the next tournament. */
const SETTLES = new Set<Outcome["outcome"]>(["kept", "lost", "refused", "ruled", "asks first", "in a form"]);
/** Outcomes that are something wrong, or something nobody has yet looked at. */
const FINDINGS = new Set<Outcome["outcome"]>(["refused", "lost", "silent", "moved", "stuck"]);

async function signIn(context: BrowserContext, baseURL: string, session: string, eventId: string) {
  await context.clearCookies();
  await context.addCookies([
    { name: "ng_session", value: session, url: baseURL },
    { name: "ng_active_event", value: sign(eventId), url: baseURL },
  ]);
}

/** One crawl: who is operating, the screens they have, and how many controls would be too few to believe. */
interface Run {
  who: string;
  session: string;
  screens: string[];
  atLeast: number;
}

async function crawl(page: Page, context: BrowserContext, baseURL: string, run: Run) {
  // EVERY ACTION HAS A LIMIT. With a six-hour test and no limit of their own,
  // a click on a button that never becomes pressable waits six hours: the
  // first full run sat on one control for eleven minutes before it was
  // stopped by hand. `exerciseWithin` bounds the whole choice as well.
  page.setDefaultTimeout(8_000);
  page.setDefaultNavigationTimeout(30_000);

  // A SCREEN THAT THROWS IS A FINDING, whatever the control then did. The crawl
  // did not listen, so when it set a tournament to Korea and every load of
  // Tournament details threw a hydration mismatch, the crawl reported nothing
  // and passed (2026-10-11). It reloads each screen hundreds of times in
  // states no other spec puts it in — the best listener the suite has.
  const threw: string[] = [];
  watchPageErrors(page, threw, run.who);
  const screens = run.screens.filter((p) => !ONLY_SCREEN || p === ONLY_SCREEN);
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
    await signIn(context, baseURL, run.session, event.id);
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
          const result = await exerciseWithin(page, path, now, pick);
          tally[result.outcome] = (tally[result.outcome] ?? 0) + 1;
          if (SETTLES.has(result.outcome)) {
            done.add(key);
            unsettled.delete(key);
          } else if (!done.has(key)) {
            unsettled.set(key, result.outcome);
          }
          const choiceName = c.choiceLabels[c.choices.indexOf(pick)] ?? pick;
          // One line a choice: a thrown error's message has newlines and tabs in it.
          const flat = (s: string) => s.replace(/\s+/g, " ").trim();
          appendFileSync(LOG, [result.outcome, event.slug, path, c.kind, flat(c.label), flat(choiceName), flat(result.note)].join("\t") + "\n");
          if (FINDINGS.has(result.outcome)) {
            findings.push(`${result.outcome.toUpperCase()} · ${event.slug} ${path} · ${c.label || c.kind} → ${choiceName}${result.note ? ` · ${result.note}` : ""}`);
          }
          // Put it back, so the next control meets the tournament as it was.
          if (result.outcome === "kept" || result.outcome === "lost") {
            await page.goto(path, { waitUntil: "domcontentloaded" });
            await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
            const back = await find(page, c);
            if (back && back.current !== c.current && back.choices.includes(c.current)) await exerciseWithin(page, path, back, c.current);
          }
        }
      }
    }
  }

  for (const e of [...new Set(threw)]) findings.push(`THREW · ${e.slice(0, 200)}`);
  console.log(`[every-control] ${run.who}: ${controls} controls, ${choices} choices made: ${JSON.stringify(tally)}; ${findings.length} findings`);
  const never = [...unsettled.entries()].map(([k, why]) => `${k.split("|").slice(0, 3).join(" · ")} (${why})`);
  console.log(`[every-control] ${never.length} controls were never saved on any tournament (views, or locked everywhere):`);
  console.log(never.map((n) => `[every-control]   ${n}`).join("\n"));
  console.log(findings.map((f) => `[every-control]   ${f}`).join("\n"));
  // CONTROL: a crawl that operated almost nothing passes by doing nothing.
  if (!ONLY_EVENT && !ONLY_SCREEN) expect(controls, "the crawl found almost no controls").toBeGreaterThan(run.atLeast);
  if (run.atLeast > 0) expect(tally.kept ?? 0, "nothing was ever kept — the crawl is not saving anything").toBeGreaterThan(0);
  expect(findings, `${findings.length} findings across ${choices} choices on ${controls} controls`).toEqual([]);
}

test("every dropdown, choice and tick-box on every console screen keeps what is chosen", async ({ page, context, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "the console's controls are operated at the desktop width");
  test.setTimeout(6 * 60 * 60 * 1000);
  await crawl(page, context, baseURL!, { who: "secretary", session: club.organizer.session, screens: consoleScreens(), atLeast: 150 });
});

/**
 * THE SAME CRAWL, AS A MEMBER, ON THE PLAYER'S SCREENS (2026-10-11).
 *
 * Ajay asked for three clean runs of the player side on its own. The player
 * app is mostly buttons — enter, withdraw, the card — so it has far fewer
 * dropdowns and tick-boxes than the console, and no minimum is claimed: the
 * run prints how many it found. What it does find is held to the same rule: a
 * choice made is a choice kept, on every tournament the member can open.
 */
test("every dropdown, choice and tick-box on every player screen keeps what is chosen", async ({ page, context, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "the player's controls are operated at a phone's width");
  test.setTimeout(2 * 60 * 60 * 1000);
  await crawl(page, context, baseURL!, { who: "member", session: club.player.session, screens: playerScreens(), atLeast: 0 });
});
