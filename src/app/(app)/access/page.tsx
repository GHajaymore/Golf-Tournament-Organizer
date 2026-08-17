import { requireScreen } from "@/lib/page-helpers";
import { loadEventState } from "@/lib/services/tournament";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { AccessClient } from "@/components/AccessClient";
import { emailConfig } from "@/lib/email";
import { emailTroubleFor } from "@/lib/services/email-trouble";

export default async function AccessPage() {
  await requireScreen("access");
  const session = await getSession();
  if (!session) redirect("/");
  const state = await loadEventState(session.eventId);
  if (!state) redirect("/");
  const mail = emailConfig();
  const trouble = await emailTroubleFor(state.event.organizationId);

  return (
    <>
      <div style={{ marginBottom: 20 }}>
        <div className="page-kicker">Set up</div>
        <h2 style={{ fontSize: 27, margin: "5px 0 0" }}>Access control</h2>
        <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
          Organizers get full admin access. Players get read-only leaderboard/stats plus score entry for their own
          matches.
        </p>
      </div>
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
            <i className={mail.configured ? "ph ph-warning" : "ph ph-warning-circle"} />{" "}
            {mail.configured ? "Reset emails may not reach players" : "Password reset is not working"}
          </span>
          <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
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
            <i className={trouble.severity === "danger" ? "ph ph-warning-circle" : "ph ph-warning"} />{" "}
            {trouble.title}
          </span>
          <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
            {trouble.detail}
          </p>
        </div>
      )}

      <AccessClient
        accounts={state.accounts.map((a) => ({ id: a.id, name: a.name, email: a.email, role: a.role }))}
      />
    </>
  );
}
