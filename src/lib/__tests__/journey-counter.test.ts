import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { journey, projectTag, ceilingBreaches, type JourneyFigures } from "../../../e2e/journey";
import { JOURNEY_BUDGETS, type Counted } from "../../../e2e/journey-budgets";

/**
 * THE JOURNEY COUNTER (e2e/journey.ts) COUNTS WHAT IT SAYS IT COUNTS, AND THE RATCHET HOLDS BOTH WAYS.
 *
 * The secretary's and the player's journeys are measured by it in a browser, on CI only (no browser on
 * the desktop that wrote it), and their ceilings (e2e/journey-budgets.ts) fail CI when a journey grows
 * AND when it shrinks without its ceiling coming down. So the counting is held here, on a page made of
 * the few calls it makes: a screen is a distinct PATH of the main frame (a client-side route change
 * counts, a query, a hash or a frame inside the page does not), a return is a screen come back to, a
 * press is a press, a box is a box, a character is a character, the test's own waits are off the clock,
 * the printed line is one JSON object a machine can read — and never carries what was typed.
 */

type Listener = (frame: unknown) => void;

function fakePage(onSettle: () => void = () => {}) {
  let current = "about:blank";
  const main = { url: () => current };
  const listeners: Listener[] = [];
  const page = {
    on: (_event: string, l: Listener) => listeners.push(l),
    mainFrame: () => main,
    url: () => current,
    waitForTimeout: async () => {},
    waitForLoadState: async () => onSettle(),
  };
  /** The main frame arrives at a URL — or, with `inner`, a frame inside the page does. */
  const go = (url: string, inner = false) => {
    if (!inner) current = url;
    const frame = inner ? { url: () => url } : main;
    for (const l of listeners) l(frame);
  };
  const control = (placeholder: string | null = null) => ({
    scrollIntoViewIfNeeded: async () => {},
    click: vi.fn(async () => {}),
    press: vi.fn(async () => {}),
    pressSequentially: vi.fn(async () => {}),
    selectOption: vi.fn(async () => {}),
    getAttribute: async (name: string) => (name === "placeholder" ? placeholder : null),
  });
  return { page, go, control };
}

const info = (project = "phone") => ({ project: { name: project }, annotations: [] as { type: string; description?: string }[], attach: vi.fn(async () => {}) });
/** The step lines without their times, which the clock decides. */
const untimed = (lines: string[]) => lines.filter((l) => l.startsWith("JOURNEY-STEP ")).map((l) => l.replace(/ at \d+\.\d s · /, " "));

const figures = (over: Partial<JourneyFigures>): JourneyFigures => ({
  name: "player-member",
  project: "phone",
  screens: 3,
  visits: 3,
  returns: 0,
  presses: 3,
  boxes: 0,
  chars: 0,
  seconds: 12,
  route: ["/me", "/me/card", "/me/board"],
  ...over,
});

afterEach(() => vi.restoreAllMocks());

