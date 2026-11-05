import { describe, it, expect } from "vitest";
import {
  keepingRole,
  keptOnSentence,
  youKeepSentence,
  nobodyKeepsSentence,
  takeOverQuestion,
  refusedSentence,
  noSheetWarning,
  CASUAL_KEEPING,
} from "@/lib/domain/keeping-words";
import { casualScoreKeeping } from "@/lib/domain/quick-match";
import { groupsArePublished } from "@/lib/domain/group-keeping";

/**
 * WHO KEEPS THE GROUP'S CARD, ON THE PHONES (2026-11-05, phase 2). One phone
 * keeps it; every other phone follows and can take over; nobody is shut out.
 */

describe("keepingRole — which of the three this phone is", () => {
  it("the keeper's own phone keeps; everybody else's follows; nobody's is open", () => {
    expect(keepingRole({ me: "ann", keeperId: "ann", refusedBy: null })).toBe("keeper");
    expect(keepingRole({ me: "bea", keeperId: "ann", refusedBy: null })).toBe("follower");
    expect(keepingRole({ me: "bea", keeperId: null, refusedBy: null })).toBe("open");
  });

  it("a save refused because the card moved outranks the page as drawn: the keeper's phone now follows", () => {
    expect(keepingRole({ me: "ann", keeperId: "ann", refusedBy: "Bea Example" })).toBe("follower");
    // Even with no name to give.
    expect(keepingRole({ me: "ann", keeperId: "ann", refusedBy: "" })).toBe("follower");
  });
});

describe("the words", () => {
  it("say whose phone, by first name, and the group by its sheet name", () => {
    expect(keptOnSentence("Group 3", "Ann Example")).toBe("Group 3 is being kept on Ann's phone.");
    expect(keptOnSentence("Your group", "")).toBe("Your group is being kept on another phone.");
    expect(youKeepSentence("Group 3")).toBe("You're keeping score for Group 3.");
    expect(youKeepSentence("Your match")).toBe("You're keeping score for your match.");
    expect(nobodyKeepsSentence("Your group")).toBe("Nobody is keeping your group's card yet.");
  });

  it("the take-over asks once and says what happens to the other phone", () => {
    expect(takeOverQuestion("Ann Example")).toBe("Take the card over from Ann? Ann's phone stops saving scores, and the change is logged.");
    expect(refusedSentence("Bea Example")).toMatch(/kept on Bea's phone, so this phone's last scores weren't saved/);
  });

  it("the organizer's warning names the tee sheet, and a match as its own group", () => {
    expect(noSheetWarning(false)).toBe("Groups come from the tee sheet. Until it is published, each player keeps their own card.");
    expect(noSheetWarning(true)).toMatch(/each match is kept on one phone/);
  });
});

describe("the casual round's one line", () => {
  it("one phone for the group first, as the default", () => {
    expect(CASUAL_KEEPING.map((k) => k.key)).toEqual(["group", "each"]);
    expect(CASUAL_KEEPING.map((k) => k.label)).toEqual(["One phone for the group", "Each player their own"]);
  });

  it("reads 'each' only when asked for: anything a caller posts otherwise is one phone", () => {
    expect(casualScoreKeeping({ scoreKeeping: "each" })).toBe("each");
    expect(casualScoreKeeping({})).toBe("group");
    expect(casualScoreKeeping({ scoreKeeping: "organizer" })).toBe("group");
    expect(casualScoreKeeping({ scoreKeeping: null })).toBe("group");
  });
});

describe("groupsArePublished — the organizer's warning reads the same sheet the groups do", () => {
  it("a published, non-empty sheet on any round; never an unpublished or empty one", () => {
    expect(groupsArePublished([{ teeSheetPublished: true, teeSheet: '{"groups":[]}' }])).toBe(true);
    expect(groupsArePublished([{ teeSheetPublished: false, teeSheet: '{"groups":[]}' }])).toBe(false);
    expect(groupsArePublished([{ teeSheetPublished: true, teeSheet: "  " }])).toBe(false);
    expect(groupsArePublished([])).toBe(false);
  });
});
