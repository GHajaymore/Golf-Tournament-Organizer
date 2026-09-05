import { COURSE_REF } from "@/lib/services/course-resolution";
import { prisma } from "@/lib/db";
import { getPlaySession } from "@/lib/play-auth";
import { settingsOf } from "@/lib/services/tournament";
import { courseForMatch, cardForMatch } from "@/lib/services/course-resolution";
import { brandForEvent } from "@/lib/services/organization";
import { PlayClient } from "@/components/PlayClient";
import type { HoleResult } from "@/lib/domain";
import { NOINDEX } from "@/lib/site";

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

export default async function PlayPage() {
  const session = await getPlaySession();

  // No session yet — show the code prompt.
  if (!session) return <PlayClient stage="code" />;

  const [event, match] = await Promise.all([
    prisma.event.findUnique({ where: { id: session.eventId }, include: COURSE_REF }),
    prisma.match.findFirst({
      where: {
        stageId: session.stageId,
        OR: [{ playerAId: session.playerId }, { playerBId: session.playerId }],
      },
    }),
  ]);
  if (!event) return <PlayClient stage="code" />;

  const settings = settingsOf(event);
  const brand = await brandForEvent(event.id);

  if (!match) {
    return (
      <PlayClient
        stage="no-match"
        brand={brand}
        playerName={session.playerName}
        eventName={event.name}
        roundLabel={session.roundLabel}
      />
    );
  }

  const [opponent, stage] = await Promise.all([
    prisma.player.findUnique({
      where: { id: match.playerAId === session.playerId ? match.playerBId : match.playerAId },
      select: { name: true, handicap: true },
    }),
    prisma.stage.findUnique({
      where: { id: session.stageId },
      select: { holes: true, scoringBasis: true, nine: true, courseId: true },
    }),
  ]);

  const holeCount = stage?.holes === 9 ? 9 : 18;

  /**
   * The card this match is played on, narrowed to the holes it is played over.
   *
   * This handed the player the EVENT's whole eighteen, which broke the screen
   * in two ways at once for a nine-hole match. `PlayClient` sized its grid
   * from the length of this array, so it drew eighteen cells for a nine-hole
   * match; the submit button then read "Fill all 18 holes to submit" and
   * stayed disabled forever, because only nine of them can ever be filled. A
   * player with a round code had no way to hand in their card at all.
   *
   * And the card itself was the wrong one — the event's, ignoring the match's
   * venue and the round's, and never narrowed to the nine. Same chain as
   * `saveMatchScorecard`, read the same way, so the screen and the save agree.
   */
  const [playMatchVenue, playStageVenue] = await Promise.all([
    match.courseId ? prisma.course.findUnique({ where: { id: match.courseId } }) : null,
    stage?.courseId ? prisma.course.findUnique({ where: { id: stage.courseId } }) : null,
  ]);
  const playResolved = courseForMatch(playMatchVenue, playStageVenue, event);
  const playCard = playResolved ? cardForMatch(playResolved, match, stage) : null;
  let holes: HoleResult[];
  try {
    holes = JSON.parse(match.holes) as HoleResult[];
  } catch {
    holes = new Array(holeCount).fill(null);
  }

  const me = await prisma.player.findUnique({
    where: { id: session.playerId },
    select: { name: true, handicap: true },
  });
  const iAmA = match.playerAId === session.playerId;

  return (
    <PlayClient
      stage="score"
      brand={brand}
      playerName={session.playerName}
      eventName={event.name}
      roundLabel={session.roundLabel}
      submitWhole={settings.scoreEntryWindow === "after"}
      match={{
        id: match.id,
        // Slot A is always the session holder, so the card reads from their
        // point of view rather than from the database's ordering.
        aId: iAmA ? match.playerAId : match.playerBId,
        bId: iAmA ? match.playerBId : match.playerAId,
        aName: me?.name ?? "You",
        bName: opponent?.name ?? "Opponent",
        aHandicap: me?.handicap ?? 0,
        bHandicap: opponent?.handicap ?? 0,
        // Results are stored A-relative; flip them when the holder is B so
        // "you won this hole" means the same thing on screen and in the data.
        holes: iAmA ? holes : holes.map((h) => (h === "A" ? "B" : h === "B" ? "A" : h)),
        flipped: !iAmA,
      }}
      // The round's own hole count, sent explicitly rather than inferred from
      // the length of the card. A card can be absent, or a different length
      // from the round — neither is a reason to draw the wrong number of holes.
      holes={holeCount}
      pars={playCard?.pars ?? []}
      yards={playCard?.yards ?? []}
      strokeIndex={playCard?.strokeIndex ?? []}
      netMode={stage?.scoringBasis === "net"}
    />
  );
}
