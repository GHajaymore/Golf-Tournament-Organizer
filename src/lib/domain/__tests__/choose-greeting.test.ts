import { describe, it, expect } from "vitest";
import { chooseGreeting } from "../choose-greeting";

/**
 * The member whose tournament was removed is told so (walked 2026-09-30): a
 * Par tournament deleted on completion sent its players to "Welcome to
 * TourneyHQ — your account is ready", the greeting for somebody brand new.
 */
describe("the /choose greeting", () => {
  it("tells a member their last tournament was removed, and does not greet them as new", () => {
    const g = chooseGreeting({ tournaments: 0, lastOpenRemoved: true, clubName: null });
    expect(g.title).toBe("Welcome back");
    expect(g.line).toContain("isn’t here any more");
    expect(g.line).not.toContain("Your account is ready");
  });

  it("the removal outranks the club line — it is the thing that just happened", () => {
    expect(chooseGreeting({ tournaments: 0, lastOpenRemoved: true, clubName: "zz Heath" }).title).toBe("Welcome back");
  });

  it("CONTROL: somebody new still gets the welcome", () => {
    const g = chooseGreeting({ tournaments: 0, lastOpenRemoved: false, clubName: null });
    expect(g.title).toBe("Welcome to TourneyHQ");
    expect(g.line).toContain("Your account is ready");
  });

  it("CONTROL: a club member with nothing published is told about the club", () => {
    expect(chooseGreeting({ tournaments: 0, lastOpenRemoved: false, clubName: "zz Heath" }).line).toContain("zz Heath");
  });

  it("anybody with a tournament is asked which, whatever else is true", () => {
    const g = chooseGreeting({ tournaments: 2, lastOpenRemoved: true, clubName: "zz Heath" });
    expect(g.title).toBe("Which tournament?");
    expect(g.line).toBe("You have access to 2 tournaments.");
  });
});
