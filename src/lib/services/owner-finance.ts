import "server-only";
import { prisma } from "@/lib/db";
import {
  addMonths, convertRow, costCsvRows, firstDayOf, monthReport, monthRange, monthsBetween,
  type UsdLine, type CostCadence, type CostRow, type MonthReport, type Month, type Rate,
} from "@/lib/domain/finance";
import { readCostBoxes, readRateBoxes, type CostBoxes, type RateBoxes } from "@/lib/domain/finance-input";

/**
 * THE OWNER'S BOOKS — the reads and writes behind the Finance tab (B44). Records only: nothing here moves
 * money. Every caller has already asked `isOwner` (the page, the actions, the CSV route); this file holds
 * the rows and the arithmetic's inputs, and `domain/finance.ts` holds the arithmetic.
 *
 * A cost is never deleted: "void" stamps it with a reason and a time, and every report leaves a voided
 * cost out (records are kept; the spec asks for seven years). RATES ARE ADD-ONLY: a rate typed is a new row,
 * never an overwrite, so a month already reported is not restated by a rate typed later. A rate typed again for
 * a day that already has one voids the earlier row ("replaced") and keeps it; a wrong rate is voided with a reason.
 */

const MONTHS_SHOWN = 12;
const MAX_EXPORT_MONTHS = 120;

function costRow(r: {
  id: string; month: string; category: string; vendor: string; currency: string; amountMinor: number;
  cadence: string; endsMonth: string | null; source: string; note: string; enteredByEmail: string;
}): CostRow {
  return { ...r, cadence: r.cadence as CostCadence };
}

async function liveCosts(): Promise<CostRow[]> {
  const rows = await prisma.costEntry.findMany({ where: { voidedAt: null }, orderBy: [{ month: "desc" }, { createdAt: "desc" }] });
  return rows.map(costRow);
}

async function allRates(): Promise<Rate[]> {
  const rows = await prisma.fxRate.findMany({ where: { voidedAt: null }, orderBy: [{ currency: "asc" }, { rateDate: "desc" }] });
  return rows.map((r) => ({ currency: r.currency, rateDate: r.rateDate, usdMicrosPerUnit: r.usdMicrosPerUnit, source: r.source }));
}

export interface FinanceView {
  currentMonth: Month;
  /** Newest first: the current month (to date, incomplete by nature) and the eleven before it. */
  months: MonthReport[];
  costs: CostRow[];
  rates: Rate[];
  /** Every rate ever typed, voided ones too, newest day first: the record is kept. */
  rateHistory: { id: string; currency: string; rateDate: string; usdMicrosPerUnit: number; source: string; reason: string; voided: boolean; voidReason: string }[];
  /** Each live cost in dollars at the rate dated on or before its first month's first day, or null with no rate. */
  costUsd: Record<string, UsdLine | null>;
  /** Rows the billing integration has written. Zero until billing exists. */
  billingRecords: number;
  /** Clubs ACTIVE on a paid plan with no billing record: zero revenue, counted apart (Ajay, 12 Nov, ruling H). A canceled or unpaid plan is not a comped one. */
  compedClubs: number;
}

export async function financeView(currentMonth: Month): Promise<FinanceView> {
  const [costs, rates, history, billingRecords, paidSubs, billedOrgs] = await Promise.all([
    liveCosts(),
    allRates(),
    prisma.fxRate.findMany({ orderBy: [{ rateDate: "desc" }, { createdAt: "desc" }] }),
    prisma.billingRecord.count(),
    prisma.subscription.findMany({
      where: { plan: { not: "free" }, status: "active", organization: { isDemo: false } },
      select: { organizationId: true },
    }),
    prisma.billingRecord.findMany({ where: { organizationId: { not: null } }, select: { organizationId: true }, distinct: ["organizationId"] }),
  ]);
  const billed = new Set(billedOrgs.map((b) => b.organizationId));
  const months = monthRange(addMonths(currentMonth, -(MONTHS_SHOWN - 1)), currentMonth)
    .reverse()
    .map((m) => monthReport(costs, rates, m));
  const costUsd = Object.fromEntries(costs.map((c) => [c.id, convertRow(c, rates, firstDayOf(c.month))]));
  const rateHistory = history.map((r) => ({
    id: r.id, currency: r.currency, rateDate: r.rateDate, usdMicrosPerUnit: r.usdMicrosPerUnit, source: r.source,
    reason: r.reason, voided: r.voidedAt !== null, voidReason: r.voidReason,
  }));
  return { currentMonth, months, costs, rates, rateHistory, costUsd, billingRecords, compedClubs: paidSubs.filter((s) => !billed.has(s.organizationId)).length };
}

