import { getSession } from "@/lib/auth";
import { pushFingerprintsFor } from "@/lib/services/push";
import { PushToggleClient } from "./PushToggleClient";

/**
 * The alerts toggle, told whose devices have alerts on (2026-11-14, safety
 * sweep G-4): the signed-in person's own, as fingerprints, so a phone holding
 * somebody else's subscription says "off" to the person now holding it rather
 * than "on". See `pushToggleState`.
 */
export async function PushToggle() {
  const session = await getSession();
  return <PushToggleClient mine={await pushFingerprintsFor(session?.email)} />;
}
