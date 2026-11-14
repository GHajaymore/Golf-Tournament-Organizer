import { createHash } from "node:crypto";
import type { Locator, Page, TestInfo } from "./coverage";
import { JOURNEY_BUDGETS, type Counted, type Limits } from "./journey-budgets";

/**
 * A JOURNEY, COUNTED AS A PERSON WALKS IT (work plan row 0b; Ajay, 14 Nov: "simplify the things while
 * setting up or as a player", "but still provide the full richer experience and functionality").
 * How to read a breach, lower a ceiling, and when one may be raised: `docs/claude/journeys.md`.
 *
 * One counter for every journey spec, so the secretary's first event and a player's first hole are
 * measured the same way and their figures can be set side by side:
 *
 *   screens   the DISTINCT paths the person's page stood on (`framenavigated` on the main frame, a
 *             full load or a client-side route change alike; the query and the hash are not a new
 *             screen, so a player link's code never reaches the output)
 *   visits    the paths in the order they were stood on — a screen left and come back to is two
 *   returns   visits minus screens: every time the person was sent back to a screen already left
 *   presses   every control the person pressed, through `press` or `key` — a helper that presses on the
 *             person's behalf is handed the walk and counts through it (`verifyByCode(page, email, walk)`).
 *             Clicking into a text box to type is not a press.
 *   boxes     every box the person filled: typed into, a date picked, a file chosen
 *   chars     every character typed, through `type`. The SAME IN EVERY PROJECT: a spec that puts a
 *             per-project mark in what is typed gives it one length (`projectTag`), and types text
 *             its own file owns, so the figure is the person's typing and never another file's format.
 *   seconds   the wall clock from `start()` to `stop()`, at the panel's pace: before every press the
 *             person takes `READ_MS` to read the screen and find the next control, and types at
 *             `TYPE_MS` a character (about 60 words a minute) — a person, not a script. A wait that is
 *             only there for the test (`settle`, the network going quiet) is capped at `SETTLE_MS` and
 *             kept OFF the clock, so a page that polls cannot add a minute and blame a step for it.
 *
 * `report` prints ONE machine-readable line per journey, with its ceiling and target beside it —
 *
 *   JOURNEY {"name":"player-member","project":"phone","screens":3,"visits":3,"returns":0,"presses":3,…}
 *
 * — then the step list, one `JOURNEY-STEP` line per thing done (when, on which screen, and what was
 * done), so a persona panel can read the walk without opening the spec. Both also go on the test's
 * annotations and as an attachment.
 *
 * THE RATCHET: `ceilingBreaches(f)` lists every count over its ceiling in `journey-budgets.ts` AND every
 * count under it (the change that shortens a journey lowers its ceiling in the same pull request, or a
 * later one could put the step back unseen), and seconds over theirs. Each spec asserts the list is empty.
 */

/** Reading a screen and finding the next control, per press. */
export const READ_MS = 3_000;
/** A character typed, at about 60 words a minute. */
export const TYPE_MS = 200;
/** The longest a test-only wait (`settle`) may take; it is kept off the clock either way. */
export const SETTLE_MS = 5_000;

export type JourneyFigures = {
  name: string;
  project: string;
  screens: number;
  visits: number;
  returns: number;
  presses: number;
  boxes: number;
  chars: number;
  seconds: number;
  /** The paths in the order they were stood on, a repeat only when the person came back. */
  route: string[];
};

export type JourneyStep = { at: number; screen: string; did: string };

const pathOf = (url: string): string => {
  try {
    return new URL(url).pathname;
  } catch {
    return "";
  }
};

/**
 * Five characters standing for a Playwright project, the same length for every project — so a mark put
 * in typed text ("phone", "small-phone", "desktop") never changes how many characters were typed.
 */
export function projectTag(project: string): string {
  return createHash("sha1").update(project).digest("hex").slice(0, 5);
}

const COUNTED: Counted[] = ["screens", "visits", "returns", "presses", "boxes", "chars", "seconds"];
const BUDGETS_FILE = "e2e/journey-budgets.ts";

/**
 * Everything that fails the ratchet, in words that say what to do: a count over its ceiling, a count
 * under it, seconds over theirs, or a journey with no ceiling at all. Empty when the journey is exactly
 * at its ceilings.
 */
export function ceilingBreaches(f: JourneyFigures, ceiling: Limits | undefined = JOURNEY_BUDGETS[f.name]?.ceiling): string[] {
  const who = `${f.name} (${f.project})`;
  if (!ceiling) return [`${who}: no ceiling in ${BUDGETS_FILE}. Write this run's figures there as the journey's ceiling.`];
  const found: string[] = [];
  for (const k of COUNTED) {
    const c = ceiling[k];
    if (c === undefined) continue;
    const v = f[k];
    if (k === "seconds") {
      if (v > c)
        found.push(
          `${who}: seconds is ${v}, over its ceiling of ${c} in ${BUDGETS_FILE}. The counted steps did not grow: the app or a ` +
            `wait got slower. Read the times on the JOURNEY-STEP lines to find the step that took longer, and make it faster. ` +
            `A ceiling is raised only with a named ruling written beside it in ${BUDGETS_FILE}.`,
        );
      continue;
    }
    if (v > c)
      found.push(
        `${who}: ${k} is ${v}, over its ceiling of ${c} in ${BUDGETS_FILE}. This change added to the journey: take it out. ` +
          `If the new step is truly needed, remove another of the same kind elsewhere in this journey — a trade within one ` +
          `figure passes (one press in, one press out); a trade across figures does not (one screen more for two presses fewer ` +
          `fails). A ceiling is raised only with a named ruling written beside it in ${BUDGETS_FILE}.`,
      );
    else if (v < c)
      found.push(
        `${who}: ${k} is ${v}, under its ceiling of ${c} in ${BUDGETS_FILE}. This change shortened the journey: lower the ` +
          `ceiling to ${v} in the same pull request, so the step cannot come back unseen.`,
      );
  }
  return found;
}

