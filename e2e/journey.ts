import type { Locator, Page, TestInfo } from "./coverage";

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
 *   presses   every control the person pressed, through `press` — and any pressed inside a helper,
 *             added with `alsoPressed`. Clicking into a text box to type is not a press.
 *   chars     every character typed, through `type` (or `alsoPressed`)
 *   seconds   the wall clock from `start()` to `stop()`, at the panel's pace: before every press the
 *             person takes `READ_MS` to read the screen and find the next control, and types at
 *             `TYPE_MS` a character (about 60 words a minute) — a person, not a script.
 *
 * `report` prints ONE machine-readable line per journey —
 *
 *   JOURNEY {"name":"player-member","project":"phone","screens":3,"presses":3,"chars":0,"seconds":11,"route":[...]}
 *
 * — and then the step list, one `JOURNEY-STEP` line per thing done (the screen it was done on, and
 * what was done), so a persona panel can read the walk without opening the spec. Both also go on the
 * test's annotations and as an attachment.
 *
 * NO BUDGET IS ASSERTED HERE YET: this measures. Budgets are set from the figures CI prints (row 0b,
 * step 3), in each spec at the place marked "BUDGET".
 */

/** Reading a screen and finding the next control, per press. */
export const READ_MS = 3_000;
/** A character typed, at about 60 words a minute. */
export const TYPE_MS = 200;

export type JourneyFigures = {
  name: string;
  project: string;
  screens: number;
  presses: number;
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

export function journey(page: Page, name: string) {
  const route: string[] = [];
  const steps: JourneyStep[] = [];
  let presses = 0;
  let typed = 0;
  let started = 0;
  let elapsed = 0;

  page.on("framenavigated", (f) => {
    if (f !== page.mainFrame()) return;
    const path = pathOf(f.url());
    if (path && route[route.length - 1] !== path) route.push(path);
  });
  const here = () => pathOf(page.url());
  const figures = (project: string): JourneyFigures => ({
    name,
    project,
    screens: new Set(route).size,
    presses,
    chars: typed,
    seconds: Math.round(elapsed / 1000),
    route: [...route],
  });

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
    /**
     * Text typed into a box, a character at a time. `what` names the box — never the text, which may be
     * an address or a password; without it the box is named by its own label or placeholder.
     */
    async type(l: Locator, text: string, what?: string) {
      const at = here();
      await l.click();
      await l.pressSequentially(text, { delay: TYPE_MS });
      typed += text.length;
      const named = what ?? `the box marked “${(await l.getAttribute("aria-label")) || (await l.getAttribute("placeholder")) || "?"}”`;
      steps.push({ screen: at, did: `typed ${text.length} characters into ${named}` });
    },
    /** Presses and characters a helper made on the person's behalf (an emailed code typed back, its button). */
    alsoPressed(counts: { presses?: number; chars?: number }, did: string) {
      presses += counts.presses ?? 0;
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
    /** The JSON line and the step list, printed and attached. Returns the figures. */
    async report(testInfo: TestInfo): Promise<JourneyFigures> {
      const f = figures(testInfo.project.name);
      const lines = steps.map((s, i) => `JOURNEY-STEP ${name} ${i + 1}. ${s.screen || "(no page yet)"} — ${s.did}`);
      console.log(`JOURNEY ${JSON.stringify(f)}`);
      for (const line of lines) console.log(line);
      testInfo.annotations.push({ type: "journey", description: JSON.stringify(f) });
      await testInfo.attach(`journey-${name}.txt`, { body: [`JOURNEY ${JSON.stringify(f)}`, ...lines].join("\n"), contentType: "text/plain" });
      return f;
    },
  };
}

export type Journey = ReturnType<typeof journey>;
