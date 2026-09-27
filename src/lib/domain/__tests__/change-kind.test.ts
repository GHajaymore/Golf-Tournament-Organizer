import { describe, it, expect } from "vitest";
import { changeKind, FIELD_ACTIONS } from "../change-kind";

/**
 * The "Recent changes" lists (Ajay, 2026-09-27) file each audit line under a
 * heading. Every action a writer uses today is filed; an unknown one is
 * "Other", never dropped.
 */
describe("which heading an audit line goes under", () => {
  it("files the field's own changes as Field", () => {
    for (const a of FIELD_ACTIONS) expect(changeKind(a)).toBe("Field");
  });

  it("files money, results, rounds and settings", () => {
    expect(changeKind("expense.settle.undo")).toBe("Money");
    expect(changeKind("skins.pot")).toBe("Money");
    expect(changeKind("match.money")).toBe("Money");
    expect(changeKind("card.certify")).toBe("Scores & results");
    expect(changeKind("confirm-batch")).toBe("Scores & results");
    expect(changeKind("cut-applied")).toBe("Rounds");
    expect(changeKind("rotate-share-token")).toBe("Settings");
  });

  it("does not mistake a result for money because of a shared word (the control)", () => {
    // "match.clear" is a result; only "match.money" is money.
    expect(changeKind("match.clear")).toBe("Scores & results");
  });

  it("keeps an action nobody has filed yet, as Other", () => {
    expect(changeKind("some-new-thing")).toBe("Other");
  });
});
