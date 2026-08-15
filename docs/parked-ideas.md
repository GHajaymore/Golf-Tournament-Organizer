# Parked — asked for, not started

Ideas raised while other work was in flight, written down so they survive the
conversation they were mentioned in. Nothing here is designed yet; each entry
records what was asked and the questions the build will have to answer.

---

## Non-golfers in the field, and who may be contacted

**Asked 2026-08-14.** Add people who are not playing, mark everyone as golfer
or non-golfer, ask whether they want communications, and make that choice
explicit. "Check the foundations" — i.e. confirm the data model actually
supports this before building screens on it.

### Why it is not a small change

A `Player` row currently assumes a golfer: it carries a handicap, a tee, a
seed, a flight and a scorecard, and the scoring engines read the confirmed
field as "everyone in the competition". A spouse at the dinner, a caddie, a
sponsor and a club captain who is not playing all belong to the OUTING but
must never reach:

- `loadEventState`'s `confirmed`, which feeds every standings, handicap and
  draw calculation — a non-golfer in it becomes a competitor with a handicap
  of zero
- the tee sheet and the flight generator
- the cut, the bracket and the qualification counts

But they DO belong in:

- the expense ledger, which is the immediate reason this came up: somebody who
  ate dinner shares the bill whether or not they played
- attendance, for catering and transport numbers
- announcements and any list of who is coming

### The foundations question, honestly

The cleanest shape is probably a `role` or `attending` field on `Player`
(`golfer | guest`), because everything that already scopes by `eventId` keeps
working and only the scoring paths need to exclude guests. The risk is that
those scoring paths are numerous and were written when every Player was a
golfer — the 2026-08-12 audit is full of what happens when one path forgets a
check the others make. So the first task is a sweep of every reader of
`state.confirmed`, not a schema change.

The alternative — a separate `Attendee` table — keeps the scoring engines
untouchable but duplicates identity, and the expense ledger would then have to
settle across two kinds of id. Given the ledger is keyed on player ids today,
that is a real cost.

### Communications consent

Whether somebody wants messages is a **separate** question from whether they
are playing, and it has to be stored as an explicit answer rather than
inferred from having an email address. Points to settle:

- Consent per channel (email / SMS / WhatsApp), because they are not the same
  ask and a phone number given for a tee time is not permission to text.
- Recorded with when and how it was given, which is what makes it defensible.
- Default is NO for anything not required to run the tournament. A tee time is
  operational; a newsletter is not.
- The existing send paths (`lib/email.ts`, the SMS/WhatsApp share stubs) must
  read it, or the setting is decoration — and P2 in the audit is still open on
  those paths printing addresses into logs.

### Sequencing

After the open audit items, and probably after the expense build has been used
once — the non-golfer case is most obviously real inside a ledger, and a live
outing will say whether people actually want guests in the app or just on the
bill.
