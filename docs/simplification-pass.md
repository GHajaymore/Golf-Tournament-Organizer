# The page-by-page simplification pass

**Status: 7 screens done of ~25, plus two classes closed by a sweep.** This file
is the working state, so the pass can be picked up in a fresh session without
re-deriving it. Reasoning for each screen is in the session record of the day it
was done.

**Two questions are waiting on Ajay** — see "Waiting on a decision" at the end.
Neither blocks the next screen.

## What "simplify" means here

Not decluttering. Both screens Ajay called confusing were confusing for one of
two reasons, and neither was too much on screen:

1. **Two unrelated things share one heading**, so the control somebody came for
   cannot be found — nothing on screen names it. The tell is an **ampersand in
   a heading**: "Match points & tiebreakers", "Players & scoring".
2. **A control creates something invisibly** the moment it is touched.

So the move is almost always to **SEPARATE what got conflated**, not to remove.
Every control that was there should still be there afterwards. If a change
removes a setting, it is probably the wrong change.

**Four more shapes, all found on 2026-08-19.** Same disease, different symptom:

3. **The thing is at the wrong LEVEL, not under the wrong heading.** On
   `StagesClient`, the per-type settings were correctly grouped and correctly
   titled — two clicks down, inside a panel called "Customize this round". A
   Single Match Stage's pairing rule is not a customization; it is the round's
   whole point. Ask of every collapsed panel: *is anything in here the reason
   this thing exists?*
4. **A section is named after a screen that already has that name.** `/event`
   had a section headed "Registration & field"; so is the sidebar screen at
   `/registration`, which the same card told organizers to go to. **Grep the
   headings of any screen against `nav.ts` labels.**
5. **An ACTION filed under a settings heading.** "Cut line & carry-forward" also
   held the Generate-pairings button; "Registration & field" also held an Apply
   that creates placeholder players and deletes scored matches. Settings and
   actions read differently and belong under different words.
6. **A value displayed where it cannot be set.** `/registration` shows
   "Registration closes" and "of N capacity" read-only; both are set on
   `/event`, and neither linked there. An unset deadline rendered as "—" on the
   screen named for it, with nothing to do about it.
