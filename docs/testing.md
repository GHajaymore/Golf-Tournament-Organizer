# Testing TourneyHQ

How the app is tested, how much testing a change needs, and how the tests are kept true as the
app grows. The rules here are Ajay's; the machinery is in `scripts/qa/`.

> "I care more about functionality and operationality of the app that is the meat. anything
> surrounding it like documentations should not fail the app … I can understand if making any
> process flow or navigational thing impacting functionality may require thorough testing."
>
> "you should be building these permanent test script which covers all aspects of the app and use
> it whenever we make any change in the app. Keep it updated whenever we add any functionality."
>
> "make the testing efficient." — Ajay, 2026-10-13

Who decides: the QA lead decides what a round covers and what counts as a finding. The golf
professional and the tournament manager decide whether what a screen shows is right golf and right
operations — against the Rules, not against what the app did last week. The designer decides
whether it can be read and used.

## The four commands

| Command | What it answers | When |
|---|---|---|
| `npm run qa:changed` | What did this change touch, and how much testing does that need? | First, on every finished change. Quote it in the pull request. |
| `npm run qa:round -- <NAME>` | Is this app sound, all over? | Before function or core changes reach production. |
| `npm run qa:status` | How many clean rounds does this app have? | Whenever somebody asks. Never answer from memory. |
| The **Round** workflow on GitHub | The same round, its parts side by side, in under an hour | The normal way to run a whole round. |
| `node scripts/qa/burn-in.mjs` | Do the tests this change adds or touches pass every time, not most times? | Before a round is spent on them. See "What a round costs" below. |
| The **Breaks** workflow on GitHub | Does each new test go red when the app is broken the way it is meant to catch? | With every change that adds a test. See "Proving a test by breaking the app". |

`ci.yml` is not on this list because nobody runs it: it runs itself on every push, on one browser,
and answers "did this change break something that was working". A round is a different question.

## How much testing a change needs

Decided by **what the change touches**, read off its files by `npm run qa:changed` — never by how
small the change is or what it is called. The first rule that matches a file decides it
(`TIER_RULES` in `scripts/qa/layers.mjs`); a file no rule knows is treated as core.

| Tier | What it is | Before production |
|---|---|---|
| **Tests and tooling** | `e2e/`, `scripts/qa/`, workflows, test files | The tests it changes, run. Nothing ships to anybody. |
| **Words and documents** | The guide, the player's Help, `docs/`, `CLAUDE.md` | Its own tests and CI. No round. |
| **The front door** | The landing page, FAQ, privacy, terms | The landing specs on three sizes, and CI. No round: its stylesheet cannot reach an app screen. |
| **Function in one area** | How a form reads what is typed, one action, one flow, one screen | A browser test for it, proven by breaking the code; CI; and **one full round** on the commit that will be production, before it merges. |
| **Core and shared** | Scoring, handicaps, money, draws and brackets, sign-in and access, the database, the shells and stylesheets every screen stands on, the build | Batch it, freeze, and **three full rounds** on the commit that will be production, before it merges. |

Three consecutive clean rounds is also the bar before go-live, whatever has changed.

**The count belongs to the app, not to the commit.** `scripts/qa/app-id.mjs` fingerprints every
file that is function or core. A commit that rewords the guide or recolours the front door has the
same fingerprint, so the count on it stands. Any change to a function or core file is a different
app, and its count starts at nothing.

## What a round is

`npm run qa:round -- --list` prints it from the source. Each layer says who it stands for, what is
really run, and what it cannot see — so a row in the report is never read as more than it is.

