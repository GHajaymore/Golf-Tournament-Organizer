/**
 * WHAT A ROUND OF TESTING IS — every layer of it, in the order it runs.
 *
 * This is the one list. `round.mjs` runs it, `docs/testing.md` explains it, and
 * `qa-framework.test.ts` holds it against the files on disk, so a spec that is
 * renamed, a scenario that is added, or a layer that names something which no
 * longer exists turns a unit test red instead of quietly dropping out of every
 * round from then on.
 *
 * It was a shell script in a scratch folder until 2026-10-13, known to one
 * session at a time. Ajay: "you should be building these permanent test script
 * which covers all aspects of the app and use it whenever we make any change
 * in the app. Keep it updated whenever we add any functionality."
 *
 * A LAYER says three things a pass count cannot:
 *
 *   stands for   whose experience this is evidence about — the row of Ajay's
 *                list it fills ("laptop, tablet, mobile, all kind of browsers,
 *                ios, google play, us and international members/organizers")
 *   really is    what was actually run. An iPhone here is Safari's engine with
 *                an iPhone's screen and touch, on a Windows or Linux machine.
 *                It is not a phone, and the report says so every time.
 *   cannot see   what this layer would pass while being wrong about
 *
 * WHEN YOU ADD TO THE APP, this file is one of the places you add to:
 *
 *   a new screen        nothing here — the walk and the layout sweep read the
 *                       screens from the filesystem (`e2e/everything.spec.ts`,
 *                       `e2e/layout.spec.ts`). Add its Help/guide lines.
 *   a new action/flow   a spec in `e2e/` that DOES it (the whole suite runs
 *                       every spec there), or a phase in a scenario below. The
 *                       round then stops calling it unreached
 *                       (`reach-baseline.json`); until then it is a finding.
 *   a new format,       a scenario, or a phase in one: a tournament of that
 *   draw or money rule  kind played end to end by a full field, with a check
 *                       against the Rules rather than against the app.
 *   a new country,      a row in LOCALES / CURRENCIES is swept by
 *   currency or device  `formats-agree`; a new place for the seeded club is a
 *                       line in `scripts/seed-club.mjs` and in ABROAD below.
 */

/** Screens, layout and touch: what changes with the size and kind of screen, and with the engine drawing it. */
export const SCREEN_SPECS = [
  "e2e/everything.spec.ts",
  "e2e/layout.spec.ts",
  "e2e/touch.spec.ts",
  "e2e/nothing-is-covered.spec.ts",
  "e2e/front-door.spec.ts",
  "e2e/landing-screens.spec.ts",
  "e2e/landing-legible.spec.ts",
];

/** Every screen of the app opened as each kind of person. */
export const WALK = ["e2e/everything.spec.ts"];

/**
 * Where the seeded club is put, round by round, besides Scotland (the suite)
 * and the United States (every round). Three a round, so three rounds visit
 * all of them: `club` is the country the CLUB is in (its currency, its dates,
 * its golf words), `reader` the language and region of the browser reading it,
 * `zone` that reader's clock.
 */
export const ABROAD = [
  [
    { club: "in", reader: "en-IN", zone: "Asia/Kolkata" },
    { club: "jp", reader: "ja-JP", zone: "Asia/Tokyo" },
  ],
  [
    { club: "au", reader: "en-AU", zone: "Australia/Sydney" },
    { club: "za", reader: "en-ZA", zone: "Africa/Johannesburg" },
  ],
  [
    { club: "ie", reader: "en-IE", zone: "Europe/Dublin" },
    // A reader whose browser is NOT in the club's language: a Scottish club read in German, from Berlin.
    { club: "gb", reader: "de-DE", zone: "Europe/Berlin" },
  ],
];

/**
 * The layers. `cookies` is which way the test server is started: "secure" is
 * production's (every cookie Secure); "plain" drops that flag, because WebKit
 * will not send a Secure cookie over the plain http a local test server speaks.
 * `specs: []` is the whole suite; `projects: []` is all three screen sizes.
 */
