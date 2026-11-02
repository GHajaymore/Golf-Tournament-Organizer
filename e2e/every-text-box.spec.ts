import { test, expect, type Page, type BrowserContext } from "./coverage";
import { createHmac } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { consoleScreens, playerScreens } from "./routes";
import { watchPageErrors } from "./page-errors";
import { seed, teardown } from "../scripts/seed-club.mjs";
import { TEXT_PARTS } from "../scripts/qa/layers.mjs";
import { heldInstead, holdsTheSame, howItSaves, newlyShown, refusalGap, spacedValue, type Matched, type Shown } from "./text-box-reading";

/**
 * EVERY TEXT BOX IS GIVEN EMPTY, OVER-LONG, BAD AND GOOD INPUT, AND READ BACK.
 *
 * The third layer of the across-the-board suite, beside `every-control.spec`
 * (which makes every choice every dropdown, choice group and tick-box offers).
 * That crawl left the TEXT BOXES — a third of the console's controls — to
 * whichever spec happened to type into one. Nothing tried each of them with the
 * input a person actually gives a box: nothing, far too much, the wrong kind of
 * thing, and the right thing.
 *
 * For every text box (a text-like `<input>`, a `<textarea>`) on every console
 * screen and every player screen, in every tournament of the seeded club, it
 * records what the box holds and then tries, each on a fresh page:
 *
 *   empty      ""
 *   over-long  one character past its maxLength, or 2,000 where it has none
 *   bad        junk for its kind: letters in a figure, "12,4x", a lone emoji,
 *              leading and trailing spaces, <b>HTML</b>
 *   good       a valid value of its kind, different from what it held
 *
 * saves each the way the screen saves it (its own Save, the form's Add, or
 * leaving the box where it saves as it is left), reloads, and says what became
 * of it:
 *
 *   kept               the good value saved and shown after a reload
 *   accepted           bad or odd input stored where a box may take anything
 *   refused in view    a refusal said on the screen within ~200px of the press,
 *                      or the browser's own check on the box, or a button that
 *                      will not press with the box as it is
 *   view               the box shapes what is shown (a filter) and stores nothing
 *   cut                over-long input stored shortened, the box having a limit
 *                      (or the box itself would not take it all)
 *   ruled              looks like a finding and is a rule somebody made (`RULED`)
 *   skipped            not tried, with the reason (it sends or deletes, it spends
 *                      an allowance, it is a picker, …)
 *
 * and, as FINDINGS:
 *
 *   refused out of view  the refusal came, and not where the press was
 *                        (CLAUDE.md, "A REFUSAL IS SAID WHERE THE PRESS WAS")
 *   cut silently         over-long input stored shortened by the server, with no
 *                        limit on the box to say so
 *   stored junk          a figure of letters, a blank name, an address that is
 *                        not one, markup drawn as markup — stored and shown
 *   error page           a page error, a 5xx answer, "Application error"
 *   lost                 the good value saved without complaint and gone on reload
 *   silent               pressed, and nothing said and nothing kept
 *   not restored         the box could not be put back as it was
 *
 * EVERY BOX IS PUT BACK. After its four tries the box is given its first value
 * again and saved, and that is checked. A box whose only way to be saved is a
 * button that sends, publishes, deletes or withdraws is never pressed:
 * `skipped: sends`. An "Add" form is pressed — it adds a row to a club that is
 * thrown away at the end — and never anything that cannot be undone by the
 * teardown.
 *
 * A CONTROL IN EVERY SHARE. A crawl that reports nothing may be blind, so before
 * it starts each share breaks one box three ways on purpose — a Save whose press
 * is swallowed, a refusal printed far above the press, and a save the server
 * answers with a 500 — and requires the crawl to call them `silent`,
 * `refused out of view` and not `kept`. If it cannot see a fault it made itself,
 * its silence about the app means nothing.
 *
 * LONG: every box is a dozen loads. It runs as its own layer of a round
 * (`text-boxes` in `scripts/qa/layers.mjs`), cut into `TEXT_PARTS` shares by
 * `--shard` — one test per share, so Playwright's shards are exactly the shares
 * — and only when `E2E_EVERYTHING` and `E2E_TEXT_BOXES` are set; the standing
 * suite does not even load it (`testIgnore` in playwright.config.ts).
 *
 *   E2E_EVERYTHING=1 E2E_TEXT_BOXES=1 npx playwright test e2e/every-text-box.spec.ts --project=desktop --shard=2/6
 *
 * Tuning: `E2E_ONLY_EVENT=<slug>`, `E2E_ONLY_SCREEN=<name, no slash>`,
 * `E2E_ONLY_BOX=<words in its label>`, and `E2E_TEXT_INVENTORY=1` to list the
 * boxes without typing into any.
 *
 * WHAT IT CANNOT SEE: whether a value it calls kept is the RIGHT value for the
 * club (that is the specs' and the scenarios' job); a box that only appears
 * after a press it does not make (a dialog, a second step of a form); and
 * whether "accepted" input should have been refused where it judged that a box
 * may take anything — the ledger prints every one, to be read.
 */

const FULL = !!process.env.E2E_EVERYTHING;
const INVENTORY = process.env.E2E_TEXT_INVENTORY === "1";
const ONLY_EVENT = process.env.E2E_ONLY_EVENT ?? "";
/** Named WITHOUT its slash: Git Bash rewrites a value that starts with one into a Windows path. */
const ONLY_SCREEN = process.env.E2E_ONLY_SCREEN ? `/${process.env.E2E_ONLY_SCREEN.split("/").filter(Boolean).join("/")}` : "";
const ONLY_BOX = (process.env.E2E_ONLY_BOX ?? "").toLowerCase();
/** `E2E_TEXT_SHARES=1` runs the whole crawl as one test, on one machine — for tuning, never in a round. */
const PARTS: number = Number(process.env.E2E_TEXT_SHARES) || TEXT_PARTS;

const sign = (v: string) => `${v}.${createHmac("sha256", process.env.AUTH_SECRET ?? "dev-secret").update(v).digest("base64url")}`;

/** Which share a box belongs to: from its own name, so it is the same share on every machine and every run. */
const shareOf = (key: string) => {
  let h = 0;
  for (let i = 0; i < key.length; i += 1) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return (h % PARTS) + 1;
};

const OUT = join(process.cwd(), ".e2e", "every-text-box");
/** The share's ledger, written a line at a time as the crawl goes. */
let liveLog = "";
const HEADER = "outcome\twho\ttournament\tscreen\tbox\tkind\tsaved by\ttry\tvalue\tnote";

type Kind = "figure" | "email" | "phone" | "web" | "name" | "words";
interface Box {
  /** Position among the text boxes in `main` — how it is found again after a reload. */
  nth: number;
  tag: "input" | "textarea";
  type: string;
  label: string;
  kind: Kind;
  value: string;
  maxLength: number;
  required: boolean;
  /** `type="number"`: the browser will not let letters be typed into it at all. */
  numberType: boolean;
  /** How the box is saved, worked out the way a person would. */
  save: { how: "save" | "form" | "leave" | "skip"; label: string; why: string };
  /** The Save or Add it was matched to, and where the two sit — see `howItSaves`. */
  addAt?: Matched;
}

