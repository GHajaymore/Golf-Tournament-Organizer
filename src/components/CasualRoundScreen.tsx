import Link from "next/link";
import type { ReactNode } from "react";
import { RoundExpiryBanner } from "./RoundExpiryBanner";
import { CasualRoundPanel } from "./CasualRoundPanel";
import { LeaderboardTable } from "./LeaderboardTable";
import { ModifiedStablefordTable } from "./PointsLeaderboard";
import { Icon } from "./Icon";
import { expiryNotice, expiryShort, hoursLeft } from "@/lib/domain/round-expiry";
import { casualKeepRefusalFor } from "@/lib/services/close-terms";
import { casualStanding, casualMoney, casualIsMatch } from "@/lib/services/casual-round";
import { screenName } from "@/lib/nav";
import { needsTeams } from "@/lib/formats";
import type { EventState } from "@/lib/services/tournament";

/**
 * A CASUAL ROUND IS ONE SCREEN (Ajay, 2026-10-06): "casual round should be just
 * one screen including score entry for the foursome".
 *
 * It was four — a dashboard, score entry, a leaderboard and the money — under
 * a console tab bar, for two to eight people standing on a tee with a phone.
 * Now, top to bottom, in the order the round asks for them:
 *
 *   the expiry       one line, the sentence behind its ⓘ; never hidden
 *   the round        what is being played, where, and the friends' code
 *   the card         every player on the hole, the mic beside it (children)
 *   where it stands  once a score is in — before that it is an empty table
 *   the money        the stake while it is live; who pays whom once final
 *   More             players and handicaps, the money in full, export, rules
 *
 * Everything below the card was the casual half of `/dashboard`, read through
 * `casual-round.ts` so there is still one copy of each answer.
 */
