import { describe, it, expect } from "vitest";
import { readSource } from "./source";

/**
 * THE CODE HOLDER'S DOOR TO THE BOARD (2026-11-05): `/play/board`.
 *
 * `/live/<token>` answers 404 unless the board is public — that 404 is the
 * privacy line and stays exactly as it was. A player who scored from a printed
 * sign has a play session and no account; `/play/board` is theirs. It is built
 * from the same pieces the public board is (`PublicBoard`: `liveBoard` through
 * `publicCopy`), so a player who asked not to be shown on public pages is not
 * shown here either, and its one permission is `mayOpenBoard`. The behaviour,
 * for all three visibility settings, is `e2e/play-board.spec.ts`; this pins the
 * shape that keeps the two doors from drifting.
 */
const play = readSource("src", "app", "play", "board", "page.tsx");
const live = readSource("src", "app", "live", "[token]", "page.tsx");
const board = readSource("src", "components", "PublicBoard.tsx");
const playPage = readSource("src", "app", "play", "page.tsx");

describe("/play/board", () => {
  it("is gated by the play session and by mayOpenBoard, and by nothing a share token could open", () => {
    expect(play).toMatch(/getPlaySession\(\)/);
    expect(play).toMatch(/mayOpenBoard\(settingsOf\(event\), "code-holder"\)/);
    expect(play).toMatch(/notFound\(\)/);
    // The event is the session's own, never one named in the address.
    expect(play).toMatch(/where: \{ id: session\.eventId \}/);
    expect(play).not.toMatch(/shareToken/);
    expect(play).not.toMatch(/params/);
  });

  it("does not ask whether the board is public: that is the other door's question", () => {
    expect(play).not.toMatch(/isLeaderboardPublic/);
  });

  it("draws the board the public draws, and gives a code holder no report", () => {
    expect(play).toMatch(/<PublicBoard\b/);
    expect(live).toMatch(/<PublicBoard\b/);
    expect(play).toMatch(/reportHref=\{null\}/);
  });
});

describe("/live stays the privacy line", () => {
  it("still answers 404 unless the tournament is explicitly public, and does not know of mayOpenBoard", () => {
    expect(live).toMatch(/isLeaderboardPublic\(settingsOf\(event\)\)/);
    expect(live).toMatch(/notFound\(\)/);
    expect(live).not.toMatch(/mayOpenBoard/);
  });
});

describe("the board both doors draw", () => {
  it("is read through publicCopy, whatever the door (opted-out players stay hidden)", () => {
    expect(board).toMatch(/publicCopy\(event\.id, await liveBoard\(/);
    expect(board).toMatch(/publicCopy\(event\.id, await cupBoard\(/);
    // CONTROL: the sweep sees the reader it is about — and no door reads the board any other way.
    expect(board).toMatch(/liveBoard\(/);
    for (const [name, src] of [["/play/board", play], ["/live", live]] as const) {
      expect(src, `${name} reads the board itself`).not.toMatch(/liveBoard\(|cupBoard\(/);
    }
  });
});

describe("/play", () => {
  it("links a code holder to their door where the board is not public, and to the public one where it is", () => {
    expect(playPage).toMatch(/mayOpenBoard\(settings, "code-holder"\)/);
    expect(playPage).toMatch(/"\/play\/board"/);
    expect(playPage).toMatch(/`\/live\/\$\{event\.shareToken\}`/);
  });
});
