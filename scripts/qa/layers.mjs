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
 * all of them — or all six in ONE round, `countries: "all"`, which is what a
 * core change's round and the nightly do (2026-10-23): `club` is the country the CLUB is in (its currency, its dates,
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
 * WHEN EACH LAYER RUNS — the panel's decision of 2026-10-23
 * (`docs/testing-panel-2026-10-23.md`). Every layer carries a `when`, and a
 * round is asked for under one of these:
 *
 *   all      every layer, one after another: a round on one machine, which is
 *            how a layer is run and debugged (`npm run qa:round` with no
 *            `--schedule`). It is what a round was until that day.
 *   pr       the round a change asks for before it merges (`round/<name>-1`).
 *   nightly  the full round on main, every night: every `pr` layer, all six
 *            countries, the console crawl in full, the Android tablet and the
 *            libraries' published holes. A core change waits for it before it
 *            reaches production (the deploy gate, `scripts/qa/deploy-gate.mjs`).
 *   weekly   what moves slowly and is the same engine as the suite: Chrome and
 *            Edge as installed, and the front door with its animation on.
 *
 * Nothing was removed from testing that day; what moved was WHEN. A layer that
 * left the `pr` list runs every night or every week on main instead.
 */
export const SCHEDULES = {
  all: "every layer, one after another (a round on one machine)",
  pr: "the round a change asks for before it merges",
  nightly: "the full round on main, every night at 02:00 UTC, with all six countries and the console crawl in full",
  weekly: "Chrome and Edge as installed, and the front door with its animation on, every Sunday",
};

/** How many countries a round visits: this round's three (`trio`), or all six at once (`all`). */
export const COUNTRY_MODES = ["trio", "all"];

/**
 * The layers. `cookies` is which way the test server is started: "secure" is
 * production's (every cookie Secure); "plain" drops that flag, because WebKit
 * will not send a Secure cookie over the plain http a local test server speaks.
 * `specs: []` is the whole suite; `projects: []` is all three screen sizes.
 *
 * `plan.schedule` keeps only the layers that run under it (see SCHEDULES), and
 * `plan.countries: "all"` puts all six places abroad into ONE round — a few
 * more parts, not three repeats of everything else. With no plan this is every
 * layer, and the round number picks the three countries, exactly as before.
 */
export function layersFor(round, plan = {}) {
  const { schedule = "all", countries = "trio" } = plan;
  if (!SCHEDULES[schedule]) throw new Error(`no schedule called "${schedule}" — one of ${Object.keys(SCHEDULES).join(", ")}`);
  if (!COUNTRY_MODES.includes(countries)) throw new Error(`no country mode called "${countries}" — one of ${COUNTRY_MODES.join(", ")}`);
  const abroad = countries === "all" ? ABROAD.flat() : ABROAD[(Math.max(1, round) - 1) % ABROAD.length];
  const every = everyLayer(abroad);
  return schedule === "all" ? every : every.filter((layer) => layer.when.includes(schedule));
}

const PR_AND_NIGHTLY = ["pr", "nightly"];

