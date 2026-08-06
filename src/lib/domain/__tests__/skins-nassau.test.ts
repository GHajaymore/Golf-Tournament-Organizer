import { describe, it, expect } from "vitest";
import { playSkins, type SkinsPlayer } from "../skins";
import { playNassau } from "../nassau";
import type { HoleResult } from "../types";

const p = (playerId: string, strokes: (number | null)[], courseHandicap = 0): SkinsPlayer => ({
  playerId,
  strokes,
  courseHandicap,
});

describe("skins", () => {
  it("awards a hole won outright", () => {
    const out = playSkins([p("a", [3, 4, 4]), p("b", [4, 4, 4])], 3);
    expect(out.holes[0].playerId).toBe("a");
    expect(out.holes[0].value).toBe(1);
    expect(out.standings[0]).toMatchObject({ playerId: "a", skins: 1 });
  });

  it("carries a tied hole into the next", () => {
    // The defining behaviour: hole 1 tied, so hole 2 is worth two skins.
    const out = playSkins([p("a", [4, 3]), p("b", [4, 4])], 2);
    expect(out.holes[0]).toMatchObject({ playerId: null, carried: true, value: 1 });
    expect(out.holes[1]).toMatchObject({ playerId: "a", value: 2 });
    expect(out.standings.find((s) => s.playerId === "a")!.skins).toBe(2);
  });

  it("keeps carrying across several ties", () => {
    const out = playSkins([p("a", [4, 4, 4, 3]), p("b", [4, 4, 4, 4])], 4);
    expect(out.holes[3].value).toBe(4);
    expect(out.standings.find((s) => s.playerId === "a")!.skins).toBe(4);
  });

  it("leaves value unclaimed when the last hole ties", () => {
    // Real games end this way and the pot has to be accounted for, not
    // silently absorbed.
    const out = playSkins([p("a", [4, 4]), p("b", [4, 4])], 2);
    expect(out.unclaimed).toBe(2);
    expect(out.standings.every((s) => s.skins === 0)).toBe(true);
  });

  it("does not carry a hole that simply hasn't been played", () => {
    // An unplayed hole is not a tie. Treating it as one would inflate later
    // holes with value from holes nobody has teed off on.
    const out = playSkins([p("a", [null, 3]), p("b", [null, 4])], 2);
    expect(out.holes).toHaveLength(1);
    expect(out.holes[0]).toMatchObject({ hole: 2, playerId: "a", value: 1 });
  });

  it("ignores a hole with only one score returned", () => {
    // One score is not a contest — the other players are still on the hole.
    const out = playSkins([p("a", [3, 3]), p("b", [null, 4])], 2);
    expect(out.holes).toHaveLength(1);
    expect(out.holes[0].hole).toBe(2);
  });

  it("plays net skins off stroke index", () => {
    // Gross, a's 4 beats b's 5. With a shot on stroke index 1, b nets 4 and
    // the hole is halved instead — which is the point of net skins.
    const gross = playSkins([p("a", [4]), p("b", [5], 18)], 1, { net: false });
    expect(gross.holes[0].playerId).toBe("a");

    const net = playSkins([p("a", [4]), p("b", [5], 18)], 1, { net: true, strokeIndex: [1] });
    expect(net.holes[0].carried).toBe(true);
    expect(net.holes[0].playerId).toBeNull();
  });

  it("records which holes each player won", () => {
    const out = playSkins([p("a", [3, 4, 3]), p("b", [4, 3, 4])], 3);
    expect(out.standings.find((s) => s.playerId === "a")!.holesWon).toEqual([1, 3]);
    expect(out.standings.find((s) => s.playerId === "b")!.holesWon).toEqual([2]);
  });

  it("ranks by skins won, not holes won", () => {
    // a wins two plain holes; b wins one hole carrying three. b leads.
    const out = playSkins([p("a", [3, 3, 4, 4, 4]), p("b", [4, 4, 4, 4, 3])], 5);
    expect(out.standings[0].playerId).toBe("b");
    expect(out.standings[0].skins).toBe(3);
    expect(out.standings[1].skins).toBe(2);
  });
});

describe("nassau", () => {
  const h = (s: string): HoleResult[] =>
    s.split("").map((c) => (c === "-" ? null : (c as HoleResult)));

  it("splits eighteen holes into three bets", () => {
    const out = playNassau(h("AAAAAAAAA" + "BBBBBBBBB"));
    expect(out.segments.map((s) => s.key)).toEqual(["front", "back", "overall"]);
    expect(out.segments[0].result!.winner).toBe("A");
    expect(out.segments[1].result!.winner).toBe("B");
    expect(out.segments[2].result!.winner).toBe("H"); // 9 each, all square
  });

  it("nets the balance across segments", () => {
    // A takes the front, B takes the back, overall square: net zero.
    expect(playNassau(h("AAAAAAAAA" + "BBBBBBBBB")).balance).toBe(0);
    // A sweeps: +3.
    expect(playNassau(h("AAAAAAAAA" + "AAAAAAAAA")).balance).toBe(3);
  });

  it("shows a lead before a segment is decided", () => {
    // Half the front played, A one up. The running state of the bet is the
    // whole appeal, so it counts toward the balance without being decided.
    const out = playNassau(h("A--------" + "---------"));
    expect(out.segments[0].result!.complete).toBe(false);
    expect(out.balance).toBe(2); // front and overall both show A ahead
    expect(out.decided).toBe(0);
  });

  it("reports a segment with no holes played as null", () => {
    const out = playNassau(h("AAAAAAAAA" + "---------"));
    expect(out.segments[1].result).toBeNull();
    expect(out.segments[1].played).toBe(0);
  });

  it("gives a nine-hole round a single segment", () => {
    // Slicing nine holes into "front" and "overall" would report one match
    // twice under two names, and there is no back nine to report.
    const out = playNassau(h("AAAAA----"));
    expect(out.segments).toHaveLength(1);
    expect(out.segments[0].key).toBe("overall");
  });

  it("counts decided segments", () => {
    // Front closed out 5&4, back untouched, overall not yet settled.
    const out = playNassau(h("AAAAA----" + "---------"));
    expect(out.segments[0].result!.complete).toBe(true);
    expect(out.decided).toBe(1);
  });
});
