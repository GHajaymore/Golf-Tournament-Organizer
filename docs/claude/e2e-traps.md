# Playwright spec traps

> Moved out of `CLAUDE.md` on 2026-10-24, verbatim, so that the file every session reads stays short. Read this when your task touches: writing or debugging a spec. Index: `CLAUDE.md`.

**A SPEC MOVES BY ADDRESS. A PLAYER MOVES BY THUMB, AND THE TWO ARE DIFFERENT REQUESTS.**
`page.goto` asks for a whole document. Tapping a tab asks for page data, through the service
worker (`public/sw.js`). Until 2026-10-11 the worker answered those from its cache FIRST, keyed
by address alone — so a member who took over somebody's phone and tapped Money was shown that
person's money, card and place on the board, and anybody re-opening the app was shown the first
tab they tapped as it was the last time.
Every spec, the every-screen walk and the control crawl were green over it, because none of them
taps. `e2e/shared-phone.spec.ts` does, and compares the screen with what that person is shown in
a clean browser that has no worker.

Two things to carry forward. **When a check is about what one PERSON sees, compare the screen,
not a word on it**: the first measurement of this looked for a name, found the right names (a
money page names everybody in the pot), and called it safe. And **the worker keeps nobody's
pages** — four static files and nothing else. The cache it had was for opening a tab with no
signal, which it never managed; if that is ever wanted it has to be BUILT, with each kept page
filed under the person it belongs to. Do not switch page caching back on to get it.

**AND A SPEC TYPES INTO A PAGE THAT LOADED LONG AGO.** The server is next door, so the script
is there before the first key. On a course it is not: a screen is drawn seconds before its
script arrives, and until 2026-10-11 anything typed in that gap was on the screen and unknown to
the page — a round code with Continue grey for ever. `TypedBeforeLoad` in the root layout
closes it for every text box. To test anything about a form's first seconds, hold the script
back (`page.route("**/_next/static/**/*.js", …)`, as `e2e/typed-before-load.spec.ts` does) and
type with `pressSequentially` — and wait for the page to be live before a `fill`, or the spec
itself is the slow-connection user and fails three steps later on a disabled button.

**AND A SPEC'S SAVE LANDS BEFORE THE NEXT TAP. ON A COURSE THE NEXT TAP COMES FIRST.** A card
saves itself after every hole. Until 2026-10-13 each save was sent on its own, so on one bar a
player three holes ahead of their signal had three saves in the air, and they arrived in whatever
order the network liked: the second to land carried a revision the first had already replaced,
and the server answered that somebody else had changed the card. The player was shown the
"Use theirs / Keep mine" chooser over a card nobody but them had touched. Next door to the
server a save is back in twenty milliseconds and none of this can happen, so every scoring spec
was green over it.

