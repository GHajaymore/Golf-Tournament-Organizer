import { describe, it, expect } from "vitest";
import {
  PLANS,
  parseLimitOverrides,
  effectiveLimit,
  enforcementEnabled,
  limitCheck,
  capacityUnderCap,
} from "@/lib/plans";
import { readSource } from "./source";

/**
 * The tier-limit override layer — the twin of the pricing overrides, and the
 * thing that lets the owner console tune caps and switch enforcement on without
 * a code edit. The gate that reads these can refuse a member entry, so the
 * parser has to be exactly as unforgiving as the pricing one, and the master
 * switch has to fail OFF.
 */

describe("parseLimitOverrides refuses to throw and defaults to OFF", () => {
  it("treats empty and malformed input as enforcement off, no caps", () => {
    for (const bad of ["", "   ", null, undefined, "not json", "[]", "42", '"x"']) {
      const parsed = parseLimitOverrides(bad);
      expect(parsed.enforce, `${JSON.stringify(bad)} must not enable enforcement`).toBe(false);
      expect(parsed.plans).toEqual({});
    }
  });

  it("reads a real blob: the switch and a per-tier cap", () => {
    const parsed = parseLimitOverrides('{"enforce":true,"plans":{"free":{"playersPerEvent":12,"staffSeats":2}}}');
    expect(parsed.enforce).toBe(true);
    expect(parsed.plans.free).toEqual({ playersPerEvent: 12, staffSeats: 2 });
  });

  it("keeps an explicit null as UNLIMITED, distinct from absent", () => {
    const parsed = parseLimitOverrides('{"plans":{"club":{"playersPerEvent":null}}}');
    expect(parsed.plans.club).toEqual({ playersPerEvent: null });
  });

  it("drops junk numbers and floors fractions, like the price parser", () => {
    const parsed = parseLimitOverrides(
      '{"plans":{"free":{"playersPerEvent":-1,"staffSeats":"5","activeEvents":3.7}}}',
    );
    // -1 (negative) and "5" (a string) are dropped; 3.7 floors to 3.
    expect(parsed.plans.free).toEqual({ activeEvents: 3 });
  });

  it("ignores an unknown plan key and enables only on a real true", () => {
    expect(parseLimitOverrides('{"plans":{"gold":{"playersPerEvent":5}}}').plans).toEqual({});
    // A truthy-but-not-true enforce value must not switch refusals on.
    expect(parseLimitOverrides('{"enforce":"yes"}').enforce).toBe(false);
    expect(parseLimitOverrides('{"enforce":1}').enforce).toBe(false);
  });

  it("drops a plan whose every limit was invalid rather than storing an empty one", () => {
    const parsed = parseLimitOverrides('{"plans":{"free":{"playersPerEvent":-3,"staffSeats":"x"}}}');
    expect(parsed.plans).toEqual({});
  });
});

describe("effectiveLimit: override wins, else the plan default", () => {
  it("uses the override when set", () => {
    const o = parseLimitOverrides('{"plans":{"free":{"playersPerEvent":25}}}');
    expect(effectiveLimit(PLANS.free, "playersPerEvent", o)).toBe(25);
  });

  it("falls back to the plan's own default when there is no override", () => {
    const o = parseLimitOverrides("");
    expect(effectiveLimit(PLANS.free, "playersPerEvent", o)).toBe(PLANS.free.limits.playersPerEvent);
    expect(effectiveLimit(PLANS.club, "playersPerEvent", o)).toBe(PLANS.club.limits.playersPerEvent);
  });

  it("an explicit null override means unlimited", () => {
    const o = parseLimitOverrides('{"plans":{"free":{"playersPerEvent":null}}}');
    expect(effectiveLimit(PLANS.free, "playersPerEvent", o)).toBeNull();
  });
});

describe("enforcementEnabled is off unless the owner turned it on", () => {
  it("defaults to off", () => {
    expect(enforcementEnabled(parseLimitOverrides(""))).toBe(false);
  });
  it("is on only for an explicit enforce:true", () => {
    expect(enforcementEnabled(parseLimitOverrides('{"enforce":true}'))).toBe(true);
  });
});