7. **A control that VANISHES instead of refusing.** The roster's bulk bar
   rendered on `addable > 0`, so ticking members already in the field made it
   disappear — boxes tick, nothing happens, nothing to read. The remove button
   rendered only at `entryCount === 0`, so for anybody who had played it simply
   was not there. This codebase already names the cure (`resolveThirdPlace`,
   `drawReadiness`): refuse with an explanation, never guess, never silently
   disappear. **Grep for a guard immediately above a control:**

       grep -rn -B 4 'className="btn' src/components/*.tsx | grep -E '\{[a-zA-Z.]+ *(===|>|<) *[^ ]+ *&&'

   Judgement needed: a *state-dependent* render ("Clear" when there is
   something to clear) is fine. A *capability* guard hiding an action is not.
8. **A link that points at a screen the thing is not on.** `SETUP_HREF.money`
   is `/organization`, which had **no money control on it** — the club default
   was a disclosure inside a per-tournament card on `/prizes`. The href sweep
   passes: it proves the route exists, not that the step's subject is there.
   **For every checklist or "go here" link, open the target and find the
   control.** Nothing automates this one.

## Method — TWO methods, and they find different things

### 1. Grep, for conflated headings

Grepping beat reading. The screens are large (StagesClient is 1568 lines) and
reading them end to end burns a session for one finding.

- **Conflation:** extract headings and see what sits under each.

      grep -oE 'className="(card-kicker|card-title)"[^>]*>[^<{]{3,60}' src/components/X.tsx

  Then list the controls under a heading:

      grep -nE '^\s+label="|<Choice|card-title' src/components/X.tsx

  An ampersand heading, or one heading with more than ~4 controls under it, is
  the signal.
- **Invisible creation:** `grep -rnE "onChange=\{.*(ensure|create|add|generate)[A-Z]" src/components/*.tsx`
  — **currently CLEAN across all components.** `ensureNextStageId` no longer
  creates anything (StagesClient.tsx:217 just returns an existing id), and no
  onChange handler makes a row. Re-run it after any settings work.
- **Drifted comments:** when an unrelated control is inserted into a group, the
  comment above the original control now documents the wrong thing. Worth
  looking for wherever a conflation is found — it is evidence of exactly this
  history.

  **Grep for the word "above".** On `StagesClient` this found three fossils of
  one move: a comment saying "directly under the date", a second saying the
  same, and — the useful one — `RoundDeadlineControl`'s own USER-FACING copy,
  *"Scoring follows the completion deadline above."* The deadline was four
  sections and a group boundary away. Copy that says "above", "below" or "on
  the left" is an assertion about layout that nothing checks, so it is the
  first thing a re-arrangement makes false.

      grep -rn "above\|below\|on the left\|opposite" src/components/X.tsx

- **Headings against the sidebar:** any card kicker or section title that
  matches a `nav.ts` label is naming a screen. Two things with one name.

      grep -oE '(card-kicker|card-title)"[^>]*>[^<{]{3,40}' src/components/X.tsx
      grep -n 'label: "' src/lib/nav.ts

### 2. Drive the screen, for everything grep cannot see

Grep finds headings. It does not find a screen that contradicts itself, a
feature nobody can reach, or a link that goes nowhere. On 2026-08-18 an
organizer-driven walkthrough of four screens found three defects in an hour,
none of which had a failing test and none of which any grep above would have
surfaced:

- the Single Match picker displaying a complete pairing while simultaneously
  saying no rule was set (local editor state defaulting, rendered
  indistinguishably from stored state);
- every link in `OrgSetupChecklist` pointing at a route that does not exist;
- a group heading repeating the words of the single control beneath it — a
  defect introduced BY the previous simplification commit.

Ask a human to sign in (agents cannot), then walk the screen. Start the dev
server with the `tourneyhq` preview config; `npm run smoke` afterwards, because
neither tsc nor the unit tests render a server component.

**The trap to watch for in this pass specifically:** separation can make a
screen WORDIER. Splitting "Players & scoring" into four groups put "Who signs
off a result" directly beneath a heading reading "Who signs off a result". If a
group holds one control, the heading IS the label — suppress the label. Check
every group you create by looking at it, not by reading the diff.

## Done

### PlaySettings — "Players & scoring" (2026-08-18)

Appears on **two** screens: the tournament settings and the organization house
defaults, so the fix lands twice.

Seven controls sat in a flat list under one heading, answering **four**
unrelated questions. Split under headings that each name one thing:

- **Who can see results** — leaderboard visibility, public link
- **How scores get in** — who enters, when players may submit, how they sign
  in, voice entry
- **Who signs off a result** — approval, and how many partners must confirm
- **Weekly sign-up** — who is playing next week, which has nothing to do with
  scoring or sign-off and was buried between them

Also fixed a **drifted comment**, which is the fossil of the conflation. This
sat above "Weekly sign-up":

> *Only asked when players sign off. With staff approval there is nobody to
> configure, and showing it anyway invites an organizer to set something that
> will never apply.*

It describes `attestBy`, two controls below, and "Weekly sign-up" is not gated
on sign-off at all. Somebody had inserted an unrelated control between a
comment and the thing it explained. The comment is back on its control.

Three render tests, including one asserting **every control it had is still
there** — the guard against a "simplification" that quietly removes a setting.

### StagesClient — Rounds & formats (2026-08-19)

Both walkthrough findings lived here, plus four more the file gave up on a
full read. See `docs/session-2026-08-19.md` for each; the shapes are what
matter:

- **"What this round decides" lifted out of "Customize this round"** — the
  third-place toggle, the Single Match rule and the qualification cut are now
  at round level. Shape 3 above. The cut and carry-forward stayed inside,
  because they are about the round AFTER this one.
- **"Cut line & carry-forward" → "Before the next round"** — an ampersand
  naming two of the three things under it; the third was the Generate button.
- **"On the day" / "Scoring window"** — the trap this pass created on its own
  first screen, ALREADY SITTING HERE. Said once, as "When scores are due", with
  the completion deadline moved into the group so three drifted "above"s
  became true again.
- The Tiebreakers blurb promised two questions on a round that shows one.
- The closed round row summarised everything except the two settings hardest
  to reach.

**Considered and rejected:** dropping the auto-open of the Customize panel. It
looks like a band-aid over the depth problem, but the carry-forward question is
inside it and removing the auto-open would make that question *less* visible.
A test caught it before the reasoning did.

### The /choose checklist row (2026-08-19)

The second walkthrough finding. `OrgSetupChecklist` takes a `currentPath`; any
step whose href resolves to it renders as a plain row plus "You do this one on
this page." **The row stays** — it is the only step a brand-new organizer can
do, it carries the "Next" chip, and dropping it would make one organization
read "0 of 4" on one screen and "0 of 5" on another. Only the link goes.

### EventSetupClient — Tournament details (2026-08-19)

Shapes 4, 5 and 6, all in one card. "Registration & field" was also the name of
the sidebar screen the same card told organizers to visit; it held the sign-up
rules AND an Apply button that invents placeholder players and deletes scored
matches; "Tournament identity" held two questions that are not identity; and
"Recommended flow" half-remembered three screen names. Following the collision
to `/registration` found the deadline displayed where it cannot be set.

**Left alone deliberately:** `playerCountMode` is read by nothing outside the
form, so "From registrations" describes what the app always does and implies
the other option turns it off. Collapsing it would remove a control and change
what a stored column means — it wants its own decision, not a heading fix.

### RegistrationClient — Registration & field (2026-08-19)

**Two switches, one word, and they are not opposites.** A banner button reading
"Close registration" (`registrationOverride` — does this tournament take entries
at all) sat inches from a card titled "Open registration" whose button read
"Open registration" / "Close sign-ups" (`registrationOpen` — does the public
link exist). Both work; the name was the whole problem. The card is now
**"Public sign-up link"** with "Publish the link" / "Take the link down".

Two more from the same read:

- the banner claimed closing **"only changes what this says"**. False —
  `decideIntake` refuses on `acceptingEntries` alone, so closing turns away
  every visitor. The mirror of the overstated course consequence fixed on
  2026-08-18; understating one costs the same trust.
- the two switches are independent, so a published link on a closed tournament
  is live, copyable and refuses everybody, with a working link and a "Closed"
  chip four inches apart and nothing joining them.

**The rename rippled** into the "Invite players" refusal, which named the old
button. That is the check to run after any rename: grep the old words.

### OrganizationClient — Club settings (2026-08-19)

Shape 8, and the biggest single finding of the pass so far. `SETUP_HREF.money`
sends "Decide how money works" to `/organization`, `orgSetupState` ticks it off
`organization.moneyMode`, and **that screen had no money control at all** — the
club default was a collapsed disclosure inside a card titled "Money in this
tournament" over on `/prizes`. The step could not be ticked by following its own
link, so for a `community` or `personal` org the checklist never completes and
never disappears.

`MoneySetup` now takes `mode: "tournament" | "organization"`, the way
`PlaySettings` already splits the same two levels. Also: the "Preview" card
re-implemented `brandLines` and `brandMonogram` by hand and so **ignored the
setting three inches to its left** — two previews of one header, disagreeing;
and the city/region/country block carried the comment "Not branding" while
sitting under a heading reading Branding.

### RosterClient — Members (2026-08-19)

Shape 7, twice. The bulk bar vanished when nothing could be added, and its
count was the ADDABLE number under the word "selected" — tick five, read "2
selected". The remove button was absent rather than refusing.

**The decision moved to `lib/domain/roster-selection.ts`** — not tidiness: a
static render cannot tick a checkbox, so leaving the rule in the component left
the whole behaviour unassertable. Same reasoning that put `drawReadiness` in the
domain, and the rule generalises: *if the interesting part is a refusal, put it
where a test can reach it.*

Also: the card called the list "Roster" while the sidebar and page heading call
it Members.

## Two classes closed by a sweep (2026-08-19)

Worth more than either screen they came from, because a swept class cannot come
back.

### Screen names typed a second time

"Rounds & format" (the screen is Rounds & formats) and "Prizes & Reports" (two
screens, neither called that) — found in the `/event` flow card, then again in
the per-tournament checklist hours later. `nav.ts` now exports
**`screenName(href)`**, and both read from it. Anything that points somebody AT
a screen must call it what the sidebar calls it.

### Refusals only a mouse could read

Five conditional `title` tooltips carrying the reason a control was off —
including the one `docs/session-2026-08-18.md` §8 explicitly parked. Each fixed
in the shape its context called for (a `drawReadiness` sibling, a line under a
button group, a sentence already beside the control, an accessible name in a
dense table), then **closed with a filesystem sweep**:
`src/lib/__tests__/no-tooltip-refusals.test.ts`.

The rule it enforces is narrow on purpose: a conditional `title` with an
`undefined` branch is an EXPLANATION and is banned; `title={pinned ? "Unpin" :
"Pin"}` is a NAME and is fine. A third test guards that distinction — a rule
that banned names too would get deleted rather than obeyed.

**The lesson worth keeping:** this pattern had been rejected in writing three
times and kept shipping. If a rule matters, sweep it; a comment is not a guard.

## Not yet examined — the queue

Ranked by how likely the pattern is, given size and how often the screen is
used. Nothing below has been looked at.

**Rank by heading COUNT, not by line count.** The 2026-08-19 session took
`RegistrationClient` (866 lines, ten headings) ahead of `ScoreEntryClient`
(1341 lines, **six** headings, one job) for that reason, and the yield was four
findings to none. A big screen that does one thing has nowhere for a conflation
to hide; a medium screen with ten headings has ten chances.

    grep -cE 'card-kicker|card-title|<h[1-5]' src/components/X.tsx

| Screen / component | Lines · headings | Why it is on the list |
| --- | --- | --- |
| `MessagesClient` | 720 · 4 | Scope levels are inherently confusing; check the naming. Low heading count, so expect shapes 3, 5 and 7 rather than conflated titles. |
| `ContestsClient` | 468 · 6 | Pot entry modes (opt-in/opt-out) are subtle, and `ContestsClient.tsx:175` says a club-funded prize "belongs in the prize list above" — **check whether that list is on this screen at all**. |
| `TeamsClient` | 360 · 6 | Touched 2026-08-19 for the refusal only; not reviewed for structure. |
| `MoneyClient` | 525 · 5 | Money model changed twice that week. Two "above" claims about a side-games figure — verify them. |
| `ScoreEntryClient` | 1341 · 6 | Biggest screen left, and the one used most during play — but six headings for one job, so expect shapes 3, 5 and 7 rather than conflated titles. Also carries a pre-existing lint warning. |
| `ThemePicker` | 561 · 6 | Partly touched 2026-08-19 (the swatch reason). Probably genuinely one thing. |
| `RoundAvailability` | 368 · 5 | |
| `FloatClient` | 256 · 5 | |
| `CourseLibrary` | 411 · — | `CourseSetupPrompt` nearby already carries a comment about copy that promises "the boxes below" — worth reading together. |
| `FoursomeMaker` | 446 · — | Touched 2026-08-19 for the refusal only. |
| Player app (`/me`, board, card, money, rules) | — | Four tabs, deliberately minimal. Lower risk, but it is what players actually see. |

**Already swept clean, so do not re-derive:** only two ampersand headings remain
in the whole tree ("Tees & ratings", "Club colour & appearance") and both are
plausibly one thing; no heading matches a `nav.ts` label any more; and the
tooltip-refusal sweep is green and enforced by a test.

## Rules for whoever continues

- **Read the file before editing it.** A component was overwritten with `Write`
  earlier this week and only the typecheck caught it.
- **Add a render test that asserts the controls are all still present**, not
  just that the new headings appear. Separation must not become removal. The
  form that works: one `for (const control of [...])` loop over every VISIBLE
  LABEL on the screen, with the label in the failure message —
  `expect(html, \`missing control: ${control}\`).toContain(control)`.
- **A completeness test that passes first time is suspicious.** Both written on
  2026-08-19 failed on their first run — one on a save button that reads
  "Saved" until the form is dirty. Write the list from the file, run it, and
  read what it says; that is the point at which it is telling you something.
- **Assert ORDER, not just presence, when the finding was about level or
  grouping.** `expect(html.indexOf(A)).toBeLessThan(html.indexOf(B))` is what
  makes "this is no longer filed under that" a claim a test can fail.
- **Prove the collapsed state.** When the finding is "two clicks deep", assert
  the control is present AND that something which only renders inside the panel
  is absent. Otherwise the control is in the markup for the wrong reason.
- **Read strings from their source, never restate them.** The flow-list test
  reads `NAV`; the checklist test reads `SETUP_HREF`. A test that writes out the
  same string the code writes out agrees with the code and proves nothing —
  that is how five dead links survived for weeks.
- `npm run smoke` after touching anything a page renders — neither tsc nor the
  unit tests render a server component. **It defaults to port 3000 and the
  `tourneyhq` preview config serves 3100**, so it needs
  `SMOKE_BASE_URL=http://localhost:3100`; without it every route reports
  `fetch failed` and reads like a total outage. The dev server also restarts
  itself on a memory threshold and can drop the tail of a run — check
  `preview_logs` before believing a failure.
- **After any rename, grep the old words.** Renaming the "Open registration"
  card broke a refusal elsewhere on the screen that told organizers to press it
  by name. A refusal pointing at a button that no longer exists is worse than no
  refusal at all.
- **If the interesting part is a REFUSAL, move it to the domain.** A static
  render cannot tick a checkbox or click a toggle, so a rule left in a
  component is a rule no test reads. `drawReadiness`, `sideDrawReadiness` and
  `rosterSelection` are all there for that reason, not for tidiness.
- **When the same defect turns up twice, stop fixing instances.** Two screen
  names typed by hand became `screenName()`; five tooltip refusals became a
  filesystem sweep. Both were cheaper than the third occurrence would have been,
  and the tooltip one had already been rejected in writing three times without
  a single line of code stopping it.
- Commit per screen, not per pass. Each screen is independently revertable and
  the reasoning belongs with its own diff.

## Waiting on a decision — Ajay's, not a heading fix

Both were found by this pass, both are recorded rather than acted on, and
neither blocks the next screen.

1. **Three meanings of "registration is open".** `LifecycleBar` on `/dashboard`
   has a button labelled **"Open registration"** which calls
   `setEventStatus("registration")` — it neither publishes a sign-up link nor
   changes what `registrationStatus` decides. So the phrase means the lifecycle
   phase, *and* `registrationOpen` (the public link), *and*
   `acceptingEntries`. Pressing it sets the chip to "Registration open" and
   creates no link. Renaming it changes the lifecycle vocabulary an organizer
   learns, so it wants one decision across all three. The 2026-08-19 rename
   took the collisions from three to two.
2. **Which screen owns the registration deadline and the field capacity.** They
   are SET on `/event` (Tournament details) and only DISPLAYED on
   `/registration` — the screen actually called Registration & field. Two
   cross-links now say where, which fixes the dead end without pre-empting the
   answer. Moving the controls is the other answer, and it is a product call.

Also noted and deliberately not acted on: **`playerCountMode` is read by nothing**
outside the `/event` form (see the EventSetupClient entry above). Collapsing it
would remove a control and change what a stored column means.
