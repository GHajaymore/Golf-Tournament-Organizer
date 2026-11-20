import "server-only";
import { prisma } from "@/lib/db";
import { getPlayerViewer } from "@/lib/player-viewer";
import { getPlaySession } from "@/lib/play-auth";
import { playStatusOf, type PlayScreen, type PlayStatus } from "@/lib/domain/play-status";

/**
 * WHO IS IN THIS ROUND, AND IS PLAY SUSPENDED IN IT — for one kind of screen
 * (2026-11-14, safety sweep G-1; Rule 5.7a).
 *
 * The committee's "stop now" reached a person only through the player app.
 * `/play` — a round code, no account, the phone a group's scorer keeps the
 * whole group's card on, and the door a member with no email is sent to —
 * drew no banner and mounted no siren, and the siren's poll asked
 * `getSession()`, which a round-code phone does not have. So a whole group
 * could play on through a lightning suspension.
 *
 * ONE function answers it, and both the banner a screen draws and the siren's
 * poll on that screen ask it (`currentPlayStatus`), so they cannot disagree:
 *
 *   "player"  the player screen's own tournament: the PLAYER VIEWER's event
 *             (`getPlayerViewer`), so a guest on a personal link is covered as
 *             well as a member, and the siren asks the very event the layout's
 *             banner draws (G1). Never `getSession()`: a guest has none.
 *   "play"    the round the phone's code opened (the play session's event)
 *
 * The event is ALWAYS the caller's own cookie's, never an argument: a
 * `"use server"` caller can name only the KIND of screen, and either kind
 * reads only a cookie the browser already holds. Nobody, or a play session
 * that has expired or whose code was reissued, is "not suspended" and no event.
 */
export async function playStatusForScreen(screen: PlayScreen): Promise<PlayStatus & { eventId: string | null }> {
  const eventId = screen === "play" ? ((await getPlaySession())?.eventId ?? null) : ((await getPlayerViewer())?.eventId ?? null);
  if (!eventId) return { suspended: false, note: "", eventId: null };
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { playSuspendedAt: true, playSuspendedNote: true },
  });
  return { ...playStatusOf(event), eventId };
}
