"use client";
import { useState, useTransition } from "react";
import { setClubPlan } from "@/app/actions/owner";

/**
 * Put one club on a tier. The only way a club's plan changes: there is no
 * checkout, so a club that agrees to Birdie, Eagle or Albatross is moved here.
 */
export function OwnerClubPlan({ tiers }: { tiers: { key: string; name: string; tagline: string }[] }) {
  const [club, setClub] = useState("");
  const [plan, setPlan] = useState(tiers[0]?.key ?? "free");
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const save = () =>
    start(async () => {
      const res = await setClubPlan(club, plan);
      const tier = tiers.find((t) => t.key === plan)?.name ?? plan;
      setResult(res.ok ? { ok: true, text: `${res.club} is now on ${tier}.` } : { ok: false, text: res.error ?? "Couldn't change the plan." });
    });

  return (
    <div className="card elev-sm" style={{ marginBottom: 16 }}>
      <span className="card-title" style={{ fontSize: 15 }}>Put a club on a tier</span>
      <p className="text-muted" style={{ fontSize: 12.5, lineHeight: 1.5, margin: "8px 0 0" }}>
        Type the club&rsquo;s name exactly as it appears and choose its tier. Nothing is charged here — the
        price is agreed with the club first.
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12, alignItems: "flex-end" }}>
        <label className="field" style={{ flex: "1 1 220px", minWidth: 0 }}>
          <span>Club name</span>
          <input
            id="owner-club-plan-name"
            className="input"
            value={club}
            onChange={(e) => {
              setClub(e.target.value);
              setResult(null);
            }}
          />
        </label>
        <label className="field" style={{ flex: "0 1 260px", minWidth: 0 }}>
          <span>Tier</span>
          <select
            id="owner-club-plan-tier"
            className="input"
            value={plan}
            onChange={(e) => {
              setPlan(e.target.value);
              setResult(null);
            }}
          >
            {tiers.map((t) => (
              <option key={t.key} value={t.key}>
                {t.name} — {t.tagline}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="btn btn-primary" disabled={pending || !club.trim()} onClick={save}>
          Set tier
        </button>
      </div>
      {result && (
        <p role="status" style={{ fontSize: 12.5, margin: "8px 0 0", color: result.ok ? undefined : "var(--color-danger)" }}>
          {result.text}
        </p>
      )}
    </div>
  );
}
