import {
  MAX_EVENT_PASSES,
  MAX_PASS_NAME,
  MAX_SEASON_MONTHS,
  PLANS,
  WORLD_REGION_ID,
  defaultMonthly,
  isAnnualMonths,
  seasonalTiers,
  type EventPass,
  type OfferPrices,
  type OfferSettings,
  type PlanKey,
  type PriceRegion,
} from "../plans";
import { isCurrencyCode } from "./money-format";
import { countryCode } from "./country";

/**
 * WHAT THE OWNER'S PLANS PANEL MAY SAVE, CHECKED AT THE BOUNDARY.
 *
 * `"use server"` exports are public endpoints and TypeScript types are erased at
 * runtime, so the actions in `app/actions/owner.ts` send everything they were
 * handed through here. Each function answers a clean value or a sentence for the
 * owner (a string), and never throws. Pure, so every refusal is a unit test.
 */

/** A region as the panel sends it: prices as typed numbers, null/blank for "the default". */
export interface RegionInput {
  id?: string;
  name: string;
  countries: string[];
  currency: string;
  monthly: Record<string, number | null>;
  annualMonths: number | null;
}

export const MAX_REGIONS = 40;

function regionName(code: string): string | null {
  try {
    const name = new Intl.DisplayNames(["en"], { type: "region" }).of(code);
    return name && name !== code ? name : null;
  } catch {
    return null;
  }
}

/** The name of a country, for the panel and its refusals; the code itself when nothing knows it. */
export function countryName(code: string): string {
  return regionName(code) ?? code;
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30) || "region";
}

/**
 * The regions to store (every one but Rest of world), or the sentence that refuses them.
 * A country is in at most one region, and the refusal says where it already is.
 */
export function cleanRegionInputs(inputs: unknown): PriceRegion[] | string {
  if (!Array.isArray(inputs)) return "The regions did not arrive as a list.";
  if (inputs.length > MAX_REGIONS) return `At most ${MAX_REGIONS} regions.`;
  const out: PriceRegion[] = [];
  const owner = new Map<string, string>();
  const names = new Set<string>(["rest of world"]);
  const ids = new Set<string>([WORLD_REGION_ID]);
  for (const raw of inputs as RegionInput[]) {
    if (!raw || typeof raw !== "object") return "A region was not readable.";
    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    if (!name) return "Every region needs a name.";
    if (name.length > 60) return `${name.slice(0, 20)}…: a region's name is at most 60 characters.`;
    if (names.has(name.toLowerCase())) return `${name}: two regions cannot share a name.`;
    names.add(name.toLowerCase());

    const currency = typeof raw.currency === "string" ? raw.currency.trim().toUpperCase() : "";
    if (!isCurrencyCode(currency)) return `${name}: "${raw.currency}" is not a currency code (three letters, like INR).`;

    const countries: string[] = [];
    for (const c of Array.isArray(raw.countries) ? raw.countries : []) {
      const code = countryCode(String(c));
      if (!/^[A-Z]{2}$/.test(code.toUpperCase())) return `${name}: "${c}" is not a country code (two letters, like IN).`;
      const iso = code === "UK" ? "GB" : code.toUpperCase();
      if (!regionName(iso)) return `${name}: ${c} is not a country.`;
      const there = owner.get(iso);
      if (there) return `${countryName(iso)} is already in ${there}.`;
      owner.set(iso, name);
      countries.push(iso);
    }
    if (countries.length === 0) return `${name}: add at least one country, or the region quotes nobody.`;

    const monthly: Partial<Record<PlanKey, number>> = {};
    for (const key of Object.keys(PLANS) as PlanKey[]) {
      const plan = PLANS[key];
      if (plan.priceMonthly <= 0) continue;
      const v = raw.monthly?.[key];
      if (v === null || v === undefined) continue;
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return `${name} · ${plan.name}: a price is a number, zero or more, or blank for the default.`;
      const whole = Math.round(v);
      // A price that is the default is no override, so a later change of the default still reaches it.
      if (whole !== defaultMonthly(plan, currency)) monthly[key] = whole;
    }
    for (const key of Object.keys(PLANS) as PlanKey[]) {
      const plan = PLANS[key];
      if (plan.priceMonthly > 0 && defaultMonthly(plan, currency) === undefined && monthly[key] === undefined) {
        return `${name}: ${currency} has no default price, so set ${plan.name}'s price in ${currency}.`;
      }
    }

    let id = typeof raw.id === "string" && /^[a-z0-9-]{1,40}$/.test(raw.id) && raw.id !== WORLD_REGION_ID ? raw.id : slug(name);
    if (ids.has(id)) {
      let n = 2;
      while (ids.has(`${id}-${n}`)) n++;
      id = `${id}-${n}`;
    }
    ids.add(id);

    const region: PriceRegion = { id, name, countries, currency, monthly };
    if (raw.annualMonths !== null && raw.annualMonths !== undefined) {
      if (!isAnnualMonths(raw.annualMonths)) return `${name}: months billed for a year is a whole number from 1 to 12.`;
      region.annualMonths = raw.annualMonths;
    }
    out.push(region);
  }
  return out;
}

