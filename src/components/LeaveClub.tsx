"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { leaveOrganization } from "@/app/actions/organization";
import { ConfirmButton } from "./ConfirmButton";

/**
 * "Leave this club", on Your account (2026-10-11).
 *
 * Somebody added as staff is staff at once — there is no invitation to accept
 * — so this is where they decline. Two presses, like every control that takes
 * something away. The club's only Commissioner is told why they cannot go
 * instead of being offered a button that would refuse.
 *
 * THE WORDS ARE FOR EVERYBODY ON THE LIST (2026-10-12). This read "Clubs you
 * help run … your staff role" to all of them, and most of the people on a
 * club's list are its Members and Guests, who run nothing: only a Commissioner
 * or an Admin has organizer rights (`orgRoleGrantsAdmin`). The role is named
 * beside each club; the sentence above them is true of all four.
 */
export function LeaveClub({ clubs }: { clubs: Array<{ organizationId: string; name: string; roleName: string; onlyOwner: boolean }> }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const leave = (organizationId: string) => {
    setError("");
    startTransition(async () => {
      const res = await leaveOrganization(organizationId);
      if (!res.ok) setError(res.error ?? "Couldn't do that just now.");
      else router.refresh();
    });
  };

  return (
    <section className="card elev-sm" style={{ gap: 10 }}>
      <h2 className="card-title" style={{ fontSize: 15 }}>Your clubs</h2>
      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55 }}>
        A club adds people by email address, so you may be on a list you did not ask to join. Leaving takes you off
        that club&rsquo;s list and nothing else: tournaments you entered and your results stay as they are.
      </p>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        {clubs.map((c) => (
          <li key={c.organizationId} style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 14, minWidth: 0 }}>
              <strong>{c.name}</strong> <span className="text-muted">&middot; {c.roleName}</span>
            </span>
            {c.onlyOwner ? (
              <span className="text-muted" style={{ fontSize: 13 }}>
                You are its only Commissioner, so you can&rsquo;t leave it.
              </span>
            ) : (
              <ConfirmButton
                onConfirm={() => leave(c.organizationId)}
                label="Leave this club"
                confirmLabel={`Leave ${c.name}`}
                title={`Come off the list at ${c.name}`}
                icon="sign-out"
                className="btn btn-secondary"
                disabled={pending}
                note="You can be added again."
              />
            )}
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" style={{ margin: 0, fontSize: 13, color: "var(--color-danger)" }}>
          {error}
        </p>
      )}
    </section>
  );
}