function everyLayer(abroad) {
  return [
    {
      key: "suite",
      when: PR_AND_NIGHTLY,
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
      // Added 2026-10-21: the dropdowns, choices and tick-boxes were every one operated by the control
      // crawl, and the text boxes — a third of the console's controls — by nothing in particular. Its own
      // layer, cut into TEXT_PARTS shares by `--shard`, so that no part of the suite grows by an hour.
      key: "text-boxes",
      // In every change's round and the nightly, as it was when it arrived (#923): the panel of
      // 2026-10-23 made the CONTROL crawl conditional and said nothing of this one, so it is unchanged.
      when: PR_AND_NIGHTLY,
      name: "Every text box",
      standsFor: "an organizer or a member typing into any box: nothing, far too much, the wrong kind of thing, the right thing",
      reallyIs: "Chromium at 1280×900: every text box on every console and player screen of every seeded tournament given empty, over-long, bad and good input, saved the way its screen saves, reloaded and read back, then put back as it was — with a control in each share proving it can see a silent press and a refusal out of view",
      cannotSee: "a box that appears only after a press it does not make (a dialog, a second step); whether a value it calls kept is right for the club; boxes behind a button that sends, deletes or spends an allowance, which it never presses",
      cookies: "secure",
      env: { E2E_EVERYTHING: "1", E2E_TEXT_BOXES: "1" },
      specs: ["e2e/every-text-box.spec.ts"],
      projects: ["desktop"],
      minutes: 40,
      // Each share's ledger (every try and its verdict) and its reach, written as it goes. Kept with
      // the part's own files (`round.mjs`), or a failing share's findings exist only in its log.
      keeps: ".e2e/every-text-box",
    },
    {
      // Added 2026-10-13: every other layer asks the browser for reduced motion, which is what almost
      // nobody has set. The first round on GitHub met the page with its motion on by accident (Safari's
      // engine on Linux ignores the request) and three front-door tests failed on pictures measured before
      // they had settled. So the front door is also run the way it is seen.
      key: "motion",
      // Weekly since 2026-10-23: the front door changes rarely and is a tier of its own with no round.
      when: ["weekly"],
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
      when: PR_AND_NIGHTLY,
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
      when: PR_AND_NIGHTLY,
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
      when: PR_AND_NIGHTLY,
      name: `A club in ${place.club.toUpperCase()}, read in ${place.reader}`,
      standsFor: "international organizers and members",
      reallyIs: `the every-screen walk with the seeded club in ${place.club.toUpperCase()}, the browser set to ${place.reader} and its clock to ${place.zone}`,
      cannotSee: "a wrong figure (as above); a country that is not in this round (a round of three visits three; the nightly visits all six)",
      cookies: "secure",
      env: { E2E_EVERYTHING: "1", E2E_CLUB: place.club, E2E_LOCALE: place.reader, E2E_TZ: place.zone },
      specs: WALK,
      projects: [],
      minutes: 40,
    })),
    {
      key: "tablet-android",
      // Nightly since 2026-10-23: Chromium at a tablet's widths, between the suite's phone and laptop sizes.
      when: ["nightly"],
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
      // Weekly since 2026-10-23: "the same engine, a version apart" is a question of the calendar, not of a change.
      when: ["weekly"],
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
      when: ["weekly"],
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
      when: PR_AND_NIGHTLY,
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
      when: PR_AND_NIGHTLY,
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
      when: PR_AND_NIGHTLY,
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
      when: PR_AND_NIGHTLY,
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
      // Nightly since 2026-10-23, and not in a change's round: a hole published overnight is about the
      // calendar, not about the change, and a registry that could not be asked stopped rounds that had
      // tested everything else. It also holds the quarantine list to its dates (scripts/qa/quarantine.mjs).
      when: ["nightly"],
      kind: "command",
      name: "Known holes in the libraries",
      standsFor: "security: a published vulnerability in something the app ships with",
      reallyIs: "npm's advisory database, asked about every package a deployment installs; anything rated high or critical is a finding. And the quarantine list held to its dates: a test quarantined past its expiry is a finding",
      cannotSee: "a hole nobody has published, and whether a published one can be reached from this app",
      command: "node scripts/qa/dependencies.mjs && node scripts/qa/quarantine.mjs",
      minutes: 10,
    },
    {
      key: "mutation",
      // The MUTATION RATCHET (backlog A7, 2026-10-31): nightly, never in a change's round, so it costs
      // a pull request nothing. Half of what retires ARITHMETIC_KEEPS_THREE_ROUNDS (below); the other
      // half is the property tests. Its score is the first line of its log, and the verdict prints it.
      when: ["nightly"],
      kind: "command",
      name: "Would the tests notice the arithmetic broken",
      standsFor: "money and handicap arithmetic: a wrong stroke or a wrong cent that every fixture would still pass",
      reallyIs:
        "Stryker breaks the arithmetic core one small change at a time (ARITHMETIC_CORE in scripts/qa/mutation-ratchet.mjs: handicap, a round's allowance and figure, strokes by stroke index, a side's strokes, the split to the cent, skins and the skins split) and runs the unit suite against each change; a module whose score falls below mutation-baseline.json is a finding",
      cannotSee:
        "a rule no unit test states at all; gameNets, the sink that reads the database (the audit suite holds it); the rest of the foundation in stryker.config.mjs (run `npm run mutation` by hand); an equivalent mutant, which counts against the score",
      // --concurrency 4: a GitHub runner has four cores. Incremental (reports/stryker-incremental.json,
      // kept between nights by round.yml): a night re-tests only the mutants whose code or tests changed.
      // Measured 2026-10-31: a FULL run (no incremental file) of 1,371 mutants is 29 min at concurrency
      // 8 on the build machine, the dry run of the whole unit suite 5 of them; at four cores, about an
      // hour. A night with the incremental file re-tests only what changed. Held under the part
      // job's own 100 minutes (round.yml), with the setup inside it.
      command: "node scripts/mutation.mjs --scope=arithmetic --ratchet --quiet --concurrency 4",
      minutes: 85,
    },
    {
      key: "firefox",
      when: PR_AND_NIGHTLY,
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

/**
 * How many machines the text-box crawl (`e2e/every-text-box.spec.ts`) is shared between. The spec is
 * one test per share, so Playwright's `--shard=k/TEXT_PARTS` runs exactly share k; `SHARDS` below
 * names the same number for its layer. Measured 2026-10-21 on one machine as one share: 27 minutes,
 * of which about seven is opening every screen on every tournament (which each share repeats). Three
 * shares is about fifteen minutes each.
 */
export const TEXT_PARTS = 3;

/**
 * HOW MANY MACHINES EACH LONG PART IS SHARED BETWEEN, by Playwright's `--shard`.
 *
 * Keyed `layer:size` for a layer that runs every spec (it is cut by size first),
 * and `layer` for one that runs a list of specs. A part not named here is one
 * machine.
 *
 * MEASURED, not guessed (Ajay, 2026-10-13: "the test round you promised me was
 * 35 mins. why its taking so long?"). With the crawl shared out, the first
 * round took 39 minutes: six for the one build and the database suite that
 * every part waits for, and then the longest part — and the longest parts had
 * become the other browsers, each still running a whole suite on one machine:
 *
 *     firefox-desktop 33   firefox-phone 30   iphone-phone 30   ipad 27
 *     chrome 24            tablet-android 23  firefox-small-phone 22   safari 21
 *
 * against 16 to 19 for everything in the suite itself. Halving those eight
 * brings the longest part to about seventeen minutes and a round to about
 * twenty-five. It removes no test: the shards of a part are exactly the part,
 * and `qa-framework.test.ts` holds every share to be there once.
 *
 * A round is then about 47 parts for 40 machines. The eleven scenario parts
 * finish in a few minutes, so the last few parts wait about that long.
 */
export const SHARDS = {
  "suite:desktop": 3,
  "suite:phone": 2,
  "firefox:desktop": 2,
  "firefox:phone": 2,
  "firefox:small-phone": 2,
  "iphone:phone": 2,
  ipad: 2,
  chrome: 2,
  "tablet-android": 2,
  safari: 2,
  "text-boxes": TEXT_PARTS,
};

/**
 * WHAT A PART'S OWN FILES ARE CALLED, inside `.qa/rounds/<tag>/` — its log, what it kept, its summary.
 *
 * Every part of a round writes into a folder of the same name (the round's tag), and each machine's is
 * handed on as an artifact of its own. They were named by LAYER, so the three shares of the text-box
 * crawl each held `.qa/rounds/G253-1/text-boxes.log` and `summary.md`: three files of one name, and
 * fetched into one place the last one won — while the verdict carried one line per failed share and
 * none of its findings, so those logs were the only place the findings were. Two of three shares'
 * were read as lost (2026-10-21). Named by the PART, no two machines' files share a name, and the
 * verdict lists every finding (`details` in `round.mjs` and `merge.mjs`). No part named (a round run
 * here): the layer's.
 */
export function partFile(layerKey, partId) {
  if (!partId) return layerKey;
  return partId.startsWith(layerKey) ? partId : `${partId}-${layerKey}`;
}

/**
 * EVERY FINDING A PART'S LOG PRINTS, for the verdict. The text-box crawl prints each finding under its
 * share's tally as `[every-text-box]   <WHAT> · …`; what it skipped and what was locked everywhere are
 * printed the same way and are not findings. Playwright's own failure line names the share and none of
 * what it found.
 */
export function findingsSaid(log) {
  return String(log ?? "")
    .split(/\r?\n/)
    .filter((l) => /^\[every-text-box\] {3}(?!skipped · |locked on every )\S/.test(l))
    .map((l) => l.replace(/^\[every-text-box\] {3}/, "").trim().slice(0, 400));
}

/**
 * The parts of a round under `plan` (see `layersFor`), plus `plan.crawl`: false
 * leaves the console crawl out — its four shares are not made, and the suite's
 * laptop shards still skip it (`--crawl=0/N`), so nothing runs it at all. A
 * change's round leaves it out when it touches no input screen
 * (`crawlNeeded`); the nightly always runs it.
 */
export function partsFor(round, plan = {}) {
  const parts = [];
  const all = ["phone", "small-phone", "desktop"];
  const crawlWanted = plan.crawl !== false;
  for (const layer of layersFor(round, plan)) {
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
        const shards = SHARDS[`${layer.key}:${project}`] ?? 1;
        // The console crawl is one test, on the laptop size of the suite, and as long as everything
        // else in that size together. It is taken out of the shards and given parts of its own.
        const crawl = layer.key === "suite" && project === "desktop" ? CRAWL_PARTS : 0;
        for (let k = 1; k <= (crawlWanted ? crawl : 0); k += 1) {
          parts.push({ id: `${layer.key}-${project}-crawl-${k}of${crawl}`, layer: layer.key, args: `--only=${layer.key} --projects=${project} --crawl=${k}/${crawl}`, browsers, minutes: layer.minutes });
        }
        for (let i = 1; i <= shards; i += 1) {
          parts.push({ id: `${layer.key}-${project}${shards > 1 ? `-${i}of${shards}` : ""}`, layer: layer.key, args: `--only=${layer.key} --projects=${project}${shards > 1 ? ` --shard=${i}/${shards}` : ""}${crawl ? ` --crawl=0/${crawl}` : ""}`, browsers, minutes: layer.minutes });
        }
      }
    } else {
      // A layer that runs a list of specs at its own sizes: one part, or shares of it.
      const shards = SHARDS[layer.key] ?? 1;
      for (let i = 1; i <= shards; i += 1) {
        parts.push({
          id: `${layer.key}${shards > 1 ? `-${i}of${shards}` : ""}`,
          layer: layer.key,
          args: `--only=${layer.key}${shards > 1 ? ` --shard=${i}/${shards}` : ""}`,
          browsers,
          minutes: layer.minutes,
        });
      }
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
    needs: "a browser test for it, proven by breaking the code; the standing suite; and ONE round on the commit that will be production, before it merges.",
  },
  core: {
    rank: 3,
    name: "Core and shared",
    needs: "batch it, and ONE round that visits all six countries on the commit that will be production, before it merges. It then reaches production only once the NIGHTLY round on main, on that commit or a later one containing it, is clean: the deploy job holds it until then. Money or handicap arithmetic keeps THREE rounds for now (ARITHMETIC_KEEPS_THREE_ROUNDS).",
  },
};

