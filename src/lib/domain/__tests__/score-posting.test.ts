import { describe, it, expect } from "vitest";
import { decidePost, postKey, type PostCandidate } from "../score-posting";

/**
 * What may be written to a golfer's official record.
 *
 * Every other test in this codebase guards a number on a screen. This one
 * guards something that leaves the building: a posted score changes a real
 * person's handicap index, that index follows them to every club they play,
 * and there is no undo this app controls.
 *
 * So the bar is not "does the right round get posted". It is "can a wrong one
 * possibly get posted", and every case below is a way somebody could end up
 * with a handicap they did not play to.
 */

const ready: PostCandidate = {
  enabled: true,
  golferId: "1234567",
  roundFinished: true,
  strokes: new Array(18).fill(4),
  holeCount: 18,
  alreadyPosted: false,
  competition: true,
};

const refusalFor = (over: Partial<PostCandidate>) => {
  const d = decidePost({ ...ready, ...over });
  return d.post ? null : d.refusal;
};

describe("a round that should be posted", () => {
  it("posts a complete, finished, competition round for a golfer with a number", () => {
    expect(decidePost(ready)).toEqual({ post: true });
  });

  it("posts a nine-hole round when nine is the whole round", () => {
    // holeCount is the question, not eighteen. A nine-hole competition is a
    // complete round and refusing it would quietly exclude every club that
    // runs midweek nines.
    expect(
      decidePost({
        ...ready,
        holeCount: 9,
        strokes: [...new Array(9).fill(4), ...new Array(9).fill(null)],
      }),
    ).toEqual({ post: true });
  });
});

describe("every way a round must NOT be posted", () => {
  it("refuses when the club has not turned posting on", () => {
    // Checked before anything else. A club that has not opted in should not
    // have its rounds evaluated for posting at all.
    expect(refusalFor({ enabled: false })).toBe("not-enabled");
  });

  it("refuses a round it has already posted", () => {
    /**
     * THE ONE THAT MATTERS MOST. A duplicate post is not a duplicate row — it
     * is somebody's index moving twice on a round they played once. The
     * commonest cause is a retry that actually succeeded the first time.
     */
    expect(refusalFor({ alreadyPosted: true })).toBe("already-posted");
  });

  it("refuses a player with no association number", () => {
    expect(refusalFor({ golferId: "" })).toBe("no-golfer-id");
    expect(refusalFor({ golferId: "   " })).toBe("no-golfer-id");
  });

  it("refuses a round that is still being played", () => {
    // A card mid-entry is not a score. Posting one and correcting it later
    // leaves the association holding a number nobody can reconcile.
    expect(refusalFor({ roundFinished: false })).toBe("round-unfinished");
  });

  it("refuses a card with holes missing, even in a finished round", () => {
    // A player can walk in on the 14th of a completed round. Their card is not
    // a score under any handicapping system, and sending eighteen holes with
    // four of them treated as anything at all is a fiction on a permanent
    // record.
    const short = [...new Array(13).fill(4), ...new Array(5).fill(null)];
    const d = decidePost({ ...ready, strokes: short });
    expect(d.post).toBe(false);
    if (d.post) return;
    expect(d.refusal).toBe("card-incomplete");
    expect(d.note).toContain("13 of 18");
  });

  it("refuses a round the club has not called a competition", () => {
    // Associations treat competition and casual rounds differently, and a club
    // that has not said which is not asking this app to guess.
    expect(refusalFor({ competition: false })).toBe("not-competition");
  });

  it("refuses on the FIRST reason, so a club is told one thing to fix", () => {
    // Everything wrong at once. The answer is still the one that comes first,
    // because a list of six problems is a screen nobody acts on.
    expect(
      refusalFor({ enabled: false, golferId: "", roundFinished: false, competition: false }),
    ).toBe("not-enabled");
  });

  it("gives every refusal something showable to a committee", () => {
    for (const over of [
      { enabled: false },
      { alreadyPosted: true },
      { golferId: "" },
      { competition: false },
      { roundFinished: false },
      { strokes: new Array(18).fill(null) },
    ] as Partial<PostCandidate>[]) {
      const d = decidePost({ ...ready, ...over });
      expect(d.post).toBe(false);
      if (d.post) continue;
      expect(d.note.length, JSON.stringify(over)).toBeGreaterThan(10);
    }
  });
});

describe("the key that makes a second post impossible", () => {
  it("is one key per golfer per round", () => {
    expect(postKey("e", "s", "p1")).not.toBe(postKey("e", "s", "p2"));
    expect(postKey("e", "s1", "p")).not.toBe(postKey("e", "s2", "p"));
  });

  it("is stable, because it is stored and compared across runs", () => {
    expect(postKey("e", "s", "p")).toBe(postKey("e", "s", "p"));
  });

  it("names the tournament, because that is the first thing anybody asks", () => {
    // Stage ids are unique on their own, so the event is in the key purely so
    // a human investigating a bad post can read it.
    expect(postKey("evt_9", "stg_2", "plr_7")).toContain("evt_9");
  });
});
