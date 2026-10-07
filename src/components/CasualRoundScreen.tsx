import Link from "next/link";
import type { ReactNode } from "react";
import { RoundExpiryBanner } from "./RoundExpiryBanner";
import { CasualRoundPanel } from "./CasualRoundPanel";
import { LeaderboardTable } from "./LeaderboardTable";
import { ModifiedStablefordTable } from "./PointsLeaderboard";
import { MoreInfo } from "./MoreInfo";
import { Icon } from "./Icon";
import { expiryNotice, expiryShort, hoursLeft } from "@/lib/domain/round-expiry";
import { casualKeepRefusalFor } from "@/lib/services/close-terms";
import { casualStanding, casualMoney } from "@/lib/services/casual-round";
import { screenName } from "@/lib/nav";
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

  const moreParts = [
    isStaff ? "Players & handicaps" : "",
    cash.anyGame ? "The money" : isStaff ? "Add a money game" : "",
    "Export",
    "Rules",
  ].filter(Boolean);

  return (
    <>
      <RoundExpiryBanner
        notice={expiryNotice(hours, isStaff, keepRefusal)}
        short={expiryShort(hours, isStaff, keepRefusal)}
        canKeep={isStaff}
        keepRefusal={keepRefusal}
      />

      {/* "The round" for every format, and that is not the error the
          dashboard once made. Calling a MEDAL "the match" was a claim about
          how it is decided; every match is played over a round. */}
      <h1 className="page-title">The round</h1>
      <p className="text-muted" style={{ fontSize: 14, margin: "4px 0 0", lineHeight: 1.45, overflowWrap: "anywhere" }}>
        {about}
      </p>

      {/* THE CODE, ABOVE THE CARD. It is read out on the first tee, so it
          belongs where the first tee is looking — it was the fourth block of
          the round's settings, two screens down. */}
      {isStaff && stage?.accessCode && (
        <MoreInfo
          style={{ marginTop: 6 }}
          short={
            <span>
              Friends&rsquo; code{" "}
              <code
                style={{
                  fontSize: 17,
                  fontWeight: 700,
                  letterSpacing: "0.12em",
                  fontFamily: "var(--font-heading)",
                  padding: "2px 8px",
                  borderRadius: 7,
                  background: "color-mix(in srgb, var(--color-accent) 12%, transparent)",
                  color: "var(--color-text)",
                }}
              >
                {stage.accessCode}
              </code>
            </span>
          }
        >
          Read it out to the others. They open the app, tap <b>Playing today?</b> and put it in — no
          account needed, and they pick their own name and keep their own card. Their scores show up
          here as they go.
        </MoreInfo>
      )}

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
            <ModifiedStablefordTable rows={standing.points} bare />
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
              {cash.stake ? `${cash.stake} ` : ""}Who pays whom shows here when every card is in.
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