describe("the journey counter", () => {
  it("counts screens, visits and returns by path, presses, boxes and characters — and prints one JSON line", async () => {
    const { page, go, control } = fakePage();
    const walk = journey(page as never, "player-member");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    walk.start();
    go("http://x.test/me");
    go("http://x.test/me?bust=1"); // the same screen: a query is not a new one
    await walk.press(control() as never, "“Start my card” on Today");
    go("http://x.test/me/card#hole-1"); // a client-side route change, its hash dropped
    go("http://x.test/frame-only", true); // a frame inside the page: not a screen
    await walk.press(control() as never, "“Par” for hole 1");
    await walk.type(control() as never, "zz-secret@example.invalid", "the email box");
    await walk.key(control() as never, "Enter", "Enter");
    await walk.pick(control() as never, async () => {}, "the first day");
    await walk.choose(control() as never, "Stroke Play", "the round's format");
    go("http://x.test/me/board");
    go("http://x.test/me"); // back to Today: a RETURN, not a new screen
    walk.stop();
    const f = await walk.report(info() as never);
    const lines = log.mock.calls.map((c) => String(c[0]));

    expect(f).toMatchObject({ name: "player-member", project: "phone", screens: 3, visits: 4, returns: 1, presses: 4, boxes: 2, chars: 25 });
    expect(f.route).toEqual(["/me", "/me/card", "/me/board", "/me"]);

    const json = lines.filter((l) => l.startsWith("JOURNEY {"));
    expect(json, "one JOURNEY line, no more").toHaveLength(1);
    const parsed = JSON.parse(json[0].slice("JOURNEY ".length));
    expect(Object.keys(parsed).sort()).toEqual(["boxes", "ceiling", "chars", "name", "presses", "project", "returns", "route", "screens", "seconds", "target", "visits"]);
    expect(parsed.returns).toBe(1);
    // The ceiling and the target ride beside the figures.
    expect(parsed.ceiling).toEqual(JOURNEY_BUDGETS["player-member"].ceiling);
    expect(parsed.target).toEqual(JOURNEY_BUDGETS["player-member"].target);

    const steps = untimed(lines);
    expect(steps).toHaveLength(6);
    expect(steps[0]).toBe("JOURNEY-STEP player-member 1. /me — pressed “Start my card” on Today");
    expect(steps[2]).toBe("JOURNEY-STEP player-member 3. /me/card — typed 25 characters into the email box");
    expect(steps[4]).toBe("JOURNEY-STEP player-member 5. /me/card — picked the first day");
    expect(steps[5]).toBe("JOURNEY-STEP player-member 6. /me/card — chose “Stroke Play” for the round's format");
    // Every step says when it happened, so a seconds breach shows where the time went.
    for (const l of lines.filter((x) => x.startsWith("JOURNEY-STEP "))) expect(l).toMatch(/ at \d+\.\d s · /);
    // This walk is over its ceiling (a return, one press more, two boxes): the report says so.
    expect(lines.filter((l) => l.startsWith("JOURNEY-BREACH ")).length).toBeGreaterThan(0);
    // What was typed (an address, a password) never reaches the output.
    expect(lines.join("\n")).not.toContain("zz-secret");
  });

  it("a box typed into with no name given is named by its placeholder, never by what was typed", async () => {
    const { page, go, control } = fakePage();
    const walk = journey(page as never, "secretary-first-event");
    go("http://x.test/");
    await walk.type(control("Full name") as never, "Rowan Fairlie");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const f = await walk.report(info("desktop") as never);
    const lines = log.mock.calls.map((c) => String(c[0]));
    expect(f.chars).toBe(13);
    expect(f.boxes).toBe(1);
    expect(untimed(lines)).toContain("JOURNEY-STEP secretary-first-event 1. / — typed 13 characters into the box marked “Full name”");
    expect(lines.join("\n")).not.toContain("Rowan");
  });

  it("the test's own waits are off the clock: a settle that takes 40 s adds nothing to the seconds", async () => {
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const { page, control } = fakePage(() => {
      now += 40_000; // the network never went quiet: a polling page
    });
    const walk = journey(page as never, "player-member");
    walk.start();
    now += 5_000;
    await walk.press(control() as never, "a control");
    await walk.settle();
    now += 7_000;
    walk.stop();
    expect(walk.figures("phone").seconds, "a test-only wait was put on the clock").toBe(12);
  });

  it("CONTROL: a walk with nothing in it counts nothing", async () => {
    const { page } = fakePage();
    const walk = journey(page as never, "empty");
    walk.start();
    walk.stop();
    expect(walk.figures("phone")).toEqual({ name: "empty", project: "phone", screens: 0, visits: 0, returns: 0, presses: 0, boxes: 0, chars: 0, seconds: 0, route: [] });
  });

  it("a project's tag is one length whatever the project is called, so typed text is too", () => {
    const tags = ["phone", "small-phone", "desktop", "iphone", "firefox-desktop"].map(projectTag);
    expect(new Set(tags.map((t) => t.length))).toEqual(new Set([5]));
    expect(new Set(tags).size, "two projects share a tag, and would share a fixture").toBe(tags.length);
  });
});

