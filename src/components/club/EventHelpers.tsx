import { loadEventState } from "@/lib/services/tournament";
import { AccessClient } from "@/components/AccessClient";
import { emailConfig } from "@/lib/email";
import { emailTroubleFor } from "@/lib/services/email-trouble";
import { Icon } from "@/components/Icon";
import { golfTermsForEvent } from "@/lib/services/organization";

/**
 * WHO MAY OPEN THIS TOURNAMENT'S CONSOLE (R7, moved out of `/access`'s page so two screens can draw it).
 *
 * A server component with no directive: the mail-trouble cards and the helpers' list, for ONE event. It
 * decides nothing about who may see it; the page that mounts it has already asked the event role
 * (`requireScreen("access")` on `/access`, `canAccessScreen(viewRole, "access")` on Club settings), and
 * every press is checked again by its action (`addAccount`, `setAccountRole`, `removeAccount`).
 *
 * Mounted ONCE per request: by `/access` while Club settings' own tab is not shown, and by Club settings'
 * "On this event" while it is (`shown.has("clubSettings")`, `the-club-settings-screen.test.ts`).
 */
export async function EventHelpers({ eventId, organizationId }: { eventId: string; organizationId: string }) {
  const state = await loadEventState(eventId);
  if (!state) return null;
  const mail = emailConfig();
  const trouble = await emailTroubleFor(organizationId);
  // The club's word for who runs it — organizer or organiser (`golf-terms.ts`).
  const { organizer } = await golfTermsForEvent(eventId);

  return (
    <>
      {/* Sign-in depends on outbound email working. A broken mail config is
          invisible from the reset form by design (saying anything there would
          leak which addresses are registered), so it surfaces here instead. */}
      {mail.problem && (
        <div
          className="card elev-sm"
          style={{
            marginBottom: 16,
            borderLeft: `3px solid ${mail.configured ? "var(--color-accent)" : "var(--color-danger)"}`,
            gap: 4,
          }}
        >
          <span className="card-title" style={{ fontSize: 14 }}>
            <Icon name={mail.configured ? "ph ph-warning" : "ph ph-warning-circle"} />{" "}
            {mail.configured ? "Reset emails may not reach players" : "Password reset is not working"}
          </span>
          <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
            {mail.problem}
          </p>
        </div>
      )}

      {/* Sends are fire-and-forget by design, so a refused email has nowhere
          else to appear. Below the configuration warning because that one is
          about mail being broken for everyone, and this one is about specific
          people who were missed. */}
      {trouble && (
        <div
          className="card elev-sm"
          style={{
            marginBottom: 16,
            borderLeft: `3px solid ${
              trouble.severity === "danger" ? "var(--color-danger)" : "var(--color-accent)"
            }`,
            gap: 4,
          }}
        >
          <span className="card-title" style={{ fontSize: 14 }}>
            <Icon name={trouble.severity === "danger" ? "ph ph-warning-circle" : "ph ph-warning"} />{" "}
            {trouble.title}
          </span>
          <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
            {trouble.detail}
          </p>
        </div>
      )}

      <AccessClient
        accounts={state.accounts.map((a) => ({ id: a.id, name: a.name, email: a.email, role: a.role }))}
        organizer={organizer}
      />
    </>
  );
}
