import { describe, it, expect } from "vitest";
import { orgSetupState, type OrgSetupFacts } from "../org-setup";

const facts = (over: Partial<OrgSetupFacts> = {}): OrgSetupFacts => ({
  kind: "club",
  named: true,
  hasCourse: true,
  memberCount: 30,
  eventCount: 1,
  moneyAnswered: true,
  ...over,
});

describe("org setup checklist", () => {
  it("asks a club for a course and a roster", () => {
    const keys = orgSetupState(facts()).steps.map((s) => s.key);
    expect(keys).toContain("course");
    expect(keys).toContain("roster");
  });

  it("never asks a personal organizer for a shared roster", () => {
    // A step that cannot apply is worse than one merely undone: it reads as
    // the app having misunderstood what this organizer is.
    const keys = orgSetupState(facts({ kind: "personal" })).steps.map((s) => s.key);
    expect(keys).not.toContain("roster");
    expect(keys).not.toContain("course");
  });

  it("offers a club the money question, already answered", () => {
    // The shop takes the entry fee and the professional pays the winner, so
    // the default is right and nothing is waiting on the organizer. But a
    // club's annual away day IS an outing, and `resolveMoneyMode` lets one
    // tournament differ — a default nobody can see is a restriction, so the
    // row is present and ticked rather than absent.
    const s = orgSetupState(facts({ kind: "club", moneyAnswered: false }));
    expect(s.steps.map((x) => x.key)).toContain("money");
    expect(s.steps.find((x) => x.key === "money")?.done).toBe(true);
    // ...and it must not hold the checklist open forever.
    expect(s.remaining.map((x) => x.key)).not.toContain("money");
  });

  it("says a club's pots are worked out even though its costs are not", () => {
    // The distinction the money-game fix rests on: a pot is a result, not a
    // cash book, and a club runs skins every Saturday.
    const s = orgSetupState(facts({ kind: "club" }));
    expect(s.steps.find((x) => x.key === "money")?.blurb).toMatch(/[Ss]kins/);
  });

  it("leaves the money question genuinely open for a society", () => {
    // Here it IS waiting on somebody: nothing sensible can be defaulted when
    // the whole point is who fronted what.
    const s = orgSetupState(facts({ kind: "community", moneyAnswered: false }));
    expect(s.steps.find((x) => x.key === "money")?.done).toBe(false);
    expect(s.remaining.map((x) => x.key)).toContain("money");
  });

  it("stays ready for a club that has never answered the money question", () => {
    expect(orgSetupState(facts({ kind: "club", moneyAnswered: false })).ready).toBe(true);
  });

  it("points at the first undone step and no further", () => {
    const s = orgSetupState(facts({ memberCount: 0, eventCount: 0 }));
    expect(s.next?.key).toBe("roster");
    expect(s.ready).toBe(false);
  });

  it("is ready when everything that applies is done", () => {
    const s = orgSetupState(facts());
    expect(s.ready).toBe(true);
    expect(s.next).toBeNull();
  });

  it("is ready for a personal organizer who has only named it and made an event", () => {
    // The steps a personal organizer never had are not 'skipped' — they do
    // not exist, so they cannot hold readiness back.
    const s = orgSetupState(facts({ kind: "personal", hasCourse: false, memberCount: 0 }));
    expect(s.ready).toBe(true);
  });

  it("says what an undone step costs, where it costs anything", () => {
    const s = orgSetupState(facts({ memberCount: 0 }));
    expect(s.next?.consequence).toContain("empty field");
  });

  it("keeps every step reachable regardless of order", () => {
    // The whole point: this is a checklist, not a gate. A tournament created
    // before the roster is loaded is a normal way to work.
    const s = orgSetupState(facts({ memberCount: 0, eventCount: 1 }));
    expect(s.steps.find((x) => x.key === "tournament")?.done).toBe(true);
    expect(s.steps.find((x) => x.key === "roster")?.done).toBe(false);
  });

  it("treats an unknown kind as something rather than crashing", () => {
    expect(() => orgSetupState(facts({ kind: "nonsense" }))).not.toThrow();
    expect(orgSetupState(facts({ kind: null })).steps.length).toBeGreaterThan(0);
  });
});