export function layersFor(round) {
  const abroad = ABROAD[(Math.max(1, round) - 1) % ABROAD.length];
  return [
    {
      key: "suite",
      name: "The whole suite",
      standsFor: "an organizer on a laptop; a player on an Android phone and on a small phone; a visitor signed out",
      reallyIs: "Chromium at 1280×900, as a Pixel 5 (393 wide, touch) and at 320 wide — every spec, the every-screen walk, the control crawl, the every-action sweep; and with them the security checks from outside (security.spec), what a search engine is given (seo.spec), the accessibility audit of every screen (a11y.spec) and the weight of the screens people open most (weight.spec)",
      cannotSee: "any other browser, a tablet, a club outside Scotland — the layers below",
      cookies: "secure",
      env: { E2E_EVERYTHING: "1" },
      specs: [],
      projects: [],
      minutes: 150,
      reach: true,
    },
    {
      // Added 2026-10-13: every other layer asks the browser for reduced motion, which is what almost
      // nobody has set. The first round on GitHub met the page with its motion on by accident (Safari's
      // engine on Linux ignores the request) and three front-door tests failed on pictures measured before
      // they had settled. So the front door is also run the way it is seen.
      key: "motion",
      name: "With the animation on",
      standsFor: "nearly every visitor: somebody who has not asked their device for less motion",
      reallyIs: "the front door's own specs with the page's motion left on, at three sizes",
      cannotSee: "the app's screens with motion on — they barely move, and are not run this way",
      cookies: "secure",
      env: { E2E_MOTION: "full" },
      // Not the readability scan: it photographs the page twice and compares, which needs a page that is
      // still. What it would have caught with the motion on — a part left faint for good — is asked
      // directly, by "every part of the front door that waits to arrive does arrive".
      specs: ["e2e/landing-screens.spec.ts", "e2e/front-door.spec.ts"],
      projects: [],
      minutes: 20,
    },
    {
      key: "elsewhere",
      name: "Somewhere else",
      standsFor: "a club and a reader on another calendar day from the server, as every club is in production",
      reallyIs: "the every-screen walk with the browser and the seeded club in a zone that is on a different date from this machine right now",
      cannotSee: "anything but a date or a time written on the wrong day",
      cookies: "secure",
      env: { E2E_EVERYTHING: "1", E2E_TZ: "@far-zone" },
      specs: WALK,
      projects: [],
      minutes: 40,
    },
    {
      key: "us-club",
      name: "An American club",
      standsFor: "US organizers and members: dollars, the month first, American golf words",
      reallyIs: "the every-screen walk with the seeded club in Indiana (en-US, USD)",
      cannotSee: "a wrong figure — the walk reads every screen for errors and for what must not be there, not for arithmetic; the scenarios check that",
      cookies: "secure",
      env: { E2E_EVERYTHING: "1", E2E_CLUB: "us" },
      specs: WALK,
      projects: [],
      minutes: 40,
    },
    ...abroad.map((place) => ({
      key: `abroad-${place.club}-${place.reader}`,
      name: `A club in ${place.club.toUpperCase()}, read in ${place.reader}`,
      standsFor: "international organizers and members",
      reallyIs: `the every-screen walk with the seeded club in ${place.club.toUpperCase()}, the browser set to ${place.reader} and its clock to ${place.zone}`,
      cannotSee: "a wrong figure (as above); a country that is not in this round's three",
      cookies: "secure",
      env: { E2E_EVERYTHING: "1", E2E_CLUB: place.club, E2E_LOCALE: place.reader, E2E_TZ: place.zone },
      specs: WALK,
      projects: [],
      minutes: 40,
    })),
    {
      key: "tablet-android",
      name: "An Android tablet",
      standsFor: "an organizer or a player on a Galaxy Tab, upright and on its side",
      reallyIs: "Chromium as a Galaxy Tab S4 upright (712 wide) and on its side (1138 wide), and a Galaxy Tab S9 upright (640 wide), touch — every screen, layout, touch targets, the front door",
      cannotSee: "function: the flows are width-independent and are run by the suite",
      cookies: "secure",
      env: { E2E_EVERYTHING: "1", E2E_DEVICES: "tablet" },
      specs: SCREEN_SPECS,
      projects: [],
      minutes: 60,
    },
    {
      key: "chrome",
      name: "Chrome, as installed",
      standsFor: "Google Chrome on a laptop and on a phone-sized window",
      reallyIs: "the Chrome installed on this machine (not Playwright's own build) — every screen, layout, touch targets, the front door",
      cannotSee: "little the suite does not: it is the same engine, a version apart",
      cookies: "secure",
      env: { E2E_EVERYTHING: "1", E2E_CHANNEL: "chrome" },
      specs: SCREEN_SPECS,
      projects: [],
      minutes: 60,
    },
    {
      key: "edge",
      name: "Edge, as installed",
      standsFor: "Microsoft Edge on a laptop",
      reallyIs: "the Edge installed on this machine — every screen, layout, the front door",
      cannotSee: "as Chrome",
      cookies: "secure",
      env: { E2E_EVERYTHING: "1", E2E_CHANNEL: "msedge" },
      specs: SCREEN_SPECS,
      projects: ["desktop"],
      minutes: 30,
    },
    {
      key: "iphone",
      name: "An iPhone",
      standsFor: "iOS: a player or an organizer in Safari on an iPhone — and the iOS app, which is this web app in a shell",
      reallyIs: "WebKit (Safari's engine) as an iPhone 13 — the whole suite at that size",
      cannotSee: "Safari itself, a real phone, the App Store build, push notifications (this engine build cannot answer for them), and how fonts are drawn (this machine's WebKit draws variable fonts at one weight)",
      cookies: "plain",
      env: { E2E_ENGINE: "webkit" },
      specs: [],
      projects: ["phone"],
      minutes: 60,
    },
    {
      key: "safari",
      name: "Safari on a Mac, and a small iPhone",
      standsFor: "an organizer in Safari on a laptop; a player on an iPhone SE",
      reallyIs: "WebKit at 1280×900 and as an iPhone SE (320 wide) — every screen, layout, touch targets, the front door, and the server-against-browser format check",
      cannotSee: "as the iPhone layer",
      cookies: "plain",
      env: { E2E_ENGINE: "webkit", E2E_EVERYTHING: "1" },
      specs: [...SCREEN_SPECS, "e2e/formats-agree.spec.ts"],
      projects: ["desktop", "small-phone"],
      minutes: 60,
    },
    {
      key: "ipad",
      name: "An iPad",
      standsFor: "iOS on a tablet: an organizer at the registration desk, a player on the sofa",
      reallyIs: "WebKit as an iPad upright (810 wide), an iPad Mini upright (768 wide) and an iPad Pro 11 on its side (1194 wide), touch — every screen, layout, touch targets, the front door",
      cannotSee: "as the iPhone layer",
      cookies: "plain",
      env: { E2E_ENGINE: "webkit", E2E_EVERYTHING: "1", E2E_DEVICES: "tablet" },
      specs: SCREEN_SPECS,
      projects: [],
      minutes: 60,
    },
    {
      key: "scenarios",
      kind: "scenarios",
      name: "Eleven tournaments, played",
      standsFor: "the app doing its job: a full field entered, drawn, scored, cut, ranked and paid, in every kind of competition",
      reallyIs: "eleven tournaments of 110 to 120 invented players each, run phase by phase through the screens, with the results checked against the Rules of Golf and the Rules of Handicapping rather than against the app",
      cannotSee: "a format or a rule no scenario plays — see SCENARIOS, and add one when the app gains a kind of competition",
      cookies: "secure",
      minutes: 60,
    },
    {
      key: "dependencies",
      kind: "command",
      name: "Known holes in the libraries",
      standsFor: "security: a published vulnerability in something the app ships with",
      reallyIs: "npm's advisory database, asked about every package a deployment installs; anything rated high or critical is a finding",
      cannotSee: "a hole nobody has published, and whether a published one can be reached from this app",
      command: "node scripts/qa/dependencies.mjs",
      minutes: 10,
    },
    {
      key: "firefox",
      name: "Firefox",
      standsFor: "Firefox on a laptop, and at a phone's and a small phone's width",
      reallyIs: "the whole standing suite on Firefox at three sizes",
      cannotSee: "Firefox on Windows or a Mac (this is its Linux build); a touch device, which Firefox does not emulate",
      // Firefox will not start on the Windows machine this app is built on ("spawn UNKNOWN",
      // through a clean reinstall, 2026-10-13). It runs wherever it can be started.
      needs: "firefox",
      cookies: "secure",
      env: { E2E_ENGINE: "firefox" },
      specs: [],
      projects: [],
      minutes: 60,
    },
  ];
}

