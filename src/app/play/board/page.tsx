import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getPlaySession } from "@/lib/play-auth";
import { settingsOf } from "@/lib/services/tournament";
import { mayOpenBoard } from "@/lib/tournament-settings";
import { PublicBoard, boardEventOf } from "@/components/PublicBoard";
import { NOINDEX } from "@/lib/site";
import { playStatusForScreen } from "@/lib/services/play-status-screen";
import { SuspensionAlarm } from "@/components/SuspensionAlarm";

/**
 * THE BOARD, FOR SOMEBODY HOLDING A ROUND CODE (2026-11-05).
 *
 * `/play` showed a link to the board only where the organizer had made it
 * public, and `/live/<token>` answers 404 unless it is: that 404 is the privacy
 * line and is tested, so it is not widened. A player who scored a round from a
 * printed sign and chose "participants only" had no way to see how the day
 * stood. This is their door: the play session is the credential (the same one
 * `/play` needs), `mayOpenBoard(settings, "code-holder")` is the permission
 * (false only for "staff"), and what is drawn is `PublicBoard` — the very board
 * `/live` draws, through `publicCopy`, so a player who asked not to be shown on
 * public pages is not shown here either.
 *
 * Without a session this is the code prompt (`/play`); with one, where the
 * organizer keeps the board to staff, it is a 404 — the same answer as `/live`
 * gives, so the page does not say whether a board exists.
 */

export const dynamic = "force-dynamic";

export const metadata = { title: "Leaderboard", robots: NOINDEX };

export default async function PlayBoardPage({ searchParams }: { searchParams: Promise<{ round?: string }> }) {
  const session = await getPlaySession();
  if (!session) redirect("/play");
  const event = await prisma.event.findUnique({ where: { id: session.eventId } });
  if (!event || !mayOpenBoard(settingsOf(event), "code-holder")) notFound();
  const { round } = await searchParams;
  // The board draws the suspension banner itself; a code holder looking at it is still on the course, so
  // the siren sounds here as on `/play` — asked of the same round (`playStatusForScreen`, safety sweep G-1).
  const status = await playStatusForScreen("play");
  return (
    <>
      <SuspensionAlarm screen="play" suspended={status.suspended} />
      <PublicBoard event={boardEventOf(event)} round={round} clubhouse={false} reportHref={null} />
    </>
  );
}
