import { screenMetadata } from "@/lib/screen-metadata";
import { requireOrgScreen } from "@/lib/page-helpers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { loadRoster } from "@/lib/services/roster";
import { screensShownFor, keepingPreview } from "@/lib/services/screens-shown";
import { MemberHistory } from "@/components/club/MemberHistory";

/**
 * WHAT ONE MEMBER HAS PLAYED AT THIS CLUB.
 *
 * `memberHistory` was written, tested and reachable from nothing: a club's
 * entry and handicap history sat in the database and on no screen. It was on
 * the unreached-service register from 2026-09-18 as an open decision, and Ajay
 * settled it on 2026-09-20 — a proper screen with its own nav entry, rather
 * than a table bolted onto the roster.
 *
 * A SCREEN RATHER THAN A ROW EXPANDER, and the reason is what the history is
 * FOR. The roster answers "who is in the club" and is read across, a hundred
 * names at a time. This answers "what has this one person done", which is a
 * different posture: a secretary checking a handicap before a committee
 * meeting, or answering a member who thinks their index is wrong. That reading
 * wants the whole screen, and it wants a URL somebody can send.
 *
 * WHY A QUERY PARAMETER RATHER THAN `/member/[id]`. A dynamic segment is
 * skipped by `e2e/routes.ts#consoleScreens`, which filters directory names
 * starting with `[` — so the screen would have had no heading assertion, no
 * sideways-scroll measurement and no touch-target floor, on a filesystem sweep
 * built precisely so a new screen is covered the day it is added. `?member=`
 * keeps it in the sweep and gives the no-selection case a real state to be
 * walked in, which is the state `verify-lifecycle.mjs` exercises and the one
 * most likely to be wrong.
 *
 * NO TOURNAMENT NEEDED. `requireOrgScreen` is the door `/roster` and
 * `/organization` use: the club is the thing that has members, and a society
 * that has not created its first tournament still has a roster to read. Using
 * the per-event door would have made a club screen depend on the tournament it
 * outlives — the deadlock `/roster`'s own comment describes.
 *
 * R7: while Members is shown the history is a section of `/roster` (`MOVES`'s
 * room for the members key); this address then sends a person there, with the
 * member they asked for. The body is drawn here only while it is not (one boolean).
 */
export const metadata = screenMetadata("/member");

export default async function MemberHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ member?: string }>;
}) {
  const { session, organizationId } = await requireOrgScreen("member");
  const params = await searchParams;
  const shown = await screensShownFor(session);
  if (shown.has("members")) {
    redirect(await keepingPreview(params.member ? `/roster?member=${encodeURIComponent(params.member)}#history` : "/roster#history"));
  }

  const members = await loadRoster(organizationId);
  /** The id is checked against THIS club's roster before it is used (`MemberHistory` does the same). */
  const selected = members.find((m) => m.id === params.member) ?? null;

  return (
    <>
      <PageHeader
        kicker="Members"
        title={selected ? selected.name : "Member history"}
        subtitle={
          selected
            ? "Every tournament this member has entered, and the handicap each was played off."
            : "Pick a member to see what they have played and the handicap each round was scored on."
        }
        actions={
          <Link className="btn btn-ghost" href="/roster">
            Back to members
          </Link>
        }
      />
      <MemberHistory organizationId={organizationId} memberId={selected?.id} base="/member" previewMode={null} />
    </>
  );
}
