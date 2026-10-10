import { handicapsForRound, teesForEvent, teeForPlay } from "@/lib/services/handicaps";
import { screenMetadata } from "@/lib/screen-metadata";
import { redirect } from "next/navigation";
import { isManualFormat, needsTeams, boardKind } from "@/lib/formats";
import { oneCardPerSide } from "@/lib/domain/team-entry";
import { isStablefordRound } from "@/lib/domain/week-basis";
import { roundIsStroke } from "@/lib/stage-types";
import { requireSession } from "@/lib/page-helpers";
import { loadEventState, settingsOf } from "@/lib/services/tournament";
import { canEnterScores, mayReportPartialCard, allowsAutoConfirm } from "@/lib/tournament-settings";
import { holeStrokesReceived, allocationHoles } from "@/lib/domain";
import { meFor } from "@/lib/services/me";
import { cardBrand, golfTermsForEvent } from "@/lib/services/organization";
import { NO_CARD_REVISION } from "@/lib/domain/pending-card";
import { PlayerCard } from "@/components/PlayerCard";
import { DistanceUnitProvider } from "@/components/DistanceUnitProvider";
import { partnerCardsFor } from "@/lib/services/group-cards";
import { roundCardFor } from "@/lib/services/round-card";
import { teamStandings } from "@/lib/services/teams";
import { CardTrustNote } from "@/components/CardTrustNote";
import { WayForward } from "@/components/WayForward";
import { MoreInfo } from "@/components/MoreInfo";
import { hasStandingToShow } from "@/lib/domain/player-standing";
import { TEAM_SESSION } from "@/lib/services/cup";
import { clubEventsFor } from "@/lib/services/club-events";
import { isWaiting } from "@/lib/domain/tournament-switcher";
import { parsePinSheet } from "@/lib/domain/pin-sheet";
import { firstHoleOf } from "@/lib/domain/hole-number";
import { notInItWords, signsCards } from "@/lib/tournament-shape";

export const metadata = screenMetadata("/me/card");

/**
 * My card — one player, one round, one hole at a time.
 *
 * The console's score entry can enter anyone's card and switch between tee
 * groups, because an organizer legitimately does both. A player entering
 * their own round needs neither, and every control that offers them is one
 * more thing to get wrong on a phone. So this is the same HoleByHoleCard with
 * the field of one.
 *
 * The tournament's own setting still decides whether players may report at
 * all — and the save action enforces it independently, because hiding a
 * screen stops nobody from calling the action.
 */
