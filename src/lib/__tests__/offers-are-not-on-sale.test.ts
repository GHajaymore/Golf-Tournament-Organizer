import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import {
  DEFAULT_EVENT_PASSES,
  DEFAULT_SEASONAL,
  offerPrice,
  parseOfferSettings,
  parsePricingOverrides,
  publicOffers,
  type OfferSettings,
} from "@/lib/plans";
import { cleanOfferInput } from "@/lib/domain/plan-edit";
import { stripComments } from "./source";

/**
 * EVENT PASSES AND THE SEASONAL PLAN ARE NOT ON SALE (Ajay, 2026-11-10).
 *
 * Decided, and settable on /owner, but nothing public may show them until the
 * owner's separate "On sale" switch is on. Two guarantees, one each:
 *
 *   1. the gate: `publicOffers` is empty while the switch is off, whatever is stored;
 *   2. the sweep: no file outside the owner's own reads the stored offers, or the
 *      defaults, without going through that gate. A page written tomorrow that
 *      quotes a pass fails here, rather than shipping a price nobody can buy.
 */

const defaults = parseOfferSettings(null);

describe("the gate", () => {
  it("is shut by default, and the defaults are the decided offers", () => {
    expect(defaults.onSale).toBe(false);
    expect(defaults.passes).toEqual([...DEFAULT_EVENT_PASSES]);
    expect(defaults.passes.map((p) => [p.prices.world, p.maxPlayers])).toEqual([[29, 64], [99, null]]);
    expect(defaults.seasonal).toEqual(DEFAULT_SEASONAL);
    expect([defaults.seasonal.tier, defaults.seasonal.months, defaults.seasonal.prices.world]).toEqual(["society", 6, 245]);
  });

  it("shows nothing while off, however much is stored", () => {
    expect(publicOffers(defaults)).toEqual({ passes: [], seasonal: null });
    expect(publicOffers({ ...defaults, onSale: false, passes: defaults.passes })).toEqual({ passes: [], seasonal: null });
  });

  it("CONTROL: shows them when the switch is on", () => {
    const on: OfferSettings = { ...defaults, onSale: true };
    expect(publicOffers(on).passes).toHaveLength(2);
    expect(publicOffers(on).seasonal?.months).toBe(6);
  });

  it("only a boolean true turns it on", () => {
    for (const v of ["true", 1, "yes", null, {}]) {
      expect(parseOfferSettings(JSON.stringify({ onSale: v })).onSale, String(v)).toBe(false);
    }
    expect(parseOfferSettings(JSON.stringify({ onSale: true })).onSale).toBe(true);
  });
});

describe("a stored value is read, never thrown on", () => {
  it("falls back to the defaults on every malformed shape", () => {
    for (const raw of ["", "not json", "[]", "null", '{"passes":"x"}', '{"passes":[{"name":"","prices":{"world":1},"maxPlayers":1}]}']) {
      const parsed = parseOfferSettings(raw);
      expect(parsed.onSale, raw).toBe(false);
      expect(parsed.seasonal, raw).toEqual(DEFAULT_SEASONAL);
    }
    expect(parseOfferSettings('{"passes":"x"}').passes).toEqual([...DEFAULT_EVENT_PASSES]);
  });

  it("keeps an empty list (the owner removed every pass) and drops a pass that is not one", () => {
    expect(parseOfferSettings('{"passes":[]}').passes).toEqual([]);
    const kept = parseOfferSettings(
      JSON.stringify({
        passes: [
          { name: "Good", prices: { world: 10 }, maxPlayers: 8 },
          { name: "Negative", prices: { world: -1 }, maxPlayers: 8 },
          { name: "No cap", prices: { world: 10 } },
          { name: "Zero cap", prices: { world: 10 }, maxPlayers: 0 },
          { name: "No world price", prices: { gb: 10 }, maxPlayers: null },
        ],
      }),
    );
    expect(kept.passes.map((p) => p.name)).toEqual(["Good"]);
  });

  it("quotes a region's own price, else Rest of world's, in the right currency", () => {
    const o = parsePricingOverrides("");
    const pass = { world: 29, gb: 25 };
    expect(offerPrice(pass, o, "GB")).toEqual({ amount: 25, currency: "GBP" });
    expect(offerPrice(pass, o, "US")).toEqual({ amount: 29, currency: "USD" });
    expect(offerPrice(pass, o, "JP")).toEqual({ amount: 29, currency: "USD" });
  });
});

