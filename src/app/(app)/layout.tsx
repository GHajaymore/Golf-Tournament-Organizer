import { NOINDEX } from "@/lib/site";
import { Sidebar } from "@/components/Sidebar";
import { MobileTopBar } from "@/components/MobileTopBar";
import { MobileTabBar } from "@/components/MobileTabBar";
import { EventContextBar } from "@/components/EventContextBar";
import { navForRole } from "@/lib/nav";
import { requireSession, initialsOf } from "@/lib/page-helpers";
import { prisma } from "@/lib/db";
import { brandForEvent, themeForEvent, currencyForEvent } from "@/lib/services/organization";

/**
 * Every organizer screen, in one declaration.
 *
 * On the LAYOUT rather than on twenty-two pages, so a console screen added
 * later inherits it instead of having to remember. Nothing here is reachable
 * without a session, so a crawler cannot read it — but a page that redirects
 * can still be listed by URL, and a rule stated once at the boundary is the
 * shape that does not rot.
 */
export const metadata = { robots: NOINDEX };
import { DEFAULT_CURRENCY } from "@/lib/domain/money-format";
import { CurrencyProvider } from "@/components/CurrencyProvider";
import { themeCss, DEFAULT_CLUB_THEME } from "@/lib/themes";
import { settingsOf } from "@/lib/services/tournament";
import { TEAM_FORMAT_NAMES } from "@/lib/formats";
import { WEEKLY_ROUND_TYPES } from "@/lib/stage-types";
import { cleanSideStyle, wantsTeams } from "@/lib/side-style";
import { myPlayerIds } from "@/lib/services/me";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const initials = initialsOf(session.name);
  const event = await prisma.event.findUnique({
    where: { id: session.eventId },
  });
  // Teams only appear once a round is actually set to a team format, so the
  // many tournaments that never play one are not shown a link to an empty
  // screen.
  const teamRounds = event
    ? await prisma.stage.count({ where: { eventId: event.id, format: { in: TEAM_FORMAT_NAMES } } })
    : 0;
  // Qualification is the preview of who advances to the knockout. Without a
  // knockout stage there is nothing to advance to, and the screen reports
  // "0 players qualify" for the many tournaments that simply end at the last
  // round.
  const knockoutRounds = event
    ? await prisma.stage.count({
        where: { eventId: event.id, type: { in: ["Bracket Stage", "Qualification Stage"] } },
      })
    : 0;
  // Screens the tournament governs (leaderboard, score entry) are filtered out
  // of the sidebar here rather than shown and then bounced.
  // "This week" earns a slot once there is more than one round to be a week
  // OF. One round is a medal, and the leaderboard already says everything the
  // weekly sheet would.
  const playingRounds = event
    ? await prisma.stage.count({
        where: { eventId: event.id, type: { in: [...WEEKLY_ROUND_TYPES] } },
      })
    : 0;
  // Whether this person is also in the field, which decides whether the play
  // shell is offered. Most club tournaments are run by someone playing in them.
  const ownEntries = event ? (await myPlayerIds(event.id, session.email)).size : 0;

  const sections = navForRole(session.viewRole, event ? settingsOf(event) : undefined, {
    hasTeamRound: teamRounds > 0,
    hasKnockout: knockoutRounds > 0,
    isLeague: playingRounds > 1,
    wantsTeams: event ? wantsTeams(cleanSideStyle(event.sideStyle)) : false,
    isPlayerToo: ownEntries > 0,
  });
  // Club branding replaces the TourneyHQ mark in the sidebar for every
  // tournament this organization runs (with attribution kept on free plans).
  const brand = session.eventId ? await brandForEvent(session.eventId) : null;
  // Applied inline on the wrapper so the club's colours arrive with the
  // server-rendered HTML. Injected later, the first paint would flash the
  // default orange before settling — a visible flicker of the wrong brand.
  const theme = session.eventId ? await themeForEvent(session.eventId) : DEFAULT_CLUB_THEME;
  // A stylesheet rather than an inline style attribute: "follow the device"
  // needs a media query, and an inline custom property outranks any rule, so
  // inlining would pin such a club to whichever mode happened to render.
  // themeCss emits only values it generated itself — see SAFE_CSS_VALUE.
  const themeStyleSheet = themeCss(theme, "#club-theme");
  // Beside the theme, for the same reason: one club decision, a dozen readers.
  const currency = session.eventId ? await currencyForEvent(session.eventId) : DEFAULT_CURRENCY;

  return (
    <CurrencyProvider currency={currency}>
    <div
      id="club-theme"
      // Drives `color-scheme` in globals.css. Native form chrome — the date
      // picker especially — is the one thing custom properties can't reach,
      // and a black calendar popup on a white page is the tell that a light
      // theme was bolted on.
      data-appearance={theme.appearance}
      style={{
        display: "flex",
        minHeight: "100vh",
        background: "var(--color-bg)",
        color: "var(--color-text)",
        fontFamily: "var(--font-body)",
      }}
    >
      <style dangerouslySetInnerHTML={{ __html: themeStyleSheet }} />
      {/* The club’s currency, beside its theme — one club decision read by
          every screen that writes an amount. */}
      <Sidebar
        sections={sections}
        name={session.name}
        role={session.role}
        viewRole={session.viewRole}
        initials={initials}
        brand={brand}
      />
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <MobileTopBar />
        {event && (
          <EventContextBar
            name={event.name}
            dates={event.dates}
            course={event.course}
            city={event.city}
            status={event.status}
            canSwitch={session.viewRole === "admin"}
          />
        )}
        <main className="app-main" style={{ flex: 1, minWidth: 0, padding: "26px 30px", maxWidth: 1220 }}>
          {children}
        </main>
      </div>
      <MobileTabBar
        sections={sections}
        name={session.name}
        role={session.role}
        viewRole={session.viewRole}
        initials={initials}
        brand={brand}
      />
    </div>
    </CurrencyProvider>
  );
}
