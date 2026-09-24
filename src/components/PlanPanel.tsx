import { PLANS, planFor, effectivePrice, effectiveAnnualPrice, upgradeBenefits, retentionNotice, retentionSummary, type Plan, type LimitResult } from "@/lib/plans";
import type { OrgLimits } from "@/lib/services/limits";
import { Icon } from "./Icon";

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
export function PlanPanel({ planKey, standing }: { planKey: string; standing?: OrgLimits }) {
  const current = planFor(planKey);
  const benefits = upgradeBenefits(planKey);
  const retention = retentionNotice(planKey);

  /**
   * WHERE THIS CLUB ACTUALLY STANDS — the half this panel described and never
   * showed.
   *
   * `limitStatus` has existed since limits were written, with a comment
   * promising it "always reports where an organization stands so the UI can
   * say so honestly", and until 2026-09-18 NOTHING CALLED IT. So a club on one
   * tournament at a time learned that by being refused the second one, which
   * is the moment it is least useful and most annoying.
   *
   * WHAT IT SAYS DEPENDS ON WHETHER LIMITS BITE. Refusals only happen once a
   * payment provider is attached (`enforcementActive`), and telling a club
   * "1 of 1 — you are at your limit" while the app would happily let it create
   * another is the kind of small lie that makes everything else on the screen
   * suspect. So the usage is shown either way, and the CONSEQUENCE is only
   * claimed when it is real.
   */
  const usage = (row: LimitResult, one: string, many: string) => {
    if (row.limit === null) return `${row.current} ${row.current === 1 ? one : many} · no limit`;
    /**
     * PAST THE ALLOWANCE, WHICH "X of Y" CANNOT SAY.
     *
     * Read off the seeded club on 2026-09-22: **"9 of 1 tournament running"**.
     * Every figure correct and the sentence unreadable — it parses as a typo
     * rather than as a club nine over what it pays for, and the noun is
     * singular because the pluralisation follows the LIMIT, which is the one
     * number in the phrase that is not being counted.
     *
     * This is not an edge case, it is the ordinary path. Limits do not bite
     * until a payment provider is attached (`enforced`, below), so nothing
     * stops a club exceeding one — which means every free-plan club that opens
     * a SECOND tournament reads "2 of 1 tournament running" today.
     *
     * Stated as two plain facts instead, and deliberately claiming no
     * consequence: whether anything is actually refused is `enforced`'s
     * question and is answered separately below, for the reason in the note
     * above. "Your plan includes one and you are running nine" is true whether
     * or not the tenth would be blocked.
     */
    if (row.current > row.limit) {
      return `${row.current} ${row.current === 1 ? one : many} · plan includes ${row.limit}`;
    }
    return `${row.current} of ${row.limit} ${row.limit === 1 ? one : many}`;
  };

  const limitLine = (p: Plan) => {
    const events = p.limits.activeEvents === null ? "Unlimited tournaments" : `${p.limits.activeEvents} tournament at a time`;
    const seats = p.limits.staffSeats === null ? "unlimited organizers" : `${p.limits.staffSeats} organizer${p.limits.staffSeats === 1 ? "" : "s"}`;
    const keep = retentionSummary(p);
    return `${events} · ${seats} · ${keep}`;
  };

  return (
    <div className="card elev-sm" style={{ gap: 14 }}>
      <div>
        <span className="card-title" style={{ fontSize: 15 }}>Your plan</span>
        <p className="text-muted" style={{ fontSize: 12, margin: "4px 0 0" }}>
          What you are on today, and what the other one includes.
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
            <Icon name="clock-countdown" /> Results are not kept
          </span>
          <p style={{ fontSize: 12, margin: "4px 0 0", lineHeight: 1.55 }}>{retention}</p>
        </div>
      )}

      {/* Where this club stands, before the two plans it could be on. A club
          reading this panel is usually asking one of two questions — "what am
          I paying for" and "am I near the edge of it" — and only the first had
          an answer here. */}
      {standing && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 14,
            padding: "10px 12px",
            borderRadius: "var(--radius-md)",
            background: "color-mix(in srgb, var(--color-text) 4%, transparent)",
          }}
        >
          <span style={{ fontSize: 12.5 }}>
            <Icon name="cards" /> {usage(standing.activeEvents, "tournament running", "tournaments running")}
          </span>
          <span style={{ fontSize: 12.5 }}>
            <Icon name="users-three" /> {usage(standing.staffSeats, "organizer", "organizers")}
          </span>
          {/* Only claimed when it is true. `enforced` is false until a payment
              provider is attached, and until then nothing is refused — saying
              otherwise would be a small lie on the one panel whose whole job
              is to be straight about what a club has bought. */}
          {standing.enforced && !standing.activeEvents.allowed && (
            <span style={{ fontSize: 12.5, color: "var(--color-danger)" }}>
              <Icon name="warning-circle" /> Another tournament needs a bigger plan.
            </span>
          )}
          {standing.enforced && !standing.staffSeats.allowed && (
            <span style={{ fontSize: 12.5, color: "var(--color-danger)" }}>
              <Icon name="warning-circle" /> Another organizer needs a bigger plan.
            </span>
          )}
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
                  {/* The configurable price, never `priceMonthly` raw — see
                      `effectivePrice`, so an override reaches this panel, the
                      landing page and the schema.org offer as one number. The
                      annual figure is derived (two months free) and follows the
                      same override. */}
                  {effectivePrice(p) === 0
                    ? "Free"
                    : `$${effectivePrice(p)}/mo · $${effectiveAnnualPrice(p)}/yr`}
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
