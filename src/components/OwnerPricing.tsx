"use client";
import { figureOr, readDecimal } from "@/lib/domain/decimal-text";
import { useState, useTransition } from "react";
import { saveTierPrices } from "@/app/actions/owner";
import { countryName, type RegionInput } from "@/lib/domain/plan-edit";
import { currencySymbol, wholeMoney } from "@/lib/domain/money-format";
import { DEFAULT_LOCALE } from "@/lib/domain/locale";
import { Icon } from "./Icon";

/**
 * THE OWNER'S PRICE CONTROLS — the one place the console writes prices.
 *
 * Prices are set BY REGION (Ajay, 2026-11-10): a region is a named group of
 * countries with one currency and its own monthly price per paid tier, and
 * optionally its own months billed for a year. A club is quoted by its
 * country's region; a country in no region is in Rest of world (US dollars).
 * Everything else reads these through `planQuote`, so the number here, the
 * landing page, the settings panel, Checkout and the schema.org offer move
 * together the moment it saves.
 *
 * Whole units; a box typed with a decimal comma is read (`readDecimal`). A
 * blank box is "the default", never a price of nothing. It waits for the save
 * and says plainly whether it took, beside the press.
 */

export interface PriceTier {
  key: string;
  name: string;
}

export interface RegionRow {
  /** Absent for a region added in this session. */
  id?: string;
  name: string;
  currency: string;
  countries: string[];
  /** What the box opens on: the owner's price, else the default, else blank. Keyed by tier. */
  monthly: Record<string, number | null>;
  annualMonths: number | null;
}

interface Draft {
  id?: string;
  name: string;
  currency: string;
  countries: string;
  monthly: Record<string, string>;
  annualMonths: string;
}

const draftOf = (r: RegionRow): Draft => ({
  id: r.id,
  name: r.name,
  currency: r.currency,
  countries: r.countries.join(", "),
  monthly: Object.fromEntries(Object.entries(r.monthly).map(([k, v]) => [k, v === null ? "" : String(v)])),
  annualMonths: r.annualMonths === null ? "" : String(r.annualMonths),
});

