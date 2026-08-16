import { redirect } from "next/navigation";
import { requireSession } from "@/lib/page-helpers";
import { membershipFor, threadsFor, composableScopes, messageableField, messagesOptOutFor } from "@/lib/services/messaging";
import { MessagesClient } from "@/components/MessagesClient";

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
  const session = await requireSession();
  if (!session.eventId) redirect("/choose");

  const ctx = await membershipFor(session.eventId, session.email, session.role);
  if (!ctx) redirect("/choose");

  const [threads, composable, people, optedOut] = await Promise.all([
    threadsFor(ctx),
    composableScopes(ctx),
    messageableField(ctx),
    messagesOptOutFor(ctx),
  ]);

  const isStaff = session.role === "admin" || session.role === "assistant";

  return (
    <div>
      <h1 style={{ fontFamily: "var(--font-heading)", fontSize: 24, margin: "0 0 4px" }}>Messages</h1>
      <p style={{ margin: "0 0 16px", fontSize: 13.5, color: "var(--color-neutral-400)" }}>
        Your group, your flight, your match — and anyone in the field.
      </p>
      <MessagesClient
        threads={threads}
        composable={composable}
        people={people}
        isStaff={isStaff}
        optedOut={optedOut}
      />
    </div>
  );
}
