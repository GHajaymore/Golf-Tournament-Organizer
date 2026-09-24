import { describe, expect, it } from "vitest";
import { ownerMetrics } from "../owner-metrics";
import { planFor, effectivePrice } from "../../plans";

/**
 * The metrics turn raw counts into the business. The dangerous line is revenue:
 * the CONTROL is that MRR reflects the PRICE, not just the count, so a version
 * that summed clubs and called it money fails.
 */

const clubPrice = effectivePrice(planFor("club"));

describe("owner metrics", () => {
  const base = {
    totalOrgs: 15,
    orgsByPlan: [
      { plan: "free", count: 10 },
      { plan: "club", count: 5 },
    ],
    orgsByKind: [
      { kind: "club", count: 8 },
      { kind: "society", count: 7 },
    ],
    eventsByStatus: [
      { status: "completed", count: 40 },
      { status: "live", count: 6 },
      { status: "draft", count: 4 },
    ],
    totalPlayers: 1234,
    orgsWithNoEvents: 3,
  };

  it("counts paid, free and totals", () => {
    const m = ownerMetrics(base);
    expect(m.totalOrgs).toBe(15);
    expect(m.paidOrgs).toBe(5);
    expect(m.freeOrgs).toBe(10);
    expect(m.totalEvents).toBe(50);
    expect(m.liveEvents).toBe(6);
    expect(m.totalPlayers).toBe(1234);
    expect(m.orgsWithNoEvents).toBe(3);
  });

  it("CONTROL: MRR is price × count, not a headcount", () => {
    const m = ownerMetrics(base);
    // Five clubs at the club price, and the free ten add nothing.
    expect(clubPrice, "the club price should be non-zero, or this proves nothing").toBeGreaterThan(0);
    expect(m.estMrrMonthly).toBe(5 * clubPrice);
    expect(m.estArr).toBe(5 * clubPrice * 12);
    // It is emphatically not just the number of paying clubs.
    expect(m.estMrrMonthly).not.toBe(5);
  });

  it("tier mix is dearest first and carries each plan's MRR", () => {
    const m = ownerMetrics(base);
    expect(m.tierMix[0].name).toBe("Club");
    expect(m.tierMix[0].mrr).toBe(5 * clubPrice);
    expect(m.tierMix.find((t) => t.plan === "free")?.mrr).toBe(0);
  });

  it("an unknown plan key is treated as free, never crashing", () => {
    const m = ownerMetrics({ ...base, orgsByPlan: [{ plan: "enterprise-typo", count: 4 }] });
    // planFor normalises the unknown key to free, so it adds no revenue.
    expect(m.estMrrMonthly).toBe(0);
    expect(m.paidOrgs).toBe(0);
  });

  it("never reports negative free orgs even if the data is odd", () => {
    // More paid subscriptions than the org count (shouldn't happen, but the
    // dashboard must not print a negative).
    const m = ownerMetrics({ ...base, totalOrgs: 2, orgsByPlan: [{ plan: "club", count: 5 }] });
    expect(m.paidOrgs).toBe(5);
    expect(m.freeOrgs).toBe(0);
  });

  it("live events default to zero when no round is live", () => {
    const m = ownerMetrics({ ...base, eventsByStatus: [{ status: "completed", count: 3 }] });
    expect(m.liveEvents).toBe(0);
    expect(m.totalEvents).toBe(3);
  });
});