/**
 * A ROUND, CUT INTO PARTS THAT CAN RUN SIDE BY SIDE.
 *
 * On one machine a round is every layer, one after another, against one
 * database: about six hours. Nothing in a layer depends on another layer, so
 * `.github/workflows/round.yml` gives each PART below a machine and a database
 * of its own, all drawing the one build, and the round takes as long as its
 * slowest part. Ajay, 2026-10-13: "make the testing efficient."
 *
 * A layer that runs every spec is cut by screen size, and its longest size by
 * `--shard`; the scenarios are a part each. The cuts are only about time: the
 * union of the parts is exactly the layer, and `qa-framework.test.ts` holds
 * that to be so.
 */
/** How many machines the console crawl is shared between. See `E2E_CRAWL_PART` in e2e/every-control.spec.ts. */
export const CRAWL_PARTS = 4;

export function partsFor(round) {
  const parts = [];
  const all = ["phone", "small-phone", "desktop"];
  for (const layer of layersFor(round)) {
    if (layer.kind === "scenarios") {
      for (const s of SCENARIOS) parts.push({ id: `scenario-${s.key}`, layer: layer.key, args: `--only=scenarios --scenario=${s.key}`, browsers: "chromium", minutes: 45 });
      continue;
    }
    if (layer.kind === "command") {
      // No browser and no server: it asks a registry a question.
      parts.push({ id: layer.key, layer: layer.key, args: `--only=${layer.key}`, browsers: "", minutes: layer.minutes });
      continue;
    }
    const browsers = layer.env?.E2E_ENGINE ?? (layer.env?.E2E_CHANNEL ? `chromium ${layer.env.E2E_CHANNEL}` : "chromium");
    const projects = layer.projects.length ? layer.projects : all;
    // Only the layers that run EVERY spec are worth cutting; a walk is three tests.
    if (layer.specs.length === 0) {
      for (const project of projects) {
        const shards = layer.key === "suite" && project === "desktop" ? 3 : layer.key === "suite" && project === "phone" ? 2 : 1;
        // The console crawl is one test, on the laptop size of the suite, and as long as everything
        // else in that size together. It is taken out of the shards and given parts of its own.
        const crawl = layer.key === "suite" && project === "desktop" ? CRAWL_PARTS : 0;
        for (let k = 1; k <= crawl; k += 1) {
          parts.push({ id: `${layer.key}-${project}-crawl-${k}of${crawl}`, layer: layer.key, args: `--only=${layer.key} --projects=${project} --crawl=${k}/${crawl}`, browsers, minutes: layer.minutes });
        }
        for (let i = 1; i <= shards; i += 1) {
          parts.push({ id: `${layer.key}-${project}${shards > 1 ? `-${i}of${shards}` : ""}`, layer: layer.key, args: `--only=${layer.key} --projects=${project}${shards > 1 ? ` --shard=${i}/${shards}` : ""}${crawl ? ` --crawl=0/${crawl}` : ""}`, browsers, minutes: layer.minutes });
        }
      }
    } else {
      parts.push({ id: layer.key, layer: layer.key, args: `--only=${layer.key}`, browsers, minutes: layer.minutes });
    }
  }
  return parts;
}