export default async function PlayCardPage() {
  const session = await requireSession();
  const state = await loadEventState(session.eventId);
  if (!state) redirect("/");

  const settings = settingsOf(state.event);
  const me = await meFor(state, session.email);
  // The club's mark for the head of the card. Same reader every other card in
  // the app uses, so no two of them can disagree about the club's name.
  const brand = await cardBrand(session.eventId);
  // The club's own golf words — organizer or organiser (`golf-terms.ts`).
  const terms = await golfTermsForEvent(session.eventId);

  if (!me.playerId || !me.round) {
    /**
     * WHY there is no card, which is not one answer but two.
     *
     * `me.playerId` is null for a waitlisted entry by design — `myPlayerIds`
     * asks for `confirmed`, and a card must never reach somebody without a
     * place. This screen then told an applicant "You aren't entered", the same
     * words it says to a stranger, while the events list was telling them they
     * were on the list. Same fault as Today's, on the screen they would open
     * next. See `isWaiting`.
     */
    const myRow = (await clubEventsFor(session.email)).find((r) => r.eventId === session.eventId) ?? null;
    const isStaff = session.role === "admin" || session.role === "assistant";
    const onTheList = isWaiting(myRow, isStaff);
    return (
      <div>
        <h1 style={{ fontFamily: "var(--font-heading)", fontSize: 22, margin: 0 }}>My card</h1>
        <p style={{ marginTop: 10, fontSize: 14.5, lineHeight: 1.6, color: "var(--color-neutral-400)" }}>
          {me.playerId ? (
            /**
             * ENTERED, AND THERE IS NO ROUND. The condition above is
             * `!me.playerId || !me.round`, so a confirmed entrant of a
             * tournament whose organizer has added no rounds fell through it
             * and was told they were not entered — which is the one thing on
             * this screen they can check, and it was false. Measured on the
             * seeded club's Captain's Day: 18 confirmed entrants, no rounds.
             */
            <>
              Your entry is confirmed. There&rsquo;s no round to play in this tournament yet, so
              there&rsquo;s no card to fill in — it appears here as soon as there is one.
            </>
          ) : onTheList && myRow?.awaiting ? (
            <>
              Your entry is with the {terms.organizer} to approve, so there&rsquo;s no card yet. It appears
              here once your entry is approved and there&rsquo;s a round to play.
            </>
          ) : onTheList ? (
            <>
              You&rsquo;re on the waiting list for this tournament, so there&rsquo;s no card yet. The{" "}
              {terms.organizer} will confirm your place if one opens up.
            </>
          ) : !isStaff && myRow?.disqualified ? (
            // Disqualified (2026-10-08): they have a row, so "not in it" would
            // be false — the ruling is what they are told, as on Today.
            <>
              You were disqualified from this tournament, so there&rsquo;s no card for you. Speak to the{" "}
              {terms.organizer} if you think that&rsquo;s wrong.
            </>
          ) : !isStaff && myRow?.withdrew ? (
            // Withdrew (2026-10-08, grid T45): entered once, so not "not in it".
            <>You withdrew from this tournament, so there&rsquo;s no card for you.</>
          ) : (
            // The same sentence Today says, in the words of what this is.
            <>{notInItWords(state.event.shape)}, so there&rsquo;s no card to fill in.</>
          )}
        </p>
        <WayForward
          links={[
            { href: "/me/events", label: "What my club has on", icon: "calendar-dots" },
            { href: "/me/board", label: "See the board", icon: "ranking" },
          ]}
        />
      </div>
    );
  }

  /**
   * CUT AFTER THE ROUND BEFORE — no card to fill in, and the server refuses
   * one anyway (`assertMayKeepCard`). Said before the scoring pad is built,
   * because an 18-box grid with "Certify my card" under it is an invitation.
   */
  if (me.round.cutOut) {
    return (
      <div>
        <h1 style={{ fontFamily: "var(--font-heading)", fontSize: 22, margin: 0 }}>My card</h1>
        <p style={{ marginTop: 10, fontSize: 14.5, lineHeight: 1.6, color: "var(--color-neutral-400)" }}>
          You didn&rsquo;t make the cut after {me.round.cutOut}, so there&rsquo;s no {me.round.name} card
          for you.{" "}
          {hasStandingToShow(me.standing)
            ? `Your ${me.round.cutOut} score stands on the board.`
            : `No ${me.round.cutOut} card was returned for you.`}
        </p>
        <WayForward
          links={[
            { href: "/me/board", label: "See the board", icon: "ranking" },
            { href: "/me", label: "Back to today", icon: "flag" },
          ]}
        />
      </div>
    );
  }

  /**
   * CLOSED WITH NOTHING FROM THEM (2026-10-08, grid cell T48). The committee
   * closed the round and this player returned no card. The page offered an
   * empty 18-hole pad that `assertRoundOpen` refuses on the first save — a
   * card nobody can hand in. Today already says it; this says the same.
   */
  if (me.round.closedWithout) {
    return (
      <div>
        <h1 style={{ fontFamily: "var(--font-heading)", fontSize: 22, margin: 0 }}>My card</h1>
        <p style={{ marginTop: 10, fontSize: 14.5, lineHeight: 1.6, color: "var(--color-neutral-400)" }}>
          The {terms.organizer} has closed {me.round.closedWithout}, and there&rsquo;s no card from you for it, so
          nothing more can be entered. If that&rsquo;s wrong, speak to the {terms.organizer}.
        </p>
        <WayForward
          links={[
            { href: "/me/board", label: "See the board", icon: "ranking" },
            { href: "/me", label: "Back to today", icon: "flag" },
          ]}
        />
      </div>
    );
  }

  /**
   * OUT OF THIS LEAGUE WEEK (2026-10-08) — they said they can't make it. Not
   * an empty pad: Today is where they change their answer, and the card is
   * offered again the moment they say they're playing.
   */
  if (me.round.outThisWeek) {
    return (
      <div>
        <h1 style={{ fontFamily: "var(--font-heading)", fontSize: 22, margin: 0 }}>My card</h1>
        <p style={{ marginTop: 10, fontSize: 14.5, lineHeight: 1.6, color: "var(--color-neutral-400)" }}>
          {me.round.closed ? (
            // Closed since (grid cell L4) — nothing left to change.
            <>
              You were down as not playing {me.round.outThisWeek}, and the {terms.organizer} has closed it, so
              there&rsquo;s no card for you.
            </>
          ) : (
            <>
              You&rsquo;re down as not playing {me.round.outThisWeek}, so there&rsquo;s no card for you this week.
              Changed your mind? Say you&rsquo;re playing on Today and your card appears here.
            </>
          )}
        </p>
        <WayForward
          links={[
            { href: "/me", label: "Back to today", icon: "flag" },
            { href: "/me/board", label: "See the board", icon: "ranking" },
          ]}
        />
      </div>
    );
  }

  if (!canEnterScores(settings, session.viewRole)) {
    return (
      <div>
        <h1 style={{ fontFamily: "var(--font-heading)", fontSize: 22, margin: 0 }}>My card</h1>
        <p style={{ marginTop: 10, fontSize: 14.5, lineHeight: 1.6, color: "var(--color-neutral-400)" }}>
          Scores for this tournament are entered by the {terms.organizer}. Your card will appear on the board once
          it is in.
        </p>
        <WayForward
          links={[
            { href: "/me/board", label: "See the board", icon: "ranking" },
            { href: "/me", label: "Back to today", icon: "flag" },
          ]}
        />
      </div>
    );
  }

  // This screen is a single player's stroke card and nothing else. A match is
  // scored between two people and a team round on a side's card, so neither
  // can be entered here — and silently rendering an 18-box grid for them would
  // collect strokes the tournament never reads.
  const stage = state.stages.find((s) => s.id === me.round!.stageId) ?? null;
  const teamRound = !!stage && needsTeams(stage.format);
  /**
   * IS THIS ROUND SCORED AGAINST AN OPPONENT? — asked of the round, not of
   * whether the app DREW it (2026-09-19).
   *
   * This read `generatesPairings`, which is true for exactly one type: Round
   * Robin. A Bracket Stage and a Single Match Stage are head-to-head and draw
   * no pairings — the organizer sets those matches — so a player in a knockout
   * was handed an individual stroke card and a scoring pad for a round that is
   * recorded against an opponent. Found on the seeded club's knockout, and
   * predicted by `the-society-outing.test.ts`: "a screen using the second to
   * decide whether a round is match play would score this nine as a medal".
   *
   * `roundIsStroke` is the one rule for this and gets BOTH directions right:
   * a head-to-head type scored by a card (the Stableford charity day that
   * `round-shape.ts` documents) is still the player's own card, and a
   * head-to-head type scored as a match is not.
   */
  const matchRound = !!stage && !roundIsStroke(stage.type, stage.format);

  /**
   * IS THE SIDE'S CARD ACTUALLY IN?
   *
   * This screen ended on "it appears on the board as soon as it's in" whether
   * or not it was in — read on the seeded club beside a side that had finished
   * eighteen holes and was seventh of eight. A sentence that is true before the
   * round and false after it is a sentence nobody can act on, so it says which.
   *
   * Found by id, the same as Today: see `TeamStanding.memberIds`.
   */
  // The round's own card, resolved here rather than reusing the one built
  // below: that one is built after this branch has already returned.
  const sideCard = teamRound && stage ? await roundCardFor(state, stage, me.round.holes) : null;
  const myCardedSide =
    teamRound && stage && sideCard && me.playerId
      ? (
          await teamStandings(
            state.event.id,
            stage.id,
            stage.format,
            sideCard.card.pars,
            sideCard.card.strokeIndex,
            stage.scoringBasis,
            stage.handicapAllowance,
            stage.allowanceWeights,
            stage.countBest,
          )
        ).find((s) => s.memberIds.includes(me.playerId!) && s.played > 0) ?? null
      : null;

  /**
   * A TEAM CUP IS SCORED MATCH BY MATCH. This said "Round 1 is played as
   * Four-Ball … Your organizer enters it" to a player in a cup whose players
   * keep their own scores — the round's number, not the session's name, and
   * the wrong person. Score entry opens on the player's own match.
   */
  if (state.stages.some((s) => s.type === TEAM_SESSION)) {
    return (
      <div>
        <h1 style={{ fontFamily: "var(--font-heading)", fontSize: 22, margin: 0 }}>My card</h1>
        <MoreInfo short="Your matches are scored on Today." style={{ marginTop: 10 }}>
          A cup is scored match by match, so there&rsquo;s no card of your own. Your matches — and the
          button to score each one — are on Today.
        </MoreInfo>
        <WayForward
          links={[
            { href: "/me", label: "See my matches", icon: "sword" },
            { href: "/me/board", label: "See the cup", icon: "ranking" },
          ]}
        />
      </div>
    );
  }

  if (teamRound || matchRound) {
    /**
     * A TEAM ROUND IS SCORED BY ITS PLAYERS TOO (2026-10-10). This read "Your
     * organizer enters it" — and this page is only reached where players DO
     * report their own scores (the refusal above returns first). Score entry
     * already takes a four-ball partner's own card and a shared-ball side's one
     * card from a player (`saveTeamScorecard`, and `/entry` shows a player
     * exactly the cards they may save). Walked on a 120-player club four-ball:
     * sixty pairs on the course and every member told the secretary would type
     * their card in.
     */
    // Whose card it is follows the committee's entry setting (`oneCardPerSide`).
    const ownBall = teamRound && !!stage && !oneCardPerSide(stage.format, stage.scoreInput, stage.scoringBasis);
    return (
      <div>
        <h1 style={{ fontFamily: "var(--font-heading)", fontSize: 22, margin: 0 }}>My card</h1>
        {/* The short line is the answer — whose card it is, or the side's
            score once it is in, which is a result and never hidden. The why
            is behind the ⓘ. */}
        <MoreInfo
          style={{ marginTop: 10 }}
          short={
            myCardedSide
              ? `Your side's card is in: ${myCardedSide.gross} gross, ${myCardedSide.net} net.`
              : teamRound
                ? ownBall
                  ? "Keep your own card; the better ball counts for your side."
                  : "Your side keeps one card; either of you enters it."
                : "Match play: no card of your own."
          }
        >
          {teamRound
            ? ownBall
              ? `${me.round.name} is played as ${stage?.format}: everyone plays their own ball, and the better score of the two counts for the side on every hole.`
              : `${me.round.name} is played as ${stage?.format}: the side plays one ball, so it has one card between you.`
            : `${me.round.name} is match play, so your score is recorded against your opponent rather than as your own card.`}{" "}
          {myCardedSide
            ? `Your side's card is in: ${myCardedSide.name} went round in ${myCardedSide.gross} gross, ${myCardedSide.net} net.`
            : teamRound
              ? "It appears on the board as soon as it’s in."
              : `Your ${terms.organizer} enters it, and it appears on the board as soon as it’s in.`}
        </MoreInfo>
        {/* A way forward out of what was otherwise a dead end.
            A player taps "My card" on a match-play round, is told the card is
            not theirs, and until now the only offer was the whole board. Their
            own match is one tap away and is what they came for — so it is
            offered first, and only when there is one to offer. */}
        <WayForward
          links={[
            ...(teamRound && stage
              ? [{ href: `/entry?round=${stage.id}`, label: ownBall ? "Enter my card" : "Enter our side's card", icon: "pencil-simple" }]
              : []),
            ...(me.round.matches.length > 0
              ? [
                  {
                    href: "/me",
                    label: me.round.matches.length === 1 ? "See my match" : "See my matches",
                    icon: "sword",
                  },
                ]
              : []),
            { href: "/me/board", label: "See the board", icon: "ranking" },
          ]}
        />
      </div>
    );
  }

  const holes = me.round.holes;

  // The course this ROUND is played on, narrowed to the nine actually played
  // — not the event's, which is only the fallback. A player standing on a
  // second venue was being shown the first course's par, yardage and stroke
  // index, and a stroke index is what decides where their shots fall.
  // One reading, shared with Today's tiles — see services/round-card.ts.
  const { venue, known, card, unit } = await roundCardFor(state, stage, holes);

  /**
   * Handicap strokes per hole, resolved on the SERVER.
   *
   * Only the server can see the whole chain — the player's tee, its Course
   * Rating and Slope, the round's allowance and its hole count — and the card
   * has never shown any of it. A player working out their own net score from a
   * gross total and a roster Index is doing arithmetic the tournament will not
   * agree with: the audit found exactly that on the organizer's entry screen,
   * where the running net came off the raw Index while the dots beside it came
   * off the Course Handicap, five shots apart on one screen.
   */
  const playing = state.strokeHandicapFor(me.playerId, me.round.stageId);
  /**
   * And WHICH SET those shots came off, which the comment above has named as
   * missing since it was written.
   *
   * Resolved by `handicapsForRound`, the same function the number above comes
   * from, so the tee printed on the card and the strokes allocated on it
   * cannot come from two different answers. It walks the player's own tee,
   * then their FLIGHT's — a club championship puts championship, seniors and
   * ladies on three sets per flight rather than per player — then the round's,
   * and the committee's policy decides which of those may win.
   */
  const teeRow = (
    await handicapsForRound(
      session.eventId,
      holes,
      // The round’s own set before the tournament’s, and a fallback scoped
      // to the course this round is actually played on. See `teeForPlay`.
      teeForPlay(
        await teesForEvent(session.eventId),
        { stageTeeId: stage?.teeId, eventDefaultTeeId: state.event.defaultTeeId },
        stage?.courseId ?? state.event.courseId ?? null,
      ),
    )
  ).find((r) => r.playerId === me.playerId);
  const tee = teeRow?.teeName ? { name: teeRow.teeName, rated: teeRow.rated } : null;
  /**
   * The group this player may keep score for — the rest of their foursome on
   * this round's published sheet, by the same rule `saveScorecard` enforces.
   * Only when players enter scores at all, which the guard above settled.
   */
  const partners = stage
    ? await partnerCardsFor({
        eventId: state.event.id,
        stage,
        playerId: me.playerId,
        holes,
        confirmed: state.confirmed,
      })
    : [];

  const alloc = allocationHoles(holes);
  /** One player's shots per hole, off the same chain as the holder's own. */
  const shotsFor = (playerId: string) => {
    const hcp = playerId === me.playerId ? playing : state.strokeHandicapFor(playerId, me.round!.stageId);
    return Array.from({ length: holes }, (_, i) =>
      known ? holeStrokesReceived(hcp, card.strokeIndex[i] ?? 18, alloc) : 0,
    );
  };
  const shots = shotsFor(me.playerId);
  // The partners' too, for the marker keeping the group's card.
  const partnersWithShots = partners.map((p) => ({ ...p, shots: shotsFor(p.id) }));

  return (
    // The card's distances in THIS course's unit — see DistanceUnitProvider.
    <DistanceUnitProvider unit={unit}>
    <PlayerCard
      stageId={me.round.stageId}
      playerId={me.playerId}
      playerName={me.name}
      roundLabel={me.round.label}
      courseName={known ? card.name : ""}
      // Whether that course is the club's own. At home the club's mark heads
      // the card; away, the course leads and the club is named beneath it — a
      // society's outing at Pebble Beach should not look like the society owns
      // the course.
      venueIsHome={!!brand?.homeCourseId && brand.homeCourseId === (venue?.id ?? "")}
      holes={holes}
      pars={known ? card.pars.slice(0, holes) : []}
      yards={known ? card.yards.slice(0, holes) : []}
      strokeIndex={known ? card.strokeIndex.slice(0, holes) : []}
      shotsPerHole={shots}
      playingHandicap={playing}
      tee={tee}
      // The table the round is decided on — the board's own reading of it
      // (`isStablefordRound`, `boardKind`), so the card and the board count
      // the same points.
      pointsTable={
        stage && isStablefordRound(stage.scoringBasis, stage.format)
          ? boardKind(stage.format) === "modified-stableford"
            ? "modified"
            : "standard"
          : null
      }
      voiceEntry={settings.voiceEntry}
      // Where the committee cut the holes for this round, shown on each hole.
      pins={stage ? parsePinSheet(stage.pinSheet, holes) : []}
      // 10 on a back nine, so the 10th tee reads "Hole 10" (`firstHoleOf`).
      firstHole={known ? firstHoleOf(card) : 1}
      status={me.round.card?.status ?? "entered"}
      // Whether signing this card hands it to anybody. Under player
      // confirmation nothing approves a scorecard — `certifyCard` writes
      // "certified" and the only paths out are staff actions — so the card
      // stops there, and saying "it's with the committee now" is a wait that
      // never ends. A casual round is exactly that case.
      staffApproves={!allowsAutoConfirm(settings)}
      // A casual card is never signed or disputed — `signsCards`.
      signs={signsCards(state.event.shape)}
      // The club's badge at the head of the card, so the card a player holds
      // carries the mark that is on the paper one.
      brand={brand}
      initialStrokes={me.round.card?.strokes ?? []}
      // Which version the screen loaded, so a save that would land on top of
      // somebody else’s change is refused rather than winning silently.
      //
      // `NO_CARD_REVISION` rather than "" when there is no card yet. The empty
      // string reached the server as "no opinion, write unconditionally" —
      // which is the CONSOLE's meaning, and the opposite of this screen's. A
      // player who opened an empty card, went offline and entered nine holes
      // then replaced a full eighteen the committee had entered meanwhile,
      // with no conflict shown.
      initialRevision={me.round.card?.revision ?? NO_CARD_REVISION}
      /**
       * Whether this card may go in hole by hole, from the same reader
       * `saveScorecard` refuses on — and on `session.role`, not `viewRole`,
       * because that is what the action tests. An organizer previewing as a
       * player still saves as staff, and telling this screen otherwise would
       * hold a card the server would have taken.
       *
       * Without it the screen auto-saved every hole into a certain refusal and
       * reported it as "This card wouldn't save. Show it to the committee
       * before you sign." for the whole round.
       */
      savePartial={mayReportPartialCard(settings, session.role)}
      partners={partnersWithShots}
      startHole={me.round.group?.startHole ?? 1}
      // Rules left the tab bar for Events (2026-09-19); the card is where a
      // local rule or the handicap allowance comes up, so the card's own
      // "Rules" line carries it (2026-10-05) rather than a second link here.
      rulesHref="/me/rules"
    />
    {/* WHAT THIS CARD'S NET SCORE WAS WORKED OUT FROM (2026-09-19). The pars
        and the stroke index on this screen decide where a player's shots
        fall, and until now nothing said whether anybody at the club had ever
        checked them. No "fix" link: a player cannot correct the club's card,
        but they can ask, and they should not be the last to know. */}
    <CardTrustNote card={venue} strokeIndex={known ? card.strokeIndex.slice(0, holes) : null} />
    {/* AND WHETHER ANYTHING SCORES THIS CARD (2026-09-20).
        A round whose format is `manual` has no engine — `standingRows` returns
        `[]` on its first line for one — so a player can fill eighteen holes
        here, certify them, and find no board and no position anywhere.
        The organizer is told: `/leaderboard` and `/reports` both render the
        notice saying the committee works the result out. The player was told
        nothing at all, which is the same silence a waitlisted entrant's card
        used to be filled in.
        The card STAYS — a club running a hand-scored format may well still
        want the scores, and refusing them would be deciding that for them.
        What changes is that it no longer implies a result is coming. */}
    {isManualFormat(stage?.format ?? "") && (
      <MoreInfo short="Scored by hand — the committee decides the result." style={{ marginTop: 12 }}>
        This round is scored by hand, so nothing here works out a position — your card is kept for
        your own record, and the committee decides the result.
      </MoreInfo>
    )}
    </DistanceUnitProvider>
  );
}
