import Link from "next/link";
import { requireSession } from "@/lib/page-helpers";
import { prisma } from "@/lib/db";
import { playerAppShut } from "@/lib/domain/lifecycle-state";
import { brandForEvent, themeForEvent, styleForEvent } from "@/lib/services/organization";
import { themeCss, playerColorScheme, DEFAULT_CLUB_THEME } from "@/lib/themes";
import { DEFAULT_STYLE } from "@/lib/styles";
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
 * THE CLUB'S THEME, LIKE THE CONSOLE — reversed 2026-09-24. The player app
 * briefly wore a fixed hand-hung scoreboard (design D, 2026-09-19), the same
 * green field at every club. Ajay's call now is that the player app is
 * colour-changeable from the org console just like the console and the public
 * board: one club theme, chosen once in settings, drives all three. So this
 * shell renders `themeCss` for the event's club — the note above
 * `playerColorScheme` in themes.ts has always described this "one ground
 * everywhere" model, and it is true again. A club that wants the scoreboard
 * look simply picks a dark ground; `auto` still gives a phone in daylight the
 * light ground on the course, which is what the sunlight argument was about.
 */
export default async function PlayLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const brand = session.eventId ? await brandForEvent(session.eventId) : null;
  // The event's club theme — the same resolution the console and the public
  // board use, so all three surfaces recolour together from one club setting.
  const theme = session.eventId ? await themeForEvent(session.eventId) : DEFAULT_CLUB_THEME;
  // The club's STYLE — the second axis beside colour, stamped as data-style.
  const style = session.eventId ? await styleForEvent(session.eventId) : DEFAULT_STYLE;
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
   * IS THIS TOURNAMENT OPEN TO ITS PLAYERS YET.
   *
   * Launching locked setup and nothing else, so a player could reach the board
   * and their own card in a tournament the club was still building. Answered
   * here because this shell wraps every player screen — the reasoning the
   * metadata above is declared on, "so a screen added later inherits it".
   *
   * DRAFT ONLY. From `registration` onward there is something true to tell a
   * player — you are in, you are on the waiting list, you are not entered —
   * and shutting the app deletes those sentences. `playerAppShut` carries the
   * rule and the reasoning; staff are never shut out.
   */
  const gateEvent = session.eventId
    ? await prisma.event.findUnique({
        where: { id: session.eventId },
        select: { name: true, status: true, accessGated: true },
      })
    : null;
  const shut = gateEvent ? playerAppShut(gateEvent, isStaff) : false;

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
      data-style={style}
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
        {shut ? (
          /* A CLOSED DOOR THAT SAYS SO. Not a 404 and not an empty board: the
             tournament exists and this player was given a way in, so the only
             true thing to say is that the club has not finished building it.

             WITH AN H1, because every screen in this app carries one —
             `e2e/layout.spec.ts` demands it on every route and
             `verify-lifecycle.mjs` walks the player app at each stage asking
             for it. The first draft used a styled span and turned 30 checks
             red, which is the cheapest way this could have been learnt. */
          <div className="card elev-sm" style={{ gap: 10, textAlign: "center", padding: "28px 20px" }}>
            <h1 className="page-title" style={{ fontSize: 17, margin: 0 }}>
              {gateEvent?.name ?? "This tournament"} hasn&rsquo;t opened yet
            </h1>
            <p className="text-muted" style={{ fontSize: 13, lineHeight: 1.6, margin: 0 }}>
              Your club is still setting it up. Everything here — your card, the board, the tee
              sheet — opens as soon as they are ready, and you will not need to do anything.
            </p>
            <p className="text-muted" style={{ fontSize: 12.5, lineHeight: 1.6, margin: 0 }}>
              Playing in something else today? Use the switcher above.
            </p>
          </div>
        ) : (
          children
        )}
      </main>

      {/* A member with no place in the field has no stake in its pots, and
          that is true of somebody WAITING for one as much as of a spectator.
          Both named, because `watching` stopped covering the waiting list when
          the two were separated — see `isWaiting`. */}
      <PlayTabs showMoney={moneyOn && !switcher.current?.watching && !switcher.current?.waiting} />
    </div>
    </CurrencyProvider>
  );
}