/**
 * MONEY AND HANDICAP ARITHMETIC — core, and for now three rounds rather than one.
 *
 * The panel of 2026-10-23 cut a core change from three rounds to one round of
 * all six countries plus the nightly before production, on the reasoning that
 * a second and third run of the same paths finds a flaky test and not a
 * fault. That is not yet true of the arithmetic: a wrong stroke or a wrong
 * pound is invisible on most fixtures (CLAUDE.md, "an error that shifts every
 * row by the same amount"), and the instruments that look along those axes —
 * property-based tests over every handicap and stake, and a nightly mutation
 * ratchet that fails when a mutant of this arithmetic survives — arrived in
 * two halves: the property tests with #942, the ratchet in the nightly round
 * (the `mutation` layer above) on 2026-10-31. The switch is NOT flipped with
 * them: it waits for the ratchet to have held on real nights (see
 * `docs/testing-panel-2026-10-23.md`, item A, for what would justify it).
 * Until then, a change to one of these files keeps the old three rounds.
 *
 * TO RETIRE IT: set `ARITHMETIC_KEEPS_THREE_ROUNDS` to false in the pull
 * request that puts the property-based tests and the mutation ratchet on main,
 * and say so in `docs/testing-panel-2026-10-23.md`. `qa-pipeline.test.ts`
 * holds this list to files that exist, as `TIER_RULES` is held.
 */
