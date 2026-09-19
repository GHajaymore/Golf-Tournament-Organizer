import Link from "next/link";
import { requireSession } from "@/lib/page-helpers";
import { brandForEvent } from "@/lib/services/organization";
import { scoreboardCss } from "@/lib/themes";
import { CurrencyProvider } from "@/components/CurrencyProvider";
import { formattingForEvent } from "@/lib/services/organization";
import { DEFAULT_LOCALE } from "@/lib/domain/locale";
import { DEFAULT_CURRENCY } from "@/lib/domain/money-format";
import { OrgBrand } from "@/components/OrgBrand";
import { NOINDEX } from "@/lib/site";

// Every player screen — their card, their board, their money, their messages.
// Declared on the layout so a screen added later inherits it.
export const metadata = { robots: NOINDEX };
import { PlayTabs } from "@/components/PlayTabs";
import { usesExpenses } from "@/lib/services/expenses";
import { membershipFor, unreadTotal } from "@/lib/services/messaging";
import { BackLink } from "@/components/BackLink";
import { PlayerSignOut } from "@/components/PlayerSignOut";
import { Icon } from "@/components/Icon";
import { TournamentSwitcher } from "@/components/TournamentSwitcher";
import { clubEventsFor } from "@/lib/services/club-events";
import { switcherFor } from "@/lib/domain/tournament-switcher";

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
 * THE SCOREBOARD, NOT THE CLUB'S THEME — since 2026-09-19. The club chose the
 * hand-hung scoreboard (design D) for Today and then for the whole player app,
 * so every screen in this shell is drawn on `SCOREBOARD_GROUND`: a deep green
 * field, cream lettering, the TourneyHQ orange to press and scoreboard red for
 * under par. The console keeps the club's theme and its ground setting; the
 * note on SCOREBOARD_GROUND in themes.ts says why this one divergence is a
 * product decision rather than a club setting.
 */
export default async function PlayLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const brand = session.eventId ? await brandForEvent(session.eventId) : null;
  /**
   * The fifth tab appears only where the tournament is actually splitting
   * costs — a league that never buys a round together keeps its four.
   *
   * EXACTLY WHEN THE PAGE WILL OPEN (2026-09-19). Staff used to see it
   * regardless, "so somebody can add the FIRST expense" — but `usesExpenses`
   * reads the tournament's money SETTING, not whether anything has been spent,
   * and the Money page redirects to Today whenever it is false. So for staff
   * on a tournament without money the tab was a door that bounced them back.
   * The setting is turned on in the console; once it is, everyone has the tab.
   *
   * And not while WATCHING: the page redirects anyone who is neither in the
   * field nor on the ledger, so the tab would do the same to a spectator.
   * `watching` is filled in below, once the switcher has been worked out.
   */
  const isStaff = session.role === "admin" || session.role === "assistant";
  const moneyOn = session.eventId ? await usesExpenses(session.eventId) : false;

  /**
   * Messages sit in the header, not the tab bar.
   *
   * PlayTabs says four and means it — "if a fifth is ever needed, something
   * here should have to leave" — and nothing here should. A chat icon with an
   * unread count is also simply where people look for messages on a phone, so
   * respecting that rule cost nothing.
   */
  const ctx = session.eventId
    ? await membershipFor(session.eventId, session.email, session.role)
    : null;
  const unread = ctx ? await unreadTotal(ctx) : 0;
  // Which tournament every tab is showing, and the way to the others. The same
  // rows the events list renders, so the two cannot disagree about a door.
  const switcher = switcherFor(await clubEventsFor(session.email), session.eventId ?? null, isStaff);
  /**
   * The club's currency, for the player half too.
   *
   * The organizer layout has provided this since the money work; this one
   * never did, so every amount a PLAYER saw fell back to the default while
   * the same club's organizer screens were correct. One club showing two
   * currencies to its two halves is worse than either being wrong alone.
   */
  const fmt = session.eventId
    ? await formattingForEvent(session.eventId)
    : { locale: DEFAULT_LOCALE, currency: DEFAULT_CURRENCY };

  return (
    <CurrencyProvider currency={fmt.currency} locale={fmt.locale}>
    <div
      id="player-theme"
      style={{
        colorScheme: "dark",
        minHeight: "100vh",
        background: "var(--color-bg)",
        color: "var(--color-text)",
        fontFamily: "var(--font-body)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <style dangerouslySetInnerHTML={{ __html: scoreboardCss("#player-theme") }} />

      {/* Off the printout with the tab bar — see the note on PlayTabs. A
          player printing their card was getting the club lockup, the messages
          button and a sign-out control on the paper. */}
      <header
        className="no-print"
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
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Link
            href="/me/messages"
            aria-label={unread > 0 ? `Messages, ${unread} unread` : "Messages"}
            className="btn btn-secondary"
            style={{ fontSize: 12.5, position: "relative", padding: "6px 10px" }}
          >
            <Icon name="chat-circle-dots" style={{ fontSize: 17 }} />
            {unread > 0 && (
              <span
                aria-hidden
                style={{
                  position: "absolute",
                  top: -5,
                  right: -5,
                  minWidth: 17,
                  height: 17,
                  borderRadius: 999,
                  background: "var(--color-accent)",
                  color: "var(--color-on-accent)",
                  fontSize: 10.5,
                  fontWeight: 700,
                  display: "grid",
                  placeItems: "center",
                  padding: "0 4px",
                }}
              >
                {unread > 9 ? "9+" : unread}
              </span>
            )}
          </Link>
          {(session.viewRole === "admin" || session.viewRole === "assistant") && (
            <Link
              href="/dashboard"
              className="btn btn-secondary"
              style={{ fontSize: 12.5, whiteSpace: "nowrap" }}
            >
              <Icon name="gear" /> Organizer
            </Link>
          )}
          {/* Last, and an icon, because it is the control you want findable and
              never want to hit by accident. The shell had none at all: a player
              signing in on a phone passed round a fourball, or on the clubhouse
              iPad, left the next person signed in as them. */}
          <PlayerSignOut name={session.name} />
        </div>
      </header>

      <TournamentSwitcher switcher={switcher} />

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

      <PlayTabs showMoney={moneyOn && !switcher.current?.watching} />
    </div>
    </CurrencyProvider>
  );
}
