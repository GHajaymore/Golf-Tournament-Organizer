import type { Page } from "@playwright/test";
import { overflowing } from "./overflow";

/**
 * THE CONSOLE SWEEP'S THREE RULES (master backlog J51: "one primary per row,
 * disabled reason within N px, no overflow at 320"), in one place, for the walk
 * (`console-sweep.spec.ts`) and for its controls, which hand it a page that
 * breaks each rule.
 *
 * TWO HALVES, ON PURPOSE. `collect` runs in the browser and brings back FACTS
 * only: how wide the page is, each disabled control and where it is drawn, the
 * sentences on the page and where they are drawn, each primary button and the
 * row or card it sits in. `judge` runs here, on those facts, and is a pure
 * function: a unit test (`src/lib/__tests__/console-sweep-rules.test.ts`) feeds
 * it facts written by hand, so the rules can be broken and watched to go red
 * on a machine that may not start a browser. The collector is proved by the
 * spec's own controls.
 *
 * THE RULES, AS DECIDED (each is a floor, said with what it cannot see):
 *
 * 1. `sideways-scroll`: the document is wider than the screen it was asked to
 *    fit (`scrollWidth > width + 1`). The width is PASSED IN, not read from
 *    `innerWidth`: a phone that meets a page too wide zooms out, and
 *    `innerWidth` then grows to the page's width and the comparison passes
 *    (`layout.spec.ts` measures against the viewport it asked for, for the same
 *    reason). Wide content inside its own `overflow-x: auto` wrapper does not
 *    widen the document, so it is not counted.
 *
 * 2. `disabled-without-reason`: a visible disabled `button`, `input`, `select`
 *    or `textarea` (`:disabled`, which a disabled `fieldset` gives too, or
 *    `aria-disabled="true"`, the app's `RefusedAction`) says why, in one of two ways:
 *      - `aria-describedby` names an element that is drawn and has words (the
 *        tees doors of state machine PR 7b, `RefusedAction`, the stepper); or
 *      - a SENTENCE is drawn within `REASON_WITHIN_PX` of it.
 *    A sentence is four words or more with a full stop, a question mark or an
 *    exclamation mark: the app's reasons are sentences ("Round 1 has scores; at
 *    another length its cards would mean something else. Clear its scores on
 *    Score entry first."), and its captions, headings and button labels are
 *    not. Words inside a label, a heading, a button, a card's title or another
 *    control are never a reason. The distance is the gap between the control's
 *    box and the words' box, as the crow flies.
 *    WHY 96: the app puts a reason directly under or beside its control (a
 *    door's paragraph has a 4px top margin; the line beside "Save entry terms"
 *    is 10px along). 96 lets one more whole row of controls stand between: a
 *    44px touch-height control, its caption and the gaps. So the one sentence
 *    under a small group of boxes counts for the group; a banner a screen away
 *    does not.
 *    EXEMPT, BY ITS MARKUP: a save button that is waiting for a change. The app
 *    gives these no attribute (found by reading `EventSetupClient`,
 *    `EntryTermsCard`, `OrganizationClient`, `PlaySettings`): the mark is the
 *    button's own label, "Saved", "Saving…" or "Save …", which IS the reason
 *    (there is nothing to save). So a disabled `button` whose label begins with
 *    the verb is exempt, whatever it saves, with no list of names.
 *    CANNOT SEE: whether the sentence near a control is ABOUT that control (a
 *    hint under the next box counts); a save button shut by a lock rather than
 *    by having nothing to save; a control disabled only while a press is in
 *    the air (the walk presses nothing on the screens it measures).
 *
 * 3. `two-primaries`: more than one visible `.btn-primary` (the filled button,
 *    `design-system.css`) in one row or card. The row or card is the button's
 *    nearest ancestor among `tr`, `li`, `[role="row"]`, `.card`, `.dialog` /
 *    `[role="dialog"]` and `.side-panel`; a primary in none of those is counted
 *    with its siblings (its parent element), which is what a row of buttons on
 *    the page itself is. A card whose rows each carry one primary is one per
 *    row and passes; two forms in one card are two primaries in that card.
 */

/** Rule 2's N: how far from a disabled control its reason may be drawn, in CSS pixels. */
export const REASON_WITHIN_PX = 96;
/** Rule 1's width: the narrowest phone the suite measures (the `small-phone` project). */
export const SWEEP_WIDTH = 320;

