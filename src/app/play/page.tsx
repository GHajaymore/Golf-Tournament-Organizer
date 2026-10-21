import { COURSE_REF } from "@/lib/services/course-resolution";
import { prisma } from "@/lib/db";
import { getPlaySession } from "@/lib/play-auth";
import { settingsOf, loadEventState } from "@/lib/services/tournament";
import { allowsAutoConfirm, isLeaderboardPublic } from "@/lib/tournament-settings";
import { courseForRound, cardForStage } from "@/lib/services/course-resolution";
import { firstHoleOf } from "@/lib/domain/hole-number";
import { brandForEvent } from "@/lib/services/organization";
import { matchCardFor, matchStrokeCardFor } from "@/lib/services/match-card";
import { matchKeptBy } from "@/lib/domain/match-kept-by";
import { oneCardPerSide } from "@/lib/domain/team-entry";
import { PlayClient } from "@/components/PlayClient";
import { DistanceUnitProvider } from "@/components/DistanceUnitProvider";
import { distanceUnitFor } from "@/lib/services/round-card";
import { NOINDEX } from "@/lib/site";
import { holeStrokesReceived } from "@/lib/domain/stroke";
import { isHeadToHead } from "@/lib/stage-types";
import { needsTeams } from "@/lib/formats";
import { signsCards } from "@/lib/tournament-shape";
import { expiryNotice, expiryShort, hoursLeft } from "@/lib/domain/round-expiry";
import { casualKeepRefusalFor } from "@/lib/services/close-terms";
import { holesPlayed } from "@/lib/domain/handicap";
import { lineupHidden } from "@/lib/domain/cup-lineup";

/**
 * The Round Code surface.
 *
 * Outside the (app) group on purpose: someone here holds a code, not an
 * account, so there is no sidebar, no role and nothing from the organizer
 * console. They can see their own match for one round and report its score.
 */

export const dynamic = "force-dynamic";

// Reached with a Round Code, and it renders the field's names once redeemed.
export const metadata = { title: "Enter your score", robots: NOINDEX };