export const ARITHMETIC_KEEPS_THREE_ROUNDS = true;
export const ARITHMETIC = [
  "src/lib/domain/handicap.ts",
  "src/lib/domain/handicap-policy.ts",
  "src/lib/domain/round-handicap.ts",
  "src/lib/domain/stroke.ts",
  "src/lib/domain/card-points.ts",
  "src/lib/services/handicaps.ts",
  "src/lib/services/round-handicap.ts",
  "src/lib/domain/money.ts",
  "src/lib/domain/money-layout.ts",
  "src/lib/domain/money-mode.ts",
  "src/lib/domain/skins.ts",
  "src/lib/domain/skins-pot.ts",
  "src/lib/domain/nassau.ts",
  "src/lib/domain/derived-games.ts",
  "src/lib/domain/carry.ts",
  "src/lib/domain/expenses.ts",
  "src/lib/services/skins-pot.ts",
];

/**
 * WHEN A CHANGE'S ROUND RUNS THE CONSOLE CRAWL (`e2e/every-control.spec.ts`).
 *
 * The crawl changes every dropdown, choice and tick-box on every console screen,
 * saves it and reads it back: an hour of machine time in four shares. The panel
 * kept it in a change's round for anything touching what a secretary TYPES OR
 * PICKS — entry, handicaps, tees and the other input screens — and the nightly
 * runs it on everything regardless. Read off the files, never off how the
 * change is described:
 *
 *   a core change                         always (what every screen stands on)
 *   a console screen, or a console action  `src/app/(app)/`, `src/app/actions/`
 *   a component or a rule whose NAME is   entry, handicap, tee, score, card,
 *   about input                           course, roster, member, registration,
 *                                         setting, flight, format, allowance,
 *                                         field, draw, group, stage, round,
 *                                         form, input, picker, select, option
 */
