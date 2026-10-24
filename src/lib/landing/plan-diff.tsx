import type { ReactNode } from "react";
import { PLANS, phoneRequiredFor, retentionSummary, type PlanKey } from "@/lib/plans";
import type { LandingPrices } from "./pricing";
import { freePlanWords, type LaunchState } from "@/lib/go-live";

/** The plans, in the order the front door shows them. */
export const PLAN_KEYS: PlanKey[] = ["free", "society", "club"];

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * "Compare plans": only what DIFFERS between the plans, every cell read from
 * PLANS. TourneyHQv2 read the code (2026-09-29): of the 69 feature lines only
 * the order of merit (seasonStandings) and white-label are plan-gated; the rest
 * is on every plan, which the table's footer says. The limits are the plans'
 * published terms — the page never claims anyone is blocked at them.
 *
 * Its own module (2026-10-23) so the table can be rendered by a test. `launch` is the go-live
 * switch's answer, required.
 */
export function planDiff(prices: LandingPrices, launch: LaunchState): [string, ReactNode[]][] {
  const each = (f: (k: PlanKey) => ReactNode) => PLAN_KEYS.map(f);
  const count = (n: number | null, one: string) => (n === null ? "No limit" : n === 1 ? one : `Up to ${n}`);
  const has = (on: boolean, note?: string) =>
    on ? <><span className="cp-m cp-y" aria-hidden="true">✓</span><span className="sr">Included</span>{note ? <small>{note}</small> : null}</>
       : <><span className="cp-m cp-x" aria-hidden="true">✕</span><span className="sr">Not included</span></>;
  return [
    ["Price", [
      // Held, the free plan is not offered (the go-live switch): no "free for good" until launch.
      <><b>{prices.zero}</b><small>{freePlanWords(launch).term}</small></>,
      <><b>{prices.society.yearly} a year</b><small>or {prices.society.monthly} a month</small></>,
      <><b>{prices.club.yearly} a year</b><small>or {prices.club.monthly} a month</small></>,
    ]],
    ["Players in one tournament", each((k) => count(PLANS[k].limits.playersPerEvent, "One"))],
    ["Tournaments at once", each((k) => count(PLANS[k].limits.activeEvents, "One"))],
    ["Organizers and assistants", each((k) => count(PLANS[k].limits.staffSeats, "One"))],
    ["Results kept", each((k) => capitalise(retentionSummary(PLANS[k]).replace(/^results /, "")))],
    ["Players' mobile numbers", each((k) => (phoneRequiredFor(k, false, "email") ? <>Asked<small>not with round codes</small></> : <>Your choice<small>per tournament</small></>))],
    ["Order of merit across events", each((k) => has(PLANS[k].features.seasonStandings))],
    ["The honors board", each((k) => has(PLANS[k].features.honours))],
    ["Your club's branding in place of ours", each((k) => has(PLANS[k].features.whiteLabel, "with your logo"))],
  ];
}
