import { CURRENCIES } from "@/lib/domain/money-format";
import {
  COST_CATEGORIES, costCategoryLabel, firstDayOf, grossMargin, microsText, originalText, sumMinor, usdText,
  type MonthReport,
} from "@/lib/domain/finance";
import type { FinanceView } from "@/lib/services/owner-finance";
import { AddCostForm, RateForm, VoidCostButton } from "./OwnerFinanceForms";

/**
 * THE FINANCE TAB (B44, Ajay's rulings of 12 Nov): a record of what TourneyHQ earned and spent.
 *
 *   - Revenue is read from billing records only. There is no billing yet, so it says "no billing yet": never
 *     a zero and never an estimate. Comped clubs (a paid plan with no invoice) are zero revenue, counted apart.
 *   - The projection lives in its OWN box, "Projection — not revenue", and is never added to anything.
 *   - Dollars first; a line paid in another currency shows what was paid in small type beside it.
 *   - Albatross has no list price: it will appear here only as a manual invoice, "by agreement".
 *   - A month missing a required cost, or a rate, is "incomplete", and its margin is never a clean number.
 */

export interface Projection {
  estMrr: string;
  estArr: string;
  tiers: { name: string; clubs: number; price: string; mrr: string }[];
}

const small = { fontSize: 13, color: "var(--color-text-muted)" } as const;
const num = { textAlign: "right", fontVariantNumeric: "tabular-nums" } as const;

function Usd({ usd, byCurrency }: { usd: number; byCurrency: Record<string, number> }) {
  const others = Object.entries(byCurrency).filter(([code]) => code !== "USD");
  return (
    <>
      {usdText(usd)}
      {others.map(([code, minor]) => (
        <span key={code} style={{ ...small, display: "block" }}>{originalText(minor, code)}</span>
      ))}
    </>
  );
}

function stateWords(m: MonthReport, isCurrent: boolean): string {
  const parts: string[] = [];
  if (isCurrent) parts.push("month to date");
  if (m.missingCategories.length > 0) parts.push(`no ${m.missingCategories.map((c) => costCategoryLabel(c).toLowerCase()).join(" or ")} entered`);
  if (m.noRate.length > 0) parts.push(`no rate for ${m.noRate.map((r) => r.currency).join(", ")}`);
  return parts.length === 0 ? "complete" : `incomplete: ${parts.join("; ")}`;
}

