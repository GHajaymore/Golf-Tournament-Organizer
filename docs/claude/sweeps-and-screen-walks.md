# Sweeps and screen walks

> Moved out of `CLAUDE.md` on 2026-10-24, verbatim, so that the file every session reads stays short. Read this when your task touches: building a sweep/audit, walking screens, browser sessions. Index: `CLAUDE.md`.

**A SWEEP THAT FINDS NOTHING MAY BE BROKEN, so give every one a control.**
This is the same discipline as proving a test can fail, applied to the
instrument instead of the subject: assert that something you KNOW the sweep
should catch is caught, in the same run that reports the count. Three sweeps on
2026-09-13 were measuring nothing, and only the ones with controls said so —
the reachability sweep now asserts `addExpense` reads as called, and the money
sweep asserts four known money actions are found at all.

A control also catches the quieter failure, which is a sweep that is merely
NARROW. `money-leaves-a-trail` first used the model name `skinsPotEntry`; the
schema says `SkinsEntry`, so it skipped the two actions writing a player's
STAKE — the sharpest rows in the file it was aimed at — and reported the app
cleaner than it was. It checks every model name against `schema.prisma` now.

**THE SAME FAILURE WEARS A SECOND COSTUME: A CHECK THAT CAN PASS WITHOUT THE
CONTENT EVER ARRIVING.** A sweep with no control reports zero because it is
looking for the wrong thing; a content check does it by never receiving
anything to look at. The output is equally calm either way.

The shape to recognise is a UNIFORM, PLAUSIBLE, NON-ERROR STATUS across every
target. On 2026-09-14 a script fetched six screens to confirm a long fixture
name rendered, and printed a tidy "no mojibake, no problem" for all six. Every
one had returned **307**: the cookie was signed with `local-e2e-secret` while
the dev server on 3100 verifies against the secret in `.env`, so each request
was redirected to sign-in and each screen was then searched as an empty string.
It read as "checked six screens" and was "checked nothing". A 500 would have
been obvious; a redirect is a success and looks like the app working.

So when a script fetches an authenticated screen: sign with
`node --env-file=.env` against the dev server, `AUTH_SECRET=local-e2e-secret`
against the e2e one on 3101, and **assert the status is 200 before asserting
anything about the body**. A check that reports an absence of problems in an
absence of content is the same bug as a sweep with no control.

**And the mirror: a detector too LOOSE reports a defect that is not there.**
The same script flagged eight mojibake hits on `/entry`. They were the word
"Château" — U+00E2 is a correct French letter, and the check grepped for a bare
one. Real mojibake from the PowerShell round-trip above is U+00E2 followed by
U+20AC, or the U+00C3 family. Check the codepoints either side before reporting
anything — and when you write that warning down, spell the sequence as
CODEPOINTS rather than as the characters, or the file explaining the defect
becomes the first hit of every future sweep for it. That is the `readSource`
trap one layer out.

THIS FILE IS THE EXCEPTION AND KNOWS IT: the PowerShell detection command
above quotes the sequence literally, because a command you cannot paste is not
a command. So CLAUDE.md is the expected first hit of any mojibake sweep and
must be excluded from one deliberately rather than investigated. Everywhere
that is not a runnable command, use the codepoints.

**SWEEP THE CLASS, NOT THE INSTANCE.** Walking screens and fixing what you see
finds defects at a constant rate for ever; it never converges, because the pool
is large and you are sampling it. Sweeping a whole class finds all of it at
once and then the class is closed. On 2026-09-13, four classes swept in a day:
links (22 of 22 fine), absolute claims against deliberately-incomplete data
(nothing new), unreachable server actions (8 — five deleted, one real money
bug, two missing features), and money writes with no audit line (ten, including
the whole of `skins.ts`). The first two came back clean, which is itself the
result worth having: it is how you learn a class is finished.

**AND STILL — WALK THE SCREENS, because there is one class no sweep sees.** The
paragraph above is about not SAMPLING when you could be closing a class, and it
stands. It is not an argument against looking, and on 2026-09-18 six screens
walked with the fixture in front of them turned up two defects that 7,682 unit
tests, 1,194 audit tests, the smoke pass and Playwright had all passed:

- club settings showed **Staff 0** while the plan allowance on the SAME page
  counted two. A club on the free plan is refused the next person it adds by a
  limit its own screen has just said it is nowhere near;
- the league week read **"4 of 4 in have returned a card"** and printed
  "thru 9" for one of those players two lines below.

Both are the same shape, and it is the shape a test suite is blind to by
construction: **two screens, or two panels of one screen, answering the same
question with different numbers.** Every function involved is individually
correct, every test of it passes, and nothing anywhere compares the two
answers. That is a class, and the only instrument that finds it is a pair of
eyes on real rows.

```bash
node --env-file=.env scripts/look-at-screens.mjs           # seed + cookies
node --env-file=.env scripts/look-at-screens.mjs --teardown
```

It seeds the e2e fixture into the development database and prints the cookies
to paste in. It **refuses any database whose host is not localhost** — checked
on the host, because a password can contain the word — since a seed pointed at
production cannot be undone from here.

**KNOW WHICH SESSION THE BROWSER IS HOLDING BEFORE YOU BELIEVE A SCREEN IS
WRONG ABOUT YOU.** On 2026-09-20 about fifteen tool calls went into a defect
that did not exist: `/me/money` read "You aren't in this tournament's field, so
you have no stake in its pots" while the expense table directly beneath it
listed the signed-in name with a £25.63 share, and the database said that
person was `confirmed` in that event. Three independent checks agreed the
screen was lying.

The tab was holding the ORGANIZER's `ng_session`, not the player's. The
organizer is genuinely not in that field, the shared costs are deliberately
visible to everyone, and every word on the screen was true about a person I had
not checked I was. The tell was on screen the whole time — an "Organizer" badge
in a shell I believed I was reading as a player.

Three things make this easy to walk into, and all three are worth knowing:

- a cookie set an hour ago is still in the jar, through navigation and a
  dev-server restart, and it may belong to somebody other than the person you
  think you are testing as. (A reseed is the other half of the same trap from
  the opposite side: the VALUE survives while the row it names does not, so
  every cookie minted before the reseed now resolves to nobody.)
- `ng_active_event` is **HttpOnly** — `document.cookie` can neither read nor
  set it, so switching tournaments from the console is impossible and has to
  go through the app's own switcher (`/me/events`, or Manage on `/tournaments`);
- a stale `session=` cookie from an earlier fixture silently outranks the
  `ng_session` you just set.

So read `document.cookie` and confirm the user before concluding anything about
identity, entry status or permissions. It is the same class as the 307 trap
above — a check that runs cleanly while answering a different question from the
one asked — and it fails in the more expensive direction, because it invents a
bug rather than hiding one.

Two things make it worth the four minutes: read the numbers on a screen
AGAINST EACH OTHER rather than against your expectation, and follow anything
that disagrees to the two functions producing it. The staff number took about
four seconds to notice and an hour to prove; the noticing is the part no test
does for you.
