import Link from "next/link";
import { requireSession } from "@/lib/page-helpers";
import { signOutAction } from "@/app/actions/auth";
import { NOINDEX } from "@/lib/site";
import { LOGO_SIZE } from "@/components/Logo";
import { Lockup } from "@/components/Lockup";
import { Icon } from "@/components/Icon";
import { DeleteAccount } from "@/components/DeleteAccount";
import { soleOwnedClubs } from "@/lib/services/account-deletion";

// Behind a session, and about one person.
export const metadata = { title: "Your account", robots: NOINDEX };

/**
 * YOUR ACCOUNT (2026-10-03).
 *
 * There was no page about the person at all — only about their clubs and
 * tournaments — so there was nowhere to delete an account from. Standalone,
 * like `/choose`, because organizers and players both reach it, and neither
 * shell is the other's. It says who is signed in, offers a new password by the
 * same reset email the sign-in page uses, and holds the deletion.
 */
export default async function AccountPage() {
  const session = await requireSession();
  const soleOwnerOf = await soleOwnedClubs(session.userId);

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "64px 16px",
        background: "var(--color-bg)",
        color: "var(--color-text)",
      }}
    >
      <div style={{ width: "min(640px, 100%)", display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <Lockup size={LOGO_SIZE.md} />
          <form action={signOutAction}>
            <button type="submit" className="btn btn-secondary" style={{ fontSize: 12 }}>
              <Icon name="sign-out" /> Sign out
            </button>
          </form>
        </div>

        <div>
          <div className="page-kicker">Signed in as {session.name}</div>
          <h1 style={{ fontSize: 32, margin: "8px 0 4px" }}>Your account</h1>
          <p className="text-muted" style={{ fontSize: 14, margin: 0 }}>{session.email}</p>
        </div>

        <section className="card elev-sm" style={{ gap: 8 }}>
          <h2 className="card-title" style={{ fontSize: 15 }}>Password</h2>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55 }}>
            To change it, sign out and choose <strong>Forgot?</strong> on the sign-in form. A link is sent to{" "}
            {session.email}, and it works for 15 minutes.
          </p>
        </section>

        <DeleteAccount email={session.email} soleOwnerOf={soleOwnerOf} />

        <p style={{ margin: 0 }}>
          <Link href="/choose" className="btn btn-secondary">
            <Icon name="arrow-left" /> Back to your tournaments
          </Link>
        </p>
      </div>
    </div>
  );
}
