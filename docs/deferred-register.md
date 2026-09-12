# Deferred register — what was left, and why

A living log of work that was **deliberately not done**, kept so it survives the
session it was decided in. `parked-ideas.md` holds things that were *asked for
and never started*; this holds the other kind — boundaries drawn while shipping
something else, decisions waiting on Ajay, and changes that cannot simply be
made because existing data would not survive them.

Every entry says what it is, why it was left, and what has to be answered before
it can be picked up. **Add to it whenever a change stops short of something**,
and delete an entry when it is done rather than marking it done — git remembers.

Last reviewed 2026-09-11.

---

## 1. Decisions waiting on Ajay

These are not bugs. Each has a defensible answer either way and must not be
decided unilaterally.

### Launching a tournament gates nothing
Launch moves `status` and locks setup. It does **not** restrict player access —
a player can reach the board and their card in a tournament that was never
launched.

**Blocked on old data.** Building the gate needs a migration story for
tournaments currently being *played in draft*, of which the seeded Demo Cup is
one. Turning the gate on retroactively would lock live players out of rounds
they are in the middle of.

### Shared places vs the tiebreak chain
`rankPlayers` shares a place only when the club's whole tiebreak chain comes
back level, and the default chain ends in `lower-handicap`, which separates
almost everybody. Five surfaces were changed on 2026-09-11 (#289, #290 ×3, #291)
to print the engine's place rather than re-deriving it — which fixed a real bug
and also committed all five to that reading.

Many clubs print a league table or flight sheet with places **shared** on equal
points regardless of countback. If that is wanted, it is five surfaces, not one,
plus a question about whether the chain should end in `lower-handicap` at all
for a **gross** event.

Visible consequence, walked 2026-09-11: a gross match-play league with eight
players and no scores shows places 1–8 in ascending handicap order. Before a
ball is struck, the board names a leader.

### The free plan requires a mobile from every entrant
`phoneRequiredFor` returns true for any free-plan organization regardless of the
per-tournament setting. After #296 made email optional under Round Codes, this
**independently blocks the same use case on free**: a society with a names-only
list still cannot enter anybody, now because of the phone field.

Deliberate and documented — `PHONE_REQUIRED_FREE` says upgrading lets you decide
per tournament, "useful when a good part of your membership has no mobile at
all". So it is a pricing decision, not a bug. Worth knowing that the fix landed
in #296 buys the paid plan, not the free one.

### The charity-day template pairs "after the round" with a public leaderboard
`scoreEntryWindow: "after"` and `leaderboardVisibility: "public"` together mean
the clubhouse screen shows nothing until cards are submitted whole. Judged a
product choice rather than a bug; flagged in case it is not the intent.

---

## 2. Deliberately not touched

Scope boundaries drawn while shipping something adjacent. Each is a real gap,
not an oversight.

### In-app messaging is keyed on email, everywhere
Threads, read receipts, authorship and the direct-thread key
(`direct:<sorted participant emails>`) are all email strings. After #296 a
player may be entered with no address, and such a player therefore **has no
messaging identity at all** — no threads, no direct messages.

What they do get: SMS (which reads `phone` from the roster, not email),
announcements on `/me`, and the tee sheet.

**Blocked on old data.** Moving these keys to `memberId` is a backfill across
every existing thread, and threads whose participants have no `Member` row —
staff added by email only — have nothing to migrate *to*. Needs a decision about
what happens to those before any schema change.

### `/me` — the signed-in player app — still resolves by email
`myPlayerIds` matches `Player.email` against the session address. An email-less
player cannot use the player app; they are a Round Code player and score at
`/play`. This is consistent and intended for now, but it means the two player
surfaces have different entry requirements, which will eventually confuse
somebody.

### Open registration still requires an email
Not relaxed with the organizer paths in #296, and the difference is not about
identity: the public form rate-limits on the address, has nothing else to
de-duplicate a stranger on, and sends a confirmation. If a society ever wants a
public link that accepts name-only entries, all three of those need an answer
first.

### ~23 unanchored `toMatch(/<prop>=\{/)` assertions across the test suite
#292 found that `/hasTeeSheet=\{/` matches inside `x-hasTeeSheet={` — an
attribute React never reads — so the assertion passed against markup that did
not do the job. The two instances found were anchored; the rest of the suite
shares the weakness. Not swept, because camelCase makes real collisions narrow
and a mechanical 20-file change was judged scope expansion at the time.

---

## 3. Hazards created by recent changes, not yet addressed

### A tournament that entered email-less players and later switches to email sign-in
After #296, an organizer using Round Codes can enter a field with no addresses.
Nothing stops them **later changing `playerAccess` to "email"** — at which point
those players have no `Account` row, no address, and no way in, and the app says
nothing about it.

**It is sharper than "they have no way in".** `saveTournamentSettings` reacts to
the change: `if (!nowUsingCodes && wasUsingCodes) await revokeRoundCodes(eventId)`.
So the switch **actively destroys** the credential those players were using. A
field that was scoring fine on Round Codes on Saturday morning is locked out the
moment somebody changes one dropdown, and neither the action nor the screen
mentions it. Read off `src/app/actions/settings.ts` on 2026-09-11.

Not data loss — entries and scores are intact — but it is a silent dead end
reachable in one click. The answer settled on is a REFUSAL, in the same shape as
the existing "this is the only Organizer on this event" — the organizer cannot
see who this would strand, the damage lands on other people, and the remedy is
cheap and obvious once named.

`src/lib/domain/access-lockout.ts` is that rule, written and **wired to nothing**
as of 2026-09-11. It is narrow on purpose: it fires only when codes are actually
being switched off AND somebody would be stranded, so a tournament whose entrants
all have addresses switches freely, which is the ordinary case. What is left is
calling it from `saveTournamentSettings` and saying so on the screen.

### Duplicate rows created before de-duplication was fixed are not cleaned up
The entry CSV importer de-duplicated on email alone and, for address-less rows,
on nothing at all. Any field imported that way before #296 may hold duplicates.
The fix prevents new ones; **nothing sweeps existing rows**, and doing so safely
means deciding which of two entries keeps the scorecard, the tee slot and the
money.

---

### Casual rounds are still started from the organizer console
**Parked 2026-09-11**, deliberately, after checking what removal would cost.

Ajay: take "Just playing a round?" out of the organizer/admin setup and make it
a member-side thing. Right instinct — a Sunday fourball is not club
administration — but the two entry points on `/choose` and in `EventSwitcher`
are the **only** links to `/match/new` in the entire app. Grep it before
believing otherwise:

```
src/app/choose/page.tsx:240        href="/match/new"
src/components/EventSwitcher.tsx:410   href="/match/new"
```

So removing them strands the feature at a URL nobody can reach. The move needs
its member-side door built in the SAME change — the landing page's "Playing
today? Enter your round code" is the natural neighbour, and `/play` is the
player's entry — rather than a removal now and a replacement later.

### What the club section should be CALLED
Open, and small. The sidebar heading and the settings screen are relabelled per
organization kind today — "Club", "Society", "Outing" — from
`orgProfile.groupLabel`, because a society being addressed as a club was a real
complaint the console had in eight places. The setup FLOW is identical for all
three; only the word differs. Worth deciding whether one fixed name is wanted
instead, and what it should be, before more screens grow the per-kind wording.

### The tournament step is a gate now, and only the first one
Recorded because it REVERSES a rule this repo argued for at length. `org-setup.ts`
said "a checklist, not a gate", on the sound grounds that organizers do not work
in order and a hard gate invites a placeholder member to unlock the next step.

Asked for on 2026-09-11 — *"how come create your first tournament is complete and
enabled when club settings are not complete?"* — and the reasoning that changed it
is that the club and the tournament are not peers on one list: a club is set up
once and its tournaments are many.

What is now true, so nobody has to re-derive it:

- The gate is `blockedByClubSetup`, and `eventCount > 0` turns it off for ever.
  It can never fire twice for anybody and never touches an existing club.
- It waits on `required` steps only — the name and the members. **The course card
  and the money setting are deliberately NOT prerequisites**, and leaving money
  out is also what keeps a standalone organizer free without a `kind === "personal"`
  special case. Making either one required would break that escape.
- `/roster` works without a tournament now, which is what made members askable at
  all. `/event` still does not and never will: it IS a tournament's own screen.
- The eventless sidebar is CLOSED to the club's own screens plus a link back to
  `/choose`. Adding a screen to it means making that screen work without an event
  first; `nav-without-a-tournament.test.ts` holds both directions.

### "Society" is a British word, and the app says it worldwide
Asked for on 2026-09-11: should the wording follow the user's country?

**Yes — and `kind` is only half of it.** The three kinds describe how the golf
is ORGANISED and they travel fine; what does not travel is the noun for
`community`. The same outfit is a *society* in Britain and Ireland, a *golf
league* or *golf association* or *men's club* in the United States, and often
just a *club* in Australia. `club` and `outing` are understood everywhere, so
this is one noun set on one kind — narrow, not a rewrite.

**Not off the login country, though.** That is a fact about a PERSON and the
word describes an OUTFIT: an Irish secretary living in Boston still runs a
society, and a US league secretary on holiday in Dublin does not become one.
`Organization.country` already exists (`schema.prisma`, beside `city` and
`region`, collected so "courses near us" has a region to search) and is the
club's own answer about itself.

**So: the country as the DEFAULT, the organizer as the AUTHORITY.** Preselect
the local word from `country` and let it be changed on the settings screen —
the same shape the app already uses for `currencySymbol`, whose comment says
why: *"Not a locale — clubs write their own currency and this is the shortest
honest way to let them."*

Two things to get right before building it:

- `country` is **free text and defaults to `""`**, so the resolver must fall
  back to today's wording on empty and must not try to tell "United States"
  from "USA" from "US". Either normalise on the way in or store a code — there
  is precedent for the latter in `scripts/backfill-country-codes.ts`, which did
  this for courses.
- The noun is read in more places than `noun` — `label`, `settingsLabel`,
  `groupLabel` and `blurb` all spell the outfit out. They must all come from
  one resolver or they will drift, which is the defect `orgProfile` exists to
  prevent. Extend `orgProfile` to take the country; do not add a second table.

## 4. Environment and ops

### `CRON_SECRET` is not set on the Vercel project
The casual-round 24-hour expiry sweep returns 401 without it. User action —
nothing in the repo can fix it.

---

## 5. Notes for whoever picks these up

- **Anything touching identity should read `entryNeedsEmail` first.** The rule
  is that email is a *credential*, not the identity: `Player.id` and
  `Member.id` are the identity, and `createPlaySession` has always used them.
- **Check what is already true before building a gate.** Both "launch gates
  nothing" and the messaging migration are blocked on existing rows, not on
  design — and the blocking question is the same one in each case: what happens
  to the records that predate the rule.