export function journey(page: Page, name: string) {
  const route: string[] = [];
  const steps: JourneyStep[] = [];
  let presses = 0;
  let typed = 0;
  let boxes = 0;
  let started = 0;
  let offClock = 0;
  let elapsed = 0;

  page.on("framenavigated", (f) => {
    if (f !== page.mainFrame()) return;
    const path = pathOf(f.url());
    if (path && route[route.length - 1] !== path) route.push(path);
  });
  const here = () => pathOf(page.url());
  const clock = () => (started ? Date.now() - started - offClock : 0);
  const step = (screen: string, did: string) => steps.push({ at: clock(), screen, did });
  const figures = (project: string): JourneyFigures => {
    const screens = new Set(route).size;
    return {
      name,
      project,
      screens,
      visits: route.length,
      returns: route.length - screens,
      presses,
      boxes,
      chars: typed,
      seconds: Math.round(elapsed / 1000),
      route: [...route],
    };
  };

  return {
    /** The clock starts. */
    start() {
      started = Date.now();
      offClock = 0;
    },
    /** The clock stops; the milliseconds since `start`, less the test's own waits. */
    stop(): number {
      elapsed = clock();
      return elapsed;
    },
    /**
     * A wait that is only there for the test — the network going quiet before the next look — capped at
     * `SETTLE_MS` and kept off the clock.
     */
    async settle() {
      const from = Date.now();
      await page.waitForLoadState("networkidle", { timeout: SETTLE_MS }).catch(() => {});
      if (started) offClock += Date.now() - from;
    },
    /** A control pressed, after reading the screen. `what` is said in the step list. */
    async press(l: Locator, what: string) {
      await page.waitForTimeout(READ_MS);
      await l.scrollIntoViewIfNeeded();
      const at = here();
      await l.click();
      presses += 1;
      step(at, `pressed ${what}`);
    },
    /** A key pressed in a box just typed into (Enter, to go on) — a press, with no screen to read first. */
    async key(l: Locator, key: string, what: string) {
      const at = here();
      await l.press(key);
      presses += 1;
      step(at, `pressed ${what}`);
    },
    /**
     * Text typed into a box, a character at a time. `what` names the box — never the text, which may be
     * an address or a password; without it the box is named by its own label or placeholder.
     */
    async type(l: Locator, text: string, what?: string) {
      const at = here();
      await l.click();
      await l.pressSequentially(text, { delay: TYPE_MS });
      typed += text.length;
      boxes += 1;
      const named = what ?? `the box marked “${(await l.getAttribute("aria-label")) || (await l.getAttribute("placeholder")) || "?"}”`;
      step(at, `typed ${text.length} characters into ${named}`);
    },
    /** A date picked (or a file chosen): one box filled, no characters typed, after reading the screen. */
    async pick(l: Locator, fill: (l: Locator) => Promise<void>, what: string) {
      await page.waitForTimeout(READ_MS);
      const at = here();
      await fill(l);
      boxes += 1;
      step(at, `picked ${what}`);
    },
    /** A choice from a list (`<select>`): one press, after reading the screen. */
    async choose(l: Locator, option: string, what: string) {
      await page.waitForTimeout(READ_MS);
      const at = here();
      await l.selectOption(option);
      presses += 1;
      step(at, `chose “${option}” for ${what}`);
    },
    /** Something the person did that is not a press — opened a link from a message, read the screen. */
    note(did: string) {
      step(here(), did);
    },
    get presses() {
      return presses;
    },
    get route(): readonly string[] {
      return route;
    },
    figures,
    /** The JSON line (with the ceiling and target beside it) and the step list, printed and attached. */
    async report(testInfo: TestInfo): Promise<JourneyFigures> {
      const f = figures(testInfo.project.name);
      const budget = JOURNEY_BUDGETS[name];
      const line = `JOURNEY ${JSON.stringify({ ...f, ceiling: budget?.ceiling ?? null, target: budget?.target ?? null })}`;
      const lines = steps.map((s, i) => `JOURNEY-STEP ${name} ${i + 1}. at ${(s.at / 1000).toFixed(1)} s · ${s.screen || "(no page yet)"} — ${s.did}`);
      const breaches = ceilingBreaches(f).map((b) => `JOURNEY-BREACH ${b}`);
      console.log(line);
      for (const l of [...lines, ...breaches]) console.log(l);
      testInfo.annotations.push({ type: "journey", description: JSON.stringify(f) });
      await testInfo.attach(`journey-${name}.txt`, { body: [line, ...lines, ...breaches].join("\n"), contentType: "text/plain" });
      return f;
    },
  };
}

export type Journey = ReturnType<typeof journey>;
/** What a helper that acts for the person needs of the walk, to count what it does. */
export type JourneyHands = Pick<Journey, "type" | "press">;
