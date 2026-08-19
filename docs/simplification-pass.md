# The page-by-page simplification pass

**Status: STARTED, 1 screen done of ~25.** This file is the working state, so
the pass can be picked up in a fresh session without re-deriving it.

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

## Found on the walkthrough, NOT yet fixed — start here

Both are real, both were seen on screen, neither is a bug in the sense of
anything computing the wrong answer. They are exactly this pass's subject.

1. **The third-place toggle and the Single Match picker are two levels deep.**
   Expand the round, then expand "Customize this round", then scroll. A
   third-place play-off is something plenty of clubs run every year, and it is
   three clicks from invisible. The picker underneath resolves a real pairing
   (Tom Halloran v Diego Alvarez on the Demo Cup) and almost nobody will find
   it. Consider surfacing "What this round decides" for round types that
   actually decide something, rather than burying it with the scoring window.
2. **`/choose` shows a checklist row linking to `/choose`.** "Create your first
   tournament" points at `/choose?stay=1` — the page it is already on, directly
   above the form that does it. Correct on the dashboard, redundant here.

## Not yet examined — the queue

Ranked by how likely the pattern is, given size and how often the screen is
used. Nothing below has been looked at.

| Screen / component | Lines | Why it is on the list |
| --- | --- | --- |
| `StagesClient` (Rounds & formats) | 1568 | **Highest value.** The screen Ajay called confusing, and where both walkthrough findings above live. Partly fixed already (three-group settings layout, split tiebreakers) but never re-read as a whole. Headings: "Add a round", "Rounds the field plays", "Structure". |
| `/event` (Tournament details) | — | Seen in passing and it is very long: tournament list, create-a-tournament, setup checklist, identity, venue, registration & field, summary, recommended flow, courses, course card, then play settings. Several of those are unrelated to each other. Strong candidate. |
| `ScoreEntryClient` | 1341 | Biggest screen after Stages, and the one used most during play. |
| `RegistrationClient` | 866 | Headings include "Set up", "Status", "Open registration", "Invite players", "Add someone new" — several near-synonyms worth checking for overlap. |
| `RosterClient` | 733 | Touched today for `orgKind`; not reviewed for structure. |
| `MessagesClient` | 720 | Scope levels are inherently confusing; check the naming. |
| `EventSetupClient` | 550 | "Registration & field" is an **ampersand heading** — prime suspect. |
| `MoneyClient` | 525 | Money model changed twice this week. |
| `ContestsClient` | 468 | Pot entry modes (opt-in/opt-out) are subtle. |
| `ThemePicker` | 561 | Large but probably genuinely one thing. |
| `CourseLibrary` | 411 | |
| `FoursomeMaker` | 446 | |
| Player app (`/me`, board, card, money, rules) | — | Four tabs, deliberately minimal. Lower risk, but it is what players actually see. |

## Rules for whoever continues

- **Read the file before editing it.** A component was overwritten with `Write`
  earlier this week and only the typecheck caught it.
- **Add a render test that asserts the controls are all still present**, not
  just that the new headings appear. Separation must not become removal.
- `npm run smoke` after touching anything a page renders — neither tsc nor the
  unit tests render a server component.
- Commit per screen, not per pass. Each screen is independently revertable and
  the reasoning belongs with its own diff.
