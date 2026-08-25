"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { WeekView } from "@/lib/services/week-view";
import { useMoney } from "@/components/CurrencyProvider";

/**
 * One week of a league on one screen.
 *
 * The order is the order it gets talked about in the bar: what happened last
 * night, what that did to the table, then who is owed money. Splitting those
 * across three screens is how the incumbents do it, and it is why an organizer
 * reads the results out from three browser tabs.
 *
 * The movement column is the part worth having. Every app shows a position;
 * this shows what changed, which is the thing members actually argue about.
 */

/**
 * The club's way of writing an amount, not this file's.
 *
 * Was a local `money()` hard-coding a dollar sign and dividing by a hundred.
 * There were several of these and a club outside the United States saw dollars
 * on every one, at a hundredth of the value in a currency with no minor unit.
 */

/** Ordinal without a lookup table: 1st, 2nd, 3rd, 4th … 11th, 21st. */
function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${suffix}`;
}

function Movement({ change, isNew }: { change: number; isNew: boolean }) {
  if (isNew) {
    return (
      <span className="tag" style={{ fontSize: 10.5, whiteSpace: "nowrap" }} title="First week counted">
        new
      </span>
    );
  }
  if (change === 0) {
    return (
      <span className="text-muted" style={{ fontSize: 12 }} aria-label="no change">
        —
      </span>
    );
  }
  const up = change > 0;
  return (
    <span
      style={{
        fontSize: 12,
        fontWeight: 600,
        whiteSpace: "nowrap",
        // Semantic, not the brand accent: this is good/bad news, and it has to
        // read as that on both grounds.
        color: up ? "var(--color-accent-2)" : "var(--color-danger)",
      }}
      aria-label={`${up ? "up" : "down"} ${Math.abs(change)} place${Math.abs(change) === 1 ? "" : "s"}`}
    >
      <i className={up ? "ph-fill ph-caret-up" : "ph-fill ph-caret-down"} /> {Math.abs(change)}
    </span>
  );
}

function Section({
  kicker,
  title,
  aside,
  children,
}: {
  kicker: string;
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="card elev-sm" style={{ gap: 12, marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <div>
          <div className="card-kicker">{kicker}</div>
          <span className="card-title" style={{ fontSize: 16 }}>{title}</span>
        </div>
        <div style={{ flex: 1 }} />
        {aside}
      </div>
      {children}
    </div>
  );
}

export function WeekClient({ view, canManageMoney }: { view: WeekView; canManageMoney: boolean }) {
  const { money } = useMoney();
  const router = useRouter();

  const th: React.CSSProperties = {
    textAlign: "left",
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: ".06em",
    fontWeight: 600,
    padding: "0 0 6px",
    color: "var(--color-text-muted, #888)",
  };
  const td: React.CSSProperties = {
    padding: "7px 0",
    fontSize: 13,
    borderTop: "1px solid var(--color-divider)",
  };
  const num: React.CSSProperties = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" };

  return (
    <>
      {/* Weeks as a scrolling strip rather than a dropdown: a league organizer
          moves between last night and the one before constantly, and a select
          hides how many weeks there are. */}
      <div
        style={{
          display: "flex",
          gap: 6,
          overflowX: "auto",
          paddingBottom: 6,
          marginBottom: 14,
          WebkitOverflowScrolling: "touch",
        }}
      >
        {view.weeks.map((w) => {
          const active = w.stageId === view.stageId;
          return (
            <button
              key={w.stageId}
              type="button"
              onClick={() => router.push(`/week?round=${w.stageId}`)}
              className={active ? "btn btn-primary" : "btn btn-ghost"}
              style={{ whiteSpace: "nowrap", flexShrink: 0, fontSize: 12.5 }}
              aria-current={active ? "true" : undefined}
            >
              {w.date || w.label}
              {!w.played && (
                <span style={{ opacity: 0.6, marginLeft: 6, fontSize: 11 }} title="No scores yet">
                  ·
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div style={{ marginBottom: 18 }}>
        <div className="page-kicker">League</div>
        <h2 style={{ fontSize: 27, margin: "5px 0 0" }}>
          {view.label}
          {view.date && (
            // The night a member recognises. "Week 4" is the app's word for it;
            // "Tue 19 May" is the club's.
            <span className="text-muted" style={{ fontSize: 17, fontWeight: 400, marginLeft: 10 }}>
              {view.date}
            </span>
          )}
        </h2>
        <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
          {view.format} · {view.holes} holes · {view.stableford ? "Stableford points" : "net strokes"}
        </p>
      </div>

      {view.manual ? (
        /* No table at all, deliberately. Anything tabular on this screen reads
           as the result, whatever the caption says — and the whole point of a
           hand-scored round is that the app does not know the result. */
        <div className="card elev-sm" style={{ gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <i className="ph ph-clipboard-text" style={{ fontSize: 19, opacity: 0.7 }} />
            <span className="card-title" style={{ fontSize: 15.5 }}>
              This week is scored by hand
            </span>
          </div>
          <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.7 }}>
            {view.format} isn&rsquo;t a format this app works out — the committee does. The field,
            the tee sheet and the skins are still here; the result goes up as an announcement.
          </p>
        </div>
      ) : view.empty ? (
        <div className="card elev-sm">
          <span className="text-muted" style={{ fontSize: 13 }}>
            No scores are in for {view.label.toLowerCase()} yet. Once cards are entered, the night&rsquo;s
            results, the table and the skins all appear here.
          </span>
        </div>
      ) : (
        <>
          <Section
            kicker="The night"
            title="Results"
            aside={
              <span className="text-muted" style={{ fontSize: 12 }}>
                {view.results.length} played
              </span>
            }
          >
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ ...th, width: 44 }}>Pos</th>
                    <th style={th}>Player</th>
                    <th style={{ ...th, textAlign: "right" }}>Gross</th>
                    <th style={{ ...th, textAlign: "right" }}>
                      {view.stableford ? "Points" : "Net"}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {view.results.map((r) => (
                    <tr key={r.playerId}>
                      <td style={{ ...td, fontVariantNumeric: "tabular-nums", fontWeight: r.position === 1 ? 700 : 400 }}>
                        {ordinal(r.position)}
                      </td>
                      <td style={{ ...td, fontWeight: r.position === 1 ? 600 : 400 }}>
                        {r.name}
                        {r.thru > 0 && r.thru < view.holes && (
                          <span className="text-muted" style={{ fontSize: 11, marginLeft: 6 }}>
                            thru {r.thru}
                          </span>
                        )}
                      </td>
                      <td style={num}>{r.gross}</td>
                      <td style={{ ...num, fontWeight: 600 }}>
                        {view.stableford ? r.points : r.net}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section
            kicker="The table"
            title="Standings after this week"
            aside={
              <span className="text-muted" style={{ fontSize: 12 }}>
                movement since last week
              </span>
            }
          >
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ ...th, width: 44 }}>Pos</th>
                    <th style={{ ...th, width: 52 }}>+/−</th>
                    <th style={th}>Player</th>
                    <th style={{ ...th, textAlign: "right" }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {view.standings.map((r) => (
                    <tr key={r.playerId}>
                      <td style={{ ...td, fontVariantNumeric: "tabular-nums" }}>{r.position}</td>
                      <td style={td}>
                        <Movement change={r.change} isNew={r.isNew} />
                      </td>
                      <td style={td}>{r.name}</td>
                      <td style={{ ...num, fontWeight: 600 }}>{r.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          {view.skins.some((g) => g.view.result) && (
            <Section
              kicker="The money"
              title="Skins"
              aside={
                canManageMoney ? (
                  <Link href={`/prizes?round=${view.stageId}`} className="btn btn-ghost" style={{ fontSize: 12.5 }}>
                    Manage
                  </Link>
                ) : undefined
              }
            >
              {/* Every game the round ran, named once in skinsGameLabel so
                  this and the money page cannot call the same game two
                  different things. A league night lists four. */}
              {view.skins.map(({ label, view: pot }) =>
                pot?.result ? (
                  <div key={label} style={{ marginBottom: 6 }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                      <span style={{ fontSize: 13, fontWeight: 600 }}>{label}</span>
                      <span className="text-muted" style={{ fontSize: 12 }}>
                        {money(pot.result.potCents)} pot · {pot.result.playerCount} in ·{" "}
                        {pot.result.claimedSkins} skin{pot.result.claimedSkins === 1 ? "" : "s"} won
                      </span>
                      {pot.result.provisional && (
                        <span className="tag" style={{ fontSize: 10.5 }}>provisional</span>
                      )}
                    </div>
                    {pot.result.shares.filter((s) => s.wonCents > 0).length === 0 ? (
                      <p className="text-muted" style={{ fontSize: 12.5, margin: 0 }}>
                        Nobody won a skin — stakes go back.
                      </p>
                    ) : (
                      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.7 }}>
                        {pot.result.shares
                          .filter((s) => s.wonCents > 0)
                          .map((s) => (
                            <li key={s.playerId}>
                              {pot.nameById[s.playerId] ?? "—"} — {s.skins} skin{s.skins === 1 ? "" : "s"},{" "}
                              <b>{money(s.wonCents)}</b>
                            </li>
                          ))}
                      </ul>
                    )}
                  </div>
                ) : null,
              )}
              <p className="text-muted" style={{ fontSize: 11.5, margin: "4px 0 0" }}>
                Calculated and recorded here. The club settles up in person — TourneyHQ never moves money.
              </p>
            </Section>
          )}
        </>
      )}
    </>
  );
}