/** Words on a button that this crawl never presses. */
const NEVER = /\b(delete|remove|withdraw|clear|send|publish|post|invite|e-?mail|message|notify|broadcast|announce|disqualify|reinstate|reset|cancel|archive|issue|draw|generate|start|launch|import|sign|join|register|approve|swap|move|pair|lock|unlock|close|finish|certify|copy|duplicate|record|award|enter|reply|text|search|find|look ?up|check|pay|buy|upgrade|redeem)\b/i;
/** A button that saves what is in its card. */
const SAVES = /^(save|update|apply|set|rename|change|keep|use this)\b/i;
/** A button that adds what is in its form as a new row. */
const ADDS = /^(add|create|new)\b/i;
/**
 * INPUTS TO SOMETHING THAT IS BUILT AND THEN SAVED WHOLE, keyed on screen and label, each with its
 * reason — `BUILDERS` in every-control.spec, for the same screen. The tee sheet's interval shapes the
 * draw; what "Save sheet" stores is the sheet, after which the builder is put away. Pressing it saves a
 * tee sheet nobody asked for, and the box is gone from the screen.
 */
const BUILDERS: Record<string, string> = {
  "/foursomes|Interval (min)": "an input to the draw; what is saved is the sheet it draws, and the builder is then put away",
};

/** Boxes (by their label) that spend an allowance or look things up elsewhere: never typed into. */
const ALLOWANCE = /directory|find a course|look ?up|^address$|postcode|zip code|course search/i;

/**
 * ONE BOX, HOWEVER MANY ROWS DRAW IT. "Handicap for Gordon Pyle" and "Handicap for Noor Al-Rashidi" are
 * the same box on two rows of one list, and "Hole 7, par 3" is the same box as "Hole 8, par 4": the
 * first inventory found 268 boxes on the screens, 96 of them the holes of one score-entry screen and
 * thirty the handicap column of Entries. Each shape is tried once, on the first row met, and the count
 * of every row drawn is reported beside it.
 */
const shapeOf = (label: string) =>
  label
    .replace(/\d+/g, "#")
    .replace(/^(.*?\b(?:for|of))\s.+$/i, "$1 …")
    .replace(/^[^,]+,\s*(hole\b.*)$/i, "…, $1");

/** Every text box in the working area — never the sidebar — with how it is saved. */
async function boxesOn(page: Page): Promise<Box[]> {
  return page.evaluate(
    ({ never, saves, adds, allowance }) => {
      const NEVER = new RegExp(never, "i");
      const SAVES = new RegExp(saves, "i");
      const ADDS = new RegExp(adds, "i");
      const ALLOWANCE = new RegExp(allowance, "i");
      const scope = document.querySelector("main") ?? document.body;
      // Open what a person would open: a box inside a closed disclosure is on the page and not on the screen.
      scope.querySelectorAll<HTMLDetailsElement>("details:not([open])").forEach((d) => {
        d.open = true;
      });
      const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
      const firstLine = (el: Element | null) => (el ? ((el as HTMLElement).innerText ?? el.textContent ?? "").split("\n").find((l) => l.trim()) ?? "" : "");
      const labelOf = (el: HTMLInputElement | HTMLTextAreaElement) => {
        const id = el.getAttribute("id");
        const byFor = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
        const field = el.closest(".field");
        return clean(
          el.getAttribute("aria-label") ||
            firstLine(byFor) ||
            firstLine(field?.querySelector("label") ?? null) ||
            firstLine(el.closest("label")) ||
            el.getAttribute("placeholder") ||
            el.getAttribute("title") ||
            el.getAttribute("name"),
        ).slice(0, 70);
      };
      const TEXTY = new Set(["text", "email", "tel", "url", "number"]);
      // Every mark from an earlier count goes first: a box drawn anew keeps no stale number to be found by.
      document.querySelectorAll("[data-tb-nth]").forEach((el) => el.removeAttribute("data-tb-nth"));
      document.querySelectorAll("[data-tb-save]").forEach((el) => el.removeAttribute("data-tb-save"));
      // The button a box was matched to carries the box's number, so the press is on THAT button and
      // not on the nearest one of the same name: every side's card has its own "Save card".
      const markSave = (button: Element, n: number) => button.setAttribute("data-tb-save", `${button.getAttribute("data-tb-save") ?? ""} ${n}`.trim());
      const all = [...scope.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")].filter(
        (el) => el.tagName === "TEXTAREA" || TEXTY.has((el as HTMLInputElement).type),
      );
      const tidy = (el: Element) => clean(el.textContent);
      const out: Box[] = [];
      all.forEach((el, nth) => {
        // How the crawl's own locator finds it again: by the place it was counted in, on this load.
        el.setAttribute("data-tb-nth", String(nth));
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height || el.disabled || el.readOnly) return;
        if (el.closest('[aria-hidden="true"], dialog:not([open])')) return;
        const input = el.tagName === "INPUT" ? (el as HTMLInputElement) : null;
        const type = input ? input.type : "textarea";
        const label = labelOf(el);
        const hint = `${label} ${el.getAttribute("name") ?? ""} ${el.getAttribute("placeholder") ?? ""} ${el.getAttribute("autocomplete") ?? ""}`;
        const mode = el.getAttribute("inputmode") ?? "";
        const kind: Box["kind"] =
          type === "email" || /e-?mail/i.test(hint) ? "email"
          : type === "tel" || /\b(phone|mobile|tel)\b/i.test(hint) ? "phone"
          : type === "url" || /\b(url|website|web address|link)\b/i.test(hint) ? "web"
          : type === "number" || mode === "numeric" || mode === "decimal" ? "figure"
          : el.tagName === "TEXTAREA" ? "words"
          : /\b(name|title|nickname)\b/i.test(hint) ? "name"
          : "words";
        // HOW IT IS SAVED, worked out the way a person would: the nearest button that saves, adds or sends,
        // looking outward from the box one wrapper at a time and taking the first wrapper that holds one —
        // the one after the box if there are several. A box with no such button saves as it is left.
        //
        // NEAREST, not "in the same card": the first draft took the first Save in the box's card and gave a
        // buy-in box the card's "Rename", and gave a box sitting in no card at all ("Add a team", whose Add
        // button is its neighbour) no button.
        let save: Box["save"] = { how: "leave", label: "", why: "" };
        let addAt: Box["addAt"];
        const isButton = (b: HTMLButtonElement) => b.getBoundingClientRect().width > 0 && !b.closest('[aria-hidden="true"]');
        const word = (b: HTMLButtonElement) => tidy(b);
        if (ALLOWANCE.test(label) || /search.*\b(course|address|place|town)/i.test(el.getAttribute("placeholder") ?? "") || type === "search") {
          save = { how: "skip", label: "", why: "allowance: it looks things up elsewhere" };
        } else if (el.getAttribute("role") === "combobox" || el.getAttribute("aria-autocomplete") || el.getAttribute("list")) {
          save = { how: "skip", label: "", why: "a picker: it chooses from a list (and may search the course directory)" };
        } else if (/\bto confirm\b|^type\b/i.test(label)) {
          save = { how: "skip", label: "", why: "destroys: it confirms a deletion" };
        } else if (/discount|promo|coupon|voucher/i.test(hint)) {
          save = { how: "skip", label: "", why: "billing: it goes to the payment provider" };
        } else if (/^(search|filter)\b/i.test(label)) {
          // A search of the screen's own list: it shapes what is shown, and the button beside it ("Add
          // member", "Add to …") belongs to the row it finds, not to the words typed.
          save = { how: "leave", label: "", why: "" };
        } else {
          // A Remove or a Reset beside a box that holds something is that row's other button, not its
          // save: it is passed over, and the search goes on outward.
          const OTHER = /^(remove|delete|clear|withdraw|cancel|reset|undo|restore)\b/i;
          let level: Element | null = el.parentElement;
          let found: HTMLButtonElement[] = [];
          while (level && level !== scope.parentElement) {
            found = [...level.querySelectorAll<HTMLButtonElement>("button")].filter(
              (b) => isButton(b) && (SAVES.test(word(b)) || ADDS.test(word(b)) || NEVER.test(word(b))) && !(el.value && OTHER.test(word(b))),
            );
            if (found.length) break;
            if (level === scope) break;
            level = level.parentElement;
          }
          const after = found.filter((b) => el.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
          const pick = after[0] ?? found[found.length - 1];
          if (pick) {
            const w = word(pick);
            const sameForm = !!el.closest("form") && el.closest("form") === pick.closest("form");
            // Whether the button is really the box's is decided outside the page, by `howItSaves`
            // (e2e/text-box-reading.ts), from where the two sit and whether the box acts when left.
            const cardOf = (n: Element) => n.closest(".card, section");
            const props = Object.entries(el).find(([k]) => k.startsWith("__reactProps"))?.[1] as { onBlur?: unknown } | undefined;
            const where = {
              followsTheBox: after.includes(pick),
              sameForm,
              sameCard: !!cardOf(el) && cardOf(el) === cardOf(pick),
              actsOnLeave: typeof props?.onBlur === "function",
            };
            if (NEVER.test(w)) {
              save = { how: "skip", label: w.slice(0, 40), why: OTHER.test(w) ? "destroys" : "sends" };
            } else if (SAVES.test(w)) {
              save = { how: "save", label: w.slice(0, 40), why: "" };
              addAt = { how: "save", ...where };
              markSave(pick, nth);
            } else if (!el.value || sameForm) {
              save = { how: "form", label: w.slice(0, 40), why: "" };
              addAt = { how: "form", ...where };
              markSave(pick, nth);
            }
            // Otherwise an Add beside a box that already holds something (a team's name beside
            // "Add player"): the box is not that form's, and saves as it is left.
          }
        }
        out.push({
          nth,
          tag: el.tagName === "TEXTAREA" ? "textarea" : "input",
          type,
          label,
          kind,
          value: el.value,
          maxLength: el.maxLength,
          required: el.required || el.getAttribute("aria-required") === "true",
          numberType: type === "number",
          save,
          addAt,
        });
      });
      return out;
    },
    { never: NEVER.source, saves: SAVES.source, adds: ADDS.source, allowance: ALLOWANCE.source },
  ).then((boxes) =>
    boxes.map((b) => (b.addAt && (b.save.how === "form" || b.save.how === "save") && howItSaves(b.addAt) === "leave" ? { ...b, save: { how: "leave" as const, label: "", why: "" } } : b)),
  );
}

