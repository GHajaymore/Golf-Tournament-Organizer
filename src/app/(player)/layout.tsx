import Link from "next/link";
import { requireSession } from "@/lib/page-helpers";
import { brandForEvent, themeForEvent } from "@/lib/services/organization";
import { themeCss, playerColorScheme } from "@/lib/themes";
import { OrgBrand } from "@/components/OrgBrand";
import { PlayTabs } from "@/components/PlayTabs";
import { usesExpenses } from "@/lib/services/expenses";
import { BackLink } from "@/components/BackLink";

/**
 * The player's app.
 *
 * A separate shell from the console on purpose. An organizer works at a desk
 * and wants density — every column, bulk edits, keyboard flow. A player is
 * one-handed on a phone, in sun, halfway down a fairway, and wants three
 * numbers and a big target. One responsive layout serving both is why the
 * mobile app felt like a shrunken console: the structure was the console's.
 *
 * So the console keeps its sidebar and its 34px controls, and this gets four
 * tabs and nothing else. Underneath they share the same services and the same
 * scoring engine — the split is in presentation only, which is what keeps the
 * two from disagreeing about who is winning.
 *
 * Same ground as the console, from the club's one theme setting. The shells
 * differ in structure — four tabs against fifteen screens — and not in
 * palette, so a club that has picked its look gets that look wherever anyone
 * opens the app. `auto` resolves dark unless the device asks for light.
 */
export default async function PlayLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const brand = session.eventId ? await brandForEvent(session.eventId) : null;
  const theme = await themeForEvent(session.eventId);
  /**
   * The fifth tab appears only where the tournament is actually splitting
   * costs — a league that never buys a round together keeps its four.
   *
   * Staff see it regardless, because somebody has to be able to add the FIRST
   * expense: a tab that only appears once the feature has been used is a tab
   * nobody can ever reach. The organizer starts the ledger, and from that
   * moment every player on the outing has it too.
   */
  const isStaff = session.role === "admin" || session.role === "assistant";
  const showMoney = session.eventId ? isStaff || (await usesExpenses(session.eventId)) : false;

  return (
    <div
      id="player-theme"
      style={{
        colorScheme: playerColorScheme(theme),
        minHeight: "100vh",
        background: "var(--color-bg)",
        color: "var(--color-text)",
        fontFamily: "var(--font-body)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <style dangerouslySetInnerHTML={{ __html: themeCss(theme, "#player-theme") }} />

      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          // Pays back the top inset that viewportFit:"cover" opts into.
          padding: "calc(14px + env(safe-area-inset-top, 0px)) calc(16px + env(safe-area-inset-right, 0px)) 14px calc(16px + env(safe-area-inset-left, 0px))",
          borderBottom: "1px solid var(--color-divider)",
          position: "sticky",
          top: 0,
          zIndex: 20,
          background: "color-mix(in srgb, var(--color-bg) 92%, transparent)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
        }}
      >
        {/* Brand on a tab root; a way back on anything deeper. Inside an
            installed PWA there is no browser chrome, so without this a
            sub-screen is a room with no door. */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <BackLink />
          <OrgBrand brand={brand} />
        </div>
        {/* The way back for someone who is both — an organizer who also plays
            should not have to sign out to run their own tournament. Rendered
            only for staff; a player has nothing to switch to. */}
        {(session.viewRole === "admin" || session.viewRole === "assistant") && (
          <Link
            href="/dashboard"
            className="btn btn-secondary"
            style={{ fontSize: 12.5, whiteSpace: "nowrap" }}
          >
            <i className="ph ph-gear" /> Organizer
          </Link>
        )}
      </header>

      <main
        style={{
          flex: 1,
          width: "100%",
          maxWidth: 620,
          margin: "0 auto",
          padding: "18px calc(16px + env(safe-area-inset-right, 0px)) 92px calc(16px + env(safe-area-inset-left, 0px))",
        }}
      >
        {children}
      </main>

      <PlayTabs showMoney={showMoney} />
    </div>
  );
}
