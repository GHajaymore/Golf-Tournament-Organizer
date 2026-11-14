import { describe, expect, it, vi } from "vitest";
import { journey } from "../../../e2e/journey";

/**
 * THE JOURNEY COUNTER (e2e/journey.ts) COUNTS WHAT IT SAYS IT COUNTS.
 *
 * The secretary's first event and a player's first hole are measured by it in a browser, on CI only
 * (no browser on the desktop that wrote it). The budgets of work plan row 0b will be set from its
 * figures, so the counting itself is held here, on a page made of the few calls it makes: a screen is
 * a distinct PATH of the main frame (a client-side route change counts, a query, a hash or a frame
 * inside the page does not), a press is a press, a character is a character, and the printed line is
 * one JSON object a machine can read — and never carries what was typed.
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
    pressSequentially: vi.fn(async () => {}),
    getAttribute: async (name: string) => (name === "placeholder" ? placeholder : null),
  });
  return { page, go, control };
}

const info = (project = "phone") => ({ project: { name: project }, annotations: [] as { type: string; description?: string }[], attach: vi.fn(async () => {}) });

describe("the journey counter", () => {
  it("counts distinct screens by path, presses, and characters typed — and prints one JSON line", async () => {
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
    walk.alsoPressed({ presses: 1, chars: 6 }, "typed the emailed code and pressed “Confirm email”");
    go("http://x.test/me/board");
    go("http://x.test/me"); // back to Today: a step on the route, not a new screen
    walk.stop();
    const f = await walk.report(info() as never);
    const lines = log.mock.calls.map((c) => String(c[0]));
    log.mockRestore();

    expect(f).toMatchObject({ name: "player-member", project: "phone", screens: 3, presses: 3, chars: 25 + 6 });
    expect(f.route).toEqual(["/me", "/me/card", "/me/board", "/me"]);

    const json = lines.filter((l) => l.startsWith("JOURNEY {"));
    expect(json, "one JOURNEY line, no more").toHaveLength(1);
    const parsed = JSON.parse(json[0].slice("JOURNEY ".length));
    expect(Object.keys(parsed).sort()).toEqual(["chars", "name", "presses", "project", "route", "screens", "seconds"]);
    expect(parsed.screens).toBe(3);

    const steps = lines.filter((l) => l.startsWith("JOURNEY-STEP "));
    expect(steps).toHaveLength(4);
    expect(steps[0]).toBe("JOURNEY-STEP player-member 1. /me — pressed “Start my card” on Today");
    expect(steps[2]).toBe("JOURNEY-STEP player-member 3. /me/card — typed 25 characters into the email box");
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
    expect(lines).toContain("JOURNEY-STEP secretary-first-event 1. / — typed 13 characters into the box marked “Full name”");
    expect(lines.join("\n")).not.toContain("Rowan");
  });

  it("CONTROL: a walk with nothing in it counts nothing", async () => {
    const { page } = fakePage();
    const walk = journey(page as never, "empty");
    walk.start();
    walk.stop();
    expect(walk.figures("phone")).toEqual({ name: "empty", project: "phone", screens: 0, presses: 0, chars: 0, seconds: 0, route: [] });
  });
});
