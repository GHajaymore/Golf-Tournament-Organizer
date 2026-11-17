import { describe, it, expect } from "vitest";
import { readSource } from "./source";
import { playScreenOf } from "@/lib/domain/play-status";

/**
 * EVERY SCREEN A ROUND CODE OPENS CARRIES "PLAY IS SUSPENDED" (2026-11-14,
 * safety sweep G-1; Rule 5.7a).
 *
 * `/play` mounted neither the banner nor the siren. Against real rows the
 * question the two ask is held by `the-siren-reaches-a-round-code.audit.test.ts`;
 * this holds the SCREENS to asking it — one function, `playStatusForScreen`,
 * for the banner and the poll, so they cannot disagree:
 *
 *   /play         the banner and the siren, both from playStatusForScreen("play")
 *   /play/board   the siren (the board draws its own banner, from the same round)
 *   the poll      currentPlayStatus asks playStatusForScreen and nothing else
 */

const play = readSource("src", "app", "play", "page.tsx");
const board = readSource("src", "app", "play", "board", "page.tsx");
const action = readSource("src", "app", "actions", "play-status.ts");

describe("a round code's phone is told play is suspended", () => {
  it("/play draws the banner and mounts the siren, both from the round its code opened", () => {
    expect(play, "/play does not ask which round it is for").toContain('playStatusForScreen("play")');
    expect(play, "/play draws no suspension banner").toMatch(/<PlaySuspendedBanner\s+status=\{status\}/);
    expect(play, "/play sounds no siren, or asks about another screen's round").toMatch(/<SuspensionAlarm\s+screen="play"\s+suspended=\{status\.suspended\}/);
  });

  it("before the code prompt is passed there is nothing to be told about", () => {
    const prompt = play.indexOf('if (!session) return <PlayClient stage="code" />;');
    expect(prompt).toBeGreaterThan(-1);
    expect(prompt, "the banner is asked before there is a round").toBeLessThan(play.indexOf('playStatusForScreen("play")'));
  });

  it("/play/board sounds the siren for the same round", () => {
    expect(board).toContain('playStatusForScreen("play")');
    expect(board).toMatch(/<SuspensionAlarm\s+screen="play"/);
  });

  it("the poll asks the one function, and never an event the client names", () => {
    const poll = action.slice(action.indexOf("export async function currentPlayStatus"), action.indexOf("export async function suspendPlay"));
    expect(poll).toContain("playStatusForScreen(playScreenOf(screen))");
    expect(poll, "the poll reads an event of its own").not.toMatch(/prisma\./);
    expect(poll, "the poll asks a session itself, beside the one function").not.toMatch(/getSession\(|getPlaySession\(/);
  });

  it("the kind of screen is the only thing a client chooses", () => {
    expect(playScreenOf("play")).toBe("play");
    expect(playScreenOf("player")).toBe("player");
    for (const other of [undefined, null, "", "PLAY", "evt_123", { screen: "play" }, ["play"]]) expect(playScreenOf(other)).toBe("player");
  });
});
