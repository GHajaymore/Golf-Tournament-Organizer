"use client";
import { useState, useTransition } from "react";
import { saveTierPrices } from "@/app/actions/owner";
import { DEFAULT_LOCALE } from "@/lib/domain/locale";
import { Icon } from "./Icon";

/**
 * THE OWNER'S PRICE CONTROLS — the one place the console writes.
 *
 * Everything else on the console reads. This edits the monthly price of each
 * paid tier and saves it to the `PlatformSetting` row `effectivePrice` reads,
 * so the number here, the landing page, the settings panel and the schema.org
 * offer move together the moment it saves. The free tier is shown but not
 * editable — it is free by definition.
 *
 * Whole dollars, and the annual figure (ten months) is derived so there is no
 * second number to keep in step. Optimistic nothing: it waits for the save and
 * says plainly whether it took.
 */
export function OwnerPricing({
  tiers,
}: {
  tiers: { key: string; name: string; monthly: number; free: boolean }[];
}) {
  const [prices, setPrices] = useState<Record<string, string>>(() =>
    Object.fromEntries(tiers.map((t) => [t.key, String(t.monthly)])),
  );
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  const save = () => {
    setError("");
    setSaved(false);
    const payload: Record<string, number> = {};
    for (const t of tiers) {
      if (t.free) continue;
      const n = Number(prices[t.key]);
      if (!Number.isFinite(n) || n < 0) {
        setError(`${t.name}: enter a price of zero or more.`);
        return;
      }
      payload[t.key] = Math.round(n);
    }
    start(async () => {
      const res = await saveTierPrices(payload);
      if (!res.ok) setError(res.error ?? "Couldn't save.");
      else setSaved(true);
    });
  };

  return (
    <div className="card elev-sm" style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <span className="card-title" style={{ fontSize: 15 }}>Pricing controls</span>
        <span className="text-muted" style={{ fontSize: 11.5 }}>Sets the price every screen quotes.</span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
        {tiers.map((t) => {
          const val = Number(prices[t.key]);
          const annual = Number.isFinite(val) ? Math.round(val) * 10 : 0;
          return (
            <div
              key={t.key}
              style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", borderTop: "1px solid var(--color-divider)", paddingTop: 10 }}
            >
              <label htmlFor={`price-${t.key}`} style={{ fontWeight: 600, fontSize: 14, minWidth: 90 }}>
                {t.name}
              </label>
              {t.free ? (
                <span className="text-muted" style={{ fontSize: 13 }}>Free — $0</span>
              ) : (
                <>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <span className="text-muted" style={{ fontSize: 14 }}>$</span>
                    <input
                      id={`price-${t.key}`}
                      className="input"
                      inputMode="numeric"
                      value={prices[t.key] ?? ""}
                      onChange={(e) => setPrices((p) => ({ ...p, [t.key]: e.target.value.replace(/[^0-9]/g, "") }))}
                      style={{ width: 84, fontVariantNumeric: "tabular-nums" }}
                      aria-label={`${t.name} price per month in dollars`}
                    />
                    <span className="text-muted" style={{ fontSize: 13 }}>/mo</span>
                  </span>
                  <span className="text-muted" style={{ fontSize: 12.5, fontVariantNumeric: "tabular-nums" }}>
                    ${annual.toLocaleString(DEFAULT_LOCALE)}/yr
                  </span>
                </>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14, flexWrap: "wrap" }}>
        <button type="button" className="btn btn-primary touch-target" onClick={save} disabled={pending}>
          {pending ? "Saving…" : "Save prices"}
        </button>
        {saved && (
          <span style={{ fontSize: 13, color: "var(--color-accent-2-300)", display: "inline-flex", alignItems: "center", gap: 5 }}>
            <Icon name="check-circle" /> Saved — live everywhere.
          </span>
        )}
        {error && (
          <span className="form-error" style={{ margin: 0 }}>
            <Icon name="warning-circle" /> {error}
          </span>
        )}
      </div>
    </div>
  );
}
