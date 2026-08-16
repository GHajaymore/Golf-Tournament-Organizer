import { openRegistrationView, registrationPrefillFor } from "@/lib/services/registration";
import { getSession } from "@/lib/auth";
import { OrgBrand } from "@/components/OrgBrand";
import { RegisterClient } from "@/components/RegisterClient";

/**
 * The public self-service registration page.
 *
 * Outside the (app) group on purpose, exactly like /live and /play: whoever
 * opens this holds a link, not an account — no sidebar, no role, no console.
 * The link is the only credential and it grants one thing: entering this one
 * tournament's field.
 *
 * A live link shows the branded form. Everything else — unknown token, closed
 * registration, passed deadline — renders the same neutral "not open" state, so
 * the page can never be used to confirm that a tournament exists.
 */

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const view = await openRegistrationView(token);
  // Don't leak the event's name through the tab title when the link isn't live.
  if (!view) return { title: "Registration" };
  return { title: `Register — ${view.eventName}` };
}

const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  background: "var(--color-bg)",
  color: "var(--color-text)",
  fontFamily: "var(--font-body)",
  padding: "22px 18px 48px",
};

function NotOpen() {
  return (
    <div style={pageStyle}>
      <div style={{ maxWidth: 440, margin: "0 auto", paddingTop: "12vh", textAlign: "center" }}>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 18 }}>
          <OrgBrand brand={null} />
        </div>
        <div className="card elev-sm" style={{ alignItems: "center", gap: 8 }}>
          <i className="ph ph-lock-simple" style={{ fontSize: 26, color: "var(--color-neutral-500)" }} />
          <h1 style={{ fontSize: 19, margin: 0, fontFamily: "var(--font-heading)" }}>
            This registration link isn&rsquo;t open
          </h1>
          <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
            It may not have opened yet, or registration has closed. Check with whoever shared it.
          </p>
        </div>
      </div>
    </div>
  );
}

export default async function PublicRegisterPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const view = await openRegistrationView(token);
  if (!view) return <NotOpen />;

  // If someone's signed in (an organizer testing, or a member who already has an
  // account), fill the form from what we know of them by email — one-tap
  // register rather than retyping their own details.
  const session = await getSession();
  const prefill = session?.email ? await registrationPrefillFor(token, session.email) : null;

  const venueLine = [view.dates, view.venue].filter(Boolean).join(" · ");

  return (
    <div style={pageStyle}>
      <div style={{ maxWidth: 460, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 22 }}>
          <OrgBrand brand={view.brand} />
        </div>

        <div style={{ marginBottom: 18 }}>
          <div className="page-kicker">Registration</div>
          <h1 style={{ fontSize: 25, margin: "5px 0 0", fontFamily: "var(--font-heading)" }}>{view.eventName}</h1>
          {venueLine && (
            <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
              {venueLine}
            </p>
          )}
        </div>

        <RegisterClient
          token={view.token}
          eventName={view.eventName}
          formatLabel={view.formatLabel}
          regDeadline={view.regDeadline}
          waitlistOnly={view.waitlistOnly}
          spotsLeft={view.spotsLeft}
          approvalMode={view.approvalMode}
          requirePhone={view.requirePhone}
          prefill={prefill}
        />

        {/* The one place a member of the public hands us their own details, so
            it is the one place the notice has to be — not buried in a footer. */}
        <p className="text-muted" style={{ fontSize: 11, marginTop: 18, textAlign: "center" }}>
          No account needed — just your details. The organizer uses them to run this event; see how
          they are handled in our <a href="/privacy">privacy notice</a>.
        </p>
      </div>
    </div>
  );
}
