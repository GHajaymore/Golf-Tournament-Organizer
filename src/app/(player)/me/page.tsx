import Link from "next/link";
import { redirect } from "next/navigation";
import { screenMetadata } from "@/lib/screen-metadata";
import { requireSession } from "@/lib/page-helpers";
import { loadEventState, settingsOf } from "@/lib/services/tournament";
import { allowsAutoConfirm } from "@/lib/tournament-settings";
import { cardStanding } from "@/lib/domain/card-approval";
import { announcementsFor } from "@/lib/services/announcements";
import { AnnouncementList } from "@/components/AnnouncementList";
import { PushToggle } from "@/components/PushToggle";
import { meFor } from "@/lib/services/me";
import { availabilityFor } from "@/lib/services/availability";
import { RoundAvailability } from "@/components/RoundAvailability";
import { todayIso } from "@/lib/deadline";
import { Icon } from "@/components/Icon";
import { teamStandings } from "@/lib/services/teams";
import { placesByValue, placeLabel } from "@/lib/domain/flight-places";
import { weekBasis, valueOnBasis, isStablefordRound } from "@/lib/domain/week-basis";
import { roundKicker, roundLabel } from "@/lib/domain/round-label";
import { hasStandingToShow } from "@/lib/domain/player-standing";
import { yourCardNote, yourCardShort } from "@/lib/domain/your-card";
import { myTieLine } from "@/lib/domain/my-tie";
import { recordBetween } from "@/lib/services/head-to-head";
import { yourHistory } from "@/lib/domain/head-to-head";
import { ReportTie } from "@/components/ReportTie";
import { EnterButton } from "@/components/EnterButton";
import { RoundExpiryBanner } from "@/components/RoundExpiryBanner";
import { expiryNotice, expiryShort, hoursLeft } from "@/lib/domain/round-expiry";
import { notInItWords, signsCards } from "@/lib/tournament-shape";
import { isStraightKnockout } from "@/lib/stage-types";
import { casualKeepRefusalFor } from "@/lib/services/close-terms";
import { nextHoleToPlay } from "@/lib/domain/next-hole";
import { standingRows } from "@/lib/services/tournament";
import { canSeeLeaderboard } from "@/lib/tournament-settings";
import { boardKind } from "@/lib/formats";
import { holesPlayed } from "@/lib/domain/handicap";
import { rankedScore, unitIsNet } from "@/lib/domain/ranked-score";
import { boardNames, positionLabel, thruTile, leadersWithYou, tileMark, heroHeadline } from "@/lib/domain/scoreboard";
import { roundCardFor } from "@/lib/services/round-card";
import { ScoreboardCard, ScoreboardLeaders, type LeaderTile } from "@/components/Scoreboard";
import { standingLabels } from "@/lib/domain/standing-labels";
import { clubEventsFor } from "@/lib/services/club-events";
import { isWatching, isWaiting } from "@/lib/domain/tournament-switcher";
import { golfTermsForEvent } from "@/lib/services/organization";
import { isFinished } from "@/lib/domain/lifecycle-state";
import { firstHoleOf, holeNumber, startHoleNumber } from "@/lib/domain/hole-number";
import { playWithFor } from "@/lib/services/pairing";
import { PlayWithPicker } from "@/components/PlayWithPicker";
import { MoreInfo } from "@/components/MoreInfo";
import { MyCup } from "@/components/MyCup";
import { cupBoard, TEAM_SESSION } from "@/lib/services/cup";
import { canEnterScores } from "@/lib/tournament-settings";
import { clubCommitmentsFor } from "@/lib/services/club-calendar";
import { weekAhead } from "@/lib/domain/club-calendar";
import { dayInWords } from "@/lib/domain/round-dates";
import { formattingForEvent } from "@/lib/services/organization";
import { enterTournament } from "@/app/actions/auth";
import { namedAfterPlayers } from "@/lib/domain/side-name";

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
  // The club's own golf words — organizer or organiser (`golf-terms.ts`).
  const terms = await golfTermsForEvent(session.eventId);
  /**
   * The events-list row for this tournament — the same one the switcher above
   * reads, memoised for the request — so "watching" and the way in agree with
   * the header and with the list.
   */
  const myRow = (await clubEventsFor(session.email)).find((r) => r.eventId === session.eventId) ?? null;
  const isStaff = session.role === "admin" || session.role === "assistant";
  // Only a casual round has an expiry to keep; asked only then.
  const keepRefusal = hoursLeft(state.event) === null ? null : await casualKeepRefusalFor(state.event.id);
  /**
   * DISQUALIFIED (2026-10-08). They have a row in this event, so "You aren't
   * in this tournament" would be false — the rule `verify-player-states`
   * asserts — and "You're watching this one" would offer them the door back
   * in. They are told the ruling, and pointed at the committee.
   */
  const ruledOut = !me.playerId && !isStaff && !!myRow?.disqualified;
  const watching = !me.playerId && !ruledOut && isWatching(myRow, isStaff);
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

  /**
   * A TEAM CUP. Its sessions are rounds, but a player's day is their matches
   * across them — the score, and who they play with and against — so the cup
   * card leads and the round-shaped panels below (a side's card, a pairing
   * request the captains have already answered) stand aside. See `MyCup`.
   */
  const cupResult = state.stages.some((s) => s.type === TEAM_SESSION) ? await cupBoard(session.eventId) : null;
  const cup = cupResult?.ok ? cupResult.board : null;

  const round = me.round;
  const card = round?.card ?? null;
  /** This player's record against the opponent in the tie they are about to play. */
  const tieHistory =
    me.playerId && round?.tie?.state === "to-play" && round.tie.opponentId
      ? await recordBetween(state.event.organizationId, me.playerId, round.tie.opponentId)
      : null;
  /**
   * The pairing-request card, while there is still a draw to ask of: entered,
   * no group on a published sheet yet, nothing on the card, and the tournament
   * not over. Null otherwise, and for a field of one.
   */
  const playWithData =
    me.playerId && !cup && !round?.group && !card?.filled && !isFinished(state.event.status)
      ? await playWithFor(session.eventId, me.playerId)
      : null;
  const playWith = playWithData && playWithData.others.length > 0 ? playWithData : null;
  /**
   * Whether a committee is going to look at this card, from the round's own
   * setting. `cardStanding` carries the whole reason; the short version is
   * that a card stops at "certified" when nobody approves cards, and this
   * screen was calling that state unfinished, in grey, forever.
   */
  const cardState = cardStanding(
    card?.status ?? "entered",
    !allowsAutoConfirm(settingsOf(state.event)),
    // Every hole in: the step left is signing, not finishing.
    !!card && (round?.holes ?? 0) > 0 && card.filled >= (round?.holes ?? 0),
    signsCards(state.event.shape),
  );
  /**
   * MOVED ON TO THE NEXT ROUND (2026-10-09, grid cell T66). Once the committee
   * closes the round on the board, `meFor` hands the player the next open
   * round — but the standing is still the board's, after the closed round. So
   * its note ("The committee has closed this round") must name that round, or
   * it reads as Round 2 closed under a Round 2 heading; and the card headline
   * must not wear the closed round's "FINAL · GROSS E" over an empty card.
   */
  const movedOn = !!round && !!state.boardStage && round.stageId !== state.boardStage.id;
  /**
   * A CARD WITH NOTHING ON IT IS NOT A CARD IN PROGRESS (grid cell T66e).
   * Making a cut gives every survivor a blank card for the next round, and a
   * card that merely EXISTS read "FINISH MY CARD · HOLE 1 · Entered, not yet
   * certified" — nothing had been entered. Until a hole is in, it reads like
   * no card at all: "Start my card", "Nothing returned yet."
   */
  const blankCard = !card || card.filled === 0;
  /**
   * The card panel speaks for THIS round's card. Moved on, or nothing on it
   * yet, it must not wear the tournament standing's label and total: Round 2
   * under way read "YOUR CARD · FINAL · GROSS E" over a player's empty Round 2
   * card (grid cell T67) — the "Final" was their Round 1.
   */
  const freshCard = movedOn || blankCard;
  const standingBase = hasStandingToShow(me.standing) ? me.standing : null;
  const standing =
    movedOn && standingBase
      ? { ...standingBase, note: `${roundLabel(state.stages, state.boardStage!.id)} is closed — these standings are after it.` }
      : standingBase;

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
  // The side's round, closed by the committee — see the side card (T51).
  const sideRoundClosed = roundStage?.closedAt != null;
  const roundCard = await roundCardFor(state, roundStage, holes);
  /** 10 on a back nine, so the tiles and "Finish my card · hole N" read the course's holes. */
  const todayFirstHole = roundCard.known ? firstHoleOf(roundCard.card) : 1;

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
    boardKind(boardStage.format) === "standard" &&
    // A straight knockout ranks nobody — the draw is the standings, and Board
    // shows it. See `isStraightKnockout`.
    !isStraightKnockout(state.stages)
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
  /** My side's players, with me as "You" — matched by id, never by name. */
  const sidePlayers = mySide ? mySide.members.map((n, i) => (mySide.memberIds[i] === me.playerId ? "You" : n)) : [];
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

  /**
   * ONE SCREEN, THEN MORE (Ajay, 2026-10-06). Today answers the moment — the
   * round, the group, whether you're playing, where you stand, what you have
   * on this week — and everything a player only sometimes wants sits behind
   * one labelled extender at the bottom. What decides each placement:
   *
   *   In / Out        on the screen until the round is under way: before it,
   *                   "are you playing Friday" IS the moment; once the card
   *                   has holes, the season's weeks are not.
   *   Leaders         on the screen only for somebody with no card of their
   *                   own (watching, waiting) — for them the board is the
   *                   content. A player with a card gets one position line,
   *                   and the table behind More.
   *   This week       the player's rounds in their OTHER tournaments over the
   *                   next seven days — Today is one tournament, and "what
   *                   have I got on" is not.
   */
  const today = todayIso();
  const { locale } = await formattingForEvent(state.event.id);
  const thisWeek = weekAhead(await clubCommitmentsFor(session.email), today, session.eventId);
  /**
   * IS THE ROUND UNDER WAY — for THIS player, whatever shape it is. Their own
   * card has holes in, or their side's card does (a four-ball or foursomes
   * player owns no card), or one of their matches has started. One reading,
   * so the In / Out question and the group card leave the screen together.
   */
  const roundUnderWay =
    (card?.filled ?? 0) > 0 || (mySide?.played ?? 0) > 0 || (round?.matches ?? []).some((m) => !m.notStarted);
  const availabilityShown = Boolean(me.playerId && availability.playerId);
  const availabilityOnScreen = availabilityShown && Boolean(availability.next) && !roundUnderWay;
  const leadersOnScreen = !hero;

  const shown = leadersWithYou(boardRows, me.playerId ?? "", 5);
  const shownNames = boardNames(shown.map((s) => s.row.name));
  const isStableford = isStablefordRound(boardStage?.scoringBasis, boardStage?.format);
  const leaders: LeaderTile[] = shown.map(({ row, gap }, i) => ({
    id: row.id,
    pos: positionLabel(row, boardRows),
    name: shownNames[i],
    // A match board has no "thru": every row read "not started" aloud,
    // including a player three matches up (grid cell T50).
    thru: state.boardIsStroke ? thruTile(row, holesPlayed(boardStage?.holes)) : "",
    absent: !!row.absent,
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

  /**
   * WHO I GO OFF WITH, AND WHEN — the first-tee question. Leading the screen
   * before the round; under More once it is under way (`roundUnderWay`),
   * because a player on the course is standing with their group (the design
   * table, 2026-10-06: during the round the summary is the card and the
   * position).
   */
  const groupCard =
    me.playerId && round?.group ? (
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
                    fontSize: 13,
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
            <span style={{ fontSize: 16, fontWeight: 600 }}>
              {[round.group.name || "Your group", round.group.time].filter(Boolean).join(" · ")}
            </span>
            <span className="text-muted" style={{ fontSize: 14, lineHeight: 1.45 }}>
              {round.group.partners.length ? `With ${round.group.partners.join(", ")}` : "Playing on your own."}
              {round.group.startHole > 1 ? ` · starting on hole ${round.group.startHoleNumber}` : ""}
            </span>
          </span>
        </section>
    ) : null;
  const groupOnScreen = !roundUnderWay;

  const expiry = expiryNotice(hoursLeft(state.event), isStaff, keepRefusal);

  /** The In / Out card — on the screen or under More, never both. */
  const availabilityCard = availabilityShown ? (
    <div style={{ marginTop: 12 }}>
      <RoundAvailability
        playerId={availability.playerId}
        next={availability.next}
        future={availability.future}
        past={availability.past}
        captainOf={availability.captainOf}
        asksPlayer={availability.asksPlayer}
        today={today}
        compact
      />
    </div>
  ) : null;
  /**
   * The extender NAMES what is in it — "More: Leaders · Your rounds" — so a
   * player knows whether it is worth opening. With nothing to name it is not
   * drawn at all: an extender that opens onto nothing is worse than none.
   */
  const moreParts = [
    !groupOnScreen && groupCard ? "Your group" : "",
    !leadersOnScreen && leaders.length > 0 ? "Leaders" : "",
    availabilityShown && !availabilityOnScreen ? "Your rounds" : "",
    playWith ? "Playing partners" : "",
  ].filter(Boolean);
  const moreLabel = `More: ${moreParts.join(" · ")}`;

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
        {/* A cup is played across its sessions, so it is headed by the cup,
            not by whichever session the tournament calls current. */}
        {[cup && me.playerId ? "Your cup" : round ? roundKicker(round.label, round.name) : "Today", round?.venue]
          .filter(Boolean)
          .join(" · ")}
      </h1>

      {/**
       * A casual round is deleted about a day after it is set up, and the whole
       * justification for that being acceptable is that the people it belongs
       * to are told before it happens. `canKeep` follows `keepRound`'s own
       * guard, which is staff: a player is told the remedy they actually have,
       * and whoever SET THE ROUND UP — who lands here too, playing in it — gets
       * the button. Hard-coded false, it told them to "ask whoever set it up to
       * keep it", which was themselves (walked 2026-09-27). `hoursLeft` is null
       * for every tournament, so nothing mounts outside a casual round.
       */}
      {/* Only with a notice to show: an empty wrapper still took 12px under
          the heading on every Today (measured 2026-10-06). */}
      {expiry && (
        <div style={{ marginTop: 12 }}>
          {/* One line, the full sentence behind its ⓘ — the same words as the
              round's own screen (`CasualRoundScreen`), so one warning reads one
              way wherever it is met. */}
          <RoundExpiryBanner
            notice={expiry}
            short={expiryShort(hoursLeft(state.event), isStaff)}
            canKeep={isStaff}
            keepRefusal={keepRefusal}
          />
        </div>
      )}

      {/**
       * PINNED NOTICES STAY ABOVE THE ROUND. `/announcements` promises the
       * organizer that "Pinned posts sit at the top of every player's
       * dashboard", and pinning is the organizer saying this one outranks
       * everything — a frost delay. Unpinned posts sit under the round.
       */}
      {announcements.some((a) => a.pinned) && (
        <div style={{ marginTop: 12 }}>
          <AnnouncementList items={announcements.filter((a) => a.pinned)} lineOnceRead />
        </div>
      )}

      {cup && me.playerId && (
        <MyCup board={cup} meId={me.playerId} canScore={canEnterScores(settingsOf(state.event), session.viewRole)} />
      )}

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
        <section aria-label="Nothing to play yet" className="card elev-sm" style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
          <span className="card-title">You&rsquo;re in — nothing to play yet</span>
          {/* "No round to play" rather than "the organizer hasn't added one":
              this branches on `me.round`, which is null when there is no
              PLAYABLE round, and stages that are not playing rounds would make
              the stronger sentence an overclaim. Say what the gate knows. */}
          <MoreInfo short="Your card and the board appear here once there's a round.">
            Your entry is confirmed. There&rsquo;s no round to play in this tournament yet, so
            there&rsquo;s no card and no board — both appear here as soon as there is one.
          </MoreInfo>
          {myRow?.windowNote && (
            <span className="text-muted" style={{ fontSize: 13 }}>
              {myRow.windowNote}
            </span>
          )}
        </section>
      )}

      {/* Awaiting approval is a kind of waiting with different words — see
          `awaitingIn` in club-events.ts. */}
      {waiting && myRow?.awaiting && (
        <section aria-label="Awaiting approval" className="card elev-sm" style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
          <span className="card-title">Your entry is awaiting approval</span>
          <MoreInfo short="No card until it's approved.">
            The {terms.organizer} approves each entry to this tournament, and yours is with them. There&rsquo;s
            no card until it&rsquo;s approved — the board, the groups and the notices are all open to read.
          </MoreInfo>
        </section>
      )}

      {waiting && !myRow?.awaiting && (
        <section aria-label="Waiting list" className="card elev-sm" style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
          <span className="card-title">You&rsquo;re on the waiting list</span>
          <MoreInfo short="No card until a place opens up.">
            Your name is down and the {terms.organizer} will confirm your place if one opens up. There&rsquo;s
            no card until then — the board, the groups and the notices are all open to read.
          </MoreInfo>
          {myRow?.placesNote && (
            <span className="text-muted" style={{ fontSize: 13 }}>
              {myRow.placesNote}
            </span>
          )}
        </section>
      )}

      {ruledOut && (
        <section aria-label="Disqualified" className="card elev-sm" style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
          <span className="card-title">You were disqualified from this tournament</span>
          <MoreInfo short={`The ${terms.organizer} has the reason.`}>
            The committee ruled you out of this competition, so there&rsquo;s no card or place for you here. If
            you think that&rsquo;s wrong, speak to the {terms.organizer} — they can reinstate you. The board is
            still open to read.
          </MoreInfo>
        </section>
      )}

      {!me.playerId && !watching && !waiting && !ruledOut && (
        <MoreInfo short={`${notInItWords(state.event.shape)}.`} style={{ marginTop: 12 }}>
          So there&rsquo;s no card here. The board is still open on the next tab.
        </MoreInfo>
      )}

      {/**
       * WATCHING — a member looking at one of the club's tournaments they are
       * not in, reached from the switcher or the events list. Said once, here,
       * in words: everything is theirs to read and nothing is theirs to change,
       * and if the door is open, this is where it is.
       */}
      {watching && (
        <section aria-label="Watching" className="card elev-sm" style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
          {/* Withdrew (2026-10-08, grid cell T45): they WERE entered, and a
              row kept for its score or money — so "You aren't entered" would
              be false, the rule `verify-player-states` asserts. */}
          <span className="card-title">
            {myRow?.withdrew ? "You withdrew from this tournament" : <>You&rsquo;re watching this one</>}
          </span>
          <MoreInfo
            short={myRow?.withdrew ? "There's no card for you — the board is open to read." : "You aren't entered — the board is open to read."}
          >
            {myRow?.withdrew ? <>You withdrew</> : <>You aren&rsquo;t entered</>}, so there&rsquo;s no card for you
            here. The board, the groups and the notices are all open to read.
          </MoreInfo>
          {myRow?.windowNote && (
            <span className="text-muted" style={{ fontSize: 13 }}>
              {myRow.windowNote}
            </span>
          )}
          {myRow?.canEnter && (
            <EnterButton eventId={myRow.eventId} href={myRow.registrationHref} organizer={myRow.organizer} waitlistOnly={myRow.waitlistOnly} />
          )}
        </section>
      )}

      {/* BEFORE THE ROUND, WHO AND WHEN COMES FIRST: the group, tee time and
          start hole lead the screen, the card and "Start my card" under them.
          Once the round is under way the group moves to More (`groupOnScreen`). */}
      {groupOnScreen && groupCard}

      {/* The sheet is out and I am not on it — entered after the draw. Said
          plainly, so "not drawn yet" and "left off" are not the same silence;
          in the group's own place, because it is the answer to the same
          question. Not once the round is under way: by then it is answered. */}
      {me.playerId && round?.offSheet && !round.group && !roundUnderWay && (
        <section className="card elev-sm" style={{ marginTop: 12 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>You&rsquo;re not on the tee sheet yet</span>
          <MoreInfo short={`The ${terms.organizer} will add you to a group.`} style={{ marginTop: 4 }}>
            The tee times for this round are out, and you were entered after they were drawn. The{" "}
            {terms.organizer} adds you to a group — check back here, or ask them for your time.
          </MoreInfo>
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
          headline={heroHeadline({
            // Moved on: this card is the new round's, and nothing on it yet —
            // not the closed round's standing (see `movedOn`).
            scoreLabel: freshCard ? undefined : standing?.scoreLabel,
            filled: freshCard ? card?.filled || undefined : card?.filled,
            holesOwed: freshCard ? 0 : (standing?.holesOwed ?? 0),
            thru: freshCard ? 0 : (standing?.thru ?? 0),
            roundHoles: holes,
            tournamentOver: state.event.status === "completed",
          })}
          total={(freshCard ? "" : standing?.scoreText) || "–"}
          tiles={strokes.map((s, i) => ({
            // The course's number — 10-18 on a back nine (`firstHoleOf`).
            n: holeNumber(i, todayFirstHole),
            stroke: s ?? null,
            // No real card, no mark: a score is never called a birdie
            // against a placeholder par.
            mark: tileMark(s, roundCard.known ? roundCard.card.pars[i] : undefined),
            next: card !== null && cardState.action === "Finish my card" && next === i + 1,
          }))}
          action={
            blankCard || cardState.action
              ? {
                  href: "/me/card",
                  label: blankCard
                    ? "Start my card"
                    : cardState.action === "Finish my card" && next !== null
                      ? `${cardState.action} · hole ${startHoleNumber(next, todayFirstHole)}`
                      : cardState.action,
                }
              : null
          }
          // The card's state only: "thru 9" is already the panel's headline
          // and the tiles show which holes are in, so "9 of 18 holes in" was
          // the same fact a third time.
          footer={blankCard ? "Nothing returned yet." : cardState.label}
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
      {me.playerId && round && !hero && !cup && (
        <>
          {/* YOUR SIDE'S ROUND, which on a team day is your round.
              Above the "not started" panel and in place of it: a player whose
              side has a card has started, whatever the individual table says,
              and this screen used to tell them otherwise. */}
          {mySide && (
            <section className="card elev-sm" style={{ marginTop: 12 }}>
              <span className="card-kicker">
                {mySide.played > 0 ? "Your side" : sideRoundClosed ? "Your side · did not play" : "Your side · not started"}
              </span>
              {/* "You & Ravenswoo 2", as the cup card says "You & Bram Blue":
                  the player is one of these names, and reading their own name
                  as if it were a stranger's is the screen not knowing who it
                  is talking to. A side with a name of its own keeps it, and
                  its players are listed under it. */}
              <div style={{ marginTop: 6, fontSize: 15, fontWeight: 600 }}>
                {namedAfterPlayers(mySide.name, mySide.members) ? sidePlayers.join(" & ") : mySide.name}
              </div>
              {!namedAfterPlayers(mySide.name, mySide.members) && (
                <div className="text-muted" style={{ fontSize: 14, marginTop: 2 }}>
                  {sidePlayers.join(" · ")}
                </div>
              )}
              {mySide.played > 0 ? (
                <p style={{ margin: "8px 0 0", fontSize: 14, lineHeight: 1.6 }}>
                  {mySide.played >= holes ? "Round complete" : `Thru ${mySide.played}`} ·{" "}
                  {isStablefordRound(roundStage?.scoringBasis, roundStage?.format)
                    ? `${mySide.points} points`
                    : `${mySide.gross} gross, ${mySide.net} net`}
                  {myPlace
                    ? ` · ${placeLabel(myPlace)} of ${sidesThisRound.length} sides`
                    : ""}
                </p>
              ) : sideRoundClosed ? (
                // Closed with nothing from the side (grid cell T51): no card is
                // coming, so "hasn't been started yet" was a promise.
                <MoreInfo short={`The ${terms.organizer} has closed this round; there's no card from your side.`}>
                  Nothing more can be entered for it. If that&rsquo;s wrong, speak to the {terms.organizer}.
                </MoreInfo>
              ) : (
                // Why it is the SIDE's card sits behind the ⓘ here — this card
                // is the one place Today talks about it (2026-10-06).
                <MoreInfo short="Your side’s card hasn’t been started yet.">
                  {yourCardNote({ side: mySide, holes, round: true, knockout: round?.knockout })}
                </MoreInfo>
              )}
            </section>
          )}
          {/* Not on a round the committee has closed without a card from them:
              no first hole is coming, and the closed-round card below says so
              (grid cell T48). */}
          {!standing && !mySide && !round?.matches.length && !round?.tie && !round?.closedWithout && (
            <section className="card elev-sm" style={{ marginTop: 12 }}>
              <span className="card-kicker">Not started</span>
              <p style={{ margin: "6px 0 0", fontSize: 14, lineHeight: 1.5 }} className="text-muted">
                Your score appears once the first hole goes in.
              </p>
            </section>
          )}
          {standing && (
            <section
              className="card elev-sm"
              style={{ marginTop: 12, display: "flex", flexDirection: "row", alignItems: "center", gap: 18 }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, color: "var(--color-neutral-400)", fontWeight: 600 }}>
                  {standingLabels({ position: standing.position, thru: standing.thru, knockout: round?.knockout }).hero}
                </div>
                <div style={{ fontFamily: "var(--font-heading)", fontSize: 40, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>
                  {standing.position || "–"}
                </div>
                {standing.record && (
                  <div style={{ fontSize: 14, color: "var(--color-neutral-400)", marginTop: 3 }}>{standing.record}</div>
                )}
                {/* Once, under the board it qualifies (2026-10-08). With the
                    Leaders board on this screen too, the same sentence —
                    "This round is all in…", "The committee has closed this
                    round…" — was printed here and again two inches below. */}
                {standing.note && !(leadersOnScreen && leaders.length > 0) && (
                  <div style={{ fontSize: 14, color: "var(--color-neutral-400)", marginTop: 5, lineHeight: 1.5 }}>
                    {standing.note}
                  </div>
                )}
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 13, color: "var(--color-neutral-400)", fontWeight: 600 }}>
                  {standing.scoreLabel ?? "Not started"}
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-heading)",
                    fontSize: 40,
                    lineHeight: 1,
                    fontVariantNumeric: "tabular-nums",
                    color: standing.toPar < 0 ? "var(--color-accent-2-200)" : "var(--color-text)",
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
                  color: m.ahead ? "var(--color-accent-2-200)" : "var(--color-text)",
                }}
              >
                {m.state}
              </p>
              {m.notStarted && (
                <p className="text-muted" style={{ margin: "4px 0 0", fontSize: 13, lineHeight: 1.5 }}>
                  Nothing yet — it fills in hole by hole.
                </p>
              )}
            </section>
          ))}
          {/* A KNOCKOUT'S "WHO AM I PLAYING". `matches` above is empty for a
              bracket round — its results are BracketWinner rows, not Match
              rows — so a player one tie from the final was told their score
              is "recorded against your opponent" and never who that was. */}
          {round?.tie && (
            <section className="card elev-sm" style={{ marginTop: 12 }}>
              <span className="card-kicker">
                {round.tie.state === "to-play" ? "Your tie" : "Your knockout"}
              </span>
              <p style={{ margin: "4px 0 0", fontFamily: "var(--font-heading)", fontSize: 20, lineHeight: 1.25 }}>
                {myTieLine(round.tie)}
              </p>
              {/* HEAD-TO-HEAD — what every golfer asks about the draw. Only
                  before the tie, and only when they have met in a match here. */}
              {tieHistory && (
                <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13, lineHeight: 1.5 }}>
                  {yourHistory(tieHistory, state.event.id)}
                </p>
              )}
              {/* Both players known and no result yet: either may report it,
                  and the organizer approves before the draw moves. */}
              {round.tie.state === "to-play" && round.tie.opponentId && me.playerId && (
                <ReportTie
                  tieKey={round.tie.key}
                  meId={me.playerId}
                  opponentId={round.tie.opponentId}
                  opponent={round.tie.opponent}
                  waiting={round.tieReport}
                  organizer={terms.organizer}
                />
              )}
            </section>
          )}
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
          {/* CUT AFTER THE LAST ROUND, which is not a card to start. This
              screen offered "Start my card" for round 2 to a player the cut
              had left out after round 1 (2026-09-26) — and saving one put
              them back on the board. */}
          {/* A ROUND THE COMMITTEE HAS CLOSED, with nothing of yours on it —
              the cut's shape one step along (2026-10-08). Not "Start my card":
              a closed round is over, and a card saved now would undo the
              committee's close without anybody deciding to. */}
          {round?.closedWithout ? (
            <section className="card elev-sm" style={{ marginTop: 12 }}>
              <span className="card-title" style={{ fontSize: 14 }}>{round.closedWithout} is closed</span>
              <MoreInfo short={`There's no ${round.closedWithout} card from you.`} style={{ marginTop: 4 }}>
                The {terms.organizer} has closed {round.closedWithout}, so nothing more can be entered for it. If
                that&rsquo;s wrong, they can reopen it.
              </MoreInfo>
            </section>
          ) : round?.outThisWeek ? (
            // Out of this league week (2026-10-08). Not "Start my card" under
            // last week's result: they said they can't make it, and the
            // sign-up card on this screen is where they change their mind.
            // When that card is ON this screen for this round it already says
            // so, with the Change button — a second card was the same fact
            // twice (grid cell L3), so this one steps aside.
            availabilityOnScreen && availability.next?.stageId === round.stageId ? null : (
            <section className="card elev-sm" style={{ marginTop: 12 }}>
              {round.closed ? (
                // The week is over and closed (grid cell L4): past tense, and
                // no offer to change an answer that can no longer change.
                <>
                  <span className="card-title" style={{ fontSize: 14 }}>
                    You didn&rsquo;t play {round.outThisWeek}
                  </span>
                  <MoreInfo short={`You were down as not playing, and the ${terms.organizer} has closed it.`} style={{ marginTop: 4 }}>
                    Nothing is owed for a week you sat out.
                  </MoreInfo>
                </>
              ) : (
                <>
                  <span className="card-title" style={{ fontSize: 14 }}>
                    You&rsquo;re not playing {round.outThisWeek}
                  </span>
                  <MoreInfo short="You're down as not playing this week." style={{ marginTop: 4 }}>
                    You&rsquo;re down as not playing {round.outThisWeek}, so there&rsquo;s no card for you this week.
                    Changed your mind? Say you&rsquo;re playing and your card appears here.
                  </MoreInfo>
                </>
              )}
            </section>
            )
          ) : round?.cutOut ? (
            <section className="card elev-sm" style={{ marginTop: 12 }}>
              <span className="card-title" style={{ fontSize: 14 }}>Missed the cut</span>
              <MoreInfo short={`Your ${round.cutOut} score stands on the board.`} style={{ marginTop: 4 }}>
                You didn&rsquo;t make the cut after {round.cutOut}, so there&rsquo;s no {round.name} card for
                you.
              </MoreInfo>
            </section>
          ) : mySide ? null /* The side card above already says where the
              side's card is; a second card saying "This card belongs to your
              side" was the same fact twice (2026-10-06). */ : (
            <section className="card elev-sm" style={{ marginTop: 12 }}>
              <span className="card-title" style={{ fontSize: 14 }}>Your card</span>
              {round && (
                <MoreInfo
                  short={yourCardShort({ side: mySide, holes, round: true, knockout: round.knockout })}
                  style={{ marginTop: 4 }}
                >
                  {yourCardNote({ side: mySide, holes, round: true, knockout: round.knockout })}
                </MoreInfo>
              )}
            </section>
          )}
        </>
      )}

      {/**
       * WHERE I STAND, ON THE LEADERS BOARD. The top five and the player,
       * from `standingRows` — the Board tab's own rows — and only where the
       * Board tab would show them: the club has published standings, and the
       * round ranks individuals. The qualifier ("2 of 4 cards in — these
       * standings will change") is printed under the board it qualifies.
       *
       * On the screen for somebody with no card of their own; a player with a
       * card reads one position line here and the table under More.
       */}
      {leadersOnScreen && leaders.length > 0 && (
        <ScoreboardLeaders
          rows={leaders}
          note={standing?.note || ""}
          title={standingLabels({ position: "", thru: 0, knockout: round?.knockout }).board}
        />
      )}
      {hero &&
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
                {/* Names the number beside it: "On the board" beside a bare
                    "4" did not say the 4 was the player's place. */}
                {standing.position
                  ? standing.flightPlace
                    ? "Your position overall"
                    : "Your position"
                  : standing.thru > 0
                    ? "Not ranked yet"
                    : "Not started"}
              </span>
              {/* And where that leaves them in their own flight, which is what a
                  flighted medal is won on — "2nd in Flight A" (2026-10-08). */}
              {standing.position && standing.flightPlace && (
                <span style={{ fontSize: 14, fontWeight: 600 }}>{standing.flightPlace}</span>
              )}
              {(standing.note || standing.record) && (
                <span className="text-muted" style={{ fontSize: 14, lineHeight: 1.45 }}>
                  {standing.note || standing.record}
                </span>
              )}
            </span>
            <Icon name="arrow-right" />
          </Link>
        )}

      {/* Am I playing, and when — asked as a question until it is answered,
          one line after (`NextRound`). On the screen until the round is under
          way; then it joins the rest of the season under More. */}
      {availabilityOnScreen && availabilityCard}

      {/* What the club posted: new ones in full, read ones folded into
          "N earlier messages" (2026-10-05). */}
      {announcements.some((a) => !a.pinned) && (
        <div style={{ marginTop: 12 }}>
          <AnnouncementList items={announcements.filter((a) => !a.pinned)} foldSeen />
        </div>
      )}

      {/* WHAT ELSE I HAVE ON THIS WEEK — my rounds in my other tournaments,
          each one tap from that tournament's Today (`weekAhead`). */}
      {thisWeek.length > 0 && (
        <section aria-label="This week" style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
          <span className="card-kicker">Also this week</span>
          {/* Three at most: a member in three leagues and a medal is a
              calendar, and the Calendar tab is where a calendar lives. */}
          {thisWeek.slice(0, 3).map((c) => (
            <form key={c.stageId} action={enterTournament.bind(null, c.eventId, "player")}>
              <button
                type="submit"
                className="btn btn-secondary"
                style={{ width: "100%", minHeight: 48, justifyContent: "space-between", textAlign: "left", gap: 10 }}
              >
                <span style={{ minWidth: 0, display: "flex", flexDirection: "column", lineHeight: 1.3 }}>
                  <span style={{ fontWeight: 600 }}>
                    {capitalise(dayInWords(c.playedOn, today, locale))}
                    {c.roundLabel ? ` · ${c.roundLabel}` : ""}
                  </span>
                  <span className="text-muted" style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {c.eventName}
                  </span>
                </span>
                <Icon name="arrow-right" />
              </button>
            </form>
          ))}
          {thisWeek.length > 3 && (
            <Link href="/me/calendar" className="touch-target" style={{ fontSize: 14, fontWeight: 600, color: "var(--color-accent-200)" }}>
              {thisWeek.length - 3} more this week — see your calendar
            </Link>
          )}
        </section>
      )}

      {/* MORE — what a player only sometimes wants, behind one extender that
          names what is in it. Nothing in here needs them to act. */}
      {moreParts.length === 0 ? (
        <div style={{ marginTop: 12 }}>
          <PushToggle />
        </div>
      ) : (
      <details style={{ marginTop: 4 }}>
        <summary
          className="touch-target"
          style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 15, fontWeight: 600, color: "var(--color-accent-200)", listStyle: "none" }}
        >
          <Icon name="caret-down" aria-hidden />
          {moreLabel}
        </summary>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 10 }}>
          {!groupOnScreen && groupCard}
          {!leadersOnScreen && leaders.length > 0 && (
            <ScoreboardLeaders
              rows={leaders}
              note={standing?.note || ""}
              title={standingLabels({ position: "", thru: 0, knockout: round?.knockout }).board}
            />
          )}
          {availabilityShown && !availabilityOnScreen && availabilityCard}
          {/* A pairing request, while there is still a draw to ask of — no
              group on a published sheet yet, and nothing on the card. */}
          {playWith && <PlayWithPicker others={playWith.others} chosen={playWith.chosen} />}
          {/* Tee-time alerts. Self-hiding where push isn't available, one line
              once they are on. */}
          <PushToggle />
        </div>
      </details>
      )}
    </div>
  );
}

/** "tomorrow" → "Tomorrow", for the start of a line. */
function capitalise(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