/** Flags every scenario's own log is read for, whatever else that scenario adds. */
const ALWAYS = "page errors: [1-9]|sideways=[1-9]|\\[5[0-9][0-9] →|Unknown player|Application error";
const ENTERED = "no Enter button| → other|NO OUTCOME|You’re in[^S]{0,25}Stroke Play Round";
const DRAWN = "refused [1-9]|same pairs as round 1: false|didn't load|setup is locked after launch";
const IMPORTED = "IMPORT SHORT|UNSORTED|only enter|not in this|WRONG ROUND";

/**
 * The tournaments. Each is one spec run a PHASE at a time (a phase is one
 * sitting: the organizer builds it, the members enter, a round is played …),
 * so a tournament lives in the database between phases the way a real one
 * does. A phase fails on its exit code OR on a red flag in what it wrote down:
 * the flags are the things a phase can see happen and still finish.
 */
export const SCENARIOS = [
  {
    key: "a",
    file: "e2e/scenarios/a-society-stableford.spec.ts",
    name: "A society's Saturday Stableford",
    plays: "a society on the Birdie plan, 110 on the roster and a field the plan caps at 50; members enter from their own phones; net Stableford at 95%",
    phases: ["A1", "A2", "A3", "A4", "A5", "A6", "A7"],
    flags: `${ALWAYS}|${ENTERED}|ROSTER MEMBER CANNOT SEE`,
  },
  {
    key: "b",
    file: "e2e/scenarios/b-better-ball.spec.ts",
    name: "Autumn Better-Ball",
    plays: "120 members as 60 pairs drawn automatically, two rounds of net Four-Ball Best Ball, totals over both, the second round drawn by position",
    phases: ["B1", "B2", "B3", "B4", "B5", "B4b", "B6", "B7"],
    flags: `${ALWAYS}|${ENTERED}|${DRAWN}|BY POSITION OFF|NO PAIR TOTAL`,
  },
  {
    key: "c",
    file: "e2e/scenarios/c-club-championship.spec.ts",
    name: "Club Championship",
    plays: "36 holes gross, 120 players in three handicap flights, a cut to the top 40 and ties, prizes and the honours board",
    phases: ["C1", "C2a", "C2b", "C2c", "C2d", "C3a", "C3b", "C3c", "C3d", "C4", "C4b", "C5", "C6", "C7"],
    flags: ALWAYS,
  },
  {
    key: "d",
    file: "e2e/scenarios/d-spring-four-ball.spec.ts",
    name: "Spring Four-Ball",
    plays: "the roster as 60 pairs from a shotgun start; a net Four-Ball whose cards are kept three ways (one member for the group, the secretary, each member their own); round two with the same pairs, drawn by position",
    phases: ["D1", "D3", "D4", "D6"],
    flags: `${ALWAYS}|${ENTERED}|${DRAWN}`,
  },
  {
    key: "e",
    file: "e2e/scenarios/e-matchplay-knockout.spec.ts",
    name: "Matchplay Championship",
    plays: "a gross stroke-play qualifier for 120, the top 64 into a match-play knockout decided on the bracket",
    phases: ["E1", "E2", "E3"],
    flags: `${ALWAYS}|${ENTERED}|Cutoff line ≈ 0 pts|CUTOFF PTS 0|group standings`,
  },
  {
    key: "f",
    file: "e2e/scenarios/f-foursomes-and-four-ball.spec.ts",
    name: "Foursomes & Four-Ball Day",
    plays: "two team rounds of different formats, each with its own draw: Foursomes imported from a spreadsheet, then a gross Four-Ball entered as one card for the side",
    phases: ["F1", "F2", "F3", "F4"],
    flags: `${ALWAYS}|${ENTERED}|${DRAWN}|REFUSED|PAIR TOTAL OVER|IMPORT SHORT|stored: 0 of`,
  },
  {
    key: "g",
    file: "e2e/scenarios/g-stableford-league.spec.ts",
    name: "Thursday Stableford League",
    plays: "three weekly net Stableford rounds with uneven attendance — the twenty best players miss a week — so a season ranked per hole instead of on points shows",
    phases: ["G1", "G2", "G3", "G4", "G5"],
    flags: `${ALWAYS}|${ENTERED}|${DRAWN}|${IMPORTED}|ABSENTEE THRU WRONG`,
  },
  {
    key: "h",
    file: "e2e/scenarios/h-nine-hole-league.spec.ts",
    name: "Wednesday Nine",
    plays: "the league again as three weekly nine-hole rounds, with a player who misses a week — whose line must show the round's nine holes, not the season's eighteen",
    phases: ["H1", "H2", "H3", "H4", "H5"],
    flags: `${ALWAYS}|${ENTERED}|${DRAWN}|${IMPORTED}|ABSENTEE THRU WRONG`,
  },
  {
    key: "i",
    file: "e2e/scenarios/i-two-course-open.spec.ts",
    name: "Two-Course Open",
    plays: "36 holes gross, round two AWAY at a course with its own par and stroke index — every player's to-par must be gross minus the two courses' own pars",
    phases: ["I1", "I2", "I3", "I4"],
    flags: `${ALWAYS}|${ENTERED}|${DRAWN}|${IMPORTED}|AWAY PAR WRONG`,
  },
  {
    key: "j",
    file: "e2e/scenarios/j-flighted-net-medal.spec.ts",
    name: "Flighted Net Medal",
    plays: "one net round, three divisions, the third off different tees — every row's strokes received must be the Playing Handicap worked out from that player's own tees",
    phases: ["J1", "J2"],
    flags: `${ALWAYS}|${ENTERED}|${DRAWN}|${IMPORTED}|AWAY PAR WRONG|TEE HANDICAP WRONG`,
  },
  {
    key: "k",
    file: "e2e/scenarios/k-match-play-league.spec.ts",
    name: "Winter Match Play League",
    plays: "thirty flights of four, everyone plays everyone, results imported as final results only — each player's won, halved, lost and points added up independently and held against the table",
    phases: ["K1", "K2", "K3", "K4", "K5"],
    flags: `${ALWAYS}|${ENTERED}|${DRAWN}|${IMPORTED}|AWAY PAR WRONG|TEE HANDICAP WRONG|LEAGUE TABLE WRONG`,
  },
];

