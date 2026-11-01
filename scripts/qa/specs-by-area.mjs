/**
 * WHICH BROWSER TESTS BELONG TO WHICH PART OF THE APP — the manifest a TARGETED round is cut from.
 *
 * The QA & Test Lead with the testing panel, 2026-11-01, on evidence: of eleven recent NOT CLEAN
 * rounds, eight failed in the area the change touched (two of those seen only by the screen-wide
 * sweeps), three outside it with none shown to be caused by the change, and one was the machine. So a
 * change of "function in one area" (TIERS in layers.mjs) runs that area's specs and scenarios PLUS
 * the screen-wide sweeps that found those two (ALWAYS_ON), instead of every spec; the full suite
 * still runs every night, and a commit that merged on a targeted round waits for a clean nightly
 * before production, as a core one does (`nightlyWait` in deploy-rules.mjs).
 *
 * FAIL-SAFE. `targetFor` in layers.mjs targets a change only when EVERY file it touches is either
 *   - a "function in one area" file that an area below names (`paths`), all of them in ONE area, or
 *   - an e2e spec that area lists, a unit test (`*.test.ts`, `src/lib/__tests__/`), or words.
 * Anything else — core, a shared component no area names, money or handicap arithmetic, `prisma/`,
 * `.github/`, `scripts/qa/`, an e2e helper, package files, the front door, a file nobody names — and
 * the change gets the full round it got before this file existed. A file missing from here is a
 * full round, never a smaller one: add an area only for code you can say belongs to it alone.
 *
 * `qa-framework.test.ts` holds this to the disk: every path and spec listed exists, every spec in
 * e2e/ is in an area, in ALWAYS_ON or in FULL_ONLY (so a new spec cannot be forgotten by targeting),
 * and an area whose specs read dates or zones visits all six countries.
 *
 * A pattern is a prefix ending in `/`, an exact path, or has one `*` inside a path part (as TIER_RULES).
 */

/**
 * WHAT EVERY TARGETED ROUND RUNS, whatever the area — at the viewports the full round runs them at
 * (the suite's three sizes, and the iPhone and Firefox layers', which run them in place of the whole
 * suite). Besides these specs a targeted round keeps, unchanged, every `pr` layer that runs a FIXED
 * list: the text-box crawl, the every-screen walks abroad, in an American club and on another day,
 * and Safari's and the iPad's screen layers (SCREEN_SPECS). And the reach check, held to the area's
 * own actions (merge.mjs).
 */
export const ALWAYS_ON = [
  // The smoke set in a browser: every screen opened as every kind of person, a 5xx or a thrown page a failure.
  "e2e/everything.spec.ts",
  // The console crawl: every dropdown, choice and tick-box changed, saved and read back (its four shares).
  "e2e/every-control.spec.ts",
  // Every server action called by somebody who may not.
  "e2e/every-action-vs-a-stranger.spec.ts",
  "e2e/a11y.spec.ts",
  "e2e/fonts.spec.ts",
  // Layout and legibility.
  "e2e/layout.spec.ts",
  "e2e/legible.spec.ts",
  "e2e/nothing-is-covered.spec.ts",
  "e2e/touch.spec.ts",
  // The text-box crawl. It runs as its own layer (`text-boxes`, below), and skips itself in the suite's
  // run exactly as it does in a full round's, so listing it here changes nothing but the bookkeeping.
  "e2e/every-text-box.spec.ts",
];

/** The layer of a round, beside the suite, that every targeted round keeps as it is: the text-box crawl. */
export const ALWAYS_ON_LAYERS = ["text-boxes"];

/**
 * The areas. `specs` are run in place of the whole suite; `scenarios` are SCENARIOS keys (layers.mjs)
 * played as well; `dateSensitive` puts all six countries in the round; `actions` are the server-action
 * files whose reach is held to reach-baseline.json in a targeted round.
 */