export function OwnerPricing({
  tiers,
  world,
  regions,
  annualMonths,
  defaultMonths,
}: {
  tiers: PriceTier[];
  /** Rest of world: always there, in US dollars, holds no countries. */
  world: { name: string; currency: string; monthly: Record<string, number>; annualMonths: number | null };
  regions: RegionRow[];
  /** The all-regions months billed for a year, as the owner set it (null = the default). */
  annualMonths: number | null;
  defaultMonths: number;
}) {
  const [worldPrices, setWorldPrices] = useState<Record<string, string>>(() =>
    Object.fromEntries(tiers.map((t) => [t.key, String(world.monthly[t.key] ?? "")])),
  );
  const [drafts, setDrafts] = useState<Draft[]>(() => regions.map(draftOf));
  const [months, setMonths] = useState(annualMonths === null ? "" : String(annualMonths));
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  const touch = () => setSaved(false);
  const edit = (i: number, patch: Partial<Draft>) => {
    touch();
    setDrafts((d) => d.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  };

  /** A box as a whole number: null when blank, NaN when it is not a figure. */
  const whole = (text: string): number | null => {
    const read = readDecimal(text);
    if (read.kind === "blank") return null;
    const n = figureOr(read, Number.NaN);
    return Number.isFinite(n) ? Math.round(n) : Number.NaN;
  };

  const save = () => {
    setError("");
    setSaved(false);
    const prices: Record<string, number> = {};
    for (const t of tiers) {
      const n = whole(worldPrices[t.key] ?? "");
      // AN EMPTIED BOX IS NOT A PRICE OF NOTHING: Rest of world is the price every other region falls back to.
      if (n === null || Number.isNaN(n) || n < 0) {
        setError(`${world.name} · ${t.name}: enter a price of zero or more.`);
        return;
      }
      prices[t.key] = n;
    }
    const payload: RegionInput[] = [];
    for (const d of drafts) {
      const label = d.name.trim() || "A region";
      const monthly: Record<string, number | null> = {};
      for (const t of tiers) {
        const n = whole(d.monthly[t.key] ?? "");
        if (n !== null && (Number.isNaN(n) || n < 0)) {
          setError(`${label} · ${t.name}: a price is a number, zero or more, or blank for the default.`);
          return;
        }
        monthly[t.key] = n;
      }
      const rm = whole(d.annualMonths);
      if (rm !== null && Number.isNaN(rm)) {
        setError(`${label}: months billed for a year is a whole number from 1 to 12, or blank.`);
        return;
      }
      payload.push({
        id: d.id,
        name: d.name,
        currency: d.currency,
        countries: d.countries.split(/[\s,;]+/).filter(Boolean),
        monthly,
        annualMonths: rm,
      });
    }
    const all = whole(months);
    if (all !== null && Number.isNaN(all)) {
      setError("Months billed for a year is a whole number from 1 to 12, or blank for the default.");
      return;
    }
    start(async () => {
      const res = await saveTierPrices(prices, { regions: payload, annualMonths: all });
      if (!res.ok) setError(res.error ?? "Couldn't save.");
      else setSaved(true);
    });
  };

  const yearly = (monthlyText: string, monthsText: string, currency: string) => {
    const m = whole(monthlyText);
    const k = whole(monthsText) ?? whole(months) ?? defaultMonths;
    if (m === null || Number.isNaN(m) || k === null || Number.isNaN(k)) return "";
    return `${wholeMoney(m * k, currency, DEFAULT_LOCALE)}/yr`;
  };

  const box = (id: string, label: string, value: string, set: (v: string) => void, symbol: string, placeholder = "") => (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <span className="text-muted" style={{ fontSize: 13 }}>{symbol}</span>
      <input
        id={id}
        className="input"
        inputMode="decimal"
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          touch();
          set(e.target.value);
        }}
        style={{ width: 84, fontVariantNumeric: "tabular-nums" }}
        aria-label={label}
      />
    </span>
  );

  return (
    <div className="card elev-sm" style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <span className="card-title" style={{ fontSize: 15 }}>Prices by region</span>
        <span className="text-muted" style={{ fontSize: 13 }}>Sets the price every screen quotes.</span>
      </div>
      <p className="text-muted" style={{ fontSize: 13, lineHeight: 1.5, margin: "8px 0 0" }}>
        A region is a named group of countries with one currency and its own prices. A club is quoted by
        its country&rsquo;s region, and a country in no region by {world.name}. Type a whole monthly amount for each
        paid tier; leave a box blank for the default. Prices are set, never converted, so changing one
        region moves no other. Free stays free.
      </p>

      <div style={{ marginTop: 12, borderTop: "1px solid var(--color-divider)", paddingTop: 10 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <strong style={{ fontSize: 14, minWidth: 130 }}>{world.name}</strong>
          <span className="text-muted" style={{ fontSize: 13 }}>{world.currency} · every country in no region</span>
        </div>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 8 }}>
          {tiers.map((t) => (
            <label key={t.key} htmlFor={`price-world-${t.key}`} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}>
              {t.name}
              {box(`price-world-${t.key}`, `${world.name} ${t.name} price per month in ${world.currency}`, worldPrices[t.key] ?? "", (v) => setWorldPrices((p) => ({ ...p, [t.key]: v })), currencySymbol(world.currency))}
              <span className="text-muted" style={{ fontSize: 13 }}>/mo {yearly(worldPrices[t.key] ?? "", "", world.currency)}</span>
            </label>
          ))}
        </div>
      </div>

      {drafts.map((d, i) => {
        const names = d.countries.split(/[\s,;]+/).filter(Boolean).map((c) => countryName(c.toUpperCase()));
        const symbol = currencySymbol(d.currency.trim().toUpperCase() || "USD");
        return (
          <div key={d.id ?? `new-${i}`} role="group" aria-label={`Region ${d.name || i + 1}`} style={{ marginTop: 12, borderTop: "1px solid var(--color-divider)", paddingTop: 10 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <input
                className="input"
                value={d.name}
                onChange={(e) => edit(i, { name: e.target.value })}
                aria-label={`Region ${i + 1} name`}
                placeholder="Region name"
                style={{ width: 190, fontWeight: 600 }}
              />
              <input
                className="input"
                value={d.currency}
                onChange={(e) => edit(i, { currency: e.target.value.toUpperCase().slice(0, 3) })}
                aria-label={`${d.name || `Region ${i + 1}`} currency`}
                placeholder="USD"
                style={{ width: 70, textTransform: "uppercase" }}
              />
              <button type="button" className="btn btn-ghost" onClick={() => { touch(); setDrafts((x) => x.filter((_, j) => j !== i)); }}>
                Remove region
              </button>
            </div>
            <label style={{ display: "block", marginTop: 8, fontSize: 13 }}>
              <span className="text-muted">Countries (two-letter codes, like GB, IE, IN)</span>
              <input
                className="input"
                value={d.countries}
                onChange={(e) => edit(i, { countries: e.target.value })}
                aria-label={`${d.name || `Region ${i + 1}`} countries`}
                style={{ width: "100%", marginTop: 2 }}
              />
            </label>
            {names.length > 0 && (
              <p className="text-muted" style={{ fontSize: 12, margin: "4px 0 0" }}>{names.join(" · ")}</p>
            )}
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 8, alignItems: "center" }}>
              {tiers.map((t) => (
                <label key={t.key} htmlFor={`price-${d.id ?? i}-${t.key}`} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                  {t.name}
                  {box(`price-${d.id ?? i}-${t.key}`, `${d.name || `Region ${i + 1}`} ${t.name} price per month`, d.monthly[t.key] ?? "", (v) => edit(i, { monthly: { ...d.monthly, [t.key]: v } }), symbol, "default")}
                  <span className="text-muted" style={{ fontSize: 13 }}>/mo {yearly(d.monthly[t.key] ?? "", d.annualMonths, d.currency.trim().toUpperCase() || "USD")}</span>
                </label>
              ))}
              <label htmlFor={`months-${d.id ?? i}`} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                Months billed a year
                {box(`months-${d.id ?? i}`, `${d.name || `Region ${i + 1}`} months billed for a year`, d.annualMonths, (v) => edit(i, { annualMonths: v }), "", months || String(defaultMonths))}
              </label>
            </div>
          </div>
        );
      })}

      <div style={{ marginTop: 12 }}>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => {
            touch();
            setDrafts((d) => [...d, { name: "", currency: "", countries: "", monthly: {}, annualMonths: "" }]);
          }}
        >
          Add a region
        </button>
      </div>

      <div style={{ marginTop: 14, borderTop: "1px solid var(--color-divider)", paddingTop: 10 }}>
        <label htmlFor="annual-months" style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 13.5 }}>
          <strong>Months billed for a year</strong>
          {box("annual-months", "Months billed for a year, every region without its own", months, setMonths, "", String(defaultMonths))}
        </label>
        <p className="text-muted" style={{ fontSize: 13, margin: "4px 0 0" }}>
          Paying yearly costs this many months of the monthly price, in every region that has no figure of its
          own: {defaultMonths} by default, so two are free; 12 means no discount for paying yearly. The yearly price and the
          words &ldquo;two months are free&rdquo; on the front door both follow it.
        </p>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14, flexWrap: "wrap" }}>
        <button type="button" className="btn btn-primary touch-target" onClick={save} disabled={pending}>
          {pending ? "Saving…" : "Save prices"}
        </button>
        {saved && (
          <span role="status" style={{ fontSize: 13, color: "var(--color-accent-2-200)", display: "inline-flex", alignItems: "center", gap: 5 }}>
            <Icon name="check-circle" /> Saved — live everywhere.
          </span>
        )}
        {error && (
          <span className="form-error" role="alert" style={{ margin: 0 }}>
            <Icon name="warning-circle" /> {error}
          </span>
        )}
      </div>
    </div>
  );
}
