import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { limitCheck, planFor, PLANS } from "../plans";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("plan limits", () => {
  it("never limits the size of a field", () => {
    // The constraint the pricing is built on: charging golfers to enter their
    // own scores would stop the tool being used, and the players are the
    // distribution channel.
    for (const plan of Object.values(PLANS)) {
      expect(plan.limits.playersPerEvent, `${plan.key} limits players`).toBeNull();
    }
  });

  it("allows up to the limit and refuses past it", () => {
    expect(limitCheck("free", "activeEvents", 0).allowed).toBe(true);
    expect(limitCheck("free", "activeEvents", 1).allowed).toBe(false);
    expect(limitCheck("free", "activeEvents", 1).reason).toMatch(/Free plan/);
  });

  it("treats null as unlimited", () => {
    expect(limitCheck("club", "activeEvents", 999).allowed).toBe(true);
    expect(limitCheck("club", "activeEvents", 999).limit).toBeNull();
  });

  it("falls back to free rather than locking someone out on a bad row", () => {
    expect(planFor("enterprise-gold").key).toBe("free");
    expect(planFor(null).key).toBe("free");
  });
});

describe("limits are wired into every path that consumes one", () => {
  const tournament = read("src/app/actions/tournament.ts");
  const organization = read("src/app/actions/organization.ts");

  it("checks before creating a tournament", () => {
    expect(tournament).toMatch(/refusalFor\(organizationId, "activeEvents"\)/);
  });

  it("checks before copying one, because a copy is a new tournament", () => {
    expect(tournament).toMatch(/refusalFor\(source\.organizationId, "activeEvents"\)/);
  });

  it("counts per-event organizer roles against staff seats", () => {
    // Without this the seat limit is bypassed by granting rights on each event
    // rather than at the club.
    expect(tournament).toMatch(/refusalFor\(orgId, "staffSeats"\)/);
  });

  it("checks before adding club staff", () => {
    expect(organization).toMatch(/refusalFor\(org\.organizationId, "staffSeats"\)/);
  });

  it("does not charge a seat for adding a player", () => {
    const addAccount = tournament.slice(tournament.indexOf("export async function addAccount"));
    expect(addAccount).toMatch(/next !== "player"/);
  });
});

describe("when limits bite", () => {
  const limits = read("src/lib/services/limits.ts");

  it("stays out of the way until billing is connected", () => {
    // A limit with no purchasable upgrade is an outage, not a business model:
    // it would lock existing organizations out of tournaments they run today.
    expect(limits).toMatch(/if \(!\(await enforcementActive\(organizationId\)\)\) return null;/);
    expect(limits).toMatch(/sub\.provider\.trim\(\) !== ""/);
  });

  it("still reports standing even when not enforcing", () => {
    // So the UI can say "1 of 1 on Free" honestly rather than staying silent.
    expect(limits).toMatch(/export async function limitStatus/);
    expect(limits).toMatch(/enforced,/);
  });

  it("deduplicates a person who is both club staff and an event organizer", () => {
    expect(limits).toMatch(/new Set<string>\(\)/);
    expect(limits).toMatch(/toLowerCase\(\)/);
  });

  it("counts only organizer and assistant roles, never players", () => {
    expect(limits).toMatch(/role: \{ in: \["admin", "assistant"\] \}/);
  });
});