export const AREAS = {
  // Swept 2026-11-01 (the Operations/Reliability Lead's review of #982): every file listed here is
  // imported by nothing outside its area's own paths (`outsideImporters`, held by qa-framework.test.ts).
  // Taken out on that sweep, and so FULL rounds now: BracketClient, BracketModePicker,
  // ThirdPlaceControl, bracket-visibility; services/print-kit; lib/owner (core: sign-in-gate reads it);
  // services/early-list; RoundAvailability, RoundDaySetup, RoundExpiryBanner, RoundReadyCard,
  // RoundVenue, actions/round-day, actions/round-expiry; EnterButton, WithdrawButton, lib/registration,
  // services/registration, services/waitlist, actions/enter; TeeSheetPrint, actions/pairing,
  // services/pairing; EventReport, FinalReport, ReportRecapEditor, ReportTie, lib/report/,
  // services/event-report, services/final-report, services/event-report-sections; MessagesClient,
  // AnnouncementCard, AnnouncementList, FoldedAnnouncements, services/messaging, services/announcements,
  // actions/messaging, actions/draft-message; and the whole commentary area.
  bracket: {
    name: "Brackets and knockouts (the Bracket screen)",
    paths: ["src/app/(app)/bracket/", "src/components/BracketFlights.tsx", "src/components/BracketReports.tsx"],
    specs: [
      "e2e/bracket-sections.spec.ts",
      "e2e/organizer-knockout.spec.ts",
      "e2e/organizer-knockout-flights.spec.ts",
      "e2e/organizer-knockout-report.spec.ts",
      "e2e/knockout-flights-adjust.spec.ts",
      "e2e/draws-and-play-offs.spec.ts",
    ],
    scenarios: ["e"],
    dateSensitive: false,
    actions: [],
  },
  "print-kit": {
    name: "The print kit",
    paths: ["src/app/(app)/print/", "src/components/print/", "src/components/print-face.ts", "src/app/actions/print-kit.ts"],
    specs: ["e2e/print-kit.spec.ts", "e2e/print-kit-fits.spec.ts", "e2e/print.spec.ts"],
    scenarios: [],
    // It prints the day and the tee times.
    dateSensitive: true,
    actions: ["src/app/actions/print-kit.ts"],
  },
  owner: {
    name: "The owner console",
    paths: [
      "src/app/owner/",
      "src/components/OwnerAccounts.tsx",
      "src/components/OwnerClubPlan.tsx",
      "src/components/OwnerDiscounts.tsx",
      "src/components/OwnerLimits.tsx",
      "src/components/OwnerPricing.tsx",
      "src/components/OwnerDemoClub.tsx",
      "src/app/actions/owner.ts",
    ],
    specs: ["e2e/owner-console.spec.ts", "e2e/owner-console-refusals.spec.ts", "e2e/go-live-switch.spec.ts", "e2e/interest.spec.ts", "e2e/demo-club.spec.ts"],
    scenarios: [],
    // The demo club replays its days.
    dateSensitive: true,
    actions: ["src/app/actions/owner.ts"],
  },
  interest: {
    name: "The early list (/interest)",
    paths: ["src/app/interest/", "src/components/InterestForm.tsx", "src/app/actions/interest.ts"],
    specs: ["e2e/interest.spec.ts", "e2e/early-list-says-free-no-card.spec.ts"],
    scenarios: [],
    dateSensitive: false,
    actions: ["src/app/actions/interest.ts"],
  },
  rounds: {
    name: "Rounds and formats (the Rounds screen)",
    paths: ["src/app/(app)/stages/", "src/components/StagesClient.tsx", "src/components/RoundDeadlineControl.tsx", "src/components/RoundClosedControl.tsx"],
    specs: [
      "e2e/organizer-rounds-screen.spec.ts",
      "e2e/rounds-and-formats.spec.ts",
      "e2e/round-date-and-viewing-as.spec.ts",
      "e2e/round-day.spec.ts",
      "e2e/round-allowance.spec.ts",
      "e2e/team-allowance.spec.ts",
      "e2e/round-handicap.spec.ts",
    ],
    // Every scenario builds its rounds through this screen.
    scenarios: ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k"],
    dateSensitive: true,
    actions: [],
  },
  registration: {
    name: "Registration and entry (the Entries screen and the entry form)",
    paths: [
      "src/app/(app)/registration/",
      "src/app/register/",
      "src/components/RegistrationClient.tsx",
      "src/components/RegisterClient.tsx",
      "src/components/DisqualifyPanel.tsx",
      "src/app/actions/register.ts",
      "src/app/actions/disqualify.ts",
    ],
    specs: [
      "e2e/entry-needs-approval.spec.ts",
      "e2e/disqualified-and-reinstated.spec.ts",
      "e2e/organizer-requires-a-phone.spec.ts",
      "e2e/enter-from-the-club-list.spec.ts",
      "e2e/organizer-entry.spec.ts",
      "e2e/public-links-and-removals.spec.ts",
      "e2e/members.spec.ts",
    ],
    // Members enter from their own phones in the society's Stableford.
    scenarios: ["a"],
    // An entry closes on a day, and the day is the club's.
    dateSensitive: true,
    actions: ["src/app/actions/register.ts", "src/app/actions/disqualify.ts"],
  },
  "tee-sheet": {
    name: "The tee sheet",
    paths: ["src/app/(app)/foursomes/", "src/components/FoursomeMaker.tsx", "src/components/PairingRequests.tsx", "src/app/actions/tee-sheet.ts"],
    specs: ["e2e/organizer-teesheet.spec.ts", "e2e/play-with.spec.ts"],
    scenarios: [],
    // Tee times are read on the club's clock.
    dateSensitive: true,
    actions: ["src/app/actions/tee-sheet.ts"],
  },
  reports: {
    name: "Reports (the Reports screen)",
    paths: ["src/app/(app)/reports/", "src/components/ReportsClient.tsx", "src/components/PrintReportButton.tsx", "src/components/AttendanceReport.tsx", "src/lib/services/attendance-report.ts"],
    specs: ["e2e/final-report.spec.ts", "e2e/organizer-knockout-report.spec.ts", "e2e/a-finished-cup-shows-its-points.spec.ts"],
    scenarios: [],
    // A report writes the event's dates.
    dateSensitive: true,
    actions: [],
  },
  player: {
    name: "The player app (not its card or its money)",
    paths: [
      "src/app/(player)/me/page.tsx",
      "src/app/(player)/me/events/",
      "src/app/(player)/me/calendar/",
      "src/app/(player)/me/help/",
      "src/app/(player)/me/rules/",
      "src/app/(player)/me/board/",
    ],
    specs: [
      "e2e/player.spec.ts",
      "e2e/player-round.spec.ts",
      "e2e/player-one-screen.spec.ts",
      "e2e/player-words.spec.ts",
      "e2e/player-calendar.spec.ts",
      "e2e/slow-page.spec.ts",
      "e2e/shared-phone.spec.ts",
    ],
    scenarios: [],
    // The calendar is days.
    dateSensitive: true,
    actions: [],
  },
  messages: {
    name: "Messages and announcements (the organizer's screens)",
    paths: ["src/app/(app)/messages/", "src/app/(app)/announcements/", "src/components/AnnouncementsClient.tsx"],
    specs: ["e2e/messages.spec.ts", "e2e/messages-to-a-flight.spec.ts", "e2e/announcements.spec.ts", "e2e/organizer-announcements.spec.ts"],
    scenarios: [],
    dateSensitive: false,
    actions: [],
  },
  guide: {
    name: "The organizer's guide screen",
    paths: ["src/app/(app)/guide/", "src/components/GuideSearch.tsx"],
    specs: ["e2e/guide.spec.ts"],
    scenarios: [],
    dateSensitive: false,
    actions: [],
  },
};