export async function CasualRoundScreen({
  state,
  email,
  isStaff,
  courseName,
  children,
}: {
  state: EventState;
  /** Who is looking — their stake, and the money's "you". */
  email: string;
  /** Whoever set the round up. Only they change it or keep it. */
  isStaff: boolean;
  /** The course, as the card heads it. */
  courseName: string;
  /** The card. */
  children: ReactNode;
}) {
  const event = state.event;
  const stage = state.boardStage ?? state.stages[0] ?? null;
  const hours = hoursLeft(event);
  const keepRefusal = hours === null ? null : await casualKeepRefusalFor(event.id);
  const [standing, cash] = await Promise.all([casualStanding(state), casualMoney(event.id, email)]);

  // What is being played, in the words it was set up in.
  const about = [
    stage?.format,
    courseName,
    stage && stage.holes === 9 ? "9 holes" : "",
    stage ? (stage.scoringBasis === "gross" ? "level" : "off handicaps") : "",
  ]
    .filter(Boolean)
    .join(" · ");

  // Nothing ranks before a score is in, and an empty table on the screen the
  // first tee is looking at reads as something broken.
  const scored = state.boardProgress.started > 0;

  /**
   * THE FRIENDS' CODE IS IN MORE, FIRST (Ajay asked "do we need to show the
   * code?", 2026-10-06). A casual round is usually kept on ONE phone — the
   * marker scores the group, which is what this screen is built for — and the
   * code matters once, on the first tee, if somebody wants their own card.
   * Shown beside the heading it was furniture on all eighteen holes for a
   * feature most groups never use. Named first in More, so it is found.
   */
  //
  // NOT FOR A SIDE'S ROUND (2026-10-07). A four-ball or foursomes is kept on
  // one phone: the code's own surface keeps a player's card or match, never a
  // side's, so the friend who used it was told they had no match in a round
  // they were playing. The promise beside the code would be a false one.
  const code = isStaff && !needsTeams(stage?.format ?? "") ? stage?.accessCode ?? "" : "";

  const moreParts = [
    code ? "Friends' code" : "",
    isStaff ? "Players & handicaps" : "",
    cash.anyGame ? "The money" : isStaff ? "Add a money game" : "",
    "Export",
    "Rules",
  ].filter(Boolean);

  return (
    <>
      <RoundExpiryBanner
        notice={expiryNotice(hours, isStaff, keepRefusal)}
        short={expiryShort(hours, isStaff)}
        canKeep={isStaff}
        keepRefusal={keepRefusal}
      />

      {/* "The round" for every format, and that is not the error the
          dashboard once made. Calling a MEDAL "the match" was a claim about
          how it is decided; every match is played over a round. */}
      <h1 className="page-title" style={{ margin: 0 }}>The round</h1>
      <p className="text-muted" style={{ fontSize: 14, margin: "2px 0 0", lineHeight: 1.45, overflowWrap: "anywhere" }}>
        {about}
      </p>

      <div style={{ marginTop: 12 }}>{children}</div>

      {scored && (
        <section className="card elev-sm" style={{ marginTop: 12 }} aria-label={standing.title}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <span className="card-title" style={{ fontSize: 16 }}>{standing.title}</span>
            <span className="text-muted" style={{ fontSize: 13 }}>{standing.basis}</span>
          </div>
          {standing.matchLine ? (
            <p
              data-match-line
              style={{ fontFamily: "var(--font-heading)", fontSize: 22, lineHeight: 1.3, margin: "6px 0 2px", textWrap: "balance" }}
            >
              {standing.matchLine}
            </p>
          ) : standing.points ? (
            <ModifiedStablefordTable rows={standing.points} bare compact />
          ) : (
            <LeaderboardTable
              isStroke={standing.isStroke}
              isStableford={standing.isStableford}
              rows={standing.rows}
              compact
              rankedOn={standing.rankedOn}
              emptyNote="Nothing to rank here yet — it fills in as the holes are scored."
            />
          )}
        </section>
      )}

      {cash.anyGame && (
        <section className="card elev-sm" style={{ marginTop: 12, gap: 6 }} aria-label="The money">
          <span className="card-title" style={{ fontSize: 16 }}>The money</span>
          {cash.final ? (
            cash.handovers.length > 0 ? (
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 15, lineHeight: 1.7 }}>
                {cash.handovers.map((h) => (
                  <li key={h}>{h}</li>
                ))}
              </ul>
            ) : (
              <p style={{ margin: 0, fontSize: 15 }}>Everyone&rsquo;s square.</p>
            )
          ) : (
            /* FINAL ONLY, NEVER LIVE — `money-layout.ts`. A skins pot can carry
               to the last green, so a running figure would be a different
               number that looked like the answer. The stake cannot move. */
            <p style={{ margin: 0, fontSize: 15, lineHeight: 1.5 }}>
              {/* A gross match is written down as who won each hole, with no
                  card to wait for — so it waits for the match to end. */}
              {cash.stake ? `${cash.stake} ` : ""}Who pays whom shows here when{" "}
              {casualIsMatch(state) ? "the match is over" : "every card is in"}.
            </p>
          )}
        </section>
      )}

      <details style={{ marginTop: 4 }}>
        <summary
          className="touch-target"
          style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 15, fontWeight: 600, color: "var(--color-accent-200)", listStyle: "none" }}
        >
          <Icon name="caret-down" aria-hidden />
          More: {moreParts.join(" · ")}
        </summary>
        <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 8 }}>
          {code && (
            <div>
              <div className="card-kicker">Friends&rsquo; code</div>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginTop: 6 }}>
                <code
                  style={{
                    fontSize: 21,
                    fontWeight: 700,
                    letterSpacing: "0.14em",
                    fontFamily: "var(--font-heading)",
                    padding: "6px 12px",
                    borderRadius: 9,
                    background: "color-mix(in srgb, var(--color-accent) 12%, transparent)",
                    color: "var(--color-text)",
                  }}
                >
                  {code}
                </code>
                <span className="text-muted" style={{ fontSize: 14, lineHeight: 1.5, minWidth: 0, flex: "1 1 200px" }}>
                  For anybody who wants their own card on their own phone: they open the app, tap{" "}
                  <b>Playing today?</b> and put it in — no account needed. Their scores show up here.
                </span>
              </div>
            </div>
          )}
          {isStaff && stage && (
            <CasualRoundPanel
              bare
              stageId={stage.id}
              holes={stage.holes}
              scoringBasis={stage.scoringBasis}
              players={state.confirmed.map((p) => ({
                id: p.id,
                name: p.name,
                // Plus handicaps are stored negative and must never be shown
                // back as "-2" — the same rule the setup form states.
                handicap: p.handicap < 0 ? `+${Math.abs(p.handicap)}` : String(p.handicap),
              }))}
            />
          )}
          <nav aria-label="The rest of this round" style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {(cash.anyGame || isStaff) && (
              <Link className="btn btn-secondary" href="/group-games" style={{ minHeight: 44 }}>
                <Icon name="coins" /> {cash.anyGame ? "The money in full" : "Add a money game"}
              </Link>
            )}
            <Link className="btn btn-secondary" href="/reports" style={{ minHeight: 44 }}>
              <Icon name="export" /> {screenName("/reports", true)}
            </Link>
            <Link className="btn btn-secondary" href="/rules" style={{ minHeight: 44 }}>
              <Icon name="book-open" /> {screenName("/rules", true)}
            </Link>
          </nav>
        </div>
      </details>
    </>
  );
}