describe("what the owner may save", () => {
  const regionIds = ["world", "gb"];
  const ok = {
    onSale: false,
    passes: [{ name: "Event pass", prices: { world: 29, gb: null }, maxPlayers: 64 }],
    seasonal: { tier: "society", months: 6, prices: { world: 245 } },
  };

  it("accepts the decided offers", () => {
    expect(cleanOfferInput(ok, regionIds)).toEqual({
      onSale: false,
      passes: [{ name: "Event pass", prices: { world: 29 }, maxPlayers: 64 }],
      seasonal: { tier: "society", months: 6, prices: { world: 245 } },
    });
  });

  it("refuses each thing a public endpoint could be handed", () => {
    const pass = ok.passes[0];
    const refuse = (patch: Record<string, unknown>) => cleanOfferInput({ ...ok, ...patch }, regionIds);
    expect(refuse({ onSale: "yes" })).toMatch(/on or off/);
    expect(refuse({ passes: [{ ...pass, prices: { world: -5 } }] })).toMatch(/zero or more/);
    expect(refuse({ passes: [{ ...pass, prices: { gb: 5 } }] })).toMatch(/Rest of world needs a price/);
    expect(refuse({ passes: [{ ...pass, maxPlayers: 0 }] })).toMatch(/1 or more/);
    expect(refuse({ passes: [{ ...pass, maxPlayers: 2.5 }] })).toMatch(/1 or more/);
    expect(refuse({ passes: [{ ...pass, name: " " }] })).toMatch(/needs a name/);
    expect(refuse({ passes: [pass, { ...pass, name: "EVENT PASS" }] })).toMatch(/share a name/);
    expect(refuse({ passes: Array.from({ length: 9 }, (_, i) => ({ ...pass, name: `P${i}` })) })).toMatch(/At most 8/);
    expect(refuse({ seasonal: { ...ok.seasonal, tier: "free" } })).toMatch(/paid tier/);
    expect(refuse({ seasonal: { ...ok.seasonal, months: 0 } })).toMatch(/months/);
    expect(refuse({ seasonal: { ...ok.seasonal, prices: { world: -1 } } })).toMatch(/zero or more/);
  });

  it("null is allowed where unlimited is meant (any field) and nowhere else", () => {
    const any = cleanOfferInput({ ...ok, passes: [{ ...ok.passes[0], maxPlayers: null }] }, regionIds);
    expect(typeof any === "string" ? any : any.passes[0].maxPlayers).toBeNull();
    expect(cleanOfferInput({ ...ok, seasonal: { ...ok.seasonal, months: null } }, regionIds)).toMatch(/months/);
  });
});

// ---- the sweep -------------------------------------------------------------------------------

const SRC = join(process.cwd(), "src");
const files = (d: string): string[] =>
  readdirSync(d).flatMap((e) => {
    const p = join(d, e);
    if (statSync(p).isDirectory()) return e === "__tests__" ? [] : files(p);
    return /\.(ts|tsx)$/.test(p) ? [p] : [];
  });

/** The owner's own files, and the file that defines the offers. Everything else is public. */
const MAY_READ_OFFERS = new Set([
  "lib/plans.ts",
  "lib/domain/plan-edit.ts",
  "lib/services/platform-offers.ts",
  "app/actions/owner.ts",
  "app/owner/page.tsx",
  "components/OwnerOffers.tsx",
]);

/** A way to reach the offers the owner has stored, or the decided defaults. */
const READS_OFFERS = /\b(storedOfferSettings|parseOfferSettings|saveOfferSettings|DEFAULT_EVENT_PASSES|DEFAULT_SEASONAL|OwnerOffers|EventPass|SeasonalPlan)\b/;

/** What a file outside the owner's is refused for, or null. Pure, so the control can feed it a string. */
export function leaksOffers(code: string): string | null {
  const m = stripComments(code).match(READS_OFFERS);
  return m ? m[1] : null;
}

describe("nothing public reads the offers", () => {
  it("no file outside the owner's reads them, except through publicOffers", () => {
    const leaks = files(SRC)
      .map((f) => ({ rel: relative(SRC, f).split(sep).join("/"), code: readFileSync(f, "utf8") }))
      .filter((f) => !MAY_READ_OFFERS.has(f.rel))
      .flatMap((f) => {
        const hit = leaksOffers(f.code);
        return hit ? [`${f.rel} uses ${hit}`] : [];
      });
    expect(leaks, "a page outside /owner reads the event passes or the seasonal plan; go through publicOffers() (plans.ts)").toEqual([]);
  });

  it("CONTROL: the sweep sees a page that quotes a pass", () => {
    expect(leaksOffers("const o = await storedOfferSettings();")).toBe("storedOfferSettings");
    expect(leaksOffers("import { DEFAULT_EVENT_PASSES } from '@/lib/plans';")).toBe("DEFAULT_EVENT_PASSES");
    expect(leaksOffers("// storedOfferSettings is only the owner's\nconst x = 1;")).toBeNull();
  });

  it("the owner's files that may read them are real files (the list cannot rot)", () => {
    const all = new Set(files(SRC).map((f) => relative(SRC, f).split(sep).join("/")));
    for (const rel of MAY_READ_OFFERS) expect(all.has(rel), rel).toBe(true);
  });

  it("the public gate is how plans.ts hands them out: only publicOffers returns them without the owner's settings", () => {
    const code = stripComments(readFileSync(join(SRC, "lib/plans.ts"), "utf8"));
    expect(code).toMatch(/if \(settings\.onSale !== true\) return \{ passes: \[\], seasonal: null \};/);
  });
});
