import { PlayStatusControl } from "./PlayStatusControl";
import { PlayStatusFrame } from "./PlayStatusFrame";
import { consoleOffersPlayStop } from "@/lib/domain/play-status";
import { isMatch } from "@/lib/tournament-shape";
import { prisma } from "@/lib/db";
import { noticesOffPlayerIds } from "@/lib/services/push";

/**
 * SUSPEND PLAY, ITS BANNER AND RESUME PLAY ON EVERY CONSOLE SCREEN (Rule 5.7;
 * simplicity cut 2, 2026-11-14). Mounted ONCE, by the console's shell
 * (`src/app/(app)/layout.tsx`), so the dashboard, the tee sheet, Score entry
 * and the leaderboard all carry the same control, and no screen carries a
 * second one (`suspend-play-is-in-the-console-shell.test.ts`).
 *
 * When it is drawn is `consoleOffersPlayStop`'s answer, from the state
 * machine's step the shell already asks for its chip, and never on a casual
 * round. The press is the one action pair (`suspendPlay` / `resumePlay`):
 * there is no second way to write a suspension. `PlayStatusFrame` keeps it
 * the server's state on a layout that is not drawn again between screens,
 * keeps it in view on a scrolled screen, and keeps it off paper.
 *
 * WHO THE ALARM MISSED (F-2 on #1133, the panel's condition 5): the confirm
 * names the players with alerts off, asked of `noticesOffPlayerIds`, the one
 * reader behind #1133's count. Asked only while play is running: a resume has
 * no alarm to miss.
 */
export async function ConsolePlayStatus({
  eventId,
  viewRole,
  step,
  event,
}: {
  eventId: string;
  viewRole: string;
  /** The machine's step, as the shell's chip reads it; null with no status. */
  step: string | null;
  event: { playSuspendedAt: Date | null; playSuspendedNote: string; shape: string } | null;
}) {
  if (!event) return null;
  const suspended = !!event.playSuspendedAt;
  if (!consoleOffersPlayStop({ viewRole, step, suspended, casualRound: isMatch(event.shape) })) return null;
  const since = event.playSuspendedAt ? event.playSuspendedAt.toISOString() : "";
  let alertsOff: string[] = [];
  if (!suspended) {
    const field = await prisma.player.findMany({
      where: { eventId, status: "confirmed" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    const off = new Set(await noticesOffPlayerIds(eventId, field.map((p) => p.id)));
    alertsOff = field.filter((p) => off.has(p.id)).map((p) => p.name);
  }
  return (
    <PlayStatusFrame since={since}>
      <PlayStatusControl suspended={suspended} note={event.playSuspendedNote} since={since} alertsOff={alertsOff} />
    </PlayStatusFrame>
  );
}
