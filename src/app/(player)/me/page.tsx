import Link from "next/link";
import { redirect } from "next/navigation";
import { screenMetadata } from "@/lib/screen-metadata";
import { requireSession } from "@/lib/page-helpers";
import { loadEventState, settingsOf } from "@/lib/services/tournament";
import { allowsAutoConfirm } from "@/lib/tournament-settings";
import { cardStanding } from "@/lib/domain/card-approval";
import { announcementsFor } from "@/lib/services/announcements";
import { AnnouncementList } from "@/components/AnnouncementList";
import { meFor } from "@/lib/services/me";
import { availabilityFor } from "@/lib/services/availability";
import { RoundAvailability } from "@/components/RoundAvailability";
import { todayIso } from "@/lib/deadline";
import { Icon } from "@/components/Icon";
import { teamStandings } from "@/lib/services/teams";
import { placesByValue, placeLabel } from "@/lib/domain/flight-places";
import { weekBasis, valueOnBasis, isStablefordRound } from "@/lib/domain/week-basis";
import { roundKicker } from "@/lib/domain/round-label";
import { hasStandingToShow } from "@/lib/domain/player-standing";
import { yourCardNote } from "@/lib/domain/your-card";
import { EnterButton } from "@/components/EnterButton";
import { RoundExpiryBanner } from "@/components/RoundExpiryBanner";
import { expiryNotice, hoursLeft } from "@/lib/domain/round-expiry";
import { nextHoleToPlay } from "@/lib/domain/next-hole";
import { standingRows } from "@/lib/services/tournament";
import { canSeeLeaderboard } from "@/lib/tournament-settings";
import { boardKind } from "@/lib/formats";
import { holesPlayed } from "@/lib/domain/handicap";
import { rankedScore, unitIsNet } from "@/lib/domain/ranked-score";
import { boardNames, positionLabel, thruTile, leadersWithYou, tileMark } from "@/lib/domain/scoreboard";
import { roundCardFor } from "@/lib/services/round-card";
import { ScoreboardCard, ScoreboardLeaders, type LeaderTile } from "@/components/Scoreboard";
import { clubEventsFor } from "@/lib/services/club-events";
import { isWatching, isWaiting } from "@/lib/domain/tournament-switcher";

/**
 * Today — the player's home.
 *
 * THE ROUND FIRST (design "A", chosen by the club 2026-09-18). The screen a
 * player keeps open on the course leads with the thing they open it to do:
 * where their round has got to, and one large button to carry on. Position,
 * group and notices follow as short rows; the week-by-week availability
 * calendar underneath is unchanged, on purpose — it was the part of the old
 * screen people liked.
 *
 * Nothing here is computed locally. Position comes from the same standingRows
 * the board renders and the card state from the same row the approval panel
 * reads, so this screen cannot tell a player something the tournament
 * disagrees with.
 */

/**
 * The one screen outside the console that never named itself either.
 *
 * `/me` is where `landingScreenFor("player")` sends everybody who plays, so
 * this is the tab a player keeps open on the course — and it read the
 * marketing sentence, the same as the organizer's twenty-one.
 */
export const metadata = screenMetadata("/me");

/** Up to two letters for a name, for the little group avatars. */
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "";
  return (first + last).toUpperCase();
}