describe("the ratchet fails both ways", () => {
  it("GROWTH fails: a count over its ceiling names the journey, the figure, the ceiling, the file and what to do", () => {
    const over = ceilingBreaches(figures({ presses: 4 }));
    expect(over).toHaveLength(1);
    expect(over[0]).toContain("player-member (phone): presses is 4, over its ceiling of 3 in e2e/journey-budgets.ts.");
    expect(over[0]).toContain("take it out");
    expect(over[0]).toContain("remove another of the same kind elsewhere in this journey");
    expect(over[0]).toContain("a trade across figures does not");
    expect(over[0]).toContain("raised only with a named ruling");
    expect(over[0]).not.toContain("lower nothing");
  });

  it("SLACK fails: a count under its ceiling says to lower the ceiling in the same pull request", () => {
    const under = ceilingBreaches(figures({ presses: 2 }));
    expect(under).toEqual([
      "player-member (phone): presses is 2, under its ceiling of 3 in e2e/journey-budgets.ts. This change shortened the journey: lower the ceiling to 2 in the same pull request, so the step cannot come back unseen.",
    ]);
  });

  it("exactly at its ceilings, a journey passes; a trade within one figure is still exactly at it", () => {
    expect(ceilingBreaches(figures({}))).toEqual([]);
  });

  it("a trade across figures fails: one screen more for one press fewer is a breach both ways", () => {
    const traded = ceilingBreaches(figures({ screens: 4, visits: 4, presses: 2 }));
    expect(traded.filter((m) => m.includes("over its ceiling"))).toHaveLength(2);
    expect(traded.filter((m) => m.includes("under its ceiling"))).toHaveLength(1);
  });

  it("seconds fail only over, and the advice is the app's speed, not a step", () => {
    const j1 = { name: "secretary-first-event", presses: 12, screens: 5, visits: 6, returns: 1, boxes: 9, chars: 211 };
    expect(ceilingBreaches(figures({ ...j1, seconds: 60 })), "fast is never a breach").toEqual([]);
    const slow = ceilingBreaches(figures({ ...j1, seconds: 121 }));
    expect(slow).toHaveLength(1);
    expect(slow[0]).toContain("seconds is 121, over its ceiling of 120 in e2e/journey-budgets.ts. The counted steps did not grow");
    expect(slow[0]).toContain("Read the times on the JOURNEY-STEP lines");
    expect(slow[0]).not.toContain("take it out");
  });

  it("a journey with no ceiling fails: nothing is walked unheld", () => {
    expect(ceilingBreaches(figures({ name: "a-journey-nobody-measured" }))).toEqual([
      "a-journey-nobody-measured (phone): no ceiling in e2e/journey-budgets.ts. Write this run's figures there as the journey's ceiling.",
    ]);
  });

  it("every journey a spec walks has a budget, and every budget is walked by a spec", () => {
    const dir = join(process.cwd(), "e2e");
    const walked = new Set<string>();
    for (const f of readdirSync(dir).filter((n) => n.endsWith(".spec.ts"))) {
      for (const m of readFileSync(join(dir, f), "utf8").matchAll(/journey\(\s*page\s*,\s*"([^"]+)"\s*\)/g)) walked.add(m[1]);
    }
    expect(walked.size, "CONTROL: no journey found in e2e/").toBeGreaterThanOrEqual(7);
    expect([...walked].sort()).toEqual(Object.keys(JOURNEY_BUDGETS).sort());
  });

  it("every ceiling holds every count: none is missing, so none can grow unseen", () => {
    const counts: Counted[] = ["screens", "visits", "returns", "presses", "boxes", "chars"];
    for (const [name, b] of Object.entries(JOURNEY_BUDGETS)) {
      expect(b.ceiling, `${name} has no ceiling`).toBeTruthy();
      for (const k of counts) expect(b.ceiling[k], `${name}'s ceiling has no ${k}`).toEqual(expect.any(Number));
    }
  });

  it("no count's target is above its ceiling: a target is where a journey is going, never where it has been", () => {
    for (const [name, b] of Object.entries(JOURNEY_BUDGETS)) {
      // A seconds target may be a promise above the ceiling (J2's ten minutes).
      for (const k of (Object.keys(b.target) as Counted[]).filter((x) => x !== "seconds")) {
        expect(b.target[k]!, `${name}: target ${k} above its ceiling`).toBeLessThanOrEqual(b.ceiling[k]!);
      }
    }
  });
});