Two things hold it now. **One save is out at a time** (`usePendingCard`: `mayStartSend`, and
`landed()` for anything that must follow the last one, which certifying does), and a newer card
goes when the one before it is back. And **the server does not call a card it already holds a
conflict** (`scorecard-write.ts`): a retry of a save whose answer was lost is the same card, not
somebody's edit. `e2e/slow-signal-scoring.spec.ts` holds every save back and scores ahead of
them; to test anything about what happens BETWEEN a tap and its answer, delay the answer
(`page.route` on the action's POST) rather than waiting for a quiet network.

**AND EVERY HOLE SAYS WHERE ITS SCORE IS (the honest card, 2026-10-25).** "On your phone", "Sent"
or "Not sent", a mark on the strip and the words at the hole, from `usePendingCard().holes` —
worked out from the card the queue holds to send against what the last answered save READ BACK
from the row it wrote (`writeScorecard`'s `stored`, the play and match actions' `card` / `holes`).
A save that resolves with a read-back that disagrees is not a landing. A spec that waits for the
card's line reads "Sent" (it was "Saved"); `e2e/honest-card.spec.ts` holds the saves back, cuts the
signal, and compares the screen with the database hole by hole. Tapping a name on a round code no
longer reloads the page — the claim's own answer draws the card — and `e2e/round-code-on-3g.spec.ts`
times it on slow 3G.

**AND A BUTTON THAT WAITS FOR THE SCRIPT WAITS FOR ALL OF IT (2026-10-25).** On slow 3G (400 kbit/s,
400 ms a request) the cold `/play` drew its code box at 1.8 s and Continue woke at 7.8 s. Measured
request by request, not read: the page brought down 351 KB — scripts 193, fonts 105, the document
44, the style sheet 9 — and Continue could be pressed only once React had taken the page over,
which is after the LAST script chunk, all of it sharing the one line with the fonts. Nothing on the
page was slow; the button simply had to wait for everything. Three things were found and done:

- **The code box and the names are real forms** (`redeemRoundCodeForm`, `claimPlayerSlotForm` in
  `actions/play.ts`, through `useActionState`). Before the script, Continue and a name post the
  plain way and the server draws the next step; once the page is live the press is taken in the page
  as before. Continue is pressable at the first paint (1.9 s) and greyed only by a LIVE page. React
  writes hidden `$ACTION_…` boxes into such a form, and React never takes those over — so a check
  of "is the page live" must not read the first `input` it finds (`round-code-before-the-script.spec`
  did, and its control was vacuous until it was made to say yes once the script landed).
- **The icon sprite went down twice in every document**: drawn by a server component, it was the
  page AND, again, the page's data for React — 37 KB of `/play`'s 44. `IconSprite` is a client
  component now whose symbols exist only in the server's copy (`typeof window` is fixed at build
  time), and the browser reads them back from the page. Every document in the app is ~19 KB lighter.
- **`next/link` in the root `not-found.tsx` cost every page outside the player app 16 KB**: it is in
  the root layout's tree, and its client reference was filed with the player layout's chunks, so
  `/play` fetched four chunks of a layout it is not in. Plain links there now.

After: 316 KB, 25 requests, names on screen at 3.3 s for a thumb that types at once (9.2 s before),
and 0.9 s from a name to a pad that takes a score once the page is live (1.4 s before). **What is
NOT fixed, and why**: a pad needs its script, and the framework alone is ~104 KB — two seconds of
that line — so "a card within 2 s of opening the link" cannot be met on this throttle by any page
that needs a script to take a score. A quick thumb still waits ~10 s for the pad, because each plain
post leaves a page whose half-fetched scripts and fonts start again. The next levers, both measured
and neither taken without a ruling: the fonts (105 KB, VeryHigh priority, restarted on every page
change) and the sprite's 19 KB still in every document's HTML.

Two things to carry forward. **Measure the page by its requests before choosing a fix** — the
obvious suspects (data fetched before render, the service worker, the hydration patch) were none of
it. And **DevTools' throttle shares the line between every request alike**: the style sheet waits
behind thirty script chunks there, which HTTP/2's priorities would not let happen on Vercel, so the
draw time it reports is a little pessimistic and the byte counts are the figure to trust.

**AND A BUILD MADE ON WINDOWS HINTS NO FONT, SO THIS MACHINE CANNOT SEE WHAT A PHONE
DOWNLOADS.** Until 2026-10-13 every screen fetched five font files before it knew which it would
draw — 248 KB — and no local run or screenshot showed it, because next/font's manifest comes out
empty on Windows (`src/app/fonts.ts` says why). Production is built on Linux. So
`e2e/weight-budget.json` is kept PER PLATFORM, `e2e/fonts.spec.ts` says in a line when the rule
about hints was not exercised, and the figure to believe is the one the phone part prints on
GitHub: two hints a screen, three on a player's Today.