export const CRAWL_PATHS = ["src/app/(app)/", "src/app/actions/"];
export const CRAWL_WORDS = /(entry|handicap|tee|score|card|course|roster|member|registration|setting|flight|format|allowance|field|draw|group|stage|round|form|input|picker|select|option)/i;

/** Whether a change's round needs the console crawl, and the files that say so. */
export function crawlNeeded(paths) {
  const because = [];
  for (const raw of paths) {
    const path = raw.replace(/\\/g, "/");
    const tier = tierOf(path);
    if (tier === "core") because.push(path);
    else if (tier !== "function") continue;
    else if (CRAWL_PATHS.some((p) => path.startsWith(p))) because.push(path);
    else if ((path.startsWith("src/components/") || path.startsWith("src/lib/")) && CRAWL_WORDS.test(path.split("/").pop() ?? "")) because.push(path);
  }
  return { needed: because.length > 0, because };
}

/**
 * THE ROUNDS A CHANGE NEEDS, read off the files it touches (`npm run qa:changed`
 * prints this, and the Round workflow plans a pushed `round/**` branch with it).
 *
 *   rounds        how many `round/<name>-N` branches before it merges (0: none)
 *   countries     "trio" — the three the round number picks; "all" — all six in one round
 *   crawl         whether those rounds run the console crawl
 *   nightly       true: it does not reach production until a clean nightly round contains it
 *   arithmetic    the money and handicap files that keep it at three rounds, if any
 */
