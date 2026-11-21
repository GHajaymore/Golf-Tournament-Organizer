import { describe, it, expect } from "vitest";
import { tournamentStatus } from "../tournament-status";
import { facts, launched } from "./tournament-facts-fixtures";
import { markOf } from "../setup-field";
import type { DefaultOf } from "../setup-field";

const READY = tournamentStatus(facts());
const UNDATED = tournamentStatus(facts({ dated: false }));
const USUAL: DefaultOf = { value: "95%", source: "the Rules' usual allowance" };

describe("markOf, hand-worked", () => {
  it("required-before-launch: the field's holder holds launch", () => {
    expect(markOf("dates", UNDATED, "", null)).toBe("required-before-launch");
    expect(markOf("dates", UNDATED, "14 Nov", null)).toBe("required-before-launch"); // until the machine says so
  });

  it("required: an action holder with an empty value", () => {
    expect(markOf("name", READY, "", null)).toBe("required");
    expect(markOf("name", READY, "   ", null)).toBe("required");
  });

  it("default: the value is the proposal", () => {
    expect(markOf("venue", READY, "95%", USUAL)).toBe("default");
  });

  it("an answered field has no mark", () => {
    expect(markOf("name", READY, "Spring Medal", null)).toBeNull();
    expect(markOf("venue", READY, "90%", USUAL)).toBeNull();
    expect(markOf("dates", READY, "14 Nov", null)).toBeNull();
  });

  it("a field launch never refuses is never required, even when empty", () => {
    expect(markOf("venue", UNDATED, "", null)).toBeNull();
  });

  it("required beats default", () => {
    expect(markOf("name", READY, "", { value: "", source: "nothing" })).toBe("required");
    expect(markOf("dates", UNDATED, "14 Nov", { value: "14 Nov", source: "the club's usual day" })).toBe("required-before-launch");
  });

  it("nothing is before launch once launched", () => {
    expect(markOf("dates", tournamentStatus(launched(facts({ dated: false }))), "", null)).toBeNull();
  });
});
