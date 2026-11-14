import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { readSource } from "./source";
import { alertsOffWords, consoleOffersPlayStop } from "@/lib/domain/play-status";
import { PLAY_STATUS_REFRESH_MS } from "@/components/PlayStatusFrame";

/**
 * SUSPEND PLAY IS ON EVERY CONSOLE SCREEN, DRAWN ONCE (simplicity cut 2,
 * 2026-11-14; Rule 5.7).
 *
 * Suspend play, its banner and Resume play were drawn by the dashboard alone:
 * from the tee sheet in a storm that was 4 presses (the menu, Home, Suspend
 * play, Suspend play now), and resuming took the TD off the sheet. The panel's
 * conditions, each held here:
 *
 *   1. the same rule as the dashboard's, from the machine's step — never a new
 *      "day of play" rule;
 *   2. ONE mount, the console's shell, and the dashboard's own removed — two
 *      would draw two banners on Home, and a later screen could add a third
 *      with its own idea of when;
 *   3. staff only, never a player (a guest never reaches the console);
 *   4. the two-step confirm stays (`PlayStatusControl`, unchanged);
 *   5. the confirm names who the alarm misses, when it is handed them.
 *
 * The press itself — 2 from a non-Home screen, on a phone — is
 * `e2e/play-suspended.spec.ts`; the rule against the machine's real step on
 * real rows is `play-can-be-suspended.audit.test.ts`.
 */

const ROOT = process.cwd();

function sourcesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = join(dir, name);
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...sourcesUnder(rel));
    else if (/\.tsx?$/.test(name)) out.push(relative(ROOT, join(ROOT, rel)).split(sep).join("/"));
  }
  return out;
}

/** Every file that DRAWS the given component (JSX), comments stripped. */
function mountsOf(component: string): string[] {
  const tag = new RegExp(`<${component}[\\s/>]`);
  return [...sourcesUnder("src/app"), ...sourcesUnder("src/components")].filter((f) => tag.test(readSource(f)));
}

const offered = (viewRole: string, step: string | null, suspended: boolean, casualRound = false) =>
  consoleOffersPlayStop({ viewRole, step, suspended, casualRound });

describe("the rule: when the console offers to stop play", () => {
  it("staff while the tournament is being played", () => {
    expect(offered("admin", "live", false)).toBe(true);
    expect(offered("assistant", "live", false), "an assistant runs the day as much as the organizer").toBe(true);
  });

  it("never before launch, and never once play is over (T69) — unless play is suspended", () => {
    for (const step of ["setting-up", "play-over", "completed", null]) {
      expect(offered("admin", step, false), `offered on ${step}`).toBe(false);
      expect(offered("admin", step, true), `suspended on ${step} with no way back`).toBe(true);
    }
  });

  it("never to a player, nor to staff looking as a player — even while play is suspended", () => {
    for (const viewRole of ["player", "", "guest"]) {
      expect(offered(viewRole, "live", false), viewRole).toBe(false);
      expect(offered(viewRole, "live", true), viewRole).toBe(false);
    }
  });

  it("never on a casual round: created live and never closed, it would carry Suspend play for its whole life (#1149 C1)", () => {
    expect(offered("admin", "live", false, true), "Suspend play over a game between friends").toBe(false);
    expect(offered("admin", "live", true, true)).toBe(false);
    // CONTROL: the same viewer on the same step of a tournament is offered it.
    expect(offered("admin", "live", false, false)).toBe(true);
  });

  it("the shell asks it with the event's shape — the casual round is the rule's, not the caller's", () => {
    expect(readSource("src/components/ConsolePlayStatus.tsx")).toMatch(/casualRound:\s*isMatch\(event\.shape\)/);
  });
});

