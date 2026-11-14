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
 */
export async function PushToggle() {
  const viewer = await getPlayerViewer();
  return <PushToggleClient mine={await pushFingerprintsForViewer(viewer)} />;
}
