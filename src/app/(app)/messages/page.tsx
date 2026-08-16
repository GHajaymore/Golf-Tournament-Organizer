import { requireScreen } from "@/lib/page-helpers";
import { redirect } from "next/navigation";
import { membershipFor, threadsFor, composableScopes, messageableField, messagesOptOutFor } from "@/lib/services/messaging";
import { MessagesClient } from "@/components/MessagesClient";

/**
 * Messages.
 *
 * Everything on this page is derived from where the reader sits in the
 * tournament — see domain/messaging.ts. The page never passes an id it was
 * given; it builds the membership from the session and asks for what that
 * membership can see.
 */
export default async function MessagesPage() {
  const session = await requireScreen("messages");

  // `session.role`, not viewRole: an organizer previewing as a player should
  // see the app as a player does, but hiding their own staff conversation from
  // them while replies keep arriving in it is not a preview, it is a bug.
  const ctx = await membershipFor(session.eventId, session.email, session.role);
  if (!ctx) redirect("/");

  const [threads, composable, people, optedOut] = await Promise.all([
    threadsFor(ctx),
    composableScopes(ctx),
    // The address book: this tournament's field, minus anyone who has turned
    // direct messages off — exactly who `openDirectThread` will accept, so the
    // picker cannot offer somebody the endpoint will refuse.
    messageableField(ctx),
    messagesOptOutFor(ctx),
  ]);

  const isStaff = session.role === "admin" || session.role === "assistant";

  return (
    <>
      <div style={{ marginBottom: 20 }}>
        <div className="page-kicker">Talk</div>
        <h2 style={{ fontSize: 27, margin: "5px 0 0" }}>Messages</h2>
        <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
          {isStaff
            ? "Reach the whole club, one flight, one round, or one player."
            : "Your group, your flight, your match, and anyone in the field."}
        </p>
      </div>
      <MessagesClient
        threads={threads}
        composable={composable}
        people={people}
        isStaff={isStaff}
        optedOut={optedOut}
      />
    </>
  );
}
