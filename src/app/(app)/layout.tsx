import { NOINDEX } from "@/lib/site";
import { Sidebar } from "@/components/Sidebar";
import { MobileTopBar } from "@/components/MobileTopBar";
import { MobileTabBar } from "@/components/MobileTabBar";
import { EventContextBar } from "@/components/EventContextBar";
import { navForRole } from "@/lib/nav";
import { loadEventState } from "@/lib/services/tournament";
import { roundLabelWith } from "@/lib/domain/round-label";
import { requireSession, initialsOf } from "@/lib/page-helpers";
import { prisma } from "@/lib/db";
import { brandForEvent, themeForEvent, styleForEvent, formattingForEvent } from "@/lib/services/organization";
import { DEFAULT_STYLE } from "@/lib/styles";
import { DEFAULT_LOCALE } from "@/lib/domain/locale";

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
import { OrgProfileProvider } from "@/components/OrgProfileProvider";
import { themeCss, DEFAULT_CLUB_THEME } from "@/lib/themes";
import { settingsOf } from "@/lib/services/tournament";
import { TEAM_FORMAT_NAMES } from "@/lib/formats";
import { KNOCKOUT_STAGE_TYPES, WEEKLY_ROUND_TYPES } from "@/lib/stage-types";
import { myPlayerIds } from "@/lib/services/me";
import { isMatch } from "@/lib/tournament-shape";
import { isOrgKind, orgProfile } from "@/lib/domain/org-profile";
import { organizationsForOrganizer } from "@/lib/services/organization";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const initials = initialsOf(session.name);
  const event = await prisma.event.findUnique({
    where: { id: session.eventId },
    // The organization's KIND rides along on a query that already runs, so the
    // sidebar can call the settings screen what it actually is without costing
    // a second round trip on every page in the console.
    // `country` rides along with it, because it decides what that kind is
    // CALLED: a community is a society in Britain and a league in the United
    // States. One query, both facts, so the word and the kind cannot come
    // from different places and disagree.
    // And `communityNoun` with them, which BEATS the country: the country is
    // only ever a good guess, and a US outfit that has always called itself a
    // society is not wrong about its own name.
    include: { organization: { select: { kind: true, country: true, communityNoun: true } } },
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
        where: { eventId: event.id, type: { in: [...KNOCKOUT_STAGE_TYPES] } },
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

  /**
   * WHICH ROUND the sidebar's round section is about.
   *
   * The five screens under that heading — tee sheet, score entry, leaderboard,
   * bracket, this week — all describe ONE round, and until this they sat under
   * headings that never said which. On a tournament whose rounds are each a
   * different format, "Live leaderboard" with no round named is an incomplete
   * sentence.
   *
   * `loadEventState` is the ONLY honest source: `currentPlayedRoundIndex`
   * inside it is what every board on every screen already reads. The cheap
   * alternative — the latest round whose `playedOn` has passed — is a second
   * reader of a settled question and would disagree with the boards on exactly
   * the tournaments where it matters: a round dated today nobody has teed off
   * in, a round played early.
   *
   * It costs nothing on the 13 console pages that load this state themselves,
   * because it is `cache`d per request and theirs is the same call. It is a
   * real extra load on the others, and that is the price of the sidebar
   * agreeing with the screen beside it rather than guessing.
   *
   * Suffix is the round's FORMAT, falling back to its stage type — the same
   * pair `dashboard` and `teams` already pass to this function, so the sidebar
   * cannot name a round differently from the screens it links to.
   *
   * IT IS `boardStage`, NOT `activeStage`, AND THE DIFFERENCE IS THE WHOLE
   * POINT OF THIS HEADING. `EventState` carries THREE round answers, because
   * three different questions are being asked:
   *
   *   activeStage        the match-points chain's position — prefers a round
   *                      still IN PROGRESS over the last one played
   *   boardStage         the later of that and the last round with something
   *                      on it — what every BOARD shows
   *   nextUnplayedRound  the first round nobody has started — what a tee
   *                      sheet is drawn for
   *
   * Written first with `activeStage`, which was wrong and would have built
   * exactly the defect the comment above congratulates itself on avoiding: a
   * heading naming one round with the leaderboard directly beneath it showing
   * another. `boardStage` exists BECAUSE four boards each wrote
   * `activeStage ?? stages[0]` and all showed Week 1 of a three-week league
   * with cards in on Week 3.
   *
   * So the heading takes the board's answer. `/leaderboard` reads only
   * `boardStage`, `/entry` reads it too, and those are the two screens under
   * this heading somebody will compare it against.
   *
   * `/foursomes` is the known exception and is not a disagreement: a tee sheet
   * is drawn for a round nobody has played yet, so it is FORWARD-looking by
   * design and reads all three. A heading that refused to name a round
   * whenever the tee sheet pointed elsewhere would be silent almost always,
   * which trades a small honest imprecision for a large useless one.
   */
  const roundState = event ? await loadEventState(event.id) : null;
  const boardRound = roundState?.boardStage ?? null;
  const roundName = boardRound
    ? roundLabelWith(roundState!.playRounds, boardRound.id, boardRound.format || boardRound.type)
    : undefined;

  /**
   * The club this person runs, asked for only when there is no tournament to
   * answer from — so the ordinary console request costs nothing extra.
   */
  const ownedOrgs = event ? [] : await organizationsForOrganizer(session.email);
  const orgKindNow = event?.organization.kind ?? ownedOrgs[0]?.kind ?? "";
  // From the SAME source as the kind, in the same order — a country read from
  // the tournament's club while the kind came from the organizer's own would
  // name one outfit after another.
  const orgCountryNow = event ? event.organization.country : (ownedOrgs[0]?.country ?? "");
  // From the same source and in the same order as the two above, for the same
  // reason: a noun read from the tournament's club while the kind came from
  // the organizer's own would name one outfit after another.
  const orgNounNow = event ? event.organization.communityNoun : (ownedOrgs[0]?.communityNoun ?? "");

  const sections = navForRole(session.viewRole, event ? settingsOf(event) : undefined, {
    hasTeamRound: teamRounds > 0,
    hasKnockout: knockoutRounds > 0,
    isLeague: playingRounds > 1,
    isPlayerToo: ownEntries > 0,
    isMatch: isMatch(event?.shape),
    /**
     * The outfit's own word for itself, from the club rather than from the
     * tournament — or the sidebar reads "Club settings" to a society that has
     * not created a tournament yet, which is the same two-names fault the
     * browser tab had.
     */
    outfit: isOrgKind(orgKindNow)
      ? orgProfile(orgKindNow, orgCountryNow, orgNounNow)
      : undefined,
    // A club with no tournament yet still has club settings to reach.
    orgAdminWithoutEvent: !event && ownedOrgs.length > 0,
    roundName,
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
  // The club's STYLE — the second axis beside colour, stamped as data-style.
  const style = session.eventId ? await styleForEvent(session.eventId) : DEFAULT_STYLE;
  // Beside the theme, for the same reason: one club decision, a dozen readers.
  const fmt = session.eventId
    ? await formattingForEvent(session.eventId)
    : { locale: DEFAULT_LOCALE, currency: DEFAULT_CURRENCY };

  return (
    <CurrencyProvider currency={fmt.currency} locale={fmt.locale}>
    {/* What kind of outfit this is, beside its currency and its theme — one
        fact about the organization read by a dozen screens that name it. A
        society is not a club, and the console said so in eight places. */}
    <OrgProfileProvider
      kind={orgKindNow || undefined}
      country={orgCountryNow || undefined}
      noun={orgNounNow || undefined}
    >
    <div
      id="club-theme"
      // Drives `color-scheme` in globals.css. Native form chrome — the date
      // picker especially — is the one thing custom properties can't reach,
      // and a black calendar popup on a white page is the tell that a light
      // theme was bolted on.
      data-appearance={theme.appearance}
      data-style={style}
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
    </OrgProfileProvider>
    </CurrencyProvider>
  );
}