/**
 * WHAT A CHANGE NEEDS BEFORE IT REACHES PRODUCTION, by what it touches.
 *
 * Ajay, 2026-10-13: "I care more about functionality and operationality of the
 * app that is the meat. anything surrounding it like documentations should not
 * fail the app … I can understand if making any process flow or navigational
 * thing impacting functionality may require thorough testing."
 *
 * So the depth of testing follows the risk to FUNCTION, and the risk is read
 * off the files a change touches — by blast radius, never by how small the
 * change is or what it is called. The first rule that matches a path decides
 * it; a path no rule knows is treated as core, which is the safe mistake.
 */
export const TIERS = {
  tests: {
    rank: 0,
    name: "Tests and tooling",
    needs: "the tests it changes, run; nothing ships to anybody",
  },
  words: {
    rank: 1,
    name: "Words and documents",
    needs: "its own tests (guide, Help) and CI. No round. A finding here never restarts a count.",
  },
  landing: {
    rank: 1,
    name: "The front door",
    needs: "the landing specs on three sizes and CI. No round: its stylesheet cannot reach an app screen.",
  },
  function: {
    rank: 2,
    name: "Function in one area",
    needs: "a browser test for it, proven by breaking the code; the standing suite; and ONE full round on the commit that will be production, before it merges.",
  },
  core: {
    rank: 3,
    name: "Core and shared",
    needs: "batch it, freeze, and THREE full rounds on the commit that will be production, before it merges.",
  },
};