export default async function PlayPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const session = await getPlaySession();

  // No session yet — show the code prompt.
  if (!session) return <PlayClient stage="code" />;

  /**
   * EVERY MATCH THIS PLAYER HAS IN THE ROUND, not an arbitrary one.
   *
   * A round robin draws one player into several matches inside one round, and
   * this was `findFirst` with no ordering — so the database chose which one a
   * code holder could score, and the others were unreachable. Found by the
   * player-side audit of 2026-09-19. Now they are listed in a stable order,
   * `?m=` picks one, and the rest are offered as links. Only this player's
   * own matches are ever looked up, so a forged `m` finds nothing and falls
   * back to the first — and the save re-checks membership regardless.
   */
  const { m: pickedMatch } = await searchParams;
  /**
   * AND THE SIDES THIS PLAYER IS ON IN THIS ROUND (2026-10-16).
   *
   * A four-ball or foursomes match is stored between two SIDES, with both
   * player columns empty, so the lookup below found nothing for a pair and a
   * cup's four-ball partner was told they had no match — while
   * `savePlayMatchHoles` has always let a member of either side save it. The
   * page now asks the same question the save asks.
   */
  const mySides = (
    await prisma.teamMember.findMany({
      where: { playerId: session.playerId, team: { stageId: session.stageId } },
      select: { teamId: true },
    })
  ).map((t) => t.teamId);
  const [event, drawn, codeStage] = await Promise.all([
    prisma.event.findUnique({ where: { id: session.eventId }, include: COURSE_REF }),
    prisma.match.findMany({
      where: {
        stageId: session.stageId,
        OR: [
          { playerAId: session.playerId },
          { playerBId: session.playerId },
          ...(mySides.length ? [{ teamAId: { in: mySides } }, { teamBId: { in: mySides } }] : []),
        ],
      },
      orderBy: { id: "asc" },
    }),
    prisma.stage.findUnique({ where: { id: session.stageId }, select: { type: true, lineupPublished: true, accessCode: true, format: true, scoreInput: true, scoringBasis: true, matchKeptBy: true } }),
  ]);
  // A cup lineup the organizer has not announced is nobody's match yet.
  const myMatches = codeStage && lineupHidden(codeStage) ? [] : drawn;
  const match = myMatches.find((x) => x.id === pickedMatch) ?? myMatches[0] ?? null;
  if (!event) return <PlayClient stage="code" />;

  const settings = settingsOf(event);
  // The board a code holder may open: only one the organizer has made public.
  const boardHref = isLeaderboardPublic(settings) && event.shareToken ? `/live/${event.shareToken}` : undefined;
  const brand = await brandForEvent(event.id);
  /**
   * That this round is temporary, worded for somebody who cannot keep it.
   *
   * `keepRound` is staff-only, and the people on this surface are precisely
   * the ones who are not staff — a fourball's other three players, here on a
   * Round Code with no account. So the sentence names the remedy they have,
   * which is to ask whoever set the round up.
   *
   * `hoursLeft` is null for every tournament that has ever existed, and
   * `expiryNotice` returns "" on null, so nothing mounts outside a casual
   * round.
   */
  const keepRefusal = hoursLeft(event) === null ? null : await casualKeepRefusalFor(event.id);
  const expiry = expiryNotice(hoursLeft(event), false, keepRefusal);
  // One line, the sentence above behind its ⓘ — what the host reads too.
  const expiryLine = expiryShort(hoursLeft(event), false);

  if (!match) {
    /**
     * NO MATCH IS NOT THE SAME AS NOTHING TO DO.
     *
     * A medal has no draw, so every player on a stroke-play round arrived here
     * and was told "you don't have a match scheduled in this round of X. Check
     * with your organizer" — a sentence about a draw problem that does not
     * exist, on a round that is scored from a card.
     *
     * It matters because the charity-day template turns exactly this on:
     * `scoreEntryBy: "players"` with a Round Code, so a roster of names can
     * score without accounts. Walked on 2026-09-10: the code redeemed, the
     * field listed, the player tapped their name, and the flow ended there.
     *
     * So the round decides which surface this is. A round that draws nobody
     * against anybody gets a card; "no match" is kept for a round that DOES
     * draw pairings and simply has none for this player, where the original
     * sentence is exactly right and the organizer really is who to ask.
     */
    const cardStage = await prisma.stage.findUnique({
      where: { id: session.stageId },
      // `format` too: a Modified Stableford round is won on points whatever the
      // basis says, and `cardTotals` needs the format to know that.
      select: { id: true, type: true, holes: true, nine: true, scoringBasis: true, format: true, courseId: true },
    });

    /**
     * A SIDE'S ROUND IS KEPT ON ONE PHONE (2026-10-07).
     *
     * A four-ball or foursomes is scored side by side, and this surface keeps
     * a player's own card or their own match — never a side's. Somebody who
     * had a code for one was told "you don't have a match scheduled in this
     * round of Ann & Bea v Cat & Dot": a round they were standing in. The
     * casual round screen no longer hands the code out for these formats;
     * this is the true sentence for anyone who has one anyway.
     */
    if (cardStage && needsTeams(cardStage.format)) {
      return (
        <PlayClient
          boardHref={boardHref}
          sessionCode={codeStage?.accessCode ?? ""}
          expiryNotice={expiry}
          expiryShort={expiryLine}
          stage="no-match"
          sideRound={cardStage.format}
          brand={brand}
          playerName={session.playerName}
          eventName={event.name}
          roundLabel={session.roundLabel}
        />
      );
    }

    if (cardStage && !isHeadToHead(cardStage.type)) {
      const roundVenue = cardStage.courseId
        ? await prisma.course.findUnique({ where: { id: cardStage.courseId } })
        : null;
      // The same chain the console reads, narrowed to the holes this round is
      // played over — so the card on the phone and the card the save is scored
      // against are the same nine.
      const resolved = courseForRound(roundVenue, event);
      const roundCard = resolved ? cardForStage(resolved, cardStage) : null;

      // The card as already returned. Opening blank and then saving would
      // erase a round somebody entered on the ninth tee.
      const existing = await prisma.scorecard.findFirst({
        where: { eventId: event.id, stageId: cardStage.id, playerId: session.playerId },
        select: { strokes: true, status: true },
      });
      let entered: (number | null)[] = [];
      try {
        entered = existing ? (JSON.parse(existing.strokes) as (number | null)[]) : [];
      } catch {
        entered = [];
      }

      /**
       * THE SHOTS THIS ROUND ACTUALLY ALLOCATES THIS PLAYER.
       *
       * Read through `loadEventState`, whose `strokeHandicapFor` is the one
       * resolver — it puts a committee override and the value frozen by the
       * first card ahead of the roster figure, and it returns a PLAYING
       * handicap with the round's allowance already applied.
       *
       * Deliberately not rebuilt from `player.handicap` here. `stroke.ts` and
       * the console's entry screen both record what that costs, in the same
       * words: a card printing a net and a Stableford total derived from the
       * raw index while the dots beside them came from the resolved figure,
       * "three to five strokes apart on the same screen, and one stroke apart
       * at minimum, since Stroke Play carries a 95% allowance". This surface
       * had no totals at all to be wrong, which is why it was never caught.
       *
       * It costs a full state load on a phone. That is the price of the card
       * in somebody's hand agreeing with the board they are on.
       */
      const cardState = await loadEventState(event.id);
      const holeCount = holesPlayed(cardStage.holes);
      const playing = cardState?.strokeHandicapFor(session.playerId, cardStage.id) ?? 0;
      const shots = roundCard
        ? Array.from({ length: holeCount }, (_, h) =>
            holeStrokesReceived(playing, roundCard.strokeIndex[h] ?? 18, holeCount),
          )
        : [];

      return (
        // This card's distances in its own course's unit.
        <DistanceUnitProvider unit={await distanceUnitFor(resolved, event.organizationId)}>
        <PlayClient
          boardHref={boardHref}
          sessionCode={codeStage?.accessCode ?? ""}
          expiryNotice={expiry}
        expiryShort={expiryLine}
          stage="card"
          stageId={session.stageId}
          playerId={session.playerId}
          brand={brand}
          playerName={session.playerName}
          eventName={event.name}
          roundLabel={session.roundLabel}
          submitWhole={settings.scoreEntryWindow === "after"}
          holes={holeCount}
          pars={roundCard?.pars ?? []}
          yards={roundCard?.yards ?? []}
          strokeIndex={roundCard?.strokeIndex ?? []}
          firstHole={firstHoleOf(roundCard)}
          card={entered}
          /* Signed already (or approved): the card opens saying so, not offering to be signed again
             (2026-10-21 — found by the first browser test to certify a card by code). */
          signed={existing?.status === "certified" || existing?.status === "approved"}
          /* How the round is scored, so the card reports the figure it is won
             on. A Stableford showed gross and to-par — the two numbers the
             format exists to stop a first-timer reading. */
          scoringBasis={cardStage.scoringBasis}
          roundFormat={cardStage.format}
          shots={shots}
          /* Whether a signed card then waits for a committee. A casual round is
             set to player confirmation because there is not one. */
          staffApproves={!allowsAutoConfirm(settings)}
          // A casual card is never signed — `signsCards`.
          signs={signsCards(event.shape)}
          voiceEntry={settings.voiceEntry}
        />
        </DistanceUnitProvider>
      );
    }

    return (
      <PlayClient
        boardHref={boardHref}
        sessionCode={codeStage?.accessCode ?? ""}
        expiryNotice={expiry}
        expiryShort={expiryLine}
        stage="no-match"
        brand={brand}
        playerName={session.playerName}
        eventName={event.name}
        roundLabel={session.roundLabel}
      />
    );
  }

  // The card, built where the player app builds it too — see `matchCardFor`.
  const card = await matchCardFor({ match, holderId: session.playerId, holderSides: mySides });
  // How the organizer has this round kept (`matchKeptBy`): a tap card, or the
  // holder's own stroke card — never both on one round.
  const strokeCard =
    codeStage && matchKeptBy(codeStage) === "cards"
      ? await matchStrokeCardFor({
          match,
          holderId: session.playerId,
          data: card,
          oneBallPerSide: oneCardPerSide(codeStage.format, codeStage.scoreInput, codeStage.scoringBasis),
        })
      : undefined;

  // The other matches, named by opponent, for the picker above the card.
  const others = myMatches.filter((x) => x.id !== match.id);
  const otherIds = others.map((x) =>
    x.playerAId === "" && x.playerBId === ""
      ? mySides.includes(x.teamAId) ? x.teamBId : x.teamAId
      : x.playerAId === session.playerId ? x.playerBId : x.playerAId,
  );
  const otherNames = otherIds.length
    ? new Map([
        ...(await prisma.player.findMany({ where: { id: { in: otherIds }, eventId: event.id }, select: { id: true, name: true } })).map(
          (p) => [p.id, p.name] as const,
        ),
        ...(await prisma.team.findMany({ where: { id: { in: otherIds }, eventId: event.id }, select: { id: true, name: true } })).map(
          (t) => [t.id, t.name] as const,
        ),
      ])
    : new Map<string, string>();
  const otherMatches = others.map((x, i) => ({
    id: x.id,
    label: `v ${otherNames.get(otherIds[i]) ?? "opponent"}`,
  }));

  return (
    // This match's card in its own course's unit — a match can have a venue
    // of its own, which is why it is asked of the match and not the round.
    <DistanceUnitProvider unit={card.unit}>
    <PlayClient
      boardHref={boardHref}
      sessionCode={codeStage?.accessCode ?? ""}
      expiryNotice={expiry}
      expiryShort={expiryLine}
      stage="score"
      stageId={session.stageId}
      playerId={session.playerId}
      otherMatches={otherMatches}
      brand={brand}
      playerName={session.playerName}
      eventName={event.name}
      roundLabel={session.roundLabel}
      submitWhole={settings.scoreEntryWindow === "after"}
      match={card.match}
      holes={card.holes}
      pars={card.pars}
      yards={card.yards}
      strokeIndex={card.strokeIndex}
      cardStrokeIndex={card.cardStrokeIndex}
      firstHole={card.firstHole}
      netMode={card.netMode}
      matchShots={card.matchShots}
      strokeCard={strokeCard}
      voiceEntry={settings.voiceEntry}
    />
    </DistanceUnitProvider>
  );
}