/** The same box after a reload: same place, same name — or it is not the same box. */
async function find(page: Page, was: Box): Promise<Box | null> {
  const now = await boxesOn(page);
  return (
    now.find((b) => b.nth === was.nth && b.label === was.label) ??
    // A row added above it moves it along; its name does not move.
    now.find((b) => b.label === was.label && b.tag === was.tag) ??
    // A name that carries the box's own value ("Name of <the team>", "Email for X — none on file"):
    // the same place and the same shape of name is the same box.
    now.find((b) => b.nth === was.nth && b.tag === was.tag && shapeOf(b.label) === shapeOf(was.label)) ??
    null
  );
}

/** Only after `boxesOn` (or `find`) on this load, which marks each box with its place. */
const boxLocator = (page: Page, b: Box) => page.locator(`main [data-tb-nth="${b.nth}"]`);

/* --------------------------------------------------------------- the inputs */

type Try = "empty" | "over-long" | "bad: letters" | "bad: typo" | "bad: emoji" | "bad: spaces" | "bad: html" | "good";
const HTML_MARK = "zz-tbx";

/**
 * A value no other row on the screen holds, for a box in an "Add" form: each add is a new row, and a
 * row is found again by what was typed into it. The same address twice is "already there", and the
 * same name twice is found on the screen before it has been added.
 */
let fresh = 0;
function freshFor(b: Box): string {
  fresh += 1;
  if (b.kind === "email") return `zz-text-box-${fresh}@example.invalid`;
  if (b.kind === "phone") return `+44 7700 9001${String(fresh % 100).padStart(2, "0")}`;
  if (b.kind === "name" || b.kind === "words") return `zz-Text Box ${fresh}`;
  return plainGood(b);
}

function goodFor(b: Box): string {
  return b.save.how === "form" && !b.value ? freshFor(b) : plainGood(b);
}

function plainGood(b: Box): string {
  const v = b.value.trim();
  if (b.kind === "figure") {
    const n = Number(v.replace(",", "."));
    if (v && Number.isFinite(n)) {
      const places = (v.split(/[.,]/)[1] ?? "").length;
      const next = places ? (n + 0.1).toFixed(places) : String(n + 1);
      return v.includes(",") ? next.replace(".", ",") : next;
    }
    return "10";
  }
  if (b.kind === "email") return "zz-text-box@example.invalid";
  if (b.kind === "phone") return "+44 7700 900123";
  if (b.kind === "web") return "https://example.invalid/zz-text-box";
  // A name keeps what it was and gains a word, so a club's name keeps the mark its teardown looks for.
  if (v) return `${v} zz`.slice(0, b.maxLength > 0 ? b.maxLength : 10_000);
  return b.kind === "name" ? "zz-Text Box" : "zz text box words";
}

function triesFor(b: Box): Array<{ try: Try; value: string }> {
  const long = b.maxLength > 0 ? b.maxLength + 1 : 2000;
  const overLong = `zz${"x".repeat(Math.max(0, long - 2))}`;
  const list: Array<{ try: Try; value: string }> = [{ try: "empty", value: "" }, { try: "over-long", value: b.kind === "figure" ? "9".repeat(Math.min(long, 400)) : overLong }];
  if (b.numberType) {
    // Letters cannot be typed into a number box at all; a minus and an exponent can.
    list.push({ try: "bad: letters", value: "-1" }, { try: "bad: typo", value: "1e9" });
  } else if (b.kind === "figure") {
    list.push({ try: "bad: letters", value: "abc" }, { try: "bad: typo", value: "12,4x" }, { try: "bad: emoji", value: "⛳" });
  } else if (b.kind === "email") {
    // Each different from every other, so an address added once is not "already there" the next time.
    const n = (fresh += 1);
    list.push(
      { try: "bad: typo", value: `zz-text-box-not-an-address-${n}` },
      // Never the good value with spaces round it: a box that trims would store the good value
      // here, and the good try would then type what the box already holds (`spacedValue`).
      { try: "bad: spaces", value: spacedValue(goodFor(b), b.kind, b.maxLength) },
      { try: "bad: html", value: `<b>${HTML_MARK}</b>zz-text-box-${n}@example.invalid` },
    );
  } else if (b.kind === "phone") {
    list.push({ try: "bad: letters", value: "call me" }, { try: "bad: emoji", value: "⛳" });
  } else {
    list.push({ try: "bad: emoji", value: "⛳" }, { try: "bad: spaces", value: spacedValue(goodFor(b), b.kind, b.maxLength) }, { try: "bad: html", value: `<b>${HTML_MARK}</b>` });
  }
  list.push({ try: "good", value: goodFor(b) });
  return list;
}

/* ------------------------------------------------------------- the outcomes */

type Verdict = "kept" | "accepted" | "refused in view" | "view" | "cut" | "skipped" | "ruled" | "blocked" | "stuck" | "refused out of view" | "cut silently" | "stored junk" | "error page" | "lost" | "silent" | "not restored";
interface Outcome {
  outcome: Verdict;
  note: string;
}
/**
 * WHAT LOOKS LIKE A FINDING AND IS A RULE SOMEBODY MADE, each with where it was decided. Anything not
 * here is a finding. Keep it short: an entry is a claim that the app is right, and it is read as one.
 */