/**
 * Specs no area claims: they run in every FULL round and every nightly, and in no targeted round.
 * Shared ground (boards, scoring, money, handicaps, cups, leagues, access, sign-in, the front door),
 * where a change is never targeted anyway — or a check of the test harness itself.
 */
export const FULL_ONLY = [
  "e2e/a-lapsed-club-is-read-only.spec.ts",
  "e2e/a-new-device-is-confirmed.spec.ts",
  "e2e/a-refusal-stays-put.spec.ts",
  "e2e/a-tie-at-the-cut.spec.ts",
  "e2e/access.spec.ts",
  "e2e/account.spec.ts",
  "e2e/an-address-is-proved.spec.ts",
  "e2e/boards-by-the-rules.spec.ts",
  "e2e/casual-round-kept.spec.ts",
  "e2e/casual-round.spec.ts",
  "e2e/club-course.spec.ts",
  "e2e/clubhouse-and-event-page.spec.ts",
  "e2e/club-record.spec.ts",
  "e2e/club-settings-tabs.spec.ts",
  "e2e/club-settings-words.spec.ts",
  "e2e/club-staff.spec.ts",
  "e2e/club-theme.spec.ts",
  "e2e/code-event-no-mobile.spec.ts",
  "e2e/commentary.spec.ts",
  "e2e/completing-asks-about-unplayed-rounds.spec.ts",
  "e2e/contest-sponsor.spec.ts",
  "e2e/country-words.spec.ts",
  "e2e/course-cards-and-venues.spec.ts",
  "e2e/dashboard-day.spec.ts",
  "e2e/deleting-for-good.spec.ts",
  "e2e/dialog.spec.ts",
  "e2e/discount-code.spec.ts",
  "e2e/event-setup-calm.spec.ts",
  "e2e/faq-blocks.spec.ts",
  "e2e/flight-board.spec.ts",
  "e2e/formats-agree.spec.ts",
  "e2e/front-door.spec.ts",
  "e2e/handicap-body.spec.ts",
  "e2e/hydration-recorder.spec.ts",
  "e2e/interclub-league.spec.ts",
  "e2e/joining-a-club-refusals.spec.ts",
  "e2e/joining-a-club.spec.ts",
  "e2e/kitty.spec.ts",
  "e2e/landing-demo-doors.spec.ts",
  "e2e/landing-legible.spec.ts",
  "e2e/landing-screens.spec.ts",
  "e2e/launch-reads-setup.spec.ts",
  "e2e/league.spec.ts",
  "e2e/match-kept-by.spec.ts",
  "e2e/match-play-rules.spec.ts",
  "e2e/match-results.spec.ts",
  "e2e/money-nav.spec.ts",
  "e2e/named-side-bet.spec.ts",
  "e2e/offline.spec.ts",
  "e2e/old-addresses.spec.ts",
  "e2e/one-prize-per-player.spec.ts",
  "e2e/one-setting-up-step.spec.ts",
  "e2e/organizer-championship.spec.ts",
  "e2e/organizer-cup.spec.ts",
  "e2e/organizer-medal.spec.ts",
  "e2e/organizer-scramble.spec.ts",
  "e2e/organizer-stableford.spec.ts",
  "e2e/organizer-tees.spec.ts",
  "e2e/organizer.spec.ts",
  "e2e/play-suspended.spec.ts",
  "e2e/pot-on-the-scores.spec.ts",
  "e2e/prizes.spec.ts",
  "e2e/roster-handicap-and-field.spec.ts",
  "e2e/roster.spec.ts",
  "e2e/round-code-box-starts-empty.spec.ts",
  "e2e/round-code-certify-and-result.spec.ts",
  "e2e/round-code-decided-match.spec.ts",
  "e2e/round-code-four-ball-side.spec.ts",
  "e2e/round-code-reissued.spec.ts",
  "e2e/round-code-sign.spec.ts",
  "e2e/seasons.spec.ts",
  "e2e/secretary-back-after-a-week.spec.ts",
  "e2e/security.spec.ts",
  "e2e/seo.spec.ts",
  "e2e/setup-checklist-outlives-the-field.spec.ts",
  "e2e/shared-costs.spec.ts",
  "e2e/side-bet-named-winner.spec.ts",
  "e2e/side-game-renamed.spec.ts",
  "e2e/sides-and-splits.spec.ts",
  "e2e/skins-pot.spec.ts",
  "e2e/slow-signal-scoring.spec.ts",
  "e2e/team-cup.spec.ts",
  "e2e/teams-and-pairs.spec.ts",
  "e2e/the-boards-agree.spec.ts",
  "e2e/the-bot-check-cannot-shut-the-door.spec.ts",
  "e2e/the-cut-a-round-is-played-for.spec.ts",
  "e2e/tournament-access.spec.ts",
  "e2e/tournaments-copied-switched-deleted.spec.ts",
  "e2e/typed-before-load.spec.ts",
  "e2e/week-sheet-after-the-cut.spec.ts",
  "e2e/weekly-sign-up.spec.ts",
  "e2e/weight.spec.ts",
];

