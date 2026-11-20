import { redirect } from "next/navigation";
import { getPlayerViewer } from "@/lib/player-viewer";
import { holdsGuestCookie } from "@/lib/guest-auth";
import { startDestination } from "@/lib/domain/home-screen-start";
import { NOINDEX } from "@/lib/site";

/**
 * /start — where an installed app opens (the manifest's `start_url`; J39/J40
 * PR 2, G3). It draws nothing: it sends an account to its home, a guest's live
 * link to Today, and anybody else to /p, where the code box is one press away.
 * See `startDestination`.
 */
export const dynamic = "force-dynamic";

export const metadata = { title: "TourneyHQ", robots: NOINDEX };

export default async function StartPage() {
  const viewer = await getPlayerViewer();
  if (viewer && !viewer.guest) redirect(startDestination({ kind: "account", eventId: viewer.eventId, viewRole: viewer.viewRole }));
  if (viewer?.guest) redirect(startDestination({ kind: "guest" }));
  redirect(startDestination({ kind: "nobody", holdsEndedLink: await holdsGuestCookie() }));
}
