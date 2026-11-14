import { createHash } from "node:crypto";
import type { Locator, Page, TestInfo } from "./coverage";
import { JOURNEY_BUDGETS, type Counted, type Limits } from "./journey-budgets";

/**
 * A JOURNEY, COUNTED AS A PERSON WALKS IT (work plan row 0b; Ajay, 14 Nov: "simplify the things while
 * setting up or as a player", "but still provide the full richer experience and functionality").
 *
 * One counter for every journey spec, so the secretary's first event and a player's first hole are
 * measured the same way and their figures can be set side by side:
 *
 *   screens   the DISTINCT paths the person's page stood on (`framenavigated` on the main frame, a
 *             full load or a client-side route change alike; the query and the hash are not a new
 *             screen, so a player link's code never reaches the output)
 *   visits    the paths in the order they were stood on — a screen left and come back to is two
 *   returns   visits minus screens: every time the person was sent back to a screen already left
 *   presses   every control the person pressed, through `press` or `key` — and any pressed inside a
 *             helper, added with `alsoPressed`. Clicking into a text box to type is not a press.
 *   boxes     every box the person filled: typed into, a date picked, a file chosen
 *   chars     every character typed, through `type` (or `alsoPressed`). The SAME IN EVERY PROJECT: a
 *             spec that puts a per-project mark in what is typed gives it one length (`projectTag`),
 *             so the figure is the person's typing and never the fixture's name.
 *   seconds   the wall clock from `start()` to `stop()`, at the panel's pace: before every press the
 *             person takes `READ_MS` to read the screen and find the next control, and types at
 *             `TYPE_MS` a character (about 60 words a minute) — a person, not a script.
 *
 * `report` prints ONE machine-readable line per journey, with its ceiling and target beside it —
 *
 *   JOURNEY {"name":"player-member","project":"phone","screens":3,"visits":3,"returns":0,"presses":3,…}
 *
 * — then the step list, one `JOURNEY-STEP` line per thing done (the screen it was done on, and what was
 * done), so a persona panel can read the walk without opening the spec. Both also go on the test's
 * annotations and as an attachment.
 *
 * THE RATCHET: `ceilingBreaches(f)` lists every figure over the journey's ceiling in
 * `journey-budgets.ts`; each spec asserts that list is empty. A figure UNDER its ceiling is printed
 * (`JOURNEY-UNDER`) so the cut's pull request lowers the ceiling in the same change.
 */

/** Reading a screen and finding the next control, per press. */
export const READ_MS = 3_000;
/** A character typed, at about 60 words a minute. */
export const TYPE_MS = 200;

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

export type JourneyStep = { screen: string; did: string };

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

/** Every figure over its ceiling, in words that say what to do; empty when there is no ceiling yet. */
export function ceilingBreaches(f: JourneyFigures, ceiling: Limits | null = JOURNEY_BUDGETS[f.name]?.ceiling ?? null): string[] {
  if (!ceiling) return [];
  return COUNTED.filter((k) => ceiling[k] !== undefined && f[k] > ceiling[k]!).map(
    (k) =>
      `${f.name} (${f.project}): ${k} is ${f[k]}, over its ceiling of ${ceiling[k]} — remove a step elsewhere in this journey or lower nothing`,
  );
}

/** Every figure under its ceiling: the ceiling comes down in this pull request. */
export function ceilingSlack(f: JourneyFigures, ceiling: Limits | null = JOURNEY_BUDGETS[f.name]?.ceiling ?? null): string[] {
  if (!ceiling) return [];
  return COUNTED.filter((k) => ceiling[k] !== undefined && k !== "seconds" && f[k] < ceiling[k]!).map(
    (k) => `${f.name} (${f.project}): ${k} is ${f[k]}, under its ceiling of ${ceiling[k]} — lower the ceiling to ${f[k]} in journey-budgets.ts`,
  );
}

export function journey(page: Page, name: string) {
  const route: string[] = [];
  const steps: JourneyStep[] = [];
  let presses = 0;
  let typed = 0;
  let boxes = 0;
  let started = 0;
  let elapsed = 0;

  page.on("framenavigated", (f) => {
    if (f !== page.mainFrame()) return;
    const path = pathOf(f.url());
    if (path && route[route.length - 1] !== path) route.push(path);
  });
  const here = () => pathOf(page.url());
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
    },
    /** The clock stops; the milliseconds since `start`. */
    stop(): number {
      elapsed = Date.now() - started;
      return elapsed;
    },
    /** A control pressed, after reading the screen. `what` is said in the step list. */
    async press(l: Locator, what: string) {
      await page.waitForTimeout(READ_MS);
      await l.scrollIntoViewIfNeeded();
      const at = here();
      await l.click();
      presses += 1;
      steps.push({ screen: at, did: `pressed ${what}` });
    },
    /** A key pressed in a box just typed into (Enter, to go on) — a press, with no screen to read first. */
    async key(l: Locator, key: string, what: string) {
      const at = here();
      await l.press(key);
      presses += 1;
      steps.push({ screen: at, did: `pressed ${what}` });
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
      steps.push({ screen: at, did: `typed ${text.length} characters into ${named}` });
    },
    /** A date picked (or a file chosen): one box filled, no characters typed, after reading the screen. */
    async pick(l: Locator, fill: (l: Locator) => Promise<void>, what: string) {
      await page.waitForTimeout(READ_MS);
      const at = here();
      await fill(l);
      boxes += 1;
      steps.push({ screen: at, did: `picked ${what}` });
    },
    /** Presses, boxes and characters a helper made on the person's behalf (an emailed code typed back, its button). */
    alsoPressed(counts: { presses?: number; boxes?: number; chars?: number }, did: string) {
      presses += counts.presses ?? 0;
      boxes += counts.boxes ?? 0;
      typed += counts.chars ?? 0;
      steps.push({ screen: here(), did });
    },
    /** Something the person did that is not a press — opened a link from a message, read the screen. */
    note(did: string) {
      steps.push({ screen: here(), did });
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
      const lines = steps.map((s, i) => `JOURNEY-STEP ${name} ${i + 1}. ${s.screen || "(no page yet)"} — ${s.did}`);
      const ceilingLines = !budget
        ? [`JOURNEY-CEILING ${name}: no entry in journey-budgets.ts`]
        : budget.ceiling
          ? ceilingSlack(f).map((s) => `JOURNEY-UNDER ${s}`)
          : [`JOURNEY-CEILING ${name}: not set yet — write this run's figures into journey-budgets.ts`];
      console.log(line);
      for (const l of [...lines, ...ceilingLines]) console.log(l);
      testInfo.annotations.push({ type: "journey", description: JSON.stringify(f) });
      await testInfo.attach(`journey-${name}.txt`, { body: [line, ...lines, ...ceilingLines].join("\n"), contentType: "text/plain" });
      return f;
    },
  };
}

export type Journey = ReturnType<typeof journey>;
