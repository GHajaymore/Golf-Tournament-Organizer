import { PLANS, planFor, upgradeBenefits, retentionNotice, type Plan } from "@/lib/plans";

/**
 * What this club is on, what it costs, and what it does not include.
 *
 * The pricing model has been complete in code and invisible on screen since
 * the app had one: no route mentioned PLANS, the landing page said "Start
 * free" twice and priced nothing, and `upgradeBenefits` — the function whose
 * whole job is to list what upgrading buys — was called by nothing at all.
 *
 * Everything here is DERIVED from PLANS rather than written out. A
 * hand-maintained pricing table is a promise that drifts from what the code
 * enforces, and the club only discovers the difference at the moment it is
 * refused something it thought it had bought.
 *
 * The retention line is deliberately the loudest thing on the panel. Free
 * keeps results 48 hours, and that is the one fact a club has to know BEFORE
 * it runs an event rather than after the results are gone.
 */
export function PlanPanel({ planKey }: { planKey: string }) {
  const current = planFor(planKey);
  const benefits = upgradeBenefits(planKey);
  const retention = retentionNotice(planKey);

  const limitLine = (p: Plan) => {
    const events = p.limits.activeEvents === null ? "Unlimited tournaments" : `${p.limits.activeEvents} tournament at a time`;
    const seats = p.limits.staffSeats === null ? "unlimited organizers" : `${p.limits.staffSeats} organizer${p.limits.staffSeats === 1 ? "" : "s"}`;
    const keep = p.retentionHours === null ? "results kept for good" : `results kept ${p.retentionHours} hours`;
    return `${events} · ${seats} · ${keep}`;
  };

  return (
    <div className="card elev-sm" style={{ gap: 14 }}>
      <div>
        <span className="card-title" style={{ fontSize: 15 }}>Your plan</span>
        <p className="text-muted" style={{ fontSize: 12, margin: "4px 0 0" }}>
          What this club is on today, and what the other one includes.
        </p>
      </div>

      {/* The retention warning, before anything else. A club that reads one
          line on this panel has to read this one: it is the only setting here
          that destroys work, and it does it silently two days later. */}
      {retention && (
        <div
          style={{
            padding: "10px 12px",
            borderRadius: "var(--radius-md)",
            background: "var(--color-danger-bg)",
            boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--color-danger) 32%, transparent)",
          }}
        >
          <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--color-danger)" }}>
            <i className="ph ph-clock-countdown" /> Results are not kept
          </span>
          <p style={{ fontSize: 12, margin: "4px 0 0", lineHeight: 1.55 }}>{retention}</p>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
        {(Object.values(PLANS) as Plan[]).map((p) => {
          const mine = p.key === current.key;
          return (
            <div
              key={p.key}
              style={{
                padding: "11px 13px",
                borderRadius: "var(--radius-md)",
                minWidth: 0,
                background: mine
                  ? "color-mix(in srgb, var(--color-accent) 10%, transparent)"
                  : "color-mix(in srgb, var(--color-text) 4%, transparent)",
                boxShadow: mine
                  ? "inset 0 0 0 1px color-mix(in srgb, var(--color-accent) 34%, transparent)"
                  : "inset 0 0 0 1px color-mix(in srgb, var(--color-text) 10%, transparent)",
              }}
            >
              <div style={{ display: "flex", alignItems: "baseline", gap: 7, flexWrap: "wrap" }}>
                <span style={{ fontFamily: "var(--font-heading)", fontSize: 14, fontWeight: 600 }}>{p.name}</span>
                <span style={{ fontSize: 13, fontVariantNumeric: "tabular-nums" }}>
                  {p.priceMonthly === 0 ? "Free" : `$${p.priceMonthly}/month`}
                </span>
                {mine && (
                  <span className="tag" style={{ fontSize: 10 }}>You are here</span>
                )}
              </div>
              <p className="text-muted" style={{ fontSize: 11.5, margin: "3px 0 0", lineHeight: 1.5 }}>
                {p.blurb}
              </p>
              <p className="text-muted" style={{ fontSize: 11.5, margin: "5px 0 0", lineHeight: 1.5 }}>
                {limitLine(p)}
              </p>
            </div>
          );
        })}
      </div>

      {benefits.length > 0 && (
        <div>
          <span style={{ fontSize: 12.5, fontWeight: 600 }}>What upgrading would add</span>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 12, lineHeight: 1.7 }}>
            {benefits.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      )}

      {/* No buy button, deliberately. TourneyHQ calculates and records money;
          it never takes any. Whatever a club pays happens outside the app, and
          a button here would imply otherwise. */}
      <p className="text-muted" style={{ fontSize: 11.5, margin: 0, lineHeight: 1.55 }}>
        Changing plan is arranged with us directly — nothing is charged through the app.
      </p>
    </div>
  );
}
