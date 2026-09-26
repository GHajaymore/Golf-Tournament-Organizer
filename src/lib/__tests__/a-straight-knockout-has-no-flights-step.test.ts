import { describe, it, expect } from "vitest";
import { setupFlow, setupScreens, type SetupFacts } from "@/lib/domain/setup-flow";
import { setupChecklist } from "@/lib/services/checklist";
import { screenName } from "@/lib/nav";

/**
 * A STRAIGHT KNOCKOUT IS NOT ASKED FOR FLIGHTS.
 *
 * Found 2026-09-26: a newcomer's club knockout — a bracket as the only round —
 * sat at "4 of 5 — NOW Flights", told to divide a field that the draw ignores
 * (a first-round bracket draws everyone; see
 * `a-straight-knockout-draws-everyone.audit.test.ts`). The guide, the journey
 * card and the dashboard checklist must all leave the step out, and all keep
 * it for every other tournament.
 */
const base: SetupFacts = {
  confirmed: 8,
  rounds: [{ label: "Round 1", drawsPairings: false, scheduled: true, cutFed: false, matches: 0 }],
  groups: 0,
  named: true,
  dated: true,
  venued: true,
  moneyAnswered: true,
  launched: false,
};

describe("the setup guide", () => {
  it("has no Flights step for a straight knockout, and is complete without flights", () => {
    const flow = setupFlow({ ...base, straightKnockout: true }, screenName);
    expect(flow.steps.map((s) => s.href)).not.toContain("/grouping");
    expect(flow.complete).toBe(true);
  });

  it("keeps it for anything else (control)", () => {
    const flow = setupFlow(base, screenName);
    expect(flow.steps.map((s) => s.href)).toContain("/grouping");
    expect(flow.complete).toBe(false);
  });
});

describe("the journey card", () => {
  it("drops Flights when the flow does", () => {
    const hrefs = setupFlow({ ...base, straightKnockout: true }, screenName).steps.map((s) => s.href);
    expect(setupScreens(hrefs)).not.toContain("/grouping");
  });

  it("shows Flights when no list is given — a plain tournament has it (control)", () => {
    expect(setupScreens()).toContain("/grouping");
  });
});

describe("the dashboard checklist", () => {
  const checklist = (firstType: string) =>
    setupChecklist({
      confirmed: [1],
      waitlist: [],
      stages: [{ type: firstType }],
      groups: [],
      matches: [],
      accounts: [{}],
    }).map((i) => i.href);

  it("has no Flights row when the bracket is the first round", () => {
    expect(checklist("Bracket Stage")).not.toContain("/grouping");
  });

  it("keeps it when a round comes first (control)", () => {
    expect(checklist("Round Robin")).toContain("/grouping");
  });
});