const RULED: Array<{ screen: string; label: RegExp; says: RegExp; why: string }> = [
  {
    screen: "/organization",
    label: /^Name$/,
    says: /a row was added and .* is not on it/,
    why: "somebody invited as staff and not back yet is listed without a name, whatever the inviter typed — an address must not buy the name of the account behind it (src/lib/services/access.ts, `invited`, 2026-10-11)",
  },
];

/** `cut silently`: shortened by the server with no limit on the box to say so — what was typed is not what was kept, and nobody was told. */
const FINDINGS = new Set<Verdict>(["refused out of view", "cut silently", "stored junk", "error page", "lost", "silent", "not restored", "stuck"]);

/** Server action id → its exported name, off the build the crawl is running against. */
const ACTION_NAMES: Record<string, string> = (() => {
  try {
    const manifest = JSON.parse(readFileSync(join(process.cwd(), process.env.NEXT_DIST_DIR ?? ".next-e2e", "server", "server-reference-manifest.json"), "utf8")) as {
      node?: Record<string, { exportedName?: string }>;
    };
    return Object.fromEntries(Object.entries(manifest.node ?? {}).map(([id, e]) => [id, e.exportedName ?? "?"]));
  } catch {
    return {};
  }
})();

/**
 * What the screen is saying is WRONG, read off how it says it — an alert, the shared form-error, or a
 * sentence in the danger colour — and where it is. Never a control, never inside one.
 */
async function complaints(page: Page): Promise<Array<{ text: string; top: number; bottom: number; scrollY: number; onScreen: boolean }>> {
  return page.evaluate(() => {
    const out: Array<{ text: string; top: number; bottom: number; scrollY: number; onScreen: boolean }> = [];
    const danger = (el: HTMLElement) => {
      const probe = document.createElement("span");
      probe.style.color = "var(--color-danger)";
      (el.parentElement ?? document.body).appendChild(probe);
      const c = getComputedStyle(probe).color;
      probe.remove();
      return c;
    };
    for (const el of document.body.querySelectorAll<HTMLElement>("*")) {
      if (el.closest("button, a, [role=button], select, label, input, textarea, nav, #__next-route-announcer__")) continue;
      const text = (el.innerText ?? "").replace(/\s+/g, " ").trim();
      if (text.length < 4 || text.length > 300) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const cls = typeof el.className === "string" ? el.className : "";
      const marked = el.getAttribute("role") === "alert" || /\bform-error\b/.test(cls);
      // Anything else must be a SENTENCE: a kitty that is short is drawn in the same red ("-1.38"), and
      // was read as a refusal out of view by the first full run.
      const sentence = text.replace(/[^A-Za-z]/g, "").length >= 8 && text.includes(" ");
      const loose = /\b(error|danger)\b/.test(cls) || (el.getAttribute("style") ?? "").includes("--color-danger");
      const red = !marked && !loose && el.children.length <= 2 && /^(P|SPAN|DIV)$/.test(el.tagName) && getComputedStyle(el).color === danger(el);
      if (!marked && !((loose || red) && sentence)) continue;
      out.push({ text: text.slice(0, 200), top: r.top, bottom: r.bottom, scrollY: window.scrollY, onScreen: r.bottom > 0 && r.top < window.innerHeight });
    }
    return out;
  });
}

/** What every text box in the working area holds. */
async function boxValues(page: Page): Promise<string[]> {
  return page
    .locator("main input, main textarea")
    .evaluateAll((els) =>
      els
        .filter((el) => el.tagName === "TEXTAREA" || ["text", "email", "tel", "url", "number"].includes((el as HTMLInputElement).type))
        .map((el) => (el as HTMLInputElement).value)
        .filter(Boolean),
    )
    .catch(() => [] as string[]);
}

/** Where the page is scrolled to, for a position measured on the screen to be put back on the page. */
const scrolled = (page: Page) => page.evaluate(() => window.scrollY).catch(() => 0);

const flat = (s: string) => s.replace(/\s+/g, " ").trim();
const short = (s: string) => (s.length > 40 ? `${s.slice(0, 18)}…(${s.length} chars)` : s);

async function settle(page: Page) {
  await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
}

async function open(page: Page, path: string) {
  await page.goto(`${path}${path.includes("?") ? "&" : "?"}tb=${Date.now()}`, { waitUntil: "domcontentloaded" });
  await settle(page);
}

/** Any page that says the server fell over. */
async function brokenPage(page: Page): Promise<string> {
  const body = await page.locator("body").innerText().catch(() => "");
  const hit = /Application error|Internal Server Error|This page couldn.t load|Something went wrong/i.exec(body);
  return hit ? hit[0] : "";
}

interface Sabotage {
  /** The control: what is done to the box's save, and the verdict the crawl must reach. */
  kind: "swallow" | "far refusal" | "server 500";
}

/**
 * Type one value into one box, save it the way its screen saves, and say what became of it.
 * A fresh page each time: the last try may have redrawn the screen.
 */