export const RULES = ["sideways-scroll", "disabled-without-reason", "two-primaries"] as const;
export type Rule = (typeof RULES)[number];

export interface Box { x: number; y: number; w: number; h: number }

export interface DisabledControl {
  /** `button.btn.btn-secondary`, `input[type=text].input`. */
  sig: string;
  /** Its name as a person reads it: aria-label, its own words, its label, its name. */
  label: string;
  tag: string;
  box: Box;
  /** One entry for each id in `aria-describedby`: the words drawn there, `""` when missing or not drawn. */
  describedBy: string[];
}

export interface Facts {
  scrollWidth: number;
  disabled: DisabledControl[];
  /** Words drawn on the page that are not a label, heading, button or title, with where they are. */
  texts: Array<{ text: string; box: Box }>;
  /** Every visible primary, and the row or card (by number, and as markup) it sits in. */
  primaries: Array<{ label: string; container: number; containerSig: string }>;
}

export interface Violation {
  rule: Rule;
  /** What the KNOWN list keys on: stable under invented names, ids and days. */
  sig: string;
  /** For the person reading the log; never part of the key. */
  detail: string;
}

/** The facts of the page as it stands. Runs in the browser; decides nothing. */
export async function collect(page: Page): Promise<Facts> {
  return page.evaluate(() => {
    const shown = (el: Element): boolean => {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") return false;
      const check = (el as Element & { checkVisibility?: (o?: object) => boolean }).checkVisibility;
      if (typeof check === "function" && !check.call(el, { visibilityProperty: true })) return false;
      return el.getClientRects().length > 0;
    };
    const boxOf = (r: { left: number; top: number; width: number; height: number }) => ({
      x: Math.round(r.left + window.scrollX),
      y: Math.round(r.top + window.scrollY),
      w: Math.round(r.width),
      h: Math.round(r.height),
    });
    const words = (el: Element | null): string =>
      el ? ((el as HTMLElement).innerText ?? el.textContent ?? "").replace(/\s+/g, " ").trim() : "";
    const sigOf = (el: Element): string => {
      const tag = el.tagName.toLowerCase();
      const type = tag === "input" ? `[type=${(el as HTMLInputElement).type}]` : "";
      const classes = Array.from(el.classList).slice(0, 3).map((c) => `.${c}`).join("");
      return `${tag}${type}${classes}`;
    };

    // Rule 2: the disabled controls.
    const disabled: Array<{ sig: string; label: string; tag: string; box: { x: number; y: number; w: number; h: number }; describedBy: string[] }> = [];
    for (const el of Array.from(document.querySelectorAll("button, input, select, textarea"))) {
      const off = el.matches(":disabled") || el.getAttribute("aria-disabled") === "true";
      if (!off) continue;
      if (el.tagName === "INPUT" && (el as HTMLInputElement).type === "hidden") continue;
      // A segmented control's radio is drawn 0 by 0 (`.seg-opt input`): the thing a person sees greyed is its label.
      let r = el.getBoundingClientRect();
      let drawn: Element = el;
      if (!r.width || !r.height) {
        const label = el.closest("label");
        if (!label) continue;
        drawn = label;
        r = label.getBoundingClientRect();
      }
      if (!shown(drawn) || !r.width || !r.height) continue;
      const id = el.getAttribute("id");
      const labelled = (el.getAttribute("aria-labelledby") ?? "").split(/\s+/).filter(Boolean).map((i) => words(document.getElementById(i))).join(" ");
      const label =
        el.getAttribute("aria-label") ||
        labelled ||
        (el.tagName === "BUTTON" ? words(el) : "") ||
        (id ? words(document.querySelector(`label[for="${CSS.escape(id)}"]`)) : "") ||
        words(el.closest("label")) ||
        el.getAttribute("name") ||
        el.getAttribute("placeholder") ||
        el.getAttribute("title") ||
        id ||
        "";
      const describedBy = (el.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean).map((i) => {
        const target = document.getElementById(i);
        return target && shown(target) ? words(target) : "";
      });
      disabled.push({ sig: sigOf(el), label: label.replace(/\s+/g, " ").trim().slice(0, 80), tag: el.tagName.toLowerCase(), box: boxOf(r), describedBy });
    }

    // Rule 2: the words that could be a reason. Only looked for when something is disabled.
    const texts: Array<{ text: string; box: { x: number; y: number; w: number; h: number } }> = [];
    if (disabled.length) {
      const NEVER_A_REASON = "button, select, option, label, textarea, h1, h2, h3, h4, h5, h6, legend, th, nav, script, style, [role='tab'], .card-title, .card-kicker";
      const HOLDS_MORE_THAN_WORDS = "button, input, select, textarea, label, div, p, ul, ol, table, section, form, article";
      for (const el of Array.from(document.querySelectorAll("body *"))) {
        const own = Array.from(el.childNodes).filter((n) => n.nodeType === 3 && (n.textContent ?? "").trim());
        if (!own.length || el.closest(NEVER_A_REASON) || !shown(el)) continue;
        if (el.querySelector(HOLDS_MORE_THAN_WORDS)) {
          // A box that holds words AND other things: only its own words, measured where they are drawn.
          let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
          for (const n of own) {
            const range = document.createRange();
            range.selectNodeContents(n);
            const rr = range.getBoundingClientRect();
            if (!rr.width || !rr.height) continue;
            left = Math.min(left, rr.left); top = Math.min(top, rr.top); right = Math.max(right, rr.right); bottom = Math.max(bottom, rr.bottom);
          }
          if (right <= left || bottom <= top) continue;
          const text = own.map((n) => n.textContent ?? "").join(" ").replace(/\s+/g, " ").trim();
          texts.push({ text: text.slice(0, 240), box: boxOf({ left, top, width: right - left, height: bottom - top }) });
        } else {
          const r = el.getBoundingClientRect();
          if (!r.width || !r.height) continue;
          texts.push({ text: words(el).slice(0, 240), box: boxOf(r) });
        }
      }
    }

    // Rule 3: the primaries, each with its row or card.
    const ROW_OR_CARD = "tr, li, [role='row'], .card, .dialog, [role='dialog'], .side-panel";
    const containers: Element[] = [];
    const primaries: Array<{ label: string; container: number; containerSig: string }> = [];
    for (const el of Array.from(document.querySelectorAll(".btn-primary"))) {
      if (!shown(el)) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const container = el.parentElement?.closest(ROW_OR_CARD) ?? el.parentElement ?? document.body;
      let at = containers.indexOf(container);
      if (at < 0) at = containers.push(container) - 1;
      primaries.push({ label: (el.getAttribute("aria-label") || words(el)).slice(0, 80), container: at, containerSig: sigOf(container) });
    }

    return { scrollWidth: document.documentElement.scrollWidth, disabled, texts, primaries };
  });
}