/** A pattern is a prefix ending in `/`, an exact path, or has one `*` standing for anything inside a path part. */
export const TIER_RULES = [
  // Tests and tooling — nothing a user runs.
  ["tests", ["e2e/", "scripts/qa/", ".github/", "playwright.config.ts", "vitest.config.ts", "vitest.audit.config.ts", ".claude/", ".gitignore"]],
  ["tests", ["src/lib/__tests__/", "src/lib/domain/__tests__/"]],
  ["tests", ["scripts/smoke-all.mjs", "scripts/smoke-routes.mjs", "scripts/verify-*.mjs", "scripts/seed-club.mjs", "scripts/e2e-coverage.mjs", "scripts/look-at-screens.mjs", "scripts/run-mark.mjs", "scripts/session-cookie.mjs"]],
  // Words.
  ["words", ["docs/", "CLAUDE.md", "README.md", "src/lib/guide-steps.ts", "src/lib/guide-search.ts", "src/lib/player-help.ts", "public/guide/", "scripts/build-guide-pdf.mjs"]],
  // The front door and its three sister pages.
  ["landing", ["src/app/page.tsx", "src/lib/landing/", "src/lib/landing-palette.ts", "src/components/landing/", "src/components/LandingAuth.tsx", "src/components/LandingEffects.tsx", "src/components/LandingHomeEffects.tsx", "public/landing/", "src/app/faq/", "src/app/privacy/", "src/app/terms/", "scripts/place-landing-shots.mjs", "src/lib/domain/landing-event.ts"]],
  // Core: what every screen stands on.
  ["core", ["prisma/", "package.json", "package-lock.json", "next.config.mjs", "vercel.json", "tsconfig.json", "public/sw.js", "src/middleware.ts", "scripts/build-checked.mjs", "scripts/react-hydration-replay-backport.cjs", "scripts/deploy-migrations.mjs", "scripts/pad-migration-names.mjs"]],
  ["core", ["src/app/layout.tsx", "src/app/globals.css", "src/app/design-system.css", "src/app/fonts.ts", "src/app/(app)/layout.tsx", "src/app/(player)/layout.tsx", "src/lib/themes.ts", "src/lib/nav.ts", "src/lib/player-nav.ts", "src/lib/db.ts"]],
  // Core: who may do what.
  ["core", ["src/lib/auth.ts", "src/lib/play-auth.ts", "src/lib/roles.ts", "src/lib/access-roles.ts", "src/lib/secure-cookies.ts", "src/lib/rate-limit.ts", "src/lib/domain/session-token.ts", "src/lib/domain/password.ts", "src/lib/domain/access-lockout.ts", "src/lib/domain/rate-limit.ts", "src/lib/services/access.ts", "src/lib/services/org-access.ts", "src/lib/services/player-access.ts", "src/lib/services/match-access.ts", "src/lib/services/game-access.ts", "src/lib/services/action-shared.ts", "src/app/actions/auth.ts"]],
  // Core: the arithmetic of golf and of money, and who plays whom.
  ["core", ["src/lib/domain/stroke.ts", "src/lib/domain/stroke-agg.ts", "src/lib/domain/stroke-countback.ts", "src/lib/domain/match.ts", "src/lib/domain/match-tiebreak.ts", "src/lib/domain/handicap.ts", "src/lib/domain/handicap-policy.ts", "src/lib/domain/round-handicap.ts", "src/lib/domain/tee-match.ts", "src/lib/domain/card-points.ts", "src/lib/domain/card-totals.ts", "src/lib/domain/ranked-score.ts", "src/lib/domain/standings.ts", "src/lib/domain/shared-position.ts", "src/lib/domain/cut.ts", "src/lib/domain/bracket.ts", "src/lib/domain/bracket-flights.ts", "src/lib/domain/draw.ts", "src/lib/domain/league-draw.ts", "src/lib/domain/grouping.ts", "src/lib/domain/team.ts", "src/lib/domain/team-match-standings.ts", "src/lib/domain/cup.ts", "src/lib/domain/pair-totals.ts"]],
  ["core", ["src/lib/domain/money.ts", "src/lib/domain/money-layout.ts", "src/lib/domain/money-mode.ts", "src/lib/domain/skins.ts", "src/lib/domain/skins-pot.ts", "src/lib/domain/nassau.ts", "src/lib/domain/derived-games.ts", "src/lib/domain/carry.ts", "src/lib/domain/expenses.ts", "src/lib/domain/score-payload.ts", "src/lib/services/scorecard-write.ts", "src/lib/services/handicaps.ts", "src/lib/services/round-handicap.ts", "src/lib/services/tournament.ts", "src/lib/services/skins-pot.ts", "src/lib/services/stroke-cut.ts", "src/lib/services/bracket-results.ts", "src/lib/services/finish-order.ts", "src/lib/services/intake-lock.ts", "src/lib/services/limits.ts", "src/lib/services/entitlements.ts", "src/lib/plans.ts"]],
  // Everything else a user runs is function in one area.
  ["function", ["src/", "public/", "scripts/"]],
];

function matches(pattern, path) {
  if (pattern.endsWith("/")) return path.startsWith(pattern);
  if (!pattern.includes("*")) return path === pattern;
  const [head, tail] = pattern.split("*");
  return path.startsWith(head) && path.endsWith(tail) && !path.slice(head.length, path.length - tail.length).includes("/");
}

/** The tier a changed path belongs to. A path nothing names is core. */
export function tierOf(path) {
  const clean = path.replace(/\\/g, "/");
  // A test beside the code it tests is a test wherever it sits.
  if (/\.(test|spec)\.(ts|tsx|mjs)$/.test(clean)) return "tests";
  for (const [tier, patterns] of TIER_RULES) {
    if (patterns.some((p) => matches(p, clean))) return tier;
  }
  return "core";
}

/** The paths that make up the app a user runs: two commits that agree on these are the same app. */
export const APP_PATHS = ["src", "prisma", "public", "package.json", "package-lock.json", "next.config.mjs"];
