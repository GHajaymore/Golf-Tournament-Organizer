import { describe, it, expect } from "vitest";
import { mayStartNamesakeNotice, namesakeNoticeWords, nameWithoutAddress, orgNamesLookLikeOne, inTheSameArea } from "../org-name-match";
import { ORG_KINDS, orgProfile } from "../org-profile";

/**
 * A CLUB THAT TAKES A NAME NEARBY TELLS THE CLUB THAT WAS HERE FIRST (Ajay, 7 Nov 2026).
 * The match is the existing one (`org-name-match.test.ts` pins it); these pin the decision to start a
 * notice and the words the Commissioner reads. The rows are in `namesake-notice.audit.test.ts`.
 */
describe("which club may start a notice", () => {
  it("a named club does, and so does a personal tenant that took a typed name", () => {
    expect(mayStartNamesakeNotice({ kind: "personal", isDemo: false, name: "Mill Ridge Golf Club" })).toBe(true);
    expect(mayStartNamesakeNotice({ kind: "club", isDemo: false, name: "Mill Ridge Golf Club" })).toBe(true);
    expect(mayStartNamesakeNotice({ kind: "community", isDemo: false, name: "Thursday League" })).toBe(true);
  });
  it("the demo club and an unnamed club do not", () => {
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
  const words = namesakeNoticeWords({ name: "Mill Ridge Golf Club", noun: "club", where: "Cincinnati, OH", byName: "Dana Lee", day: "7 Nov 2026" });
  it("names the club, its town, the day and who set it up", () => {
    expect(words).toContain("A club named “Mill Ridge Golf Club” in Cincinnati, OH was set up on 7 Nov 2026 by Dana Lee.");
    expect(words).toContain("ask Dana Lee to join this one");
    expect(words).toContain("dismiss this");
  });
  it("says a club that already existed TOOK the name, not that it was set up", () => {
    const w = namesakeNoticeWords({ name: "Heath", noun: "club", where: "Leeds", byName: "Dana Lee", day: "7 Nov 2026", how: "renamed" });
    expect(w).toContain("A club in Leeds took the name “Heath” on 7 Nov 2026, run by Dana Lee.");
    expect(w).not.toContain("set up");
  });
  it("reads right for every kind, with the nouns orgProfile itself gives (never a lowercased label)", () => {
    for (const kind of ORG_KINDS) {
      for (const country of ["us", "gb", "au", ""]) {
        const noun = orgProfile(kind, country, "").noun;
        const w = namesakeNoticeWords({ name: "Heath", noun, day: "7 Nov 2026" });
        expect(w, `${kind}/${country}`).toMatch(new RegExp(`^An? ${noun} named “Heath” was set up on 7 Nov 2026\. If it is the same ${noun} as yours`));
        expect(w).not.toMatch(/ or |personal named/i);
      }
    }
    expect(namesakeNoticeWords({ name: "Heath", noun: orgProfile("community", "gb", "").noun, day: "d" })).toContain("A society named");
    expect(namesakeNoticeWords({ name: "Heath", noun: "association", day: "d" })).toContain("An association named");
  });
  it("copes with no town and no name, and never shows an email (a founder stored under an address)", () => {
    const bare = namesakeNoticeWords({ name: "Heath", noun: "club", day: "7 Nov 2026" });
    expect(bare).not.toContain(" in ,");
    expect(bare).toContain("ask them to join this one");
    const address = namesakeNoticeWords({ name: "Heath", noun: "club", byName: "dana@example.invalid", day: "7 Nov 2026" });
    expect(address).not.toContain("@");
    expect(address).toContain("ask them to join this one");
  });
  it("nameWithoutAddress keeps a name and drops an address", () => {
    expect(nameWithoutAddress(" Dana Lee ")).toBe("Dana Lee");
    expect(nameWithoutAddress("dana@example.invalid")).toBe("");
    expect(nameWithoutAddress(null)).toBe("");
  });
});