/** What a spec that reads days, times or zones looks like: an area with one is `dateSensitive`. */
export const READS_DATES = /E2E_TZ|E2E_LOCALE|deadline|clubToday|timeZone|toLocaleDateString/;

/**
 * Everything wrong with a manifest against the disk, in words — [] when sound. Pure (the caller
 * hands in what is on disk), so the test can prove it SEES a fault by handing it one.
 *
 *   specsOnDisk   every `e2e/*.spec.ts` there is
 *   exists(path)  whether a file or folder is there
 *   source(path)  a spec's text (for READS_DATES)
 */
export function manifestProblems(m, specsOnDisk, exists, source) {
  const problems = [];
  const placed = new Set([...m.alwaysOn, ...m.fullOnly]);
  for (const [key, a] of Object.entries(m.areas)) {
    if (!a.paths.length) problems.push(`area ${key} names no paths`);
    if (!a.specs.length) problems.push(`area ${key} lists no specs`);
    for (const p of a.paths) if (!exists(p.endsWith("/") ? p.slice(0, -1) : p)) problems.push(`area ${key} names ${p}, which is not there`);
    for (const p of a.actions) if (!exists(p)) problems.push(`area ${key} holds the reach of ${p}, which is not there`);
    for (const p of a.actions) if (!a.paths.some((q) => p === q || (q.endsWith("/") && p.startsWith(q)))) problems.push(`area ${key} holds the reach of ${p}, which is not one of its paths`);
    for (const s of a.specs) {
      placed.add(s);
      if (!exists(s)) problems.push(`area ${key} lists ${s}, which is not there`);
      else if (!a.dateSensitive && READS_DATES.test(source(s))) problems.push(`area ${key} lists ${s}, which reads days, times or zones, so the area must be dateSensitive (all six countries)`);
      if (m.fullOnly.includes(s)) problems.push(`${s} is in area ${key} AND in FULL_ONLY`);
    }
  }
  for (const s of [...m.alwaysOn, ...m.fullOnly]) if (!exists(s)) problems.push(`${s} is listed, and is not there`);
  for (const s of m.alwaysOn) if (m.fullOnly.includes(s)) problems.push(`${s} is ALWAYS_ON and FULL_ONLY`);
  for (const s of specsOnDisk) if (!placed.has(s)) problems.push(`${s} is in no area, not ALWAYS_ON and not FULL_ONLY: a targeted round would not know whether to run it`);
  return problems;
}

/**
 * EVERY FILE AN AREA LISTS IS USED ONLY INSIDE THAT AREA — or a change to it is not a change in one
 * area at all. A component the dashboard, a public board or the player's layout also imports is shared
 * ground, and a targeted round of the area would not run the specs of the screens it reaches.
 * (The Operations/Reliability Lead's review of #982, 2026-11-01: the first sweep moved forty files out.)
 *
 *   files        every source file in src/ (not tests), as repository paths
 *   importers    Map: a source file → the files that import it
 *
 * Returns "area: file ← importer" for each import from outside the area's own paths. Pure, so the test
 * can prove it sees one by handing it a graph with one.
 */
export function outsideImporters(areas, files, importers) {
  const inside = (paths, f) => paths.some((p) => (p.endsWith("/") ? f.startsWith(p) : f === p));
  const found = [];
  for (const [key, a] of Object.entries(areas)) {
    for (const f of files.filter((x) => inside(a.paths, x))) {
      for (const i of importers.get(f) ?? []) if (!inside(a.paths, i)) found.push(`${key}: ${f} ← ${i}`);
    }
  }
  return found;
}
