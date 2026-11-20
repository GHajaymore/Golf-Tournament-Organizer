# The club's clock

> Moved out of `CLAUDE.md` on 2026-10-24, verbatim, so that the file every session reads stays short. Read this when your task touches: any date, deadline, "today", time zone, E2E_TZ. Index: `CLAUDE.md`.

## The club's clock: "today" is asked of the club, never of the server

A deadline is a DAY, and a day belongs to a place. Until 2026-10-11 the day was whatever the
server's clock said — UTC in production — so a club in New York whose entries "close on the
12th" stopped taking them at 8pm on the 12th, and a club in Sydney saw Saturday's 8am round as
"tomorrow" until eleven on Saturday morning. Every test was green over it for a year, because
every test ran the server and the club on ONE machine: one clock, one zone, in CI both UTC.

- `Organization.timeZone` is an IANA name, or `""` for a club that has not said (it then keeps
  the server's day). A club with none takes its organizer's device zone the first time they
  open the console (`ClubClockAdopter` → `adoptClubTimeZone`, which never overwrites); Club
  settings shows it, with the time at the club, and changes it.
- `src/lib/domain/club-clock.ts` is the rule: `clubToday(zone)` and `clubDay(zone)`. On the
  server, get the zone through `state.today` / `state.timeZone` on the event state, or
  `clubDayForEvent(eventId)` from `src/lib/services/club-clock.ts`.
- **The day helpers have no clock of their own.** `todayIso`, `deadlinePassed`, `deadlineState`,
  `playerMayChange` and `registrationStatus` must be TOLD the day; the compiler refuses a call
  that leaves it out, and `the-server-asks-the-club-what-day-it-is.test.ts` refuses one that
  hands over `new Date()`. An INSTANT (a timestamp, an expiry, "3 minutes ago") is the same
  everywhere and is still read straight off the server's clock.
- `clubDay(zone)` is the club's day at noon by this machine's clock, so that a helper's own
  `getDate()` reads the club's date. It is NOT the present instant — never compare it with a
  stored timestamp.

**`E2E_TZ` is how a test reaches the state production is always in.** `E2E_TZ=Pacific/Auckland`
puts the browser in Auckland (`playwright.config.ts`, and `e2e/coverage.ts` for a context a spec
makes itself) AND the seeded club (`scripts/seed-club.mjs` counts its dates from Auckland's
today), while the server stays where it is. Without it the walk cannot tell a server that asks
the club from one that asks itself. The audit test picks its zone by the hour — Kiritimati or
Pago Pago, whichever is on another calendar day right now — and reports the other direction as
SKIPPED rather than passed.

## Moved from CLAUDE.md (20 Nov 2026): The club's clock

A deadline is a DAY and a day belongs to a place. `Organization.timeZone` is an IANA name (or `""` = keep
the server's day). `src/lib/domain/club-clock.ts` is the rule: `clubToday(zone)`, `clubDay(zone)`; on the
server get the zone through `state.today` / `state.timeZone`, or `clubDayForEvent(eventId)`. The day helpers
(`todayIso`, `deadlinePassed`, `deadlineState`, `playerMayChange`, `registrationStatus`) must be TOLD the
day; never hand them `new Date()`. An INSTANT (timestamp, expiry, "3 minutes ago") is still the server's
clock; `clubDay(zone)` is NOT an instant — never compare it with a stored timestamp. **`E2E_TZ`**
(`E2E_TZ=Pacific/Auckland`) puts the browser AND the seeded club in another zone while the server stays
put — the only way a walk tells a server that asks the club from one that asks itself. Dates the app writes
go through `date-words.ts`; amounts typed in a club's language are read with `minorUnitsFrom` /
`decimalPoint` (see the index). Long form: `docs/claude/club-clock.md`, `docs/claude/dates-and-figures.md`.

