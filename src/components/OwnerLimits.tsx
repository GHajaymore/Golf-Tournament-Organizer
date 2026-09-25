"use client";
import { useState, useTransition } from "react";
import { saveTierLimits } from "@/app/actions/owner";
import { Icon } from "./Icon";

/**
 * THE OWNER'S LIMIT CONTROLS — the other half of what a tier is.
 *
 * `OwnerPricing` sets what a tier costs; this sets what it INCLUDES — the number
 * of active tournaments, staff seats and the field size a plan may run — and the
 * master switch that decides whether any of it is enforced at all.
 *
 * Enforcement is OFF by default and turning it on is a deliberate act, because
 * it begins refusing over-limit adds across every club at once. A blank field
 * means no cap (unlimited). The numbers and the switch write to the same
 * `PlatformSetting` row the entry gates read, so a change here reaches the next
 * sign-up without a deploy.
 */

const COLUMNS = [
  { key: "activeEvents", label: "Active events" },
  { key: "staffSeats", label: "Staff seats" },
  { key: "playersPerEvent", label: "Field size" },
] as const;

type LimitKey = (typeof COLUMNS)[number]["key"];

export function OwnerLimits({
  tiers,
  enforce: initialEnforce,
}: {
  tiers: { key: string; name: string; limits: Record<LimitKey, number | null> }[];
  enforce: boolean;
}) {
  // A cap is its number as a string; unlimited (null) is an empty field.
  const [vals, setVals] = useState<Record<string, Record<string, string>>>(() =>
    Object.fromEntries(
      tiers.map((t) => [
        t.key,
        Object.fromEntries(COLUMNS.map((c) => [c.key, t.limits[c.key] === null ? "" : String(t.limits[c.key])])),
      ]),
    ),
  );
  const [enforce, setEnforce] = useState(initialEnforce);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  const setVal = (tier: string, limit: string, raw: string) => {
    setSaved(false);
    setVals((v) => ({ ...v, [tier]: { ...v[tier], [limit]: raw.replace(/[^0-9]/g, "") } }));
  };

  const save = () => {
    setError("");
    setSaved(false);
    const plans: Record<string, Record<string, number | null>> = {};
    for (const t of tiers) {
      const per: Record<string, number | null> = {};
      for (const c of COLUMNS) {
        const s = (vals[t.key]?.[c.key] ?? "").trim();
        // Blank is a real, deliberate value here: no cap.
        per[c.key] = s === "" ? null : Number(s);
      }
      plans[t.key] = per;
    }
    start(async () => {
      const res = await saveTierLimits({ enforce, plans });
      if (!res.ok) setError(res.error ?? "Couldn't save.");
      else setSaved(true);
    });
  };

  return (
    <div className="card elev-sm" style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <span className="card-title" style={{ fontSize: 15 }}>Limit controls</span>
        <span className="text-muted" style={{ fontSize: 11.5 }}>Caps every entry gate reads.</span>
      </div>

      <p className="text-muted" style={{ fontSize: 12.5, lineHeight: 1.5, margin: "8px 0 0" }}>
        Set each tier&rsquo;s caps and press <strong>Save limits</strong>. <strong>Field size</strong> is the
        most players a tournament may confirm on that tier — over it, entries waitlist instead of joining.
        Leave a box blank for <strong>no cap</strong>. Changes reach the next sign-up with no deploy.
      </p>

      {/* The safety catch. Off by default, and called out because turning it on
          changes behaviour for every existing club at once. */}
      <label
        htmlFor="enforce-limits"
        style={{ display: "flex", alignItems: "flex-start", gap: 10, marginTop: 12, padding: "10px 12px", borderRadius: 8, background: "var(--color-surface-2)", cursor: "pointer" }}
      >
        <input
          id="enforce-limits"
          type="checkbox"
          checked={enforce}
          onChange={(e) => {
            setSaved(false);
            setEnforce(e.target.checked);
          }}
          style={{ marginTop: 2, width: 18, height: 18, flex: "none" }}
        />
        <span style={{ fontSize: 13, lineHeight: 1.45 }}>
          <strong>Enforce these limits.</strong>{" "}
          <span className="text-muted">
            Off by default. Turning it on immediately caps every club — one already over a limit keeps what
            it has but can&rsquo;t add more until it upgrades. Leave it off while there is nowhere to upgrade to.
          </span>
        </span>
      </label>

      <div className="table-scroll" style={{ marginTop: 12 }}>
        <table className="table">
          <thead>
            <tr>
              <th>Tier</th>
              {COLUMNS.map((c) => (
                <th key={c.key} style={{ textAlign: "right" }}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tiers.map((t) => (
              <tr key={t.key}>
                <td style={{ fontWeight: 600 }}>{t.name}</td>
                {COLUMNS.map((c) => (
                  <td key={c.key} style={{ textAlign: "right" }}>
                    <input
                      id={`limit-${t.key}-${c.key}`}
                      className="input"
                      inputMode="numeric"
                      placeholder="∞"
                      value={vals[t.key]?.[c.key] ?? ""}
                      onChange={(e) => setVal(t.key, c.key, e.target.value)}
                      style={{ width: 68, textAlign: "right", fontVariantNumeric: "tabular-nums" }}
                      aria-label={`${t.name} ${c.label} (blank for no cap)`}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14, flexWrap: "wrap" }}>
        <button type="button" className="btn btn-primary touch-target" onClick={save} disabled={pending}>
          {pending ? "Saving…" : "Save limits"}
        </button>
        <span className="text-muted" style={{ fontSize: 12.5 }}>
          {enforce ? "Enforcement is ON." : "Enforcement is off — nothing is refused."}
        </span>
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
