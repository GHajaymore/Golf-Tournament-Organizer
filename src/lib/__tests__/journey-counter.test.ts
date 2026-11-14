import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { journey, projectTag, ceilingBreaches, ceilingSlack, type JourneyFigures } from "../../../e2e/journey";
import { JOURNEY_BUDGETS, type Counted } from "../../../e2e/journey-budgets";

/**
 * THE JOURNEY COUNTER (e2e/journey.ts) COUNTS WHAT IT SAYS IT COUNTS, AND THE RATCHET HOLDS.
 *
 * The secretary's and the player's journeys are measured by it in a browser, on CI only (no browser on
 * the desktop that wrote it), and their ceilings (e2e/journey-budgets.ts) fail CI when a journey grows.
 * So the counting itself is held here, on a page made of the few calls it makes: a screen is a distinct
 * PATH of the main frame (a client-side route change counts, a query, a hash or a frame inside the page
 * does not), a return is a screen come back to, a press is a press, a box is a box, a character is a
 * character, the printed line is one JSON object a machine can read — and never carries what was typed.
 */

type Listener = (frame: unknown) => void;

function fakePage() {
  let current = "about:blank";
  const main = { url: () => current };
  const listeners: Listener[] = [];
  const page = {
    on: (_event: string, l: Listener) => listeners.push(l),
    mainFrame: () => main,
    url: () => current,
    waitForTimeout: async () => {},
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
    fill: vi.fn(async () => {}),
    getAttribute: async (name: string) => (name === "placeholder" ? placeholder : null),
  });
  return { page, go, control };
}

const info = (project = "phone") => ({ project: { name: project }, annotations: [] as { type: string; description?: string }[], attach: vi.fn(async () => {}) });

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
    walk.alsoPressed({ presses: 1, boxes: 1, chars: 6 }, "typed the emailed code and pressed “Confirm email”");
    go("http://x.test/me/board");
    go("http://x.test/me"); // back to Today: a RETURN, not a new screen
    walk.stop();
    const f = await walk.report(info() as never);
    const lines = log.mock.calls.map((c) => String(c[0]));
    log.mockRestore();

    expect(f).toMatchObject({ name: "player-member", project: "phone", screens: 3, visits: 4, returns: 1, presses: 4, boxes: 3, chars: 25 + 6 });
    expect(f.route).toEqual(["/me", "/me/card", "/me/board", "/me"]);

    const json = lines.filter((l) => l.startsWith("JOURNEY {"));
    expect(json, "one JOURNEY line, no more").toHaveLength(1);
    const parsed = JSON.parse(json[0].slice("JOURNEY ".length));
    expect(Object.keys(parsed).sort()).toEqual(["boxes", "ceiling", "chars", "name", "presses", "project", "returns", "route", "screens", "seconds", "target", "visits"]);
    expect(parsed.returns).toBe(1);
    // The ceiling and the target ride beside the figures.
    expect(parsed.ceiling).toEqual(JOURNEY_BUDGETS["player-member"].ceiling);
    expect(parsed.target).toEqual(JOURNEY_BUDGETS["player-member"].target);

    const steps = lines.filter((l) => l.startsWith("JOURNEY-STEP "));
    expect(steps).toHaveLength(6);
    expect(steps[0]).toBe("JOURNEY-STEP player-member 1. /me — pressed “Start my card” on Today");
    expect(steps[2]).toBe("JOURNEY-STEP player-member 3. /me/card — typed 25 characters into the email box");
    expect(steps[4]).toBe("JOURNEY-STEP player-member 5. /me/card — picked the first day");
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
    log.mockRestore();
    expect(f.chars).toBe(13);
    expect(f.boxes).toBe(1);
    expect(lines).toContain("JOURNEY-STEP secretary-first-event 1. / — typed 13 characters into the box marked “Full name”");
    expect(lines.join("\n")).not.toContain("Rowan");
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

describe("the ratchet", () => {
  it("a journey over its ceiling is named, with the figure, the ceiling, and what to do", () => {
    const over = ceilingBreaches(figures({ presses: 4, returns: 1 }));
    expect(over).toEqual([
      "player-member (phone): returns is 1, over its ceiling of 0 — remove a step elsewhere in this journey or lower nothing",
      "player-member (phone): presses is 4, over its ceiling of 3 — remove a step elsewhere in this journey or lower nothing",
    ]);
  });

  it("at its ceiling it passes; under it, the ceiling is to be lowered — and seconds are never 'lowered'", () => {
    expect(ceilingBreaches(figures({}))).toEqual([]);
    expect(ceilingSlack(figures({}))).toEqual([]);
    expect(ceilingSlack(figures({ presses: 2, seconds: 1 }))).toEqual([
      "player-member (phone): presses is 2, under its ceiling of 3 — lower the ceiling to 2 in journey-budgets.ts",
    ]);
  });

  it("a journey with no ceiling yet asserts nothing, and one with a seconds ceiling holds it", () => {
    expect(ceilingBreaches(figures({ name: "a-journey-not-yet-measured", presses: 99 }))).toEqual([]);
    expect(ceilingBreaches(figures({ presses: 99 }), null)).toEqual([]);
    expect(ceilingBreaches(figures({ name: "secretary-first-event", presses: 12, screens: 5, visits: 6, returns: 1, boxes: 9, chars: 211, seconds: 121 }))).toEqual([
      "secretary-first-event (phone): seconds is 121, over its ceiling of 120 — remove a step elsewhere in this journey or lower nothing",
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

  it("no target is above its ceiling: a target is where a journey is going, never where it has been", () => {
    for (const [name, b] of Object.entries(JOURNEY_BUDGETS)) {
      if (!b.ceiling) continue;
      for (const k of Object.keys(b.target) as Counted[]) {
        if (b.ceiling[k] === undefined) continue;
        expect(b.target[k]!, `${name}: target ${k} above its ceiling`).toBeLessThanOrEqual(b.ceiling[k]!);
      }
    }
  });
});
