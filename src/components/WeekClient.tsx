"use client";
import { WEEK_BASIS_LABEL, WEEK_BASIS_COLUMN, valueOnBasis } from "@/lib/domain/week-basis";
import { weekReturnsNote } from "@/lib/domain/attendance";
import { useOrgProfile } from "@/components/OrgProfileProvider";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import type { WeekView } from "@/lib/services/week-view";
import { useMoney } from "@/components/CurrencyProvider";
import { nightPurse, stakesGoBack } from "@/lib/domain/skins-pot";
import { Icon } from "./Icon";

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

/**
 * THE NIGHT'S PURSE: every player across every skins game, with a total.
 *
 * Only a round that ran more than one game needs it — with one, the game's own
 * list already is the purse. And only once every game is final: money is
 * reported when it cannot change (see `money-layout.ts`), so a round still
 * being played says when this will appear instead of showing a running total.
 *
 * The total line is the reconciliation. `nightPurse` adds up what was PAID,
 * not what was staked, so a sheet that does not balance shows two different
 * numbers here rather than one reassuring one.
 */
function NightPurseTable({ games }: { games: WeekView["skins"] }) {
  const { money } = useMoney();
  const played = games.filter((g) => g.view.result);
  if (played.length < 2) return null;

  const purse = nightPurse(played.map((g) => g.view.result));
  if (!purse.final) {
    return (
      <p className="text-muted" style={{ fontSize: 12.5, margin: "8px 0 0" }}>
        The night&rsquo;s purse is added up once every card is in.
      </p>
    );
  }

  const names: Record<string, string> = Object.assign({}, ...played.map((g) => g.view.nameById));
  const signed = (n: number) => (n === 0 ? "level" : `${n > 0 ? "+" : "−"}${money(Math.abs(n))}`);
  const cell: React.CSSProperties = {
    padding: "5px 6px",
    borderTop: "1px solid var(--color-divider)",
    textAlign: "right",
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
  };
  const head: React.CSSProperties = {
    ...cell,
    borderTop: "none",
    fontSize: 11.5,
    fontWeight: 600,
    color: "var(--color-text-muted)",
  };
  const balanced = purse.wonCents === purse.stakeCents;

  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>The night&rsquo;s purse</div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
          <thead>
            <tr>
              <th style={{ ...head, textAlign: "left" }}>Player</th>
              <th style={head}>In</th>
              <th style={head}>Won</th>
              <th style={head}>Net</th>
            </tr>
          </thead>
          <tbody>
            {purse.rows.map((r) => (
              <tr key={r.playerId}>
                <td style={{ ...cell, textAlign: "left", whiteSpace: "normal" }}>
                  {names[r.playerId] ?? "—"}
                </td>
                <td style={cell}>{money(r.stakeCents)}</td>
                <td style={cell}>{money(r.wonCents)}</td>
                <td style={{ ...cell, fontWeight: 600 }}>{signed(r.netCents)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td style={{ ...cell, textAlign: "left", fontWeight: 600 }}>Total purse</td>
              <td style={{ ...cell, fontWeight: 600 }}>{money(purse.stakeCents)}</td>
              <td style={{ ...cell, fontWeight: 600 }}>{money(purse.wonCents)}</td>
              <td style={cell} />
            </tr>
          </tfoot>
        </table>
      </div>
      {!balanced && (
        <p role="alert" style={{ fontSize: 12.5, margin: "6px 0 0", color: "var(--color-danger)" }}>
          The payouts do not add up to the stakes. Check the pots on Prizes &amp; payouts before
          anybody settles.
        </p>
      )}
    </div>
  );
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
      <Icon name={up ? "ph-fill ph-caret-up" : "ph-fill ph-caret-down"} /> {Math.abs(change)}
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
  // A society is not a club, and this screen says so. See OrgProfileProvider.
  const org = useOrgProfile();
  const { money } = useMoney();
  const router = useRouter();
  const pathname = usePathname();

  /**
   * What a SIDE is ranked on: the night's own basis, all three of them.
   *
   * This read "points for a Stableford, otherwise net" for a day, to match
   * `teamStandings`, which had no gross branch — so a team round set to gross
   * was ordered by net everywhere and a "Gross" heading would have sat over a
   * column that did not run in order. The service reads the basis now, and so
   * does this: one rule, three screens.
   */
  const sideBasis = view.basis;

  const th: React.CSSProperties = {
    textAlign: "left",
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: ".06em",
    fontWeight: 600,
    padding: "0 0 6px",
    color: "var(--color-text-muted)",
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
        {/* Not a RoundPicker: this strip shows each week's DATE and whether it
            has been scored, which a select cannot. Same rule though — it
            returns to the screen it is ON rather than naming one, so it stays
            right if this strip is ever rendered somewhere else. */}
        {view.weeks.map((w) => {
          const active = w.stageId === view.stageId;
          return (
            <button
              key={w.stageId}
              type="button"
              onClick={() => router.push(`${pathname}?round=${w.stageId}`)}
              className={active ? "btn btn-primary" : "btn btn-ghost"}
              style={{ whiteSpace: "nowrap", flexShrink: 0, fontSize: 12.5 }}
              aria-current={active ? "true" : undefined}
              /* WHAT THE DOT MEANS, on the button rather than in a tooltip.
                 "Not scored yet" was carried by a `title` on a middle dot —
                 and this strip is read on a phone, where there is no hover.
                 A member saw a dot beside some weeks and not others with no
                 way to find out which was which. */
              aria-label={`${w.date || w.label}${w.played ? "" : " — no scores yet"}`}
            >
              {w.date || w.label}
              {!w.played && (
                <span aria-hidden style={{ opacity: 0.6, marginLeft: 6, fontSize: 11 }}>
                  ·
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div style={{ marginBottom: 18 }}>
        <div className="page-kicker">League</div>
        <h1 className="page-title">
          {view.label}
          {view.date && (
            // The night a member recognises. "Week 4" is the app's word for it;
            // "Tue 19 May" is the club's.
            <span className="text-muted" style={{ fontSize: 17, fontWeight: 400, marginLeft: 10 }}>
              {view.date}
            </span>
          )}
        </h1>
        <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
          {view.format} · {view.holes} holes · {WEEK_BASIS_LABEL[view.basis]}
        </p>
      </div>

      {view.manual ? (
        /* No table at all, deliberately. Anything tabular on this screen reads
           as the result, whatever the caption says — and the whole point of a
           hand-scored round is that the app does not know the result. */
        <div className="card elev-sm" style={{ gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <Icon name="clipboard-text" style={{ fontSize: 19, opacity: 0.7 }} />
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
          {/* The night's SCORES, when the night has any.
              A match week's result is who beat whom, and its points are in the
              table below — there is no gross and net to rank. This section
              used to be the only thing deciding whether the screen rendered at
              all, so a played match night was blanked entirely, season table
              and skins with it. */}
          {view.hasScoreTable && (
          <Section
            kicker="The night"
            title="Results"
            aside={
              /* "16 played" is the same sentence whether sixteen were expected
                 or eighteen were, and those are different nights — one is
                 finished, the other has two cards outstanding and somebody to
                 ring. Only a league knows how many were expected, so a
                 tournament keeps the plain count it always had. */
              <span className="text-muted" style={{ fontSize: 12 }}>
                {view.attendance
                  ? weekReturnsNote(view.attendance)
                  : `${view.results.length} played`}
              </span>
            }
          >
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ ...th, width: 44 }}>Pos</th>
                    <th style={th}>Player</th>
                    {/* A GROSS night has one strokes column, not the same
                        number twice. `cardTotals` states the same rule for a
                        printed card — "no handicap is involved, so a net
                        column would be a column of the same numbers" — and
                        this table had it as Gross | Gross. */}
                    {view.basis !== "gross" && (
                      <th style={{ ...th, textAlign: "right" }}>Gross</th>
                    )}
                    <th style={{ ...th, textAlign: "right" }}>
                      {WEEK_BASIS_COLUMN[view.basis]}
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
                      {view.basis !== "gross" && <td style={num}>{r.gross}</td>}
                      <td style={{ ...num, fontWeight: 600 }}>
                        {valueOnBasis(view.basis, r)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
          )}

          {/* THE NIGHT'S SIDES, on a night played in teams.
              Its own section rather than a second shape for the one above:
              a foursomes has no individual score to rank, and a four-ball's
              individual score is half of what the side went round in. Both
              were ranked by side on the leaderboard and by nothing here — the
              week sheet showed a finished team night as "no scores are in". */}
          {view.sides.length > 0 && (
          <Section
            kicker="The night"
            title="Sides"
            aside={
              <span className="text-muted" style={{ fontSize: 12 }}>
                {/* Counted in sides, because that is what returned a card.
                    "8 played" beside a foursomes reads as eight players. */}
                {view.sides.filter((s) => s.played > 0).length} of {view.sides.length} sides in
              </span>
            }
          >
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ ...th, width: 44 }}>Pos</th>
                    <th style={th}>Side</th>
                    {/* Not Gross twice on a gross round — the same rule the
                        player table above states: "no handicap is involved, so
                        a net column would be a column of the same numbers". */}
                    {view.basis !== "gross" && (
                      <th style={{ ...th, textAlign: "right" }}>Gross</th>
                    )}
                    <th style={{ ...th, textAlign: "right" }}>
                      {WEEK_BASIS_COLUMN[sideBasis]}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {view.sides.map((s) => (
                    <tr key={s.teamId}>
                      <td style={{ ...td, fontVariantNumeric: "tabular-nums", fontWeight: s.position === 1 ? 700 : 400 }}>
                        {s.position === null ? "—" : ordinal(s.position)}
                      </td>
                      <td style={{ ...td, fontWeight: s.position === 1 ? 600 : 400 }}>
                        <div>
                          {s.name}
                          {s.played > 0 && s.played < view.holes && (
                            <span className="text-muted" style={{ fontSize: 11, marginLeft: 6 }}>
                              thru {s.played}
                            </span>
                          )}
                        </div>
                        {/* Who is in it, on its own line and in the same words
                            as the team leaderboard — a side is called "Hattie &
                            Gordon" and its members are "Hattie Mwangi · Gordon
                            Pyle", so inline they ran into one another and read
                            as the same two names printed twice. */}
                        <div className="text-muted" style={{ fontSize: 11 }}>
                          {s.members.join(" · ") || "No players"}
                        </div>
                      </td>
                      {view.basis !== "gross" && (
                        <td style={num}>{s.played > 0 ? s.gross : "—"}</td>
                      )}
                      <td style={{ ...num, fontWeight: 600 }}>
                        {s.played > 0 ? valueOnBasis(sideBasis, s) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
          )}

          {/* THE HEADING FOLLOWS THE TABLE, rather than claiming for it.

              A medal night in a match-play league earns no match points, so
              what is shown is the season as it stood WALKING INTO the night —
              `standingsWithMovement` says exactly that of itself. The heading
              claimed otherwise, and the movement column full of dashes
              underneath then read as a week the app had lost.

              The aside goes with it: "movement since last week" over a column
              that cannot move is the same claim in smaller type. */}
          <Section
            kicker="The table"
            title={
              view.standingsIncludeThisWeek
                ? "Standings after this week"
                : "Season standings going into this week"
            }
            aside={
              <span className="text-muted" style={{ fontSize: 12 }}>
                {view.standingsIncludeThisWeek
                  ? "movement since last week"
                  : "this night earns no league points"}
              </span>
            }
          >
            {/* A HEADED TABLE WITH NO ROWS IS A CLAIM THAT NOBODY IS IN THE
                LEAGUE. Seen on the seeded club's foursomes night: "Season
                standings going into this week" over four column headings and
                nothing underneath, which reads as a table the app has lost.
                It is a season table of PLAYERS, and a night played in sides
                files no player's card — so it says that instead. */}
            {view.standings.length === 0 ? (
              <p className="text-muted" style={{ fontSize: 13, margin: 0, lineHeight: 1.7 }}>
                Nothing in the season table yet. It adds up the rounds scored
                player by player, and a night played in sides doesn&rsquo;t reach it.
              </p>
            ) : (
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
            )}
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
                    {/* See `stakesGoBack`: a refund is a payout, so asking
                        "has nobody any winnings" never said stakes go back. */}
                    {stakesGoBack(pot.result) ? (
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
              <NightPurseTable games={view.skins} />
              <p className="text-muted" style={{ fontSize: 11.5, margin: "4px 0 0" }}>
                Calculated and recorded here. The {org.noun} settles up in person — TourneyHQ never moves money.
              </p>
            </Section>
          )}
        </>
      )}
    </>
  );
}
