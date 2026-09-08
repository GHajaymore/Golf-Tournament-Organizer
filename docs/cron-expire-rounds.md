# The expired-round sweep

The one scheduled DELETE in the product. It removes casual rounds — the things
`/match/new` creates — 24 hours after they were set up, and it can reach
nothing else.

## Why it cannot delete a tournament

The query is one condition: `expiresAt IS NOT NULL AND expiresAt <= now()`.

`Event.expiresAt` is written by exactly one caller, `createMatch`, on exactly
one kind of row. Every tournament that has ever existed has null there, and the
migration that added the column backfilled nothing — so a tournament is
unreachable by this query even if everything else about it is wrong.

The rejected design was "delete anything with `shape = 'match'` older than a
day". It reads a row's *lifetime* off a description of the *game*, and those are
two different facts: the day something else legitimately sets `shape` to
`"match"`, that rule starts deleting it.

The sweep is also capped at 200 rows a pass. Not for performance — an unbounded
DELETE driven by a clock is one wrong comparison away from emptying a table, and
a capped one leaves a number that looks wrong on the first run instead of all of
it. The remainder is taken next pass.

## The way out

`keepRound` sets `expiresAt` back to null, permanently, from a button on the
round's own screen. It can only ever *clear* an expiry — an action that could
set one would be a way to schedule the deletion of any event the caller can
reach, through a screen built for a Sunday fourball.

The sweep re-checks the condition inside the DELETE, one row at a time, so a
round kept a second ago survives a sweep already in flight.

## Authorization

`GET /api/cron/expire-rounds` requires `Authorization: Bearer $CRON_SECRET`,
which Vercel Cron sends automatically when `CRON_SECRET` is set on the project.

**A missing secret is a 401, not a bypass.** The tempting fallback — "no secret
configured, so let it through" — publishes an unauthenticated delete-by-clock
endpoint the first time somebody forgets an environment variable. An
unconfigured cron does nothing, which is a feature that is off; an
unauthenticated one is a way for anyone to force other people's rounds to be
swept.

So: **set `CRON_SECRET` on the Vercel project.** Until it is set, the route
returns 401 and no round is ever deleted.

## The schedule, and why it is daily

`vercel.json` runs it at 03:00 UTC daily.

Daily rather than hourly because **hourly crons need a paid Vercel plan**, and
`main` auto-deploys through the `deploy` job in `ci.yml` — a `vercel.json` the
platform rejects would fail that deploy rather than degrade quietly. Daily is
valid on every plan.

The cost is precision: a round expires at 24 hours but is not swept until the
next 03:00, so it lives between 24 and roughly 48 hours. The screen is worded to
match — it says a round is kept for a day and names the button that keeps it
permanently, rather than promising an exact hour.

**On a Pro plan, change the schedule to `0 * * * *`** and the wording becomes
exact. Nothing else needs to change.