/** The all-regions months billed for a year: 1 to 12, or null for the default. */
export function cleanAnnualMonths(v: unknown): number | null | string {
  if (v === null || v === undefined) return null;
  if (!isAnnualMonths(v)) return "Months billed for a year is a whole number from 1 to 12 (12 means no discount for paying yearly).";
  return v;
}

/** What the passes-and-season form sends. */
export interface OfferInput {
  onSale: boolean;
  passes: { name: string; prices: Record<string, number | null>; maxPlayers: number | null }[];
  seasonal: { tier: string; months: number; prices: Record<string, number | null> };
}

function cleanOfferPrices(raw: Record<string, number | null> | undefined, label: string, regionIds: readonly string[]): OfferPrices | string {
  const out: Record<string, number> = {};
  for (const id of regionIds) {
    const v = raw?.[id];
    if (v === null || v === undefined) continue;
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return `${label}: a price is a number, zero or more.`;
    out[id] = Math.round(v);
  }
  if (out[WORLD_REGION_ID] === undefined) return `${label}: Rest of world needs a price (every other region without its own is quoted it).`;
  return out as OfferPrices;
}

/** The offers to store, or the sentence that refuses them. `regionIds` are the regions that exist. */
export function cleanOfferInput(input: unknown, regionIds: readonly string[]): OfferSettings | string {
  if (!input || typeof input !== "object") return "The offers did not arrive.";
  const i = input as OfferInput;
  if (typeof i.onSale !== "boolean") return "On sale is on or off.";
  if (!Array.isArray(i.passes)) return "The passes did not arrive as a list.";
  if (i.passes.length > MAX_EVENT_PASSES) return `At most ${MAX_EVENT_PASSES} passes.`;
  const passes: EventPass[] = [];
  const seen = new Set<string>();
  for (const p of i.passes) {
    const name = typeof p?.name === "string" ? p.name.trim() : "";
    if (!name) return "Every pass needs a name.";
    if (name.length > MAX_PASS_NAME) return `${name.slice(0, 20)}…: a pass's name is at most ${MAX_PASS_NAME} characters.`;
    if (seen.has(name.toLowerCase())) return `${name}: two passes cannot share a name.`;
    seen.add(name.toLowerCase());
    const cap = p.maxPlayers;
    if (cap !== null && (typeof cap !== "number" || !Number.isInteger(cap) || cap < 1)) {
      return `${name}: the player cap is a whole number of 1 or more, or "any field".`;
    }
    const prices = cleanOfferPrices(p.prices, name, regionIds);
    if (typeof prices === "string") return prices;
    passes.push({ name, prices, maxPlayers: cap });
  }
  const s = i.seasonal;
  if (!s || typeof s !== "object") return "The seasonal plan did not arrive.";
  if (!seasonalTiers().includes(s.tier as PlanKey)) return "The seasonal plan is on a paid tier.";
  if (typeof s.months !== "number" || !Number.isInteger(s.months) || s.months < 1 || s.months > MAX_SEASON_MONTHS) {
    return `The season is a whole number of months, 1 to ${MAX_SEASON_MONTHS}.`;
  }
  const prices = cleanOfferPrices(s.prices, "Seasonal plan", regionIds);
  if (typeof prices === "string") return prices;
  return { onSale: i.onSale, passes, seasonal: { tier: s.tier as PlanKey, months: s.months, prices } };
}
