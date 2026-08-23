import { COURSE_REF } from "@/lib/services/course-resolution";
import { prisma } from "@/lib/db";
import { getPlaySession } from "@/lib/play-auth";
import { settingsOf } from "@/lib/services/tournament";
import { resolveCourse } from "@/lib/courses";
import { brandForEvent } from "@/lib/services/organization";
import { PlayClient } from "@/components/PlayClient";
import type { HoleResult } from "@/lib/domain";

/**
 * The Round Code surface.
 *
 * Outside the (app) group on purpose: someone here holds a code, not an
 * account, so there is no sidebar, no role and nothing from the organizer
 * console. They can see their own match for one round and report its score.
 */

export const dynamic = "force-dynamic";

export const metadata = { title: "Enter your score" };

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
  const course = resolveCourse(event);

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
    prisma.stage.findUnique({ where: { id: session.stageId }, select: { holes: true, scoringBasis: true } }),
  ]);

  const holeCount = stage?.holes === 9 ? 9 : 18;
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
      pars={course.pars}
      yards={course.yards}
      strokeIndex={course.strokeIndex}
      netMode={stage?.scoringBasis === "net"}
    />
  );
}
