import { describe, it, expect } from "vitest";
import { mayStartNamesakeNotice, namesakeNoticeWords, orgNamesLookLikeOne, inTheSameArea } from "../org-name-match";

/**
 * A CLUB THAT TAKES A NAME NEARBY TELLS THE CLUB THAT WAS HERE FIRST (Ajay, 7 Nov 2026).
 * The match is the existing one (`org-name-match.test.ts` pins it); these pin the decision to start a
 * notice and the words the Commissioner reads. The rows are in `namesake-notice.audit.test.ts`.
 */
describe("which club may start a notice", () => {
  it("a named club does", () => {
    expect(mayStartNamesakeNotice({ kind: "club", isDemo: false, name: "Mill Ridge Golf Club" })).toBe(true);
    expect(mayStartNamesakeNotice({ kind: "community", isDemo: false, name: "Thursday League" })).toBe(true);
  });
  it("a personal tenant, the demo club and an unnamed club do not", () => {
    expect(mayStartNamesakeNotice({ kind: "personal", isDemo: false, name: "Dana Lee" })).toBe(false);
    expect(mayStartNamesakeNotice({ kind: "club", isDemo: true, name: "Demo Heath Golf Club" })).toBe(false);
    expect(mayStartNamesakeNotice({ kind: "club", isDemo: false, name: "   " })).toBe(false);
  });
  it("is decided by the one matcher: the same name written two ways, near, and not a county away", () => {
    expect(orgNamesLookLikeOne("Mill Ridge G.C.", "Mill Ridge Golf Club")).toBe(true);
    expect(inTheSameArea({ city: "Cincinnati", region: "OH", country: "" }, { city: "", region: "", country: "" })).toBe(true);
    expect(inTheSameArea({ city: "Cincinnati", region: "OH", country: "" }, { city: "Austin", region: "TX", country: "" })).toBe(false);
  });
});

describe("what the existing club's Commissioner reads", () => {
  const words = namesakeNoticeWords({ name: "Mill Ridge Golf Club", label: "Club", where: "Cincinnati, OH", byName: "Dana Lee", day: "7 Nov 2026" });
  it("names the club, its town, the day and who set it up", () => {
    expect(words).toContain("A club named “Mill Ridge Golf Club” in Cincinnati, OH was set up on 7 Nov 2026 by Dana Lee.");
    expect(words).toContain("ask Dana Lee to join this one");
    expect(words).toContain("dismiss this");
  });
  it("uses the new club's own word, so a society is a society", () => {
    expect(namesakeNoticeWords({ name: "Heath", label: "Society", day: "7 Nov 2026" })).toContain("A society named “Heath” was set up on 7 Nov 2026.");
  });
  it("copes with no town and no name, and never shows an email", () => {
    const bare = namesakeNoticeWords({ name: "Heath", label: "Club", day: "7 Nov 2026" });
    expect(bare).not.toContain(" in ,");
    expect(bare).toContain("ask them to join this one");
    expect(bare).not.toContain("@");
  });
});
