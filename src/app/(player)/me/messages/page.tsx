import { screenMetadata } from "@/lib/screen-metadata";
import { redirect } from "next/navigation";
import { requirePlayingViewer } from "@/lib/page-helpers";
import { membershipFor, threadsFor, composableScopes, messageableField, messagesOptOutFor, MUTED_WORDS } from "@/lib/services/messaging";
import { prisma } from "@/lib/db";
import { MessagesClient } from "@/components/MessagesClient";
import { golfTermsForEvent } from "@/lib/services/organization";

export const metadata = screenMetadata("/me/messages");

/**
 * Messages, in the player's app.
 *
 * The same component and the same service as the console screen, on purpose.
 * A player and an organizer looking at the same conversation must see the same
 * conversation — the split between the two shells is presentation, and this is
 * the one feature where the two sides are literally talking to each other.
 *
 * What each of them can see still differs, and not because of the route: the
 * screen renders whatever `membershipFor` derives, so a player gets their
 * flight, round, four and match and never the organizers' thread.
 */
export default async function PlayMessagesPage() {
  // An account, or a guest's player link (J39/J40 PR 2): the screen's own viewer. A waiting guest
  // is sent to Today (S5, SF-3), and gets no messaging context below either.
  const session = await requirePlayingViewer();
  if (!session.eventId) redirect(session.guest ? "/me" : "/choose");

  const ctx = await membershipFor(session, session.eventId);
  if (!ctx) redirect(session.guest ? "/me" : "/choose");

  const [threads, composable, people, optedOut, rosterRow] = await Promise.all([
    threadsFor(ctx),
    composableScopes(ctx),
    messageableField(ctx),
    messagesOptOutFor(ctx),
    // Texting is an account's (no phone for a guest, ruled 7 Nov).
    ctx.guest
      ? null
      : prisma.member.findFirst({
          where: { organizationId: ctx.organizationId, email: { equals: ctx.whoKey, mode: "insensitive" } },
          select: { smsOptIn: true },
        }),
  ]);

  const isStaff = session.role === "admin" || session.role === "assistant";

  return (
    <div>
      <h1 style={{ fontFamily: "var(--font-heading)", fontSize: 24, margin: "0 0 4px" }}>Messages</h1>
      <p style={{ margin: "0 0 16px", fontSize: 14, color: "var(--color-neutral-400)" }}>
        {ctx.guest ? "Message your group, your round and the organizers." : "Message your group, flight, match or anyone in the field."}
      </p>
      <MessagesClient
        threads={threads}
        composable={composable}
        people={people}
        isStaff={isStaff}
        optedOut={optedOut}
        smsOptIn={rosterRow?.smsOptIn ?? false}
        organizer={(await golfTermsForEvent(session.eventId)).organizer}
        surface="player"
        guest={ctx.guest}
        deskKey={ctx.playerId ? `desk:${ctx.playerId}` : ""}
        mutedWords={ctx.muted ? MUTED_WORDS : ""}
      />
    </div>
  );
}
