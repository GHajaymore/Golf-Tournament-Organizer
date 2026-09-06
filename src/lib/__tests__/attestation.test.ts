import { describe, it, expect } from "vitest";
import { attestMatch, parseAttested, ruleFrom } from "@/lib/services/attestation";
import type { MatchSides } from "@/lib/domain/attest";

/**
 * The club's attestation rule, applied to a match result.
 *
 * `attestBy` has been offered in Play Settings since the screen was written —
 * one playing partner, someone from the other side, or everyone in the match —
 * and nothing read it. `confirmMatch` confirmed on the FIRST signature whichever
 * option a club had chosen, so an organizer who picked the strictest one, on a
 * result they expected to be argued about, got the fastest one.
 *
 * These assert the three rules DIFFER. That is the whole point: a test that
 * only checked "a signature confirms it" passed perfectly against the broken
 * behaviour, which is how this survived.
 */

/** A four-ball: Ann and Bob against Cat and Dan. */
const FOURBALL: MatchSides = { id: "m1", sideA: ["ann", "bob"], sideB: ["cat", "dan"] };
/** A singles match. */
const SINGLES: MatchSides = { id: "m2", sideA: ["ann"], sideB: ["cat"] };

/** A match Ann entered, with nobody having signed yet. */
const enteredByAnn = { enteredById: "ann", attestedBy: "[]" };

describe("the three rules are actually different", () => {
  it("marker: one other player in the match is enough", () => {
    const r = attestMatch(FOURBALL, enteredByAnn, "bob", "marker");
    expect(r.ok && r.status).toBe("confirmed");
  });

  it("all: one signature is NOT enough, and the same case confirms under marker", () => {
    /**
     * The cell that proves the setting does something. The identical call
     * differs only in the rule, so a fixture that could not tell them apart
     * would fail here rather than passing quietly.
     */
    const strict = attestMatch(FOURBALL, enteredByAnn, "bob", "all");
    const loose = attestMatch(FOURBALL, enteredByAnn, "bob", "marker");
    expect(strict.ok && strict.status).toBe("pending");
    expect(loose.ok && loose.status).toBe("confirmed");
  });

  it("all: confirms only once everyone else bound into the result has signed", () => {
    // Ann entered it, so the other three must sign. Two is not enough.
    const after1 = attestMatch(FOURBALL, enteredByAnn, "bob", "all");
    expect(after1.ok && after1.status).toBe("pending");

    const after2 = attestMatch(
      FOURBALL,
      { ...enteredByAnn, attestedBy: JSON.stringify(["bob"]) },
      "cat",
      "all",
    );
    expect(after2.ok && after2.status).toBe("pending");
    expect(after2.ok && after2.outstanding).toEqual(["dan"]);

    const after3 = attestMatch(
      FOURBALL,
      { ...enteredByAnn, attestedBy: JSON.stringify(["bob", "cat"]) },
      "dan",
      "all",
    );
    expect(after3.ok && after3.status).toBe("confirmed");
  });

  it("opponent: a partner may not sign, someone from the other side may", () => {
    // Ann entered it. Bob is her partner — he has no more reason to check it
    // than she does, which is the distinction the setting's help text draws.
    const partner = attestMatch(FOURBALL, enteredByAnn, "bob", "opponent");
    expect(partner.ok).toBe(false);
    expect(!partner.ok && partner.error).toMatch(/other side/i);

    const opponent = attestMatch(FOURBALL, enteredByAnn, "cat", "opponent");
    expect(opponent.ok && opponent.status).toBe("confirmed");
  });

  it("opponent in singles behaves as one playing partner, as the help says", () => {
    const r = attestMatch(SINGLES, enteredByAnn, "cat", "opponent");
    expect(r.ok && r.status).toBe("confirmed");
  });
});

describe("the rule attestation exists to guarantee", () => {
  it("refuses the person who entered the score", () => {
    /**
     * "A card signed only by the person who wrote it is not attested, it is
     * asserted." Before this was wired, Ann could enter a result and confirm
     * it herself — the old check only asked whether she had played in the
     * match, which she had.
     */
    const r = attestMatch(FOURBALL, enteredByAnn, "ann", "marker");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/somebody else/i);
  });

  it("refuses a lone player rather than letting them self-confirm", () => {
    // Nobody else is bound into the result. attest.ts is explicit that this
    // reads as "needs staff approval", never as approved.
    const alone: MatchSides = { id: "m3", sideA: ["ann"], sideB: [] };
    const r = attestMatch(alone, enteredByAnn, "ann", "marker");
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/organizer/i);
  });

  it("does not count the same signature twice", () => {
    // Otherwise Bob could satisfy "everyone in the match" by tapping three
    // times, which is the cheapest possible way to defeat the strict option.
    const r = attestMatch(
      FOURBALL,
      { ...enteredByAnn, attestedBy: JSON.stringify(["bob"]) },
      "bob",
      "all",
    );
    expect(r.ok && r.status).toBe("pending");
    expect(r.ok && r.attestedBy).toEqual(["bob"]);
  });
});

describe("reading what is stored", () => {
  it("treats a malformed column as nobody having signed", () => {
    // The failure direction matters: the other way round would confirm a
    // result off a parse error.
    expect(parseAttested("not json")).toEqual([]);
    expect(parseAttested("")).toEqual([]);
    expect(parseAttested('{"a":1}')).toEqual([]);
    expect(parseAttested('["ann", 3, "", "bob"]')).toEqual(["ann", "bob"]);
  });

  it("falls back to the marker rule rather than throwing on an unknown value", () => {
    expect(ruleFrom("all")).toBe("all");
    expect(ruleFrom("nonsense")).toBe("marker");
  });
});

describe("a result with no recorded author", () => {
  it("still needs somebody other than the signer", () => {
    /**
     * Every match recorded before this shipped has `enteredById: ""`, and the
     * migration says so. An unknown author excludes nobody, so the whole group
     * are candidates — which is the marker system and is what those rows have
     * always effectively had. What it must NOT do is confirm on nothing.
     */
    const legacy = { enteredById: "", attestedBy: "[]" };
    const r = attestMatch(FOURBALL, legacy, "bob", "marker");
    expect(r.ok && r.status).toBe("confirmed");

    const strict = attestMatch(FOURBALL, legacy, "bob", "all");
    expect(strict.ok && strict.status).toBe("pending");
  });
});