**AND THE FRONT DOOR IS NOT ITS FULL HEIGHT WHEN IT HAS LOADED.** The story of a round is a plain
section until the page's script starts, and then a scroll-told track: on a phone the page is
14,021px tall half a second after it loads and 16,559px a second after, and everything below the
story — the pricing, the sign-in box — is 2,500 to 3,500px further down. Three rounds on one
batch each stopped on a front-door test because of it (2026-10-13): one read where the sign-up
form was on arrival and scrolled there later; one pressed "Send reset link" in the instant the
page grew, and the press landed where the button had been. Three more walks read the page's
height on arrival and would NOT have failed — they would have stopped short of the bottom and
called the rest clean. **Any test of the front door awaits `landingSettled(page)`
(`e2e/landing-settled.ts`) before it measures or presses**, and one that scrolls to a thing asks
where the thing is at the moment it scrolls. The visitor is fine: somebody already at the
sign-up form keeps their place to the pixel on Chrome's engine and on Safari's — measured, after
it had been assumed otherwise and written down as a fault that was not there.

**AND THE SUITE IS CHROMIUM UNLESS YOU ASK.** Most players hold an iPhone, which is WebKit.
`E2E_ENGINE=webkit npx playwright test` runs the same three projects on it (CI installs Chromium
only, so this is by hand: `npx playwright install webkit` once). Two things to know before
believing a red WebKit run:

- **Start the server for it with `E2E_PLAIN_HTTP=1`.** The e2e server is a production build over
  plain http, and WebKit does not send a Secure cookie there — so every flow where the SERVER
  sets the cookie (sign-up, set-password, a round code) silently signs nobody in, and the spec
  fails three steps later on a screen that says "Enter your score". `secure-cookies.ts` drops the
  flag for that run and refuses to on Vercel. Start it WITHOUT the variable for Chromium runs.
- **"TypeError: Load failed" is a real finding; "Fetch API cannot load … due to access control
  checks" is not.** Both mean a request was dropped because the page was left. The second is the
  framework's own and `page-errors.ts` ignores it. The first is a request the APP made and did
  not catch — Safari raises it where Chromium says nothing, and the first run found three.
- **Push is NOT covered on WebKit.** This WebKit build offers `PushManager` and then never
  answers `getSubscription()`, freezing the page — the player's Today, on its second visit, once
  the service worker is there. It read for an hour as the app freezing on an iPhone.
  `e2e/coverage.ts` takes `PushManager` away on that engine. Real Safari answers the call; the
  real-phone push test is still owed.

**A RUN KILLED INSIDE AN ORGANIZER-FROM-NOTHING SPEC POISONS THE NEXT ONE.** Those specs
(`organizer-medal`, `organizer-entry` and their kin) make a club the app names after the PERSON,
not the fixture's mark. Stop a run inside one and the next run's standing fixture deletes the
organizer — their address carries the mark — and leaves the club, with a tournament on it that
still lists that address as its organizer. The next fresh organizer is therefore sent straight to
that tournament instead of being asked for a first one, and every such spec waits out its whole
timeout on a form that never appears. Six minutes each, and it reads as the app. Since
2026-10-11 `teardownOrganizer` finds the club through the tournament as well; if those specs all
time out together on "create your first tournament", look for an orphan club before the code.

**Reading a change in the browser: bust the URL, or you will read the old page.** Navigating to a
URL the browser has already visited serves it from cache, so `innerText` shows the render from
before the edit. On 2026-09-07 that reported a fix as missing three separate times — twice after
a dev-server restart, once on `/live`, which ALSO has its own server-side board cache and so has
two independent ways of handing back something stale.

The tell is that a `fetch(url, { cache: "no-store" })` of the same page contains the string the
rendered DOM does not. That is not a bug in the fix; that is two caches doing their job.

So: append a throwaway query (`?bust=1`) when navigating to check a change, or assert against a
no-store `fetch`. And note the failure is not symmetrical — a stale read can also show a string
you have just DELETED, which is the direction that ends with "already fixed" written on something
that is not.