describe("one mount: the console's shell", () => {
  it("only ConsolePlayStatus draws the control, and the shell draws ConsolePlayStatus once", () => {
    // The control sees a mount: ConsolePlayStatus's own is found, so an empty answer is not a pass.
    expect(mountsOf("PlayStatusControl"), "a page draws Suspend play itself, beside the shell's").toEqual([
      "src/components/ConsolePlayStatus.tsx",
    ]);
    expect(mountsOf("ConsolePlayStatus"), "Suspend play is drawn by something other than the console's shell").toEqual([
      "src/app/(app)/layout.tsx",
    ]);
  });

  it("the dashboard no longer draws its own", () => {
    expect(readSource("src/app/(app)/dashboard/page.tsx")).not.toMatch(/PlayStatusControl|ConsolePlayStatus/);
  });

  it("the shell hands it the machine's step — the one its chip shows — and the viewer's role", () => {
    const shell = readSource("src/app/(app)/layout.tsx");
    const mount = shell.match(/<ConsolePlayStatus[^>]*\/>/)?.[0] ?? "";
    expect(mount).toMatch(/step=\{told\?\.status\.step \?\? null\}/);
    expect(mount).toMatch(/viewRole=\{session\.viewRole\}/);
    expect(shell, "the chip and the control read different steps").toMatch(/step: told\.status\.step/);
  });

  it("framed: never on paper, kept in view (sticky under the phone's top bar), kept the server's", () => {
    expect(readSource("src/components/ConsolePlayStatus.tsx")).toMatch(/<PlayStatusFrame>\s*<PlayStatusControl/);
    const frame = readSource("src/components/PlayStatusFrame.tsx");
    expect(frame).toMatch(/className="no-print console-play-status"/);
    expect(frame, "the frame does not sit under the phone's top bar").toMatch(/querySelector<HTMLElement>\("\.m-topbar"\)/);
    const css = readSource("src/app/globals.css");
    const rule = css.slice(css.indexOf(".console-play-status {"), css.indexOf("}", css.indexOf(".console-play-status {")));
    expect(rule).toMatch(/position: sticky/);
    expect(rule).toMatch(/top: var\(--play-status-top, 0px\)/);
    expect(rule, "content shows through the sticky row").toMatch(/background: var\(--color-bg\)/);
  });

  it("a layout is not drawn again between screens, so the frame asks the server again: on a timer and when the screen comes back (#1149 C2)", () => {
    const frame = readSource("src/components/PlayStatusFrame.tsx");
    expect(frame).toMatch(/setInterval\(ask, PLAY_STATUS_REFRESH_MS\)/);
    expect(frame).toMatch(/addEventListener\("visibilitychange", ask\)/);
    expect(frame).toMatch(/router\.refresh\(\)/);
    expect(PLAY_STATUS_REFRESH_MS, "slower than the player side's siren").toBeLessThanOrEqual(20_000);
  });

  it("Resume confirms, and says the field will be told to play on (#1149 C3)", () => {
    const control = readSource("src/components/PlayStatusControl.tsx");
    // The banner's own button opens the confirm; only "Resume play now" calls the action.
    expect(control).toMatch(/onClick=\{\(\) => setResuming\(true\)\}>\s*Resume play\s*</);
    expect(control).toMatch(/run\(resumePlay, close\)\}>\s*\{pending \? "Resuming…" : "Resume play now"\}/);
    expect(control.match(/run\(resumePlay/g), "a second press path resumes without the confirm").toHaveLength(1);
    expect(control).toMatch(/Players will be told to play on/);
    // A confirm opened on one suspension closes when the server's state moves under it.
    expect(control).toMatch(/useEffect\(\(\) => \{\s*setOpen\(false\);\s*setResuming\(false\);\s*\}, \[suspended, since\]\)/);
  });

  it("the shell's mount is outside the screen, so every console screen carries it", () => {
    const shell = readSource("src/app/(app)/layout.tsx");
    expect(shell.indexOf("<ConsolePlayStatus"), "mounted after the screen").toBeLessThan(shell.indexOf("{children}"));
    expect(shell.indexOf("<ConsolePlayStatus"), "mounted outside <main>").toBeGreaterThan(shell.indexOf("<main"));
  });

  it("the press goes through the one action pair — no second way to write a suspension", () => {
    const control = readSource("src/components/PlayStatusControl.tsx");
    expect(control).toMatch(/from "@\/app\/actions\/play-status"/);
    expect(control).toMatch(/suspendPlay\(why\)/);
    expect(control).toMatch(/resumePlay/);
    // Application code only: tests stamp the row directly to set the scene, and that is not a door.
    // The SHAPE is banned, not one spelling: any `data: { … playSuspendedAt: … }` (create, update,
    // updateMany, upsert), whatever value it writes, and any raw SQL that sets the column.
    const writes = (src: string) => /data:\s*\{[^}]*\bplaySuspendedAt\s*:/.test(src) || /"playSuspendedAt"\s*=/.test(src);
    const writers = [...sourcesUnder("src/app"), ...sourcesUnder("src/lib")]
      .filter((f) => !f.includes("/__tests__/"))
      .filter((f) => writes(readSource(f)));
    // The control: the action file is found, so an empty answer would be a blind sweep, not a pass.
    expect(writers, "a second place writes a suspension").toEqual(["src/app/actions/play-status.ts"]);
    expect(writes("prisma.event.update({ where, data: { note: x, playSuspendedAt: now } })"), "CONTROL: another spelling").toBe(true);
    expect(writes("select: { playSuspendedAt: true }"), "CONTROL: a read is not a write").toBe(false);
  });
});

describe("who the alarm will miss, on the confirm (F-2)", () => {
  it("names them, in the player's word for the switch", () => {
    expect(alertsOffWords(["Wren Calloway"])).toBe(
      "1 player has alerts off and will not be buzzed: Wren Calloway. Tell them another way, or sound the horn.",
    );
    expect(alertsOffWords(["Wren Calloway", "Robin Vale"])).toMatch(/^2 players have alerts off and will not be buzzed: Wren Calloway, Robin Vale\./);
  });

  it("says nothing when nobody is missed, or nobody asked", () => {
    expect(alertsOffWords([])).toBe("");
  });
});