export function roundPlan(paths) {
  const clean = paths.map((p) => p.replace(/\\/g, "/"));
  if (!clean.length) return { tier: "none", rounds: 0, countries: "trio", crawl: false, crawlBecause: [], nightly: false, arithmetic: [] };
  const tier = clean.map(tierOf).sort((a, b) => TIERS[b].rank - TIERS[a].rank)[0];
  const arithmetic = tier === "core" ? clean.filter((p) => ARITHMETIC.includes(p)) : [];
  const rounds = tier === "core" ? (arithmetic.length && ARITHMETIC_KEEPS_THREE_ROUNDS ? 3 : 1) : tier === "function" ? 1 : 0;
  const crawl = rounds > 0 ? crawlNeeded(clean) : { needed: false, because: [] };
  return {
    tier,
    rounds,
    countries: tier === "core" ? "all" : "trio",
    crawl: crawl.needed,
    crawlBecause: crawl.because,
    nightly: tier === "core",
    arithmetic,
  };
}

/** A pattern is a prefix ending in `/`, an exact path, or has one `*` standing for anything inside a path part. */
export const TIER_RULES = [
  // Tests and tooling — nothing a user runs.
  ["tests", ["e2e/", "scripts/qa/", ".github/", "playwright.config.ts", "vitest.config.ts", "vitest.audit.config.ts", ".claude/", ".gitignore"]],
  ["tests", ["src/lib/__tests__/", "src/lib/domain/__tests__/"]],
  ["tests", ["scripts/smoke-all.mjs", "scripts/smoke-routes.mjs", "scripts/verify-*.mjs", "scripts/seed-club.mjs", "scripts/e2e-coverage.mjs", "scripts/look-at-screens.mjs", "scripts/run-mark.mjs", "scripts/session-cookie.mjs"]],
  // The load test and the production canary: they ask the app questions and ship nothing.
  ["tests", ["scripts/load/", "scripts/prod-smoke.mjs"]],
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
  ["core", ["src/lib/domain/stroke.ts", "src/lib/domain/stroke-agg.ts", "src/lib/domain/stroke-countback.ts", "src/lib/domain/match.ts", "src/lib/domain/match-tiebreak.ts", "src/lib/domain/handicap.ts", "src/lib/domain/handicap-policy.ts", "src/lib/domain/round-handicap.ts", "src/lib/domain/card-points.ts", "src/lib/domain/card-totals.ts", "src/lib/domain/ranked-score.ts", "src/lib/domain/standings.ts", "src/lib/domain/shared-position.ts", "src/lib/domain/cut.ts", "src/lib/domain/bracket.ts", "src/lib/domain/bracket-flights.ts", "src/lib/domain/draw.ts", "src/lib/domain/league-draw.ts", "src/lib/domain/grouping.ts", "src/lib/domain/team.ts", "src/lib/domain/team-match-standings.ts", "src/lib/domain/cup.ts", "src/lib/domain/pair-totals.ts"]],
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