export default async function PlayTodayPage() {
  const session = await requireSession();
  const state = await loadEventState(session.eventId);
  if (!state) redirect("/");
  const me = await meFor(state, session.email);
  const availability = await availabilityFor(state, session.email);
  const announcements = await announcementsFor(session.eventId);
  /**
   * The events-list row for this tournament — the same one the switcher above
   * reads, memoised for the request — so "watching" and the way in agree with
   * the header and with the list.
   */
  const myRow = (await clubEventsFor(session.email)).find((r) => r.eventId === session.eventId) ?? null;
  const isStaff = session.role === "admin" || session.role === "assistant";
  const watching = !me.playerId && isWatching(myRow, isStaff);
  /**
   * ON THE WAITING LIST — a third state, and until 2026-09-20 there were two.
   *
   * `me.playerId` is null for a waitlisted entry by design: `myPlayerIds` asks
   * for `confirmed`, and a card must never reach somebody without a place. So
   * this screen put them through the same door as a stranger and told them
   * "You aren't entered in this tournament" — while the events list, reading
   * the row directly beneath, said "You’re on the waiting list". Measured on
   * the seeded club's Am-Am.
   */
  const waiting = !me.playerId && isWaiting(myRow, isStaff);

  const round = me.round;
  const card = round?.card ?? null;
  /**
   * Whether a committee is going to look at this card, from the round's own
   * setting. `cardStanding` carries the whole reason; the short version is
   * that a card stops at "certified" when nobody approves cards, and this
   * screen was calling that state unfinished, in grey, forever.
   */
  const cardState = cardStanding(card?.status ?? "entered", !allowsAutoConfirm(settingsOf(state.event)));
  const standing = hasStandingToShow(me.standing) ? me.standing : null;

  /**
   * THE HERO IS FOR A ROUND THE PLAYER SCORES THEMSELVES.
   *
   * "9 of 18 holes in" and a button to carry on are true only of a card this
   * player owns. A match is recorded against the opponent and a team round
   * on the side's card, so those rounds keep the cards they had — a hero
   * promising a card `/me/card` would then refuse is the contradiction
   * `MyRound.ownCard` exists to prevent.
   */
  const hero = Boolean(me.playerId && round?.ownCard);
  const holes = round?.holes ?? 0;
  const strokes: (number | null)[] = card?.strokes ?? Array.from({ length: holes }, () => null);
  const next = card ? nextHoleToPlay(strokes, round?.group?.startHole ?? 1) : 1;

  /** The round's pars, for marking the tiles — the card page's own reading. */
  const roundStage = round ? (state.stages.find((s) => s.id === round.stageId) ?? null) : null;
  const roundCard = await roundCardFor(state, roundStage, holes);

  /**
   * THE LEADERS BOARD, from the Board tab's own rows and under its own two
   * gates: the club has published standings to players, and the round ranks
   * individuals (`boardKind` — a manual or team round has no board to hang).
   */
  const boardStage = state.boardStage;
  /**
   * THREE gates now. `boardKind(undefined)` is "standard", so a tournament
   * with NO ROUND passed the second one and this screen hung a leaders table
   * — every member of the field, dashes across, under a heading claiming a
   * ranking — beside a panel saying there was nothing to play. Two answers on
   * one screen, which is the shape this file keeps finding.
   */
  const boardRows =
    canSeeLeaderboard(settingsOf(state.event), session.viewRole) &&
    boardStage &&
    boardKind(boardStage.format) === "standard"
      ? standingRows(state)
      : [];
  /**
   * MY SIDE, on a round where the side is the thing that scores.
   *
   * `me.standing` is a PLAYER's standing, and a foursomes files no player's
   * card — so this screen showed "Not started · Your position and score appear
   * here as soon as the first hole goes in" to somebody whose side had been
   * round in eighteen and finished seventh. Read off the seeded club on
   * 2026-09-20, the same day the week sheet and the player's board were found
   * saying the same thing about the same rounds.
   *
   * Found by id, never by name: two members of a club can share one, and the
   * result on somebody's phone is the one thing that must not be somebody
   * else's. See `TeamStanding.memberIds`.
   */
  const sidesThisRound =
    me.playerId && roundStage && boardKind(roundStage.format) === "team"
      ? await teamStandings(
          state.event.id,
          roundStage.id,
          roundStage.format,
          roundCard.card.pars,
          roundCard.card.strokeIndex,
          roundStage.scoringBasis,
          roundStage.handicapAllowance,
          roundStage.allowanceWeights,
          roundStage.countBest,
        )
      : [];
  const myIdx = sidesThisRound.findIndex((s) => s.memberIds.includes(me.playerId ?? ""));
  const mySide = myIdx >= 0 ? sidesThisRound[myIdx] : null;
  /**
   * And WHERE that side stands, by the board's own rule.
   *
   * `placesByValue` is what the team leaderboard, the player's board and the
   * week sheet all place sides with, so the number on this phone is the number
   * on the board rather than a fourth opinion. Sides level on the night share
   * a place; a side with no card has none at all.
   */
  const myPlace =
    mySide && roundStage
      ? placesByValue(
          sidesThisRound,
          (s) => valueOnBasis(weekBasis(roundStage.scoringBasis, roundStage.format), s),
          (s) => s.played > 0,
        )[myIdx]
      : null;

  const shown = leadersWithYou(boardRows, me.playerId ?? "", 5);
  const shownNames = boardNames(shown.map((s) => s.row.name));
  const isStableford = isStablefordRound(boardStage?.scoringBasis, boardStage?.format);
  const leaders: LeaderTile[] = shown.map(({ row, gap }, i) => ({
    id: row.id,
    pos: positionLabel(row, boardRows),
    name: shownNames[i],
    thru: thruTile(row, holesPlayed(boardStage?.holes)),
    /* The same figure the Board tab shows, off the same unit — these two
       screens printing different numbers for one round is the fault
       `rankedScore` was extracted to stop. */
    total: rankedScore(row, {
      isStroke: state.boardIsStroke,
      isStableford,
      isNet: unitIsNet(state.boardIsStroke ? state.strokeUnitLabel : ""),
    }).text,
    under: state.boardIsStroke && !isStableford && row.started && row.toPar < 0,
    you: row.id === me.playerId,
    gap,
  }));

  return (
    <div>
      {/* THE ROUND, NOT THE TOURNAMENT AGAIN (2026-09-19). The tournament's
          full name is in the switcher strip directly above, so repeating it as
          this heading put it on the screen twice before anything the player
          came for. The heading is the round — `roundKicker` prefers the
          organizer's short label ("Round 1") — and where it is played. */}
      <h1
        style={{
          fontFamily: "var(--font-heading)",
          fontSize: 20,
          lineHeight: 1.2,
          margin: 0,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {[round ? roundKicker(round.label, round.name) : "Today", round?.venue].filter(Boolean).join(" · ")}
      </h1>

      {/**
       * A casual round is deleted about a day after it is set up, and the whole
       * justification for that being acceptable is that the people it belongs
       * to are told before it happens. `canKeep` is false: `keepRound` is
       * staff-only, so the sentence names the remedy a player actually has.
       * `hoursLeft` is null for every tournament, so nothing mounts outside a
       * casual round.
       */}
      <div style={{ marginTop: 12 }}>
        <RoundExpiryBanner notice={expiryNotice(hoursLeft(state.event), false)} canKeep={false} />
      </div>

      {/**
       * PINNED NOTICES STAY ABOVE THE ROUND. `/announcements` promises the
       * organizer that "Pinned posts sit at the top of every player's
       * dashboard", and pinning is the organizer saying this one outranks
       * everything — a frost delay. Unpinned posts sit under the round.
       */}
      <AnnouncementList items={announcements.filter((a) => a.pinned)} />

      {/**
       * ENTERED, AND THERE IS NOTHING TO PLAY YET.
       *
       * The state every club is in for its first ten minutes, from the side
       * nothing walks. `verify-lifecycle.mjs` exists because `/entry` returned
       * 500 on a tournament with no rounds and covers the ORGANIZER at each
       * stage; the player's screens were never walked there, and said two
       * things that were not true rather than the one that was.
       *
       * It says what will happen next and does not promise when: a club that
       * has taken entries has not necessarily decided the format, and "your
       * position appears as soon as the first hole goes in" is a promise about
       * a round nobody has created.
       */}
      {me.playerId && !round && (
        <section aria-label="Nothing to play yet" className="card elev-sm" style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          <span className="card-title">You&rsquo;re in — nothing to play yet</span>
          {/* "No round to play" rather than "the organizer hasn't added one":
              this branches on `me.round`, which is null when there is no
              PLAYABLE round, and stages that are not playing rounds would make
              the stronger sentence an overclaim. Say what the gate knows. */}
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55 }}>
            Your entry is confirmed. There&rsquo;s no round to play in this tournament yet, so
            there&rsquo;s no card and no board — both appear here as soon as there is one.
          </p>
          {myRow?.windowNote && (
            <span className="text-muted" style={{ fontSize: 13 }}>
              {myRow.windowNote}
            </span>
          )}
        </section>
      )}

      {waiting && (
        <section aria-label="Waiting list" className="card elev-sm" style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          <span className="card-title">You&rsquo;re on the waiting list</span>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55 }}>
            Your name is down and the organizer will confirm your place if one opens up. There&rsquo;s
            no card until then — the board, the groups and the notices are all open to read.
          </p>
          {myRow?.placesNote && (
            <span className="text-muted" style={{ fontSize: 13 }}>
              {myRow.placesNote}
            </span>
          )}
        </section>
      )}

      {!me.playerId && !watching && !waiting && (
        <p style={{ marginTop: 16, fontSize: 14.5, lineHeight: 1.6, color: "var(--color-neutral-400)" }}>
          You aren&rsquo;t entered in this tournament, so there&rsquo;s no card here. The board is still
          open on the next tab.
        </p>
      )}

      {/**
       * WATCHING — a member looking at one of the club's tournaments they are
       * not in, reached from the switcher or the events list. Said once, here,
       * in words: everything is theirs to read and nothing is theirs to change,
       * and if the door is open, this is where it is.
       */}
      {watching && (
        <section aria-label="Watching" className="card elev-sm" style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          <span className="card-title">You&rsquo;re watching this one</span>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55 }}>
            You aren&rsquo;t entered, so there&rsquo;s no card for you here. The board, the groups and the
            notices are all open to read.
          </p>
          {myRow?.windowNote && (
            <span className="text-muted" style={{ fontSize: 13 }}>
              {myRow.windowNote}
            </span>
          )}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {myRow?.canEnter && (
              <EnterButton eventId={myRow.eventId} href={myRow.registrationHref} style={{ flex: "1 1 160px" }} />
            )}
            <Link className="btn btn-secondary" href="/me/board" style={{ flex: "1 1 160px" }}>
              See the board <Icon name="arrow-right" />
            </Link>
          </div>
        </section>
      )}

      {/**
       * YOUR CARD, HUNG ON THE BOARD (design D, 2026-09-19). The round as
       * eighteen tiles — ringed red under par, boxed over — with the same one
       * button and the same words as before: the action comes from
       * `cardState`, so "Finish my card" is never offered over a signed,
       * complete card, and the hole number is added, never substituted.
       */}
      {hero && (
        <ScoreboardCard
          headline={`YOUR CARD · ${(standing?.scoreLabel ?? (card ? `${card.filled} in` : "Not started")).toUpperCase()}`}
          total={standing?.scoreText || "–"}
          tiles={strokes.map((s, i) => ({
            n: i + 1,
            stroke: s ?? null,
            // No real card, no mark: a score is never called a birdie
            // against a placeholder par.
            mark: tileMark(s, roundCard.known ? roundCard.card.pars[i] : undefined),
            next: card !== null && cardState.action === "Finish my card" && next === i + 1,
          }))}
          action={
            !card || cardState.action
              ? {
                  href: "/me/card",
                  label: !card
                    ? "Start my card"
                    : cardState.action === "Finish my card" && next !== null
                      ? `${cardState.action} · hole ${next}`
                      : cardState.action,
                }
              : null
          }
          // The card's state only: "thru 9" is already the panel's headline
          // and the tiles show which holes are in, so "9 of 18 holes in" was
          // the same fact a third time.
          footer={card ? cardState.label : "Nothing returned yet."}
        />
      )}

      {/* A player whose round is scored for them — a match or a team round —
          keeps the cards this screen always had.

          `round` as well, since 2026-09-20: a tournament whose organizer has
          added no rounds landed here too, and every panel inside promises one.
          A confirmed entrant of a brand-new Captain's Day was shown "Not
          started · Your position and score appear here as soon as the first
          hole goes in" and "your score is recorded against your opponent" —
          two futures and an opponent, for a tournament with nothing in it.
          The organizer's half of this is #518. */}
      {me.playerId && round && !hero && (
        <>
          {/* YOUR SIDE'S ROUND, which on a team day is your round.
              Above the "not started" panel and in place of it: a player whose
              side has a card has started, whatever the individual table says,
              and this screen used to tell them otherwise. */}
          {mySide && (
            <section className="card elev-sm" style={{ marginTop: 18 }}>
              <span className="card-kicker">
                {mySide.played > 0 ? "Your side" : "Your side · not started"}
              </span>
              <div style={{ marginTop: 6, fontSize: 15, fontWeight: 600 }}>{mySide.name}</div>
              <div className="text-muted" style={{ fontSize: 12.5, marginTop: 2 }}>
                {mySide.members.join(" · ")}
              </div>
              {mySide.played > 0 ? (
                <p style={{ margin: "8px 0 0", fontSize: 13.5, lineHeight: 1.6 }}>
                  {mySide.played >= holes ? "Round complete" : `Thru ${mySide.played}`} ·{" "}
                  {isStablefordRound(roundStage?.scoringBasis, roundStage?.format)
                    ? `${mySide.points} points`
                    : `${mySide.gross} gross, ${mySide.net} net`}
                  {myPlace
                    ? ` · ${placeLabel(myPlace)} of ${sidesThisRound.length} sides`
                    : ""}
                </p>
              ) : (
                <p className="text-muted" style={{ margin: "8px 0 0", fontSize: 13.5, lineHeight: 1.6 }}>
                  Your side&rsquo;s card hasn&rsquo;t been started yet.
                </p>
              )}
              {/* Where the rest of the field is. The board has the sides now. */}
              <Link className="btn btn-secondary" href="/me/board" style={{ marginTop: 10 }}>
                See every side <Icon name="arrow-right" />
              </Link>
            </section>
          )}
          {!standing && !mySide && !round?.matches.length && (
            <section className="card elev-sm" style={{ marginTop: 18 }}>
              <span className="card-kicker">Not started</span>
              <p style={{ margin: "6px 0 0", fontSize: 13.5, lineHeight: 1.5 }} className="text-muted">
                Your position and score appear here as soon as the first hole goes in.
              </p>
            </section>
          )}
          {standing && (
            <section
              className="card elev-sm"
              style={{ marginTop: 18, display: "flex", flexDirection: "row", alignItems: "center", gap: 18 }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11.5, color: "var(--color-neutral-400)", fontWeight: 600 }}>
                  {standing.position ? "Position" : standing.thru > 0 ? "Not ranked" : "Not started"}
                </div>
                <div style={{ fontFamily: "var(--font-heading)", fontSize: 40, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
                  {standing.position || "–"}
                </div>
                {standing.record && (
                  <div style={{ fontSize: 12.5, color: "var(--color-neutral-400)", marginTop: 3 }}>{standing.record}</div>
                )}
                {standing.note && (
                  <div style={{ fontSize: 11.5, color: "var(--color-neutral-400)", marginTop: 5, lineHeight: 1.5 }}>
                    {standing.note}
                  </div>
                )}
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 11.5, color: "var(--color-neutral-400)", fontWeight: 600 }}>
                  {standing.scoreLabel ?? "Not started"}
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-heading)",
                    fontSize: 40,
                    lineHeight: 1,
                    fontVariantNumeric: "tabular-nums",
                    color: standing.toPar < 0 ? "var(--color-accent-2-300)" : "var(--color-text)",
                  }}
                >
                  {standing.scoreText || "–"}
                </div>
              </div>
            </section>
          )}
          {round?.matches.map((m, i) => (
            <section key={i} className="card elev-sm" style={{ marginTop: 12 }}>
              <span className="card-title" style={{ fontSize: 14 }}>
                {round.matches.length > 1 ? `Match ${i + 1} — ` : ""}v {m.opponent}
              </span>
              <p
                style={{
                  margin: "4px 0 0",
                  fontFamily: "var(--font-heading)",
                  fontSize: 22,
                  lineHeight: 1.2,
                  color: m.ahead ? "var(--color-accent-2-300)" : "var(--color-text)",
                }}
              >
                {m.state}
              </p>
              {m.notStarted && (
                <p className="text-muted" style={{ margin: "4px 0 0", fontSize: 13, lineHeight: 1.5 }}>
                  Nothing recorded yet — it appears here hole by hole as it goes in.
                </p>
              )}
            </section>
          ))}
          {/**
           * AND WHETHER IT IS IN, which this promised without ever checking.
           *
           * The sentence ended "it appears on the board as soon as it's in" on
           * every round of this shape — including, four inches under a panel
           * reading "Round complete · 35 gross, 26 net · 5th of 8 sides", the
           * one where it plainly already had. A sentence that is true before
           * the round and false after it is one nobody can act on, which is
           * the same fault `/me/card` was fixed for on 2026-09-20; this is its
           * sibling on Today, found the same evening by walking the seeded
           * club's away round as a player.
           *
           * It also named BOTH shapes at once — "a match is recorded against
           * your opponent, and a team round on your side's card" — on a round
           * that is only ever one of them. `mySide` says which.
           */}
          <section className="card elev-sm" style={{ marginTop: 12 }}>
            <span className="card-title" style={{ fontSize: 14 }}>Your card</span>
            <p style={{ margin: "4px 0 0", fontSize: 14, lineHeight: 1.6, color: "var(--color-neutral-400)" }}>
              {yourCardNote({ side: mySide, holes, round: !!round })}
            </p>
          </section>
        </>
      )}

      {/**
       * WHERE I STAND, ON THE LEADERS BOARD. The top five and the player,
       * from `standingRows` — the Board tab's own rows — and only where the
       * Board tab would show them: the club has published standings, and the
       * round ranks individuals. The qualifier ("2 of 4 cards in — these
       * standings will change") is printed under the board it qualifies.
       */}
      {leaders.length > 0 ? (
        <ScoreboardLeaders rows={leaders} note={standing?.note || standing?.record || ""} />
      ) : (
        hero &&
        standing && (
          <Link
            href="/me/board"
            className="card elev-sm"
            style={{
              marginTop: 12,
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              gap: 14,
              textDecoration: "none",
              color: "var(--color-text)",
            }}
          >
            <span style={{ fontFamily: "var(--font-heading)", fontSize: 30, lineHeight: 1, minWidth: 48, fontVariantNumeric: "tabular-nums" }}>
              {standing.position || "–"}
            </span>
            <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>
                {standing.position ? "On the board" : standing.thru > 0 ? "Not ranked yet" : "Not started"}
              </span>
              {(standing.note || standing.record) && (
                <span className="text-muted" style={{ fontSize: 12.5, lineHeight: 1.45 }}>
                  {standing.note || standing.record}
                </span>
              )}
            </span>
            <Icon name="arrow-right" />
          </Link>
        )
      )}

      {/* Who I go off with. The question every player asks first. */}
      {me.playerId && round?.group && (
        <section
          className="card elev-sm"
          style={{ marginTop: 12, display: "flex", flexDirection: "row", alignItems: "center", gap: 12 }}
        >
          {round.group.partners.length > 0 && (
            <span aria-hidden="true" style={{ display: "flex", flex: "none" }}>
              {round.group.partners.slice(0, 3).map((p, i) => (
                <span
                  key={i}
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: "50%",
                    display: "grid",
                    placeItems: "center",
                    fontSize: 12,
                    fontWeight: 600,
                    background: "var(--color-surface-2)",
                    border: "2px solid var(--color-surface)",
                    marginLeft: i === 0 ? 0 : -8,
                  }}
                >
                  {initialsOf(p)}
                </span>
              ))}
            </span>
          )}
          <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>
              {[round.group.name || "Your group", round.group.time].filter(Boolean).join(" · ")}
            </span>
            <span className="text-muted" style={{ fontSize: 13, lineHeight: 1.45 }}>
              {round.group.partners.length ? `With ${round.group.partners.join(", ")}` : "Playing on your own."}
              {round.group.startHole > 1 ? ` · starting on hole ${round.group.startHole}` : ""}
            </span>
          </span>
        </section>
      )}

      {/* The rest of what the club posted, under the player's own round. */}
      {announcements.some((a) => !a.pinned) && (
        <div style={{ marginTop: 12 }}>
          <AnnouncementList items={announcements.filter((a) => !a.pinned)} />
        </div>
      )}

      {/* The club's tournaments and a casual round used to be two rows here.
          Both live on the Events tab now (player-nav.ts), one tap from
          anywhere — a row on Today was a second way to the same place. */}

      {/* Am I playing, and when — the calendar, unchanged. */}
      {me.playerId && availability.playerId && (
        <div style={{ marginTop: 12 }}>
          <RoundAvailability
            playerId={availability.playerId}
            next={availability.next}
            future={availability.future}
            past={availability.past}
            captainOf={availability.captainOf}
            asksPlayer={availability.asksPlayer}
            today={todayIso()}
          />
        </div>
      )}
    </div>
  );
}