/** Four words or more, and a sentence's mark. See rule 2. */
export function isReason(text: string): boolean {
  const words = text.trim().split(/\s+/).filter((w) => /[A-Za-z]/.test(w));
  return words.length >= 4 && /[.!?]/.test(text);
}

/** A save button waiting for a change: its label is its reason. See rule 2. */
export function isSaveState(control: Pick<DisabledControl, "tag" | "label">): boolean {
  return control.tag === "button" && /^(Saved|Saving|Save)(?![a-z])/.test(control.label.trim());
}

/** The gap between two boxes as the crow flies; 0 when they touch or overlap. */
export function gap(a: Box, b: Box): number {
  const dx = Math.max(0, a.x - (b.x + b.w), b.x - (a.x + a.w));
  const dy = Math.max(0, a.y - (b.y + b.h), b.y - (a.y + a.h));
  return Math.hypot(dx, dy);
}

const escapeForRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const MONTH = "(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\\.?";
const DATE = new RegExp(`${MONTH} #+(?:,? #+)?|#+ ${MONTH}(?:,? #+)?`, "g");
const WEEKDAY_BEFORE_DATE = /(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,? <date>/g;

/**
 * A signature with everything that changes from run to run taken out: the
 * fixture's invented names and mark, database ids, figures and days. So the
 * KNOWN list names a control ("Withdraw <name>"), not a row, and is the same
 * list next month.
 *
 * `max` is how much of it is kept. The sweep's known list keys on 70 and that
 * does not change; the form-control inventory (`form-controls.ts`) asks for
 * more, because a signature cut short on one side of its join and not the
 * other is two controls.
 */
export function scrub(text: string, names: readonly string[] = [], max = 70): string {
  let out = text;
  const tokens = [...new Set(names.flatMap((n) => [n, ...n.split(/\s+/).filter((w) => w.length >= 3)]))].sort((a, b) => b.length - a.length);
  for (const t of tokens) out = out.replace(new RegExp(`(?<![A-Za-z])${escapeForRegex(t)}(?![A-Za-z])`, "g"), "<name>");
  return out
    .replace(/(?<![a-z0-9])c[a-z0-9]{20,}(?![a-z0-9])/g, "<id>")
    .replace(/\d+/g, "#")
    .replace(DATE, "<date>")
    .replace(WEEKDAY_BEFORE_DATE, "<date>")
    .replace(/<name>(?: <name>)+/g, "<name>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** The rules, applied to a page's facts. Pure. */
export function judge(facts: Facts, opts: { width: number; within?: number; names?: readonly string[] }): Violation[] {
  const within = opts.within ?? REASON_WITHIN_PX;
  const out: Violation[] = [];

  if (facts.scrollWidth > opts.width + 1) {
    out.push({ rule: "sideways-scroll", sig: "page", detail: `the page is ${facts.scrollWidth}px wide on a ${opts.width}px screen` });
  }

  for (const c of facts.disabled) {
    if (isSaveState(c)) continue;
    if (c.describedBy.some((t) => t.trim().length > 0)) continue;
    if (facts.texts.some((t) => isReason(t.text) && gap(t.box, c.box) <= within)) continue;
    const nearest = facts.texts.filter((t) => isReason(t.text)).map((t) => Math.round(gap(t.box, c.box))).sort((a, b) => a - b)[0];
    out.push({
      rule: "disabled-without-reason",
      sig: scrub(`${c.sig} "${c.label}"`, opts.names),
      detail: nearest === undefined ? "no sentence on the screen at all" : `the nearest sentence is ${nearest}px away (the rule is ${within})`,
    });
  }

  const byContainer = new Map<number, Facts["primaries"]>();
  for (const p of facts.primaries) byContainer.set(p.container, [...(byContainer.get(p.container) ?? []), p]);
  for (const group of byContainer.values()) {
    if (group.length < 2) continue;
    const labels = group.map((p) => scrub(p.label, opts.names)).sort();
    out.push({ rule: "two-primaries", sig: `${group[0].containerSig} [${labels.join(" | ")}]`.slice(0, 160), detail: `${group.length} primary buttons in one ${group[0].containerSig}` });
  }

  // One line per signature: forty greyed boxes of one kind on a screen are one entry.
  const seen = new Set<string>();
  return out.filter((v) => (seen.has(`${v.rule} ${v.sig}`) ? false : (seen.add(`${v.rule} ${v.sig}`), true)));
}

/** What the page breaks, and what was looked at (so a walk can prove it looked at something). */
export async function sweep(
  page: Page,
  opts: { width: number; within?: number; names?: readonly string[] },
): Promise<{ violations: Violation[]; seen: { disabled: number; primaries: number; texts: number } }> {
  const facts = await collect(page);
  const violations = judge(facts, opts);
  for (const v of violations) {
    if (v.rule !== "sideways-scroll") continue;
    const past = await overflowing(page);
    v.detail += past.length ? `; past the edge: ${JSON.stringify(past.slice(0, 3))}` : "";
  }
  return { violations, seen: { disabled: facts.disabled.length, primaries: facts.primaries.length, texts: facts.texts.length } };
}

/** One line of the KNOWN list: the stage of the tournament, the screen, the rule, the thing. */
export function keyOf(stage: string, where: string, v: Pick<Violation, "rule" | "sig">): string {
  return `${stage} ${where} :: ${v.rule} :: ${v.sig}`;
}

/** What a KNOWN line must look like (held by the unit test, so a bad paste is caught before a browser runs). */
export const KEY_SHAPE = new RegExp(`^[a-z-]+ /[^ ]* :: (?:${RULES.join("|")}) :: .+$`);

/** The ratchet: what was found that the list does not hold, and what the list holds that is gone. */
export function ratchet(found: readonly string[], known: readonly string[]): { added: string[]; gone: string[] } {
  const f = new Set(found);
  const k = new Set(known);
  return { added: [...f].filter((x) => !k.has(x)).sort(), gone: [...k].filter((x) => !f.has(x)).sort() };
}

/** The whole KNOWN file as it should be now: paste it over `e2e/console-sweep-known.json`. */
export function knownFile(found: readonly string[]): string {
  return JSON.stringify([...new Set(found)].sort(), null, 2);
}
