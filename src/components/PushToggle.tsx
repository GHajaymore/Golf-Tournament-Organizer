import { prisma } from "@/lib/db";
import { getPlayerViewer } from "@/lib/player-viewer";
import { pushFingerprintsForViewer } from "@/lib/services/push";
import { PushToggleClient } from "./PushToggleClient";

/**
 * The alerts toggle, told whose devices have alerts on (2026-11-14, safety
 * sweep G-4): the own devices of the person the player screen is for, as
 * fingerprints, so a phone holding somebody else's subscription says "off" to
 * the person now holding it rather than "on". See `pushToggleState`.
 *
 * Asked of the PLAYER VIEWER, never of `getSession()` (J39/J40 PR 2): Today is
 * drawn for an account or a guest's link, and Turn on files the row for that
 * same viewer (`savePushSubscription`), so a guest's own phone reads "on" after
 * a reload and an account's row on the same browser is never the guest's.
 *
 * A guest's switch names the event its link is for (simplicity review of
 * #1133, finding 5); an account's names none, since its alerts reach all of
 * its events.
 */
export async function PushToggle() {
  const viewer = await getPlayerViewer();
  const guestEvent = viewer?.guest
    ? ((await prisma.event.findUnique({ where: { id: viewer.eventId }, select: { name: true } }))?.name ?? "").trim() || "your event"
    : null;
  return <PushToggleClient mine={await pushFingerprintsForViewer(viewer)} guestEvent={guestEvent} />;
}
