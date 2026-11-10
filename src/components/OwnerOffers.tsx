"use client";
import { figureOr, readDecimal } from "@/lib/domain/decimal-text";
import { useState, useTransition } from "react";
import { saveOffers } from "@/app/actions/owner";
import { currencySymbol } from "@/lib/domain/money-format";
import { Icon } from "./Icon";

/**
 * THE OWNER'S EVENT PASSES AND SEASONAL PLAN (decided 10 Nov 2026).
 *
 * NOT ON SALE until billing can sell them. They are set here, in the owner's
 * own console, and nowhere else shows them while the "On sale" switch below is
 * off (`publicOffers` in `plans.ts`; `offers-are-not-on-sale.test.ts`). A price
 * is set per region; a region without its own is quoted Rest of world's.
 */

export interface OfferRegion {
  id: string;
  name: string;
  currency: string;
}

export interface PassRow {
  name: string;
  /** By region id; null = not set (Rest of world's is quoted). */
  prices: Record<string, number | null>;
  /** null = any field. */
  maxPlayers: number | null;
}

interface PassDraft {
  name: string;
  prices: Record<string, string>;
  anyField: boolean;
  cap: string;
}

const text = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v));

export function OwnerOffers({
  regions,
  passes,
  seasonal,
  onSale: initialOnSale,
  canBeBought,
  tiers,
}: {
  /** Rest of world first, then the owner's regions. */
  regions: OfferRegion[];
  passes: PassRow[];
  seasonal: { tier: string; months: number; prices: Record<string, number | null> };
  onSale: boolean;
  /** Whether billing can sell a pass at all (`OFFERS_CAN_BE_BOUGHT`). While not, On sale cannot be turned on. */
  canBeBought: boolean;
  /** The paid tiers a season may be on. */
  tiers: { key: string; name: string }[];
}) {
  const [onSale, setOnSale] = useState(initialOnSale);
  const [drafts, setDrafts] = useState<PassDraft[]>(() =>
    passes.map((p) => ({
      name: p.name,
      prices: Object.fromEntries(regions.map((r) => [r.id, text(p.prices[r.id])])),
      anyField: p.maxPlayers === null,
      cap: text(p.maxPlayers),
    })),
  );
  const [tier, setTier] = useState(seasonal.tier);
  const [months, setMonths] = useState(String(seasonal.months));
  const [seasonPrices, setSeasonPrices] = useState<Record<string, string>>(() =>
    Object.fromEntries(regions.map((r) => [r.id, text(seasonal.prices[r.id])])),
  );
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  const touch = () => setSaved(false);
  const editPass = (i: number, patch: Partial<PassDraft>) => {
    touch();
    setDrafts((d) => d.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  };
  /** A box as a whole number: null when blank, NaN when it is not a figure. */
  const whole = (t: string): number | null => {
    const read = readDecimal(t);
    if (read.kind === "blank") return null;
    const n = figureOr(read, Number.NaN);
    return Number.isFinite(n) ? Math.round(n) : Number.NaN;
  };
  const prices = (boxes: Record<string, string>, label: string): Record<string, number | null> | null => {
    const out: Record<string, number | null> = {};
    for (const r of regions) {
      const n = whole(boxes[r.id] ?? "");
      if (n !== null && (Number.isNaN(n) || n < 0)) {
        setError(`${label} · ${r.name}: a price is a number, zero or more, or blank.`);
        return null;
      }
      out[r.id] = n;
    }
    return out;
  };

  const save = () => {
    setError("");
    setSaved(false);
    const passPayload: { name: string; prices: Record<string, number | null>; maxPlayers: number | null }[] = [];
    for (const d of drafts) {
      const label = d.name.trim() || "A pass";
      const p = prices(d.prices, label);
      if (!p) return;
      let maxPlayers: number | null = null;
      if (!d.anyField) {
        const cap = whole(d.cap);
        if (cap === null || Number.isNaN(cap) || cap < 1) {
          setError(`${label}: the player cap is a whole number of 1 or more, or tick any field.`);
          return;
        }
        maxPlayers = cap;
      }
      passPayload.push({ name: d.name, prices: p, maxPlayers });
    }
    const sp = prices(seasonPrices, "Seasonal plan");
    if (!sp) return;
    const m = whole(months);
    if (m === null || Number.isNaN(m)) {
      setError("The season is a whole number of months.");
      return;
    }
    start(async () => {
      const res = await saveOffers({ onSale, passes: passPayload, seasonal: { tier, months: m, prices: sp } });
      if (!res.ok) setError(res.error ?? "Couldn't save.");
      else setSaved(true);
    });
  };

  const priceBoxes = (boxes: Record<string, string>, set: (id: string, v: string) => void, label: string) => (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 6 }}>
      {regions.map((r) => (
        <label key={r.id} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 13 }}>
          <span className="text-muted">{r.name}</span>
          <span className="text-muted">{currencySymbol(r.currency)}</span>
          <input
            className="input"
            inputMode="decimal"
            value={boxes[r.id] ?? ""}
            placeholder={r.id === "world" ? "required" : "as world"}
            onChange={(e) => {
              touch();
              set(r.id, e.target.value);
            }}
            aria-label={`${label} price in ${r.name}`}
            style={{ width: 80, fontVariantNumeric: "tabular-nums" }}
          />
        </label>
      ))}
    </div>
  );

  return (
    <div className="card elev-sm" style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <span className="card-title" style={{ fontSize: 15 }}>Event passes and the seasonal plan</span>
        <span className="text-muted" style={{ fontSize: 13 }}>Decided 10 Nov. Not on sale until billing exists.</span>
      </div>
      <p className="text-muted" style={{ fontSize: 13, lineHeight: 1.5, margin: "8px 0 0" }}>
        A pass covers one tournament up to its player cap, or any field. The seasonal plan is one tier for a
        set number of months. Prices are per region; a region left blank is quoted Rest of world&rsquo;s.
        These appear nowhere but here while <strong>On sale</strong> is off.
      </p>

      <label
        htmlFor="offers-on-sale"
        style={{ display: "flex", alignItems: "flex-start", gap: 10, marginTop: 12, padding: "10px 12px", borderRadius: 8, background: "var(--color-surface-2)", cursor: "pointer" }}
      >
        <input
          id="offers-on-sale"
          type="checkbox"
          checked={onSale}
          disabled={!canBeBought && !onSale}
          onChange={(e) => {
            touch();
            setOnSale(e.target.checked);
          }}
          style={{ marginTop: 2, width: 18, height: 18, flex: "none" }}
        />
        <span style={{ fontSize: 13, lineHeight: 1.45 }}>
          <strong>On sale.</strong>{" "}
          <span className="text-muted">
            {canBeBought
              ? "Off by default. While it is off, no page but this one can show a pass or the season."
              : "Off, and it cannot be turned on yet: nothing can sell a pass or the season until billing does. No page but this one shows them."}
          </span>
        </span>
      </label>

      {drafts.map((d, i) => (
        <div key={i} role="group" aria-label={`Pass ${d.name || i + 1}`} style={{ marginTop: 12, borderTop: "1px solid var(--color-divider)", paddingTop: 10 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <input className="input" value={d.name} onChange={(e) => editPass(i, { name: e.target.value })} aria-label={`Pass ${i + 1} name`} placeholder="Pass name" style={{ width: 190, fontWeight: 600 }} />
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}>
              Up to
              <input
                className="input"
                inputMode="numeric"
                value={d.anyField ? "" : d.cap}
                disabled={d.anyField}
                onChange={(e) => editPass(i, { cap: e.target.value })}
                aria-label={`${d.name || `Pass ${i + 1}`} player cap`}
                style={{ width: 70 }}
              />
              players
            </label>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}>
              <input type="checkbox" checked={d.anyField} onChange={(e) => editPass(i, { anyField: e.target.checked })} />
              Any field
            </label>
            <button type="button" className="btn btn-ghost" onClick={() => { touch(); setDrafts((x) => x.filter((_, j) => j !== i)); }}>
              Remove pass
            </button>
          </div>
          {priceBoxes(d.prices, (id, v) => editPass(i, { prices: { ...d.prices, [id]: v } }), d.name || `Pass ${i + 1}`)}
        </div>
      ))}
      <div style={{ marginTop: 10 }}>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => {
            touch();
            setDrafts((d) => [...d, { name: "", prices: {}, anyField: false, cap: "" }]);
          }}
        >
          Add a pass
        </button>
      </div>

      <div role="group" aria-label="Seasonal plan" style={{ marginTop: 14, borderTop: "1px solid var(--color-divider)", paddingTop: 10 }}>
        <strong style={{ fontSize: 14 }}>Seasonal plan</strong>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginTop: 6 }}>
          <label style={{ fontSize: 13, display: "inline-flex", alignItems: "center", gap: 6 }}>
            Tier
            <select className="input" value={tier} onChange={(e) => { touch(); setTier(e.target.value); }} aria-label="Seasonal plan tier">
              {tiers.map((t) => (
                <option key={t.key} value={t.key}>{t.name}</option>
              ))}
            </select>
          </label>
          <label style={{ fontSize: 13, display: "inline-flex", alignItems: "center", gap: 6 }}>
            Months
            <input className="input" inputMode="numeric" value={months} onChange={(e) => { touch(); setMonths(e.target.value); }} aria-label="Seasonal plan months" style={{ width: 64 }} />
          </label>
        </div>
        {priceBoxes(seasonPrices, (id, v) => { touch(); setSeasonPrices((p) => ({ ...p, [id]: v })); }, "Seasonal plan")}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14, flexWrap: "wrap" }}>
        <button type="button" className="btn btn-primary touch-target" onClick={save} disabled={pending}>
          {pending ? "Saving…" : "Save passes and season"}
        </button>
        {saved && (
          <span role="status" style={{ fontSize: 13, color: "var(--color-accent-2-200)", display: "inline-flex", alignItems: "center", gap: 5 }}>
            <Icon name="check-circle" /> Saved{onSale ? " — on sale." : " — still not on sale."}
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