/** The CSV of every month from the first cost to the current month (never more than ten years). */
export async function financeCsvRows(currentMonth: Month): Promise<string[][]> {
  const [costs, rates] = await Promise.all([liveCosts(), allRates()]);
  const earliest = costs.reduce<Month>((a, c) => (c.month < a ? c.month : a), currentMonth);
  const from = monthsBetween(earliest, currentMonth) > MAX_EXPORT_MONTHS ? addMonths(currentMonth, -MAX_EXPORT_MONTHS) : earliest;
  return costCsvRows(monthRange(from, currentMonth).map((m) => monthReport(costs, rates, m)));
}

export type FinanceResult = { ok: true } | { ok: false; error: string };

export async function addCost(boxes: CostBoxes, byEmail: string): Promise<FinanceResult> {
  const read = readCostBoxes(boxes);
  if (!read.ok) return read;
  const v = read.value;
  await prisma.costEntry.create({
    data: {
      month: v.month, category: v.category, vendor: v.vendor, currency: v.currency, amountMinor: v.amountMinor,
      cadence: v.cadence, endsMonth: v.endsMonth, source: "typed", note: v.note, enteredByEmail: byEmail.trim().toLowerCase(),
    },
  });
  return { ok: true };
}

/** A soft void with a reason: the row stays, every report leaves it out. */
export async function voidCost(id: string, reason: string, byEmail: string, at: Date): Promise<FinanceResult> {
  const why = String(reason ?? "").trim().slice(0, 200);
  if (!why) return { ok: false, error: "Say why it is being voided." };
  const row = await prisma.costEntry.findUnique({ where: { id: String(id ?? "") }, select: { id: true, voidedAt: true } });
  if (!row) return { ok: false, error: "That cost is not there." };
  if (row.voidedAt) return { ok: false, error: "That cost is already voided." };
  await prisma.costEntry.update({ where: { id: row.id }, data: { voidedAt: at, voidReason: `${why} (${byEmail.trim().toLowerCase()})` } });
  return { ok: true };
}

/** The owner's own rate for a currency on a day (a published rate is a later change). */
export async function saveRate(boxes: RateBoxes, byEmail: string, at: Date): Promise<FinanceResult> {
  const read = readRateBoxes(boxes);
  if (!read.ok) return read;
  const v = read.value;
  const by = byEmail.trim().toLowerCase();
  // ADD-ONLY: the earlier typed rate for this day (if any) is voided and kept, and the new one is a new row.
  await prisma.$transaction([
    prisma.fxRate.updateMany({
      where: { currency: v.currency, rateDate: v.rateDate, source: "override", voidedAt: null },
      data: { voidedAt: at, voidReason: `replaced by a rate typed by ${by}` },
    }),
    prisma.fxRate.create({
      data: { currency: v.currency, rateDate: v.rateDate, usdMicrosPerUnit: v.usdMicrosPerUnit, source: "override", reason: v.reason, enteredByEmail: by },
    }),
  ]);
  return { ok: true };
}

/** A wrong rate is voided with a reason, never edited or removed; every report then reads the rate before it. */
export async function voidRate(id: string, reason: string, byEmail: string, at: Date): Promise<FinanceResult> {
  const why = String(reason ?? "").trim().slice(0, 200);
  if (!why) return { ok: false, error: "Say why it is being voided." };
  const row = await prisma.fxRate.findUnique({ where: { id: String(id ?? "") }, select: { id: true, voidedAt: true } });
  if (!row) return { ok: false, error: "That rate is not there." };
  if (row.voidedAt) return { ok: false, error: "That rate is already voided." };
  await prisma.fxRate.update({ where: { id: row.id }, data: { voidedAt: at, voidReason: `${why} (${byEmail.trim().toLowerCase()})` } });
  return { ok: true };
}