describe("limitCheck reads the effective (overridden) limit", () => {
  it("allows up to the override and refuses at it, naming the tier and the count", () => {
    const o = parseLimitOverrides('{"plans":{"free":{"playersPerEvent":12}}}');
    expect(limitCheck("free", "playersPerEvent", 11, o).allowed).toBe(true);
    const full = limitCheck("free", "playersPerEvent", 12, o);
    expect(full.allowed).toBe(false);
    expect(full.limit).toBe(12);
    expect(full.reason).toContain("12");
    expect(full.reason).toContain("players in a tournament");
  });

  it("without an override it enforces the plan default", () => {
    const o = parseLimitOverrides("");
    // Free defaults to a field of ten: nine fits, ten is full.
    expect(limitCheck("free", "playersPerEvent", 9, o).allowed).toBe(true);
    expect(limitCheck("free", "playersPerEvent", 10, o).allowed).toBe(false);
  });

  it("an unlimited override never refuses", () => {
    const o = parseLimitOverrides('{"plans":{"free":{"playersPerEvent":null}}}');
    expect(limitCheck("free", "playersPerEvent", 9999, o).allowed).toBe(true);
  });
});

describe("capacityUnderCap tightens the organizer's capacity to the tier", () => {
  it("leaves the organizer's number alone when the tier is uncapped", () => {
    expect(capacityUnderCap(0, null)).toBe(0);
    expect(capacityUnderCap(24, null)).toBe(24);
  });
  it("caps an unlimited organizer field at the tier cap", () => {
    expect(capacityUnderCap(0, 10)).toBe(10);
  });
  it("takes the tighter of the two when both are capped", () => {
    expect(capacityUnderCap(24, 10)).toBe(10);
    expect(capacityUnderCap(6, 10)).toBe(6);
    expect(capacityUnderCap(10, 10)).toBe(10);
  });
});

/**
 * THE FIELD CAP STAYS WIRED INTO EVERY ADD PATH.
 *
 * The gate is off by default, so no behavioural test refuses anything, so
 * nothing would go red if a refactor quietly dropped the cap from an intake
 * path — it would simply stop existing the day enforcement is switched on, in
 * production, on the paths a field actually fills from. Read through
 * `readSource`, which strips comments, so a mention of the helper in prose
 * cannot satisfy it: the call has to be really there.
 *
 * RE-PINNED 2026-10-10, on the guarantee rather than the spelling. This
 * required `effectiveCapacity(` in three files, and every one of them passed
 * it the tournament's `capacity` column — which is the wrong number once the
 * organizer has typed a manual target, so the guard held all three to the
 * defect (see `fieldLimitFor`). What a door must do is count against the one
 * limit the waiting list counts against, which has the cap inside it; and it
 * must not reach past that for a column of its own.
 */
const DOORS = [
  "src/app/actions/register.ts", // a stranger on a public link
  "src/app/actions/enter.ts", // a signed-in member, one tap
  "src/app/actions/roster.ts", // the organizer adding the club
  "src/app/actions/tournament.ts", // by hand, from a file, approving an entry
  "src/lib/services/registration.ts", // what the public page says about room
  "src/app/(app)/registration/page.tsx", // what the organizer's screen says
];

describe("the field cap stays wired into every add path", () => {
  for (const f of DOORS) {
    it(`${f} counts against the one field limit`, () => {
      const src = readSource(f);
      expect(src).toContain("fieldLimitFor(");
      expect(src, "measures a column of its own instead of the field's limit").not.toContain("effectiveCapacity(");
      expect(src).not.toContain("capacityUnderCap(");
    });
  }

  it("and that limit has the plan's cap inside it", () => {
    const src = readSource("src/lib/services/waitlist.ts");
    const body = src.slice(src.indexOf("export function fieldLimitUnder"), src.indexOf("export async function drainWaitlist"));
    expect(body).toContain("capacityUnderCap(fieldLimitOf(event)");
    expect(body).toContain("fieldCapFor(event.organizationId)");
  });

  it("CONTROL: the sweep reads real files — the member's Events list goes through the same limit", () => {
    expect(readSource("src/lib/services/club-events.ts")).toContain("fieldLimitUnder(event,");
  });
});