async function attempt(page: Page, path: string, was: Box, value: string, t: Try, threw: string[], sabotage?: Sabotage): Promise<Outcome> {
  await open(page, path);
  const b = await find(page, was);
  if (!b) return { outcome: "skipped", note: "the box is not where it was on a fresh load" };
  // Saved the way it was found to be saved when it was MET: an email box emptied by the last try
  // otherwise reads as the empty box of the "Add to field" form beside it.
  b.save = { ...was.save };
  let box = boxLocator(page, b);
  // TYPE INTO THE PAGE ONCE IT IS LIVE. A box typed into before React has taken the page over is
  // wiped when it does, and every Add beside it then reads as a button that will not press — which is
  // what the first full run reported for half the screens. (`typed-before-load.spec` is the test of
  // what a person typing that early is shown; this crawl is asking a different question.)
  await page
    .waitForFunction((n) => {
      const el = document.querySelector(`main [data-tb-nth="${n}"]`);
      return !!el && Object.keys(el).some((k) => k.startsWith("__reactProps"));
    }, b.nth, { timeout: 10_000 })
    .catch(() => {});
  const fired: string[] = [];
  const failed: string[] = [];
  const onRequest = (r: { headers(): Record<string, string> }) => {
    const id = r.headers()["next-action"];
    if (id) fired.push(ACTION_NAMES[id] ?? id.slice(0, 8));
  };
  const onResponse = (r: { status(): number; request(): { headers(): Record<string, string> }; url(): string }) => {
    if (r.status() >= 500 && (r.request().headers()["next-action"] || r.url().includes(path))) failed.push(`${r.status()}`);
  };
  let asked = "";
  const onDialog = (d: { message(): string; dismiss(): Promise<void> }) => {
    asked = d.message().slice(0, 120);
    void d.dismiss().catch(() => {});
  };
  page.on("request", onRequest);
  page.on("response", onResponse);
  page.on("dialog", onDialog);
  const threwBefore = threw.length;
  const by = () => [...new Set(fired)].join(", ");
  try {
    const before = await complaints(page);
    const textBefore = await page.locator("main").innerText().catch(() => "");
    // What the screen showed before anything was typed, its boxes' values included: a row a form
    // adds may show what was typed only as the value of a box of its own (see `newlyShown`).
    const shownBefore: Shown = { text: textBefore, values: await boxValues(page) };
    // An "Add" form: the other boxes in it are given good values, so the one under test is the only question.
    const siblingValues: string[] = [];
    if (b.save.how === "form") {
      // …and a dropdown of the form still on its "Choose…" is given its first real choice
      // ("How is it played?" beside "Create a new tournament").
      await box.evaluate((el, label) => {
        let level = el.parentElement;
        const holds = (l: Element) => [...l.querySelectorAll("button")].some((x) => (x.textContent ?? "").replace(/\s+/g, " ").trim().startsWith(label));
        while (level && level.tagName !== "MAIN" && !holds(level)) level = level.parentElement;
        level?.querySelectorAll("select").forEach((s) => {
          if (!s.value) s.setAttribute("data-tb-choose", "1");
        });
      }, b.save.label);
      for (const s of await page.locator("main [data-tb-choose]").all()) {
        const first = (await s.locator("option").evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value).filter(Boolean)))[0];
        if (first) await s.selectOption(first).catch(() => {});
      }
      const siblings = (await boxesOn(page)).filter((o) => o.nth !== b.nth && o.save.how === "form" && o.save.label === b.save.label && !o.value);
      for (const s of siblings) {
        const v = goodFor(s);
        siblingValues.push(v);
        await boxLocator(page, s).fill(v).catch(() => {});
      }
    }
    const buttonsBefore = (await page.locator("main button:visible").allInnerTexts().catch(() => [] as string[])).map((x) => flat(x));
    try {
      await box.fill(value);
    } catch (e) {
      // A box that cannot be typed into is the finding, not the crawl's: the colour boxes of the club's
      // theme are drawn anew on every keystroke, and a person's second character goes nowhere.
      // Then as a person types — a key at a time — and what the box holds after three keys is the evidence.
      let held = "?";
      try {
        const fresh0 = await find(page, b);
        if (fresh0) {
          await boxLocator(page, fresh0).click({ timeout: 3_000 });
          await page.keyboard.press("Control+A");
          await page.keyboard.type("abc", { delay: 80 });
          const fresh1 = await find(page, b);
          held = fresh1 ? await boxLocator(page, fresh1).inputValue({ timeout: 2_000 }) : "(gone)";
        }
      } catch {
        /* the evidence is what it is */
      }
      return { outcome: "stuck", note: `could not be typed into (${String(e).split("\n")[0].slice(0, 80)}); typed "abc" a key at a time and the box holds "${short(held)}"` };
    }
    await page.waitForTimeout(250);
    // The box may have been drawn anew by what was typed (a figure that saves as it changes): find it again.
    const redrawn = await find(page, b);
    if (redrawn) box = boxLocator(page, redrawn);
    const typed = await box.inputValue().catch(() => "");
    // THE BOX ITSELF SAID NO: it would not hold what was typed. That is a refusal made where the typing
    // is, and there is nothing to save. (Over-long input a box shortens is its limit doing its job; an
    // address box trims the spaces round an address as it is typed, which is the browser's own rule.)
    const held = sabotage ? null : heldInstead(t, typed, value);
    if (held === "cut") return { outcome: "cut", note: `the box itself took ${typed.length} of ${value.length} characters${b.maxLength > 0 ? ` (its limit is ${b.maxLength})` : ""}` };
    if (held === "refused") return { outcome: "refused in view", note: t === "empty" ? `the box would not be emptied: it reads "${short(typed)}"` : `the box would not hold it: it reads "${short(typed)}"` };
    await page.waitForTimeout(150);
    const textTyped = await page.locator("main").innerText().catch(() => "");

    // A Save that appears only once the box has been changed ("Save name" beside a cup team's name):
    // looked for again now, or the box is left and its own button never pressed.
    // Only a button that was NOT there before the typing: the first draft took the Points-to-win
    // form's Save for a cup team's emptied name.
    if (b.save.how === "leave") {
      const again = (await boxesOn(page)).find((o) => o.nth === b.nth);
      if (again && again.save.how === "save" && !buttonsBefore.some((x) => x.startsWith(again.save.label))) b.save = again.save;
    }
    // Where the press is, for "said where the press was".
    let pressBox = await box.boundingBox();
    // …and how far the page was scrolled when it was measured: a refusal that brings itself into view
    // moves the page under the press (`refusalGap`).
    let pressScroll = await scrolled(page);
    if (b.save.how === "leave") {
      await box.press("Tab");
    } else {
      // The box's own button, as `boxesOn` matched it on this load (counted again now: typing may have
      // redrawn the box, and a button that appears with the typing is marked only now).
      const marked = (await boxesOn(page)).find((o) => o.label === b.label || (shapeOf(o.label) === shapeOf(b.label) && o.nth === b.nth));
      if (marked) box = boxLocator(page, marked);
      const own = marked ? page.locator(`main [data-tb-save~="${marked.nth}"]`) : null;
      const button = page
        .locator("main button:visible")
        .filter({ hasText: new RegExp(`^\\s*${b.save.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) });
      // Failing the mark, the nearest button of that name below the box: a long form has several "Save"s.
      const count = own && (await own.count()) ? 1 : await button.count();
      let chosen = own && (await own.count()) ? own.first() : button.first();
      if (count > 1) {
        const top = pressBox?.y ?? 0;
        let best = Infinity;
        for (let i = 0; i < count; i += 1) {
          const bb = await button.nth(i).boundingBox();
          if (bb && bb.y >= top - 40 && bb.y - top < best) {
            best = bb.y - top;
            chosen = button.nth(i);
          }
        }
      }
      if (await chosen.isDisabled().catch(() => false)) {
        if (process.env.E2E_TEXT_DEBUG) {
          await page.screenshot({ path: join(OUT, `debug-disabled-${Date.now()}.png`), fullPage: true });
          writeFileSync(join(OUT, `debug-disabled-${Date.now()}.txt`), `${b.label} | ${b.save.how} ${b.save.label} | typed "${typed}" | buttons ${count} | ${await chosen.evaluate((e) => e.outerHTML.slice(0, 400))}`);
        }
        // A launched tournament's setup is locked, and the bar holding the Save says so: that is an
        // answer, and the box is tried again on a tournament where it can be saved.
        const said = (await page.locator("main").innerText().catch(() => "")).split("\n").map((l) => l.trim()).find((l) => /setup is locked|setup locked|unlock (it|setup)/i.test(l));
        if (said) return { outcome: "blocked", note: `its "${b.save.label}" is disabled: ${said.slice(0, 120)}` };
        const invalid = await box.evaluate((el) => (el as HTMLInputElement).validationMessage).catch(() => "");
        return { outcome: "refused in view", note: `its "${b.save.label}" button will not press with this in the box${invalid ? ` · ${invalid}` : ""}` };
      }
      if (sabotage?.kind === "swallow") {
        await chosen.evaluate((el) => el.addEventListener("click", (e) => { e.preventDefault(); e.stopImmediatePropagation(); }, { capture: true }));
      }
      if (sabotage?.kind === "far refusal") {
        await chosen.evaluate((el) =>
          el.addEventListener(
            "click",
            (e) => {
              e.preventDefault();
              e.stopImmediatePropagation();
              const p = document.createElement("p");
              p.setAttribute("role", "alert");
              p.className = "form-error";
              p.textContent = "zz-control: this refusal is printed far below the press on purpose.";
              p.style.marginTop = "4000px";
              document.body.append(p);
            },
            { capture: true },
          ),
        );
      }
      await chosen.scrollIntoViewIfNeeded().catch(() => {});
      pressBox = (await chosen.boundingBox()) ?? pressBox;
      pressScroll = await scrolled(page);
      await chosen.click();
      // A SECOND PRESS, where the screen asks for one: "Use this colour" puts a colour into the theme
      // being drawn up, and the card's own "Save theme" is what stores it. Only a Save in the same card,
      // only when the first press sent nothing, and never for the control.
      await page.waitForTimeout(500);
      if (!fired.length && !sabotage && !/^save\b/i.test(b.save.label)) {
        const card = box.locator("xpath=ancestor::*[contains(concat(' ', @class, ' '), ' card ') or self::section or self::form][1]");
        const then = card.locator("button:visible:enabled").filter({ hasText: /^\s*save\b/i }).first();
        if (await then.count()) {
          pressBox = (await then.boundingBox()) ?? pressBox;
          pressScroll = await scrolled(page);
          await then.click().catch(() => {});
        }
      }
    }
    await page.waitForTimeout(900);
    await settle(page);
    await page.waitForTimeout(300);

    const broke = await brokenPage(page);
    if (broke || failed.length || threw.length > threwBefore) {
      return { outcome: "error page", note: `${broke || (failed.length ? `answered ${failed.join(",")}` : threw.slice(threwBefore).join(" | ").slice(0, 160))}${by() ? ` · ${by()}` : ""}` };
    }
    if (asked) return { outcome: "refused in view", note: `the browser asked first: ${asked}` };
    // A refusal the press brought up: where is it?
    const after = await complaints(page);
    const fresh = after.filter((c) => !before.some((o) => o.text === c.text));
    if (fresh.length) {
      const press = pressBox ? { top: pressBox.y, bottom: pressBox.y + pressBox.height, scrollY: pressScroll } : { top: 0, bottom: 0, scrollY: pressScroll };
      const gapOf = (c: { top: number; bottom: number; scrollY: number }) => refusalGap(press, c);
      const near = fresh.find((c) => c.onScreen && gapOf(c) <= 200);
      if (near) return { outcome: "refused in view", note: `${near.text.slice(0, 140)}${by() ? ` · ${by()}` : ""}` };
      const c = fresh[0];
      return {
        outcome: "refused out of view",
        note: `${c.onScreen ? `on the screen but ${Math.round(gapOf(c))}px from the press` : "off the screen"}: ${c.text.slice(0, 140)}${by() ? ` · ${by()}` : ""}`,
      };
    }
    // The browser's own check on the box (required, type=email, a pattern): said beside it, in its own bubble.
    const invalid = await box.evaluate((el) => (el as HTMLInputElement).validationMessage).catch(() => "");
    if (invalid && !fired.length) return { outcome: "refused in view", note: `the browser's own check: ${invalid.slice(0, 120)}` };

    if (!fired.length) {
      // Left, and the box put back what is stored: it refused, where the typing was ("Emptied: nothing
      // is saved, and the box says again what is stored" — the field's handicap column).
      const now = await box.inputValue().catch(() => typed);
      if (b.save.how === "leave" && now === b.value && typed !== b.value) return { outcome: "refused in view", note: `the box put back "${short(b.value)}" when it was left` };
      if (flat(textTyped) !== flat(textBefore) && b.save.how === "leave") return { outcome: "view", note: "changes what is shown, sends nothing" };
      return { outcome: "silent", note: `${b.save.how === "leave" ? "left the box" : `pressed "${b.save.label}"`}; nothing was sent and nothing said` };
    }

    // Saved without complaint: read it back from a fresh load.
    await open(page, path);
    if (await brokenPage(page)) return { outcome: "error page", note: `after saving: ${await brokenPage(page)} · ${by()}` };
    const html = await page.locator(`main b:text-is("${HTML_MARK}"), main strong:text-is("${HTML_MARK}")`).count();
    if (html) return { outcome: "stored junk", note: `markup was drawn as markup: <b>${HTML_MARK}</b> is bold on the screen · ${by()}` };
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    const again = await find(page, b);
    const main = await page.locator("main").innerText().catch(() => "");
    const pageNote = sideways ? " · the page now scrolls sideways" : "";
    if (b.save.how === "form") {
      // A row was added, or not: look on the screen for what was typed — into this box, and into the
      // others of its form, each of which no row held before.
      const shownAfter: Shown = { text: main, values: await boxValues(page) };
      const newly = (v: string) => newlyShown(v, shownBefore, shownAfter);
      const added = newly(typed) || siblingValues.some(newly);
      if (newly(typed) && b.kind !== "figure") return judge(b, t, typed, typed.trim(), `${by()}${pageNote}`);
      // A FIGURE IS SHOWN IN THE SCREEN'S OWN FORMAT ("£10.00", "1 point"), and "10" is on every screen
      // already: a row added is the answer, and what it holds for the figure is not read back here.
      if (added && b.kind === "figure") {
        return t === "good"
          ? { outcome: "kept", note: `a row was added (the figure is drawn in the screen's own format, not read back) · ${by()}${pageNote}` }
          : { outcome: "accepted", note: `a row was added with "${short(typed)}" typed for the figure — what it holds is not read back · ${by()}${pageNote}` };
      }
      if (added) {
        if (process.env.E2E_TEXT_DEBUG) writeFileSync(join(OUT, `debug-${Date.now()}.txt`), `${typed}\n${siblingValues.join("\n")}\n----\n${main}`);
        return t === "good"
          ? { outcome: "lost", note: `a row was added and "${short(typed)}" typed here is not on it · ${by()}${pageNote}` }
          : { outcome: "accepted", note: `a row was added${typed.trim() ? `, without "${short(typed)}" on it` : " without it"} · ${by()}${pageNote}` };
      }
      return t === "good"
        ? { outcome: "lost", note: `added "${short(typed)}" without complaint and nothing new is on the screen after a reload · ${by()}${pageNote}` }
        : { outcome: "silent", note: `sent, nothing said, and nothing was added · ${by()}${pageNote}` };
    }
    // THE SCREEN MOVED ON: the player's card asks one hole at a time, and after the 10th is saved the
    // box on the screen is the 11th's. Found by the shape of its name, holding neither what was typed
    // nor a shortened copy of it — it is another box, and this one cannot be read back here.
    if (again && again.label !== b.label && again.value.trim() !== typed.trim() && !(again.value && typed.startsWith(again.value))) {
      return { outcome: "accepted", note: `saved, and the screen moved on to "${again.label}", so it was not read back · ${by()}${pageNote}` };
    }
    return judge(b, t, typed, again ? again.value : null, `${by()}${pageNote}`);
  } finally {
    page.off("request", onRequest);
    page.off("response", onResponse);
    page.off("dialog", onDialog);
  }
}

/** What a stored value means for this box and this try. */
function judge(b: Box, t: Try, typed: string, shown: string | null, by: string): Outcome {
  const original = b.value;
  if (shown === null) return { outcome: "lost", note: `the box is gone after saving · ${by}` };
  const same = (a: string, z: string) => a === z || a.trim() === z.trim();
  if (t === "good") {
    if (same(shown, typed)) return { outcome: "kept", note: by };
    if (same(shown, original)) return { outcome: "lost", note: `saved "${short(typed)}" without complaint and it reads "${short(original)}" after a reload · ${by}` };
    return { outcome: "kept", note: `stored as "${short(shown)}" · ${by}` };
  }
  // An emptied figure that reads nought, where it held nought: empty is nought, which is the same thing.
  if (t === "empty" && b.kind === "figure" && Number(original.replace(",", ".")) === 0 && Number(shown.replace(",", ".")) === 0) return { outcome: "accepted", note: `empty reads as "${short(shown)}" · ${by}` };
  // Not stored, and nothing said: a refusal nobody was told about.
  if (same(shown, original) && !same(typed, original)) return { outcome: "silent", note: `sent "${short(typed)}", nothing said, and the box reads "${short(original)}" after a reload · ${by}` };
  if (t === "over-long") {
    if (shown.length < typed.length) return b.maxLength > 0 ? { outcome: "cut", note: `stored ${shown.length} of ${typed.length} characters (its limit is ${b.maxLength}) · ${by}` } : { outcome: "cut silently", note: `stored ${shown.length} of ${typed.length} characters, and the box has no limit that says so · ${by}` };
    if (typed.length < 2000 && b.maxLength > 0 && typed.length <= b.maxLength) return { outcome: "cut", note: `the box itself took only ${typed.length} characters · ${by}` };
    return b.kind === "name" || b.kind === "figure" || b.kind === "email" || b.kind === "phone"
      ? { outcome: "stored junk", note: `${typed.length} characters stored and shown in a box for a ${b.kind} · ${by}` }
      : { outcome: "accepted", note: `${typed.length} characters stored · ${by}` };
  }
  if (t === "empty") {
    if (!shown.trim() && original.trim() && (b.required || b.kind === "name")) return { outcome: "stored junk", note: `a blank ${b.kind === "name" ? "name" : "required box"} was stored · ${by}` };
    return { outcome: "accepted", note: `stored "${short(shown)}" · ${by}` };
  }
  // The bad ones.
  if (b.kind === "figure" && !b.numberType && /[A-Za-z⛳]/u.test(shown)) return { outcome: "stored junk", note: `a figure box stored "${short(shown)}" · ${by}` };
  if (b.kind === "figure" && t === "bad: typo" && /x/i.test(shown)) return { outcome: "stored junk", note: `a figure box stored "${short(shown)}" · ${by}` };
  if (b.kind === "email" && shown.trim() && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(shown.trim())) return { outcome: "stored junk", note: `an address box stored "${short(shown)}" · ${by}` };
  if (b.kind === "phone" && /[A-Za-z⛳]/u.test(shown)) return { outcome: "stored junk", note: `a phone box stored "${short(shown)}" · ${by}` };
  if (t === "bad: spaces" && shown !== shown.trim()) return { outcome: "accepted", note: `kept the spaces round "${short(shown.trim())}" · ${by}` };
  return { outcome: "accepted", note: `stored "${short(shown)}" · ${by}` };
}

/** Put the box back as it was, by the way it saves, and check. */
async function restore(page: Page, path: string, b: Box, threw: string[]): Promise<Outcome | null> {
  if (b.save.how === "form") return null;
  await open(page, path);
  const now = await find(page, b);
  if (!now) return { outcome: "not restored", note: "the box was not there to put back" };
  if (holdsTheSame(b.kind, now.value, b.value)) return null;
  await attempt(page, path, b, b.value, "good", threw);
  await open(page, path);
  const back = await find(page, b);
  if (!back || !holdsTheSame(b.kind, back.value, b.value)) return { outcome: "not restored", note: `it reads "${short(back?.value ?? "(gone)")}", and held "${short(b.value)}"` };
  return null;
}

async function signIn(context: BrowserContext, baseURL: string, session: string, eventId: string) {
  await context.clearCookies();
  await context.addCookies([
    { name: "ng_session", value: session, url: baseURL },
    { name: "ng_active_event", value: sign(eventId), url: baseURL },
  ]);
}

type Club = Awaited<ReturnType<typeof seed>>;

/**
 * THE TEARDOWN FINDS ROWS BY THEIR NAME, AND THIS CRAWL RENAMES THINGS. A club or tournament left
 * renamed by a box that could not be put back would be invisible to it, so they are also deleted by
 * the ids the seed handed back — on the development database only, as the seed itself insists.
 */
async function cleanUp(club: Club | undefined) {
  await teardown().catch(() => {});
  if (!club) return;
  const host = (() => {
    try {
      return new URL(process.env.DATABASE_URL ?? "").hostname.toLowerCase();
    } catch {
      return "";
    }
  })();
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) return;
  const prisma = new PrismaClient();
  try {
    const ids = (club.events as Array<{ id: string }>).map((e) => e.id);
    await prisma.event.deleteMany({ where: { id: { in: ids } } }).catch(() => {});
    await prisma.organization.deleteMany({ where: { id: (club.org as { id: string }).id } }).catch(() => {});
    // Accounts an "Add" form made, under the address this crawl types.
    await prisma.user
      .deleteMany({ where: { OR: [{ email: { startsWith: "zz-text-box" } }, { email: { contains: HTML_MARK } }, { email: { startsWith: "zzxx" } }] } })
      .catch(() => {});
  } finally {
    await prisma.$disconnect();
  }
}

interface Run {
  who: string;
  session: string;
  screens: string[];
}

interface Tally {
  /** Every row a box is drawn on, on every tournament: what the screens hold. */
  rowsSeen: Set<string>;
  lockedEverywhere: Map<string, string>;
  /** Distinct boxes (a screen and a shape of label) in this share. */
  boxes: number;
  tried: number;
  outcomes: Record<string, number>;
  findings: string[];
  skipped: string[];
}

async function crawl(page: Page, context: BrowserContext, baseURL: string, club: Club, run: Run, share: number, ledger: string[], tally: Tally, threw: string[]) {
  const screens = run.screens.filter((p) => !ONLY_SCREEN || p === ONLY_SCREEN);
  const events = (club.events as Array<{ id: string; slug: string }>).filter((e) => !ONLY_EVENT || e.slug === ONLY_EVENT);
  /** A box met on one tournament is not tried again on the next: the screen and its shape are the box. */
  const done = new Set<string>();
  const met = new Set<string>();
  /** Boxes no tournament let the crawl save: reported by name, so "every box" is not claimed for them. */
  const locked = tally.lockedEverywhere;
  const rows = tally.rowsSeen;
  for (const event of events) {
    await signIn(context, baseURL, run.session, event.id);
    for (const path of screens) {
      await open(page, path);
      if (new URL(page.url()).pathname !== path) continue;
      const here = await boxesOn(page);
      for (const b of here) {
        const key = `${run.who}|${path}|${b.tag}:${b.type}|${shapeOf(b.label)}`;
        if (ONLY_BOX && !b.label.toLowerCase().includes(ONLY_BOX)) continue;
        if (PARTS > 1 && shareOf(key) !== share) continue;
        rows.add(`${run.who}|${path}|${b.label}`);
        if (done.has(key)) continue;
        // Counted once; SETTLED once it has been saved somewhere. A box behind a launched tournament's
        // lock is met again on the draft, where it can be.
        if (!met.has(key)) tally.boxes += 1;
        met.add(key);
        done.add(key);
        // A press may have moved the active tournament (creating one does): every box starts where it should.
        await signIn(context, baseURL, run.session, event.id);
        const row = (found: Outcome, t: string, value: string) => {
          const rule = FINDINGS.has(found.outcome) ? RULED.find((r) => r.screen === path && r.label.test(b.label) && r.says.test(found.note)) : undefined;
          const o: Outcome = rule ? { outcome: "ruled", note: `${rule.why} · was: ${found.outcome}` } : found;
          const line = [o.outcome, run.who, event.slug, path, b.label, b.kind, b.save.how, t, short(flat(value)), flat(o.note)].join("\t");
          ledger.push(line);
          // As it goes, so a share stopped on time still leaves what it found.
          if (liveLog) appendFileSync(liveLog, line + "\n");
          tally.outcomes[o.outcome] = (tally.outcomes[o.outcome] ?? 0) + 1;
          if (FINDINGS.has(o.outcome)) tally.findings.push(`${o.outcome.toUpperCase()} · ${event.slug} ${path} · "${b.label}" (${b.kind}) ← ${t}${value !== "" ? ` "${short(value)}"` : ""} · ${o.note}`);
        };
        if (INVENTORY) {
          row({ outcome: "skipped", note: `inventory · ${b.type} · max ${b.maxLength} · ${b.required ? "required · " : ""}held "${short(b.value)}" · ${b.save.how}${b.save.label ? ` "${b.save.label}"` : ""}${b.save.why ? ` · ${b.save.why}` : ""}` }, "-", "");
          continue;
        }
        const builder = BUILDERS[`${path}|${b.label}`];
        if (builder) b.save = { how: "skip", label: "", why: `builder: ${builder}` };
        if (b.save.how === "skip") {
          tally.skipped.push(`${path} · ${b.label} — ${b.save.why}`);
          row({ outcome: "skipped", note: b.save.why }, "-", "");
          continue;
        }
        let blocked = false;
        for (const t of triesFor(b)) {
          // Emptying a box that is already empty asks nothing — unless pressing Add with it empty does.
          if (t.try === "empty" && !b.value && b.save.how !== "form") continue;
          let result: Outcome;
          try {
            result = await within(attempt(page, path, b, t.value, t.try, threw), 60_000);
          } catch (e) {
            result = { outcome: "stuck", note: `the crawl could not finish the try: ${String(e).split("\n")[0].slice(0, 160)}` };
          }
          if (result.outcome === "blocked") {
            blocked = true;
            row(result, t.try, t.value);
            break;
          }
          row(result, t.try, t.value);
        }
        if (blocked) {
          done.delete(key);
          locked.set(key, `${path} · ${b.label}`);
          continue;
        }
        locked.delete(key);
        tally.tried += 1;
        const back = await within(restore(page, path, b, threw), 60_000).catch((e) => ({ outcome: "not restored" as const, note: String(e).split("\n")[0].slice(0, 160) }));
        if (back) row(back, "restore", b.value);
      }
    }
  }
}

async function within<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`nothing came back in ${ms / 1000}s`)), ms);
  });
  try {
    return await Promise.race([p, late]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * THE CONTROL. One box with a Save of its own, broken three ways on purpose. The crawl must call
 * a swallowed press `silent`, a refusal printed far above the press `refused out of view`, and a save
 * the server answers with a 500 anything but `kept`. Otherwise the crawl cannot see a finding, and a
 * share that reports none proves nothing.
 */
const CONTROL = { screen: "/organization", label: /^organi[sz]ation name$/i };

async function control(page: Page, context: BrowserContext, baseURL: string, club: Club, threw: string[]) {
  const live = (club.events as Array<{ id: string; slug: string }>)[0];
  await signIn(context, baseURL, club.organizer.session, live.id);
  await open(page, CONTROL.screen);
  const b = (await boxesOn(page)).find((x) => CONTROL.label.test(x.label) && x.save.how === "save");
  expect(b, `the control box (the club's name with a Save, on ${CONTROL.screen}) is not there to break — choose another`).toBeTruthy();
  const value = goodFor(b!);
  const swallowed = await attempt(page, CONTROL.screen, b!, value, "good", threw, { kind: "swallow" });
  const far = await attempt(page, CONTROL.screen, b!, value, "good", threw, { kind: "far refusal" });
  await page.route("**/*", (route) => (route.request().method() === "POST" && route.request().headers()["next-action"] ? route.fulfill({ status: 500, body: "zz-control" }) : route.continue()));
  const refused = await attempt(page, CONTROL.screen, b!, value, "good", threw, { kind: "server 500" }).finally(() => page.unroute("**/*"));
  // The 500's page error is the control's, not the app's.
  threw.length = 0;
  await restore(page, CONTROL.screen, b!, threw);
  console.log(`[every-text-box] control: swallowed press → ${swallowed.outcome}; refusal far above → ${far.outcome}; server 500 → ${refused.outcome} (${refused.note.slice(0, 80)})`);
  expect(swallowed.outcome, `a Save whose press does nothing must read as silent: ${swallowed.note}`).toBe("silent");
  expect(far.outcome, `a refusal printed at the top of the page must read as out of view: ${far.note}`).toBe("refused out of view");
  expect(refused.outcome, `a save the server failed must not read as kept: ${refused.note}`).not.toBe("kept");
}

test.describe.configure({ mode: "parallel" });

for (let share = 1; share <= PARTS; share += 1) {
  test(`every text box, share ${share} of ${PARTS}: empty, over-long, bad and good input, saved and read back`, async ({ page, context, baseURL }, testInfo) => {
    test.skip(!FULL || process.env.E2E_TEXT_BOXES !== "1", "the text-box crawl is a layer of a round: set E2E_EVERYTHING=1 and E2E_TEXT_BOXES=1");
    test.skip(testInfo.project.name !== "desktop", "the text boxes are tried at the desktop width");
    test.setTimeout(3 * 60 * 60 * 1000);
    page.setDefaultTimeout(8_000);
    page.setDefaultNavigationTimeout(30_000);
    mkdirSync(OUT, { recursive: true });
    liveLog = join(OUT, `ledger-${share}of${PARTS}.tsv`);
    writeFileSync(liveLog, HEADER + "\n");
    const threw: string[] = [];
    watchPageErrors(page, threw, "text-box");
    const ledger: string[] = [];
    const tally: Tally = { rowsSeen: new Set(), lockedEverywhere: new Map(), boxes: 0, tried: 0, outcomes: {}, findings: [], skipped: [] };
    const started = Date.now();
    let club: Club | undefined;
    try {
      club = await seed();
      if (!INVENTORY) await control(page, context, baseURL!, club, threw);
      await crawl(page, context, baseURL!, club, { who: "secretary", session: club.organizer.session, screens: consoleScreens() }, share, ledger, tally, threw);
      await crawl(page, context, baseURL!, club, { who: "member", session: club.player.session, screens: playerScreens() }, share, ledger, tally, threw);
    } finally {
      await cleanUp(club);
    }
    const minutes = Math.round((Date.now() - started) / 60_000);
    for (const e of [...new Set(threw)]) tally.findings.push(`THREW · ${e.slice(0, 200)}`);
    const COLUMNS = ["outcome", "who", "tournament", "screen", "box", "kind", "savedBy", "try", "value", "note"];
    const tries = ledger.map((line) => Object.fromEntries(line.split("\t").map((v, i) => [COLUMNS[i], v])));
    writeFileSync(join(OUT, `reach-${share}of${PARTS}.json`), JSON.stringify({ share, of: PARTS, minutes, ...tally, rowsSeen: tally.rowsSeen.size, lockedEverywhere: [...tally.lockedEverywhere.values()], tries }, null, 1));
    console.log(`[every-text-box] share ${share}/${PARTS}: ${tally.boxes} boxes found (drawn on ${tally.rowsSeen.size} rows), ${tally.tried} tried, ${ledger.length} tries: ${JSON.stringify(tally.outcomes)}; ${tally.findings.length} findings; ${minutes} min`);
    console.log(tally.skipped.map((s) => `[every-text-box]   skipped · ${s}`).join("\n"));
    console.log([...tally.lockedEverywhere.values()].map((s) => `[every-text-box]   locked on every tournament, never saved · ${s}`).join("\n"));
    console.log(tally.findings.map((f) => `[every-text-box]   ${f}`).join("\n"));
    // CONTROL on the reach: a crawl that tried almost nothing passes by doing nothing. A share is held
    // to it by `scripts/qa/merge.mjs`, which adds the shares up; the whole crawl is held to it here.
    if (!ONLY_EVENT && !ONLY_SCREEN && !ONLY_BOX && !INVENTORY && PARTS === 1) expect(tally.tried, "the crawl tried almost no boxes — it is not finding them").toBeGreaterThan(40);
    if (!INVENTORY) expect(tally.outcomes.kept ?? 0, "nothing was ever kept — the crawl is not saving anything").toBeGreaterThan(0);
    expect(tally.findings, `${tally.findings.length} findings across ${ledger.length} tries on ${tally.tried} boxes`).toEqual([]);
  });
}
