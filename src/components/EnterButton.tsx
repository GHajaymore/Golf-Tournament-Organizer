"use client";

import React, { useState, useTransition } from "react";
import Link from "next/link";
import { Icon } from "@/components/Icon";
import { enterThisTournament } from "@/app/actions/enter";

/**
 * ONE TAP, FOR SOMEBODY THE CLUB ALREADY KNOWS.
 *
 * `/register/[token]` is a PUBLIC form for a stranger on a shared link and
 * asks for a name, an email, a handicap and a tee. A signed-in member has all
 * four on the roster, and was being sent to type them again to enter their own
 * club's tournament from their own Events screen.
 *
 * THE FORM IS NOT REPLACED. It is the door for guests, for a society's
 * visitors and for anybody without an account, and it stays exactly as it is.
 * This is the same entry by the other door — see `enterThisTournament`, which
 * shares `decideIntake` with it so the two cannot land an entry in different
 * places.
 *
 * WHAT IT SAYS BACK IS WHERE THE ENTRY LANDED, not "done". A club running
 * approve mode puts every entry in front of a human, and a full field puts it
 * on the waiting list — a member who taps Enter and reads "You're in" when
 * they are actually ninth on a list has been told something false by a button.
 *
 * The link stays as the fallback for a refusal this cannot resolve, because a
 * screen whose only affordance has just failed leaves a member with nowhere to
 * go — the same reason `WayForward` exists.
 */
export function EnterButton({
  eventId,
  href,
  style,
}: {
  eventId: string;
  /** The public form, kept as the way out when the one tap is refused. */
  href: string;
  style?: React.CSSProperties;
}) {
  /**
   * NO `router.refresh()` HERE, deliberately.
   *
   * `enterThisTournament` calls `revalidatePath` for the screens a new entry
   * changes, and an action invoked from a client component refreshes the route
   * it was called from when it revalidates — so the refresh was belt and
   * braces on top of the server already doing it.
   *
   * It was also a real cost: `useRouter` needs an App Router mounted, and
   * `render.test.tsx` mounts components on their own. Five assertions about
   * the events list went red with "invariant expected app router to be
   * mounted" — a component that cannot be rendered in isolation is one no
   * render test can ever cover.
   */
  const [pending, start] = useTransition();
  const [done, setDone] = useState<"confirmed" | "waitlisted" | "pending" | null>(null);
  const [error, setError] = useState("");

  if (done) {
    return (
      <span
        className="text-muted"
        style={{ ...style, display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13.5 }}
      >
        <Icon name="check" />
        {done === "confirmed"
          ? "You're in — see you there."
          : done === "waitlisted"
            ? "You're on the waiting list. The organizer will confirm if a place opens."
            : "Sent to the organizer to approve."}
      </span>
    );
  }

  return (
    <span style={{ ...style, display: "flex", flexDirection: "column", gap: 6 }}>
      <button
        type="button"
        className="btn btn-primary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError("");
            const res = await enterThisTournament(eventId);
            if (res.ok && res.status) {
              setDone(res.status);
              return;
            }
            setError(res.error ?? "That didn't work.");
          })
        }
      >
        {pending ? "Entering…" : "Enter this tournament"} <Icon name={pending ? "hourglass" : "arrow-right"} />
      </button>
      {error && (
        <span className="text-muted" style={{ fontSize: 12.5 }}>
          {error}{" "}
          <Link href={href} style={{ color: "var(--color-accent-300)", fontWeight: 600 }}>
            Use the entry form
          </Link>
        </span>
      )}
    </span>
  );
}