| Asked for | Layer | What is really run |
|---|---|---|
| Laptop, phone, Android | **The whole suite** | Chromium at 1280 wide, as a Pixel 5, and at 320 wide: every spec, every screen opened as each kind of person, every control operated and read back, every server action called by a stranger |
| Nearly every visitor | **With the animation on** | The front door's specs with the page's motion left on. Every other layer asks for reduced motion, which almost nobody has set; a test about how a page looks at rest has to wait for rest |
| A club in another time zone | **Somewhere else** | Every screen again with the browser and the club on another calendar day from the server |
| US members and organizers | **An American club** | Every screen with the club in Indiana: dollars, the month first, American golf words |
| International | **Abroad** (three a round) | Every screen with the club in India, Japan, Australia, South Africa, Ireland — and a Scottish club read from a German browser. Three rounds visit them all |
| Tablet (Android) | **An Android tablet** | Chromium as a Galaxy Tab, upright and on its side, touch |
| Chrome, Edge | **As installed** | The real Chrome and the real Edge, not the test build |
| iOS | **An iPhone**, **Safari**, **An iPad** | WebKit — Safari's engine — as an iPhone 13, an iPhone SE, a Mac, and an iPad upright and on its side |
| Firefox | **Firefox** | The standing suite on Firefox at three sizes |
| Security, from outside | In **the whole suite** | `security.spec`: the headers every answer is sent in; that no screen opens signed out and nothing of a club comes back instead; that a "go on to" address cannot be another site; that no secret is in the scripts a browser downloads; that a name, a title, a club's colour and a notice are text wherever they are drawn; that another site cannot act as you; that a wrong address never shows the inside of the app. With `every-action-vs-a-stranger`, which calls every server action as the wrong person |
| Security, known holes | **Known holes in the libraries** | npm's advisory database, asked about everything a deployment installs. High or critical is a finding |
| Security, in the repository | Every push | `no-secret-is-committed.test.ts`: no tracked file carries a key, a token or an address with a password in it |
| Search engines, shared links | In **the whole suite** | `seo.spec`: each public page's title, description, one heading, language and its own canonical address; the share card and its picture; structured data that parses; a sitemap that lists exactly the public pages; and every private screen telling crawlers to keep out |
| People who cannot see it or use a mouse | In **the whole suite** | `a11y.spec`: axe, against WCAG 2.1 A and AA, on every public page, every organizer screen and every player screen |
| A weak signal | In **the whole suite** | `weight.spec`: what a phone downloads for the screens people open most, held to a budget (kept per platform: a build made on Windows hints no font, so GitHub's figure is the one production matches); `fonts.spec`, every font file a screen downloads is one it draws with; `slow-page.spec`, which delivers pages slowly on purpose; and `slow-signal-scoring.spec`, which holds every save back and scores ahead of them |
| The app doing its job | **Eleven tournaments, played** | Eleven tournaments of 110–120 invented players, entered, drawn, scored, cut, ranked and paid through the screens, with the results checked against the Rules of Golf and of Handicapping |

On one machine that is about six hours. On GitHub the same layers are cut into about thirty parts
(`partsFor` in `layers.mjs`), each with a machine and a database of its own and all drawing one
build, so a round takes as long as its slowest part.

### Does end-to-end cover everything? Not yet — and the gap has a number

Asked twice by Ajay on 2026-10-12, and the answer he is owed each time is the measured one, not
"the suite is large".

| | Covered by a browser test |
|---|---|
| Every screen opens, as organizer, member and signed out, on every seeded tournament | Yes — the lists are read from the app, so a new screen is included unasked |
| Every dropdown, choice and tick-box is changed, saved and read back | Yes |
| Every action is tried by the wrong person and refused | Yes |
| Whole tournaments played from entry to payout | Yes — eleven |
| **Every action done by the RIGHT person, with the result checked** | **No.** 36 of 263 on 2026-10-10; 127 of 272 in the first clean round (2026-10-13, commit `77d59567`), with 17 more performed by specs written after it. Every round re-measures it and names each action nothing performs |
| Every text box given good, bad and empty input | Only where a spec was written for it |
| Every figure a club can TYPE, in every language it can choose | Amounts, handicaps and course ratings: yes, since 2026-10-13 (`figures-are-read-in-every-language.test.ts`). Any other decimal somebody types: only once it goes through `minorUnitsFrom` or `decimalPoint` |

**What writing a spec per flow has found.** Ten flows were written in the two nights to
2026-10-13, and six of them found at least one fault on the first run — eight faults in all,
each of which every other layer had passed:
a pin that could not be cleared, commentary nobody but the committee could read, four screens
dating things by the server's day, a negative prize left standing in its box, "take 5.00" with no
currency, a stake read as a hundred times what a German club typed, a side bet started for
nothing a head, and a withdrawal whose confirmation was wiped before it could be read. That rate
has not fallen yet. So the reach figure is not a formality: the actions nothing performs are
where the next faults are, and a clean round says nothing about them.

**And it did not fall the next morning.** Four more areas were used in a browser for the first
time on 2026-10-13, and three held faults that were live: a club could only ever have one season,
and a second season wore the first one's rules; members who missed a cut were described as
entries with no roster record; the course editor refused a wrong card in a sentence that was not
on the screen; and one tap on a radio changed somebody's role at the club. The fourth, the
honours board, was right — and the test written for it was wrong about it, which is the other
thing a spec per flow finds.

**Two of those were one fault, and the round now looks for it everywhere.** A refusal printed at
the top of a long screen, under a press made at the bottom, is a button that appears to do
nothing. Every page of every browser test watches for words that look like a refusal, appearing
within four seconds of a press, with none of them on the screen (`watchRefusals` in
`e2e/coverage.ts`); `scripts/e2e-coverage.mjs` lists them beside the reach. It is a list to read,
not a count to fail on: an entry marked "red" was recognised by its colour alone, and a kitty
that is short is red too.

**Roughly thirteen actions cannot be performed here at all**, because they call a paid service
that a test must not reach: reading a card from a photograph (3), drafting words with the AI
(`draftMessage`, `suggestCommentary`, `suggestSetup`, `applySetupProposal`), Stripe
(`startCheckout`, `openBillingPortal`), a text to a whole club (`broadcastToScope`,
`broadcastWithText`) and push (`savePushSubscription`, `removePushSubscription`). They are refused
to the wrong person by the every-action sweep and held by database tests; "done by the right
person in a browser" will stay short of the whole by that many.

The fifth row is the work: a spec per flow, until the named list is empty. The figure is on the
testing board and in every round's verdict, and it is never quoted from memory — the ledger only
means anything against the build it was recorded on (`scripts/e2e-coverage.mjs` says so when the
two do not match).

**What no layer covers, and the report says so every time:** a real phone or tablet in a hand; the
App Store and Google Play builds (an iPhone here is Safari's engine with an iPhone's screen, on a
Linux machine); Safari and Firefox on a Mac or on Windows; push notifications on Safari's engine.
Those are checked by a person with the device.

## Running a round

**On GitHub — the normal way.** Push the commit to a branch named `round/<anything>-1` (then `-2`
and `-3` for the second and third of a count; the number decides which three countries that round
visits), or use *Run workflow* on the **Round** workflow. The verdict and the table are the run's
summary. Three rounds can be asked for at once.

**On one machine** — for one layer, or when a part needs looking at:

```bash
npm run qa:round -- T1 --build --only=suite          # database suite, fresh build, one layer
npm run qa:round -- T1 --only=scenarios --scenario=c # one tournament
npm run qa:round -- T1 --only=tablet-android
```

It refuses to start with uncommitted changes, or on a build made from a different app. Never two
at once on one machine. No edits to `src`, `e2e` or `scripts` while one runs, and no other build.

**Recording it.** `npm run qa:status -- --record <NAME>` writes a round's verdict into
`docs/qa-ledger.json`, which is committed. `npm run qa:status` then says how many consecutive
clean, all-over rounds the app that is checked out has. That file is the answer to "where are we
with testing" — with the commit, the reach and what was left out beside every count.

## What makes a round not clean

Any one of these, in any layer:

- a test that failed, was flaky, or did not run;
- a run that exited badly, or in which nothing passed (it tested nothing);
- a tournament that stopped part-way;
- a hydration mismatch recorded on any page, whether or not a test was looking at it;
- a server action no screen test calls that `scripts/qa/reach-baseline.json` does not already
  list — something added to the app without a test, or a test that was lost.

A layer that was left out or could not run makes a round **clean, but not all over**. It is said
that way and never rounded up.

### What a finding costs

"Not clean" means *a finding*, not *the app failed*. Every finding is written down with what a
user would have seen, and then it is one of two things:

- **It touches function** — a wrong score, wrong money, wrong access, lost data, a flow that cannot
  be finished, a screen that cannot be used on a device people hold. It is fixed, the fix is a
  change like any other (so it has a tier), and the count restarts on the new app.
- **It is surroundings** — a word, a document, a picture on the front door, a cosmetic fault on one
  screen. It is fixed and that screen is re-tested. The fix does not change the app's fingerprint
  unless it has to touch a function or core file, so the count stands.

The second kind must not be used to wave through the first. If there is doubt about which it is,
it is the first.

## What a round costs, and how it is kept short

Ajay, 2026-10-13: "how can we reduce the testing time without impacting the testing
efficiencies". Measured that day on a clean round (35 parts):

| | |
|---|---|
| Machine time for one round | 445 minutes |
| Wall clock for one round | 74 minutes |
| Its longest part | 62 minutes: the laptop suite's first shard, which held the console crawl |
| Its next longest part | 34 minutes |
| A part's longest wait for a machine | 21 minutes, with three rounds pushed together |
| Rounds that week which stopped on a test's own mistake | 2 of the last 7; none of the 7 stopped on the app |

So three things, in order of what they save. None of them removes a test.

1. **A round is not spent on a test's own mistakes.** A test that is wrong about timing passes
   most of the time, so one run of it proves little. Before a round, `node scripts/qa/burn-in.mjs`
   runs every spec the change adds or touches five times at laptop and phone size, and each must
   pass every time. A round that stops on a new test costs that round and the one that confirms
   the fix: two hours, against the ten minutes this takes.
2. **A round takes as long as its slowest part, so no part is twice the others.** The console
   crawl is one test and `--shard` cannot cut a test, so it is cut by SCREEN into four parts
   (`E2E_CRAWL_PART`, `CRAWL_PARTS` in `layers.mjs`); the merge adds the four counts and holds the
   total to the crawl's own minimum. When a part grows past about thirty minutes, cut it the same
   way rather than waiting on it.
3. **Nothing is run twice for no reason.** The every-push checks do not run on a `round/**`
   branch: a round is a push of a commit that already has its pull request's checks.

**Measured again the same evening, with all three in and forty machines** (Ajay upgraded the
account; `round/league-1`, 39 parts):

| | |
|---|---|
| Wall clock for one round | 39 minutes, for the same checks and eight more |
| The build and the database suite every part waits for | 6 minutes |
| Its longest part | 33 minutes: Firefox at laptop size |
| Its next longest | Firefox phone 30, the iPhone 30, the iPad 27, Chrome 24, the Android tablet 23, Firefox small phone 22, Safari 21 |
| A share of the console crawl, which had been 62 | 16 minutes |
| Everything in the standing suite itself | 16 to 19 minutes a part |

So the limit had moved, as rule 2 says it will: to the other browsers, each still running a whole
suite on one machine. Ajay, that evening: "the test round you promised me was 35 mins. why its
taking so long?" Those eight parts are cut in two by `--shard` (`SHARDS` in `layers.mjs`), which
puts the longest part at about seventeen minutes and a round at about twenty-five. **When a round
is slower than it was said to be, measure the parts before explaining it**: the first answer that
came to mind that evening was the queue, and the queue was nought.

4. **A deliberate break is proven on a machine of its own, not one after another on a desk.**
   A browser test is only worth its green if the app, broken, turns it red, and that takes a
   build per break. Eighteen of them run one at a time on the machine the app is written on took
   eighty-five minutes and held its working tree the whole time. `breaks.yml` gives each break a
   machine: push the list to a `breaks/**` branch (see "Proving a test by breaking the app").

What decides the time of THREE rounds pushed together is machine time over the machines the
account may use at once: about 1,400 minutes over forty is 35 minutes of queue-free running, so
three rounds together finish in a little over the time of one and a half.

**What is not on the list, deliberately:** fewer browsers, fewer rounds for a change to scoring,
a shorter crawl, or re-running a failed part until it passes. Each of those is where a fault this
suite found was found.

## Proving a test by breaking the app

A test is only worth its green if the app, broken, turns it red. Every change that adds a test
breaks the code it covers, watches the test fail, and puts the code back (`CLAUDE.md`, "Prove a
new test can fail"). For a browser test that is a build per break, so it is not done on a desk:

1. Commit the work. A break is judged against that commit, and is undone with `git checkout`.
2. Write the list: a JSON array, one entry a break. `scripts/qa/breaks.mjs` says what an entry
   holds: the file, the one line to change and what to change it to, and the tests that should
   notice (a browser spec, unit tests, database tests).
3. `node scripts/qa/breaks.mjs --check <list>` says whether every break would apply, before any
   machine is spent. Then, on a branch named `breaks/<anything>`, on top of that commit, commit the list as
   `qa-breaks.json` at the root, and push. The **Breaks** workflow gives every break a machine and
   a database. The branch is thrown away afterwards; the list is never merged.
4. Read the verdict. A job is GREEN when a test went red, so a red job is a break the tests missed.

| Result | What it means |
|---|---|
| CAUGHT | A test the break names failed. |
| NOT CAUGHT | They all passed. Either the tests cannot see that fault, or the break changes nothing anybody would notice. Work out which and write it in the pull request; do not assume. |
| NOT APPLIED | The line was not found exactly once, so nothing was broken. Never read this as "not caught". |
| DOES NOT COMPILE | The type checker refused the break, so nothing ran. Rewrite the break. |
| DID NOT RUN | A browser test's build or server failed. A break that leaves a variable unused fails the build's lint: keep it used (`x * 0`, `x && ""`). |

One break on a desk, to see it work before pushing a list: `node scripts/qa/breaks.mjs --run=1
qa-breaks.json`. Quote the count in the pull request, with every break that was not caught explained.

## Keeping it true when the app changes

A change is not finished until the tests know about it. What to add, by what was added:

| You added | Add |
|---|---|
| A screen | Nothing for the walk or the layout sweep — they read the screens from the filesystem. Its guide and Help lines (`CLAUDE.md`, "Help and docs travel with the change"). |
| An action, a form, a flow | A spec in `e2e/` that **does** it as the person who would, and reads the result back. Prove it can fail: break the code, watch it go red, put it back. Until it exists the next round reports the action as *no screen test calls it* — a finding, not a note. |
| A format, a draw, a cut, a money rule | A scenario in `e2e/scenarios/`, or a phase in one: a tournament of that kind played by a full field, with a check against the Rules rather than against the app. List it in `SCENARIOS`. And the cell in `src/lib/__tests__/matrix.test.ts`. |
| A country, a currency, a language | A language's dates are the app's own: add its tag to `TAGS` in `scripts/build-date-words.mjs`, run it, **read the new line by eye** (it is what a club will see), and only then offer it in `LOCALES` — `date-words.test.ts` refuses a tag the picker offers and the table does not hold. The row in `LOCALES` / `CURRENCIES` is then swept by `formats-agree`. A place for the seeded club is a line in `scripts/seed-club.mjs` and in `ABROAD`. |
| A date or a time on a screen | Nothing new: write it with `formatDay` / `formatDayAt` / `formatMonthDayAt` / `formatDayRange` / `formatClock` / `shortDate`. A screen that asks the platform to word one itself is refused by `date-words.test.ts`, because two browsers word it two ways. |
| A box with no Save button | `onKeyDown={leaveOnEnter}` above its `onBlur` (`src/lib/leave-on-enter.ts`), so Enter keeps what was typed. `saves-on-leave-saves-on-enter.test.ts` finds every box that acts when it is left and holds it to that, or to a stated reason. |
| A sentence that says no | Print it beside the press it answers, with `role="alert"` (and the shared `form-error` class), never in one line at the top of a long screen. The spec that provokes it asserts `toBeInViewport()` as well as `toBeVisible()`; the round lists any refusal that appeared off the screen. |
| A screen behind a plan | A spec that opens it on a club that HAS the plan. The seeded club is on Birdie; the e2e fixture's club is on none, so a spec there gives it a plan row for as long as it runs and takes it away again (`seasons.spec.ts`). |
| A figure a board prints (a net, a handicap, points, money) | A spec that works the figure out **for itself**, from the stored rows and the Rule, and holds the board to it — never by calling the app's own function, and never by accepting two answers. Use a field where a wrong method gives a different figure, and assert that it does (a control), or the check cannot fail. A golfer's index has a decimal place: a fixture of whole-number handicaps cannot tell rounding first from rounding last, which is how a stroke's error for one player in five sat under 11,800 green tests (`e2e/team-allowance.spec.ts`, `allowance-is-taken-of-the-exact-figure.test.ts`). |
| An allowance, a share, any percentage of a handicap | Take it with `playingHandicapFrom(exact, pct)`, of the figure BEFORE rounding (`CourseHandicaps.exact`, `resolveRoundHandicap().exact`, a side member's `handicapExact`). The sweep in `allowance-is-taken-of-the-exact-figure.test.ts` reads every caller and refuses the arithmetic written out by hand. |
| A block inside an answer or a page that shares the landing chrome | A rule for its class in `lib/landing/styles.ts` (`landing-answers-are-dressed.test.ts` refuses a class with none), and a look at it OPEN in a browser: `e2e/faq-blocks.spec.ts` measures the three the questions page has. |
| Anything in the seeded club (`scripts/seed-club.mjs`), or a control on a console screen | Before a round, the crawl, locally: `E2E_EVERYTHING=1 npx playwright test e2e/every-control.spec.ts e2e/everything.spec.ts --project=desktop`. The ordinary local run leaves it out because it takes most of an hour, and it is the one layer that reads every control on every seeded tournament. Putting the seeded club on a paid plan unlocked one tick-box, the crawl lost track of it, and a round of thirty-four parts was spent finding that out (2026-10-13). `E2E_ONLY_EVENT=<slug> E2E_ONLY_SCREEN=<name>` narrows it to one screen in a few minutes. |
| Anything on the front door | `await landingSettled(page)` before measuring or pressing: the page grows by thousands of pixels when its script starts (`e2e/landing-settled.ts`). |
| A kind of file nothing here names | A line in `TIER_RULES`. Until then it is treated as core, which is the safe mistake. |

Three tests hold this page to the code (`src/lib/__tests__/qa-framework.test.ts`): every scenario
file is listed and every listed file exists; the parts of a round add up to exactly its layers;
and every file named as core exists — so a rename cannot quietly demote the scoring engine to
"function in one area".

`scripts/qa/reach-baseline.json` is the list of server actions no screen test calls yet. It may
only get shorter. Shortening it — writing the test that reaches one — is the most useful testing
work there is: a clean round says the paths walked behaved, and that list is the paths nobody
walked.