export function OwnerFinance({ view, projection }: { view: FinanceView; projection: Projection }) {
  const currencies = CURRENCIES.map((c) => c.code);
  const costsToDate = sumMinor(view.months.map((m) => m.usdMinor));
  const anyIncomplete = view.months.some((m) => m.incomplete);

  return (
    <section aria-labelledby="finance-heading">
      <h2 id="finance-heading" style={{ fontFamily: "var(--font-heading)", fontSize: 20, margin: "16px 0 4px" }}>Finance</h2>
      <p className="text-muted" style={{ fontSize: 13, lineHeight: 1.5, margin: "0 0 12px" }}>
        A record of what TourneyHQ earned and spent. Not accounting or tax advice.
      </p>

      {/* REVENUE: from billing records only, and there is no billing yet. */}
      <div className="card elev-sm" style={{ marginBottom: 16 }}>
        <span className="card-title" style={{ fontSize: 15 }}>Revenue</span>
        <p style={{ fontSize: 22, fontFamily: "var(--font-heading)", margin: "6px 0 0" }}>no billing yet</p>
        <p className="text-muted" style={{ fontSize: 13, lineHeight: 1.5, margin: "4px 0 0" }}>
          Revenue is read from invoices TourneyHQ has actually charged, and none has been. {view.billingRecords > 0
            ? `${view.billingRecords} billing ${view.billingRecords === 1 ? "record exists" : "records exist"}, and reading them into revenue is the next change.`
            : "Nothing is estimated here."}
          {" "}Albatross (by agreement) will appear only as an invoice you type, never as a list price.
        </p>
        <p style={{ fontSize: 13, margin: "8px 0 0" }}>
          <strong>{view.compedClubs}</strong> {view.compedClubs === 1 ? "club" : "clubs"} on a comped plan
          <span className="text-muted"> — a paid plan with no invoice: zero revenue, counted apart.</span>
        </p>
      </div>

      {/* MONTH BY MONTH */}
      <div className="card elev-sm" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <span className="card-title" style={{ fontSize: 15 }}>Month by month</span>
          <a href="/owner/finance-export" download style={{ fontSize: 13 }}>Export CSV</a>
        </div>
        <p className="text-muted" style={{ fontSize: 13, margin: "6px 0 0" }}>
          Costs to date over these months: <strong style={{ color: "var(--color-text)" }}>{usdText(costsToDate)}</strong>
          {anyIncomplete ? " (some months are incomplete, so this may be low)" : ""}. Margin needs revenue, so it shows a dash until there is billing.
        </p>
        <div className="table-scroll" style={{ marginTop: 8 }}>
          <table className="table">
            <thead>
              <tr>
                <th>Month</th>
                <th style={{ textAlign: "right" }}>Revenue</th>
                <th style={{ textAlign: "right" }}>Costs</th>
                <th style={{ textAlign: "right" }}>Margin</th>
                <th>State</th>
              </tr>
            </thead>
            <tbody>
              {view.months.map((m) => {
                const margin = grossMargin(null, m.usdMinor, !m.incomplete);
                return (
                  <tr key={m.month}>
                    <td style={{ whiteSpace: "nowrap", fontWeight: 500 }}>{m.month}</td>
                    <td className="text-muted" style={{ textAlign: "right" }}>no billing yet</td>
                    <td style={num}><Usd usd={m.usdMinor} byCurrency={m.byCurrency} /></td>
                    <td className="text-muted" style={{ textAlign: "right" }}>{margin.marginMinor === null ? "—" : usdText(margin.marginMinor)}</td>
                    <td style={{ fontSize: 13 }} className={m.incomplete ? undefined : "text-muted"}>{stateWords(m, m.month === view.currentMonth)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* THE COSTS ENTERED */}
      <div className="card elev-sm" style={{ marginBottom: 16 }}>
        <span className="card-title" style={{ fontSize: 15 }}>Costs entered</span>
        {view.costs.length === 0 ? (
          <p className="text-muted" style={{ fontSize: 13, margin: "6px 0 0" }}>Not entered yet. Add the first below: hosting and the database are the two a month needs to be complete.</p>
        ) : (
          <div className="table-scroll" style={{ marginTop: 8 }}>
            <table className="table">
              <thead>
                <tr>
                  <th>From</th>
                  <th>For</th>
                  <th>Vendor</th>
                  <th style={{ textAlign: "right" }}>Amount</th>
                  <th>Repeats</th>
                  <th>Source</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {view.costs.map((c) => (
                  <tr key={c.id}>
                    <td style={{ whiteSpace: "nowrap" }}>{c.month}{c.endsMonth ? ` to ${c.endsMonth}` : ""}</td>
                    <td>{costCategoryLabel(c.category)}{c.note ? <span style={{ ...small, display: "block" }}>{c.note}</span> : null}</td>
                    <td>{c.vendor || <span className="text-muted">—</span>}</td>
                    <td style={num}>{originalText(c.amountMinor, c.currency)}</td>
                    <td className="text-muted">{c.cadence === "yearly" ? "yearly" : c.cadence}</td>
                    <td className="text-muted" style={{ fontSize: 13 }}>typed by owner</td>
                    <td><VoidCostButton id={c.id} label={`${costCategoryLabel(c.category)} ${c.month}`} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <AddCostForm month={view.currentMonth} categories={COST_CATEGORIES.map((c) => ({ key: c.key, label: c.label }))} currencies={currencies} />

      {/* RATES IN USE */}
      <div className="card elev-sm" style={{ marginBottom: 16 }}>
        <span className="card-title" style={{ fontSize: 15 }}>Rates to US dollars</span>
        <p className="text-muted" style={{ fontSize: 13, lineHeight: 1.5, margin: "6px 0 0" }}>
          A cost paid in another currency is shown in dollars at the rate dated on or before the first day of its month, and the figure keeps
          that rate. A month with no rate is shown incomplete, never skipped. You type the rate and say where it comes from.
        </p>
        {view.rates.length === 0 ? (
          <p className="text-muted" style={{ fontSize: 13, margin: "6px 0 0" }}>No rates typed yet. US dollars need none.</p>
        ) : (
          <div className="table-scroll" style={{ marginTop: 8 }}>
            <table className="table">
              <thead>
                <tr><th>Currency</th><th>From day</th><th style={{ textAlign: "right" }}>US dollars per 1</th><th>Source</th></tr>
              </thead>
              <tbody>
                {view.rates.map((r) => (
                  <tr key={`${r.currency}-${r.rateDate}-${r.source}`}>
                    <td>{r.currency}</td>
                    <td>{r.rateDate}</td>
                    <td style={num}>{microsText(r.usdMicrosPerUnit)}</td>
                    <td className="text-muted">{r.source === "override" ? "typed by owner" : r.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <RateForm day={firstDayOf(view.currentMonth)} currencies={currencies.filter((c) => c !== "USD")} />
      </div>

      {/* THE PROJECTION: its own box, never revenue, never totalled with it. */}
      <section className="card elev-sm" style={{ marginBottom: 16 }} aria-label="Projection, not revenue">
        <span className="card-title" style={{ fontSize: 15 }}>Projection — not revenue</span>
        <p className="text-muted" style={{ fontSize: 13, lineHeight: 1.5, margin: "6px 0 0" }}>
          What the clubs on paid plans would pay at today&rsquo;s list prices. It is a forecast from the price list, not money received, and it is
          not added to anything above.
        </p>
        <p style={{ fontSize: 13, margin: "8px 0 0" }}>
          <strong>{projection.estMrr}</strong> a month · <strong>{projection.estArr}</strong> a year
        </p>
        <div className="table-scroll" style={{ marginTop: 8 }}>
          <table className="table">
            <thead>
              <tr><th>Plan</th><th style={{ textAlign: "right" }}>Clubs</th><th style={{ textAlign: "right" }}>Price / mo</th><th style={{ textAlign: "right" }}>Projected / mo</th></tr>
            </thead>
            <tbody>
              {projection.tiers.map((t) => (
                <tr key={t.name}>
                  <td style={{ fontWeight: 500 }}>{t.name}</td>
                  <td style={num}>{t.clubs}</td>
                  <td style={num}>{t.price}</td>
                  <td style={num}>{t.mrr}</td>
                </tr>
              ))}
              {projection.tiers.length === 0 && <tr><td colSpan={4} className="text-muted" style={{ fontSize: 13, padding: 16 }}>No subscriptions yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <p className="text-muted" style={{ fontSize: 13, lineHeight: 1.5 }}>
        Figures are a record of what was paid, converted to US dollars at the stored dated rate. They are not accounting, tax or financial advice.
      </p>
    </section>
  );
}
