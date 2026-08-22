# What TourneyHQ is for, and how it beats the incumbent

Ajay, 2026-08-21. The goal in his words: **beat Golf Genius by far, with
configurable options targeted at every kind of outfit — clubs, local
communities, charity events, a foursome, weekend golf.**

This file exists so that a session making a design choice knows which
properties are the advantage and does not trade one away for convenience.

## The audience, and why it is the hard part

One product, five very different outfits:

| | What they are | What they will not tolerate |
| --- | --- | --- |
| A **club** | A standing membership, a season, a shop that takes the money | Anything that invites a member to think the club owes them |
| A **society or league** | Plays together all season, splits real costs | Being told to use a club's ledger, or none at all |
| A **charity day** | One big field, many sponsors, played once | A season's worth of setup |
| A **foursome** | Four people, a bet, one afternoon | Being asked anything at all |
| **Weekend golf** | Recurring, casual, small | Ceremony |

Golf Genius is built for the top of that list and is very good there. The
further down you go, the worse the fit — not because it lacks the features, but
because it asks a foursome the questions it asks a tour.

## The trap in "more configurable"

**Configurability is how Golf Genius became hard to use.** Every option is
defensible on its own; the sum is a product with a help centre. If "beat them
with configurable options" is read as "have more settings", we lose — they have
a decade's head start on settings and the result would be their weakness with
less of their strength.

So the goal has to be stated more precisely, and it is the one thing in this
file worth remembering:

> **Be MORE configurable and ASK LESS.** Every axis they expose, and most of
> them answered before anybody is asked.

That is not a slogan. It is already how this codebase works, and it is the
actual moat:

- **`org-profile.ts`** — a kind (`club | community | personal`) declares what an
  outfit MEANS: shared roster, ledger, season play, owns a course. One answer at
  sign-up decides which setup steps exist, whether a settle-up appears at all,
  and how the roster reads. A club is never offered a ledger; a society is never
  asked to build a shared roster it does not have.
- **`resolveMoneyMode`** — event → club → kind. Three levels, narrowest first,
  every level defaulting upward. A society that never opens a settings screen
  still gets the right behaviour, and the club that wants a kitty for one day
  can have it without changing anything else.
- **`scoring-input-model.md`** — the format declares its natural input, with an
  override. The organizer is not asked a question the format already answers.
- **`org-setup.ts`** — the checklist derives from data and is never stored, so
  it cannot be wrong; steps that cannot apply to this kind do not exist rather
  than sitting unticked.

Every one of those is an axis GG exposes as a setting and this app resolves from
something already known. **That is the product.** A foursome answers one
question at sign-up; a club championship gets every knob — from the same engine,
without either being asked the other's questions.

## The four properties that are the advantage

Guard these. They are cheap to lose one commit at a time.

1. **Refusals that explain, at the point of consequence.** A control that cannot
   work says why, on the page, with the way out — `drawReadiness`,
   `resolveThirdPlace`, `resolveSingleMatch`. Never a dead button, never a
   tooltip (`no-tooltip-refusals.test.ts` enforces it). Most software, GG
   included, disables silently.
2. **Never invent a number, and say so when you cannot answer.** An incomplete
   card never loses on countback; a 5&4 card is shown and not ranked; a team
   forfeit is refused rather than stored where nothing reads it; a pot is
   settled only when the round is final. A club that catches the app inventing
   one number stops trusting all of them.
3. **One rule, one reader.** Derive, never store. The recurring defect here has
   always been one rule implemented twice and disagreeing — the same contest
   worth $165 on one screen and $5 on another. Every screen that agrees with
   every other is a feature the incumbent cannot copy quickly, because it is
   architecture rather than surface.
4. **The player needs no account.** A round code puts somebody on their card
   with no install and no sign-up. That is what makes a foursome and a charity
   day possible at all.

## What NOT to compete on

- **Format coverage.** They have more, they will keep having more, and it is
  not why anybody switches.
- **Integrations and scale.** GHIN, tours, big federations. Worth having in
  time; not the wedge.
- **Being cheaper alone.** A cheaper version of something confusing is still
  confusing.

## The test to apply to a new feature

Before adding an option, ask in this order:

1. **Can it be derived?** From the org kind, the format, the stage type, or what
   the data already says. If yes, derive it and do not ask.
2. **If it must be asked, who is asked?** A club setting must not appear to a
   foursome. `org-profile` exists to answer this.
3. **When it is refused, does the screen say why and where to go?**
4. **Does it ever require a number nobody actually recorded?** If so it is the
   wrong shape, whatever it enables.

A feature that passes all four widens the gap. One that fails the first adds a
setting, and settings are how the incumbent got beatable in the first place.
