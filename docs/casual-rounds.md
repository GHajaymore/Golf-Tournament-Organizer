# Casual rounds

The free-tier product: one round of golf, set up in one screen, by anybody —
club or no club. Built 2026-09-08/09 from Ajay's direction, which is worth
quoting because it is the test every decision below was measured against:

> a complete separate setup for the free tier where most of the
> non club/organizations/community/societies players (even if they are part of
> it) can play it separately including money game

And, on scope:

> just one golf round … no multi rounds or chained rounds … no flights no
> teesheets etc … make sure we do not expose the owner/organizer/admin
> features which are built for the tournament organization

Everything here is `/match/new` → `planMatch` → `createMatch`. The scoring,
formats and money all reuse the tournament engines; what is separate is the
setup and the surface.

## The decisions, and which are yours to change

These were made to keep moving while you were asleep. Most are cheap to
reverse; the ones worth a second look are marked **↺**.

| Decision | What it does | Why |
|---|---|---|
| **Five round types** | Match Play, Stroke Play, Modified Stableford, Four-Ball, Foursomes | Every one is `playable` in `formats.ts` — engine, score entry, board — asserted against the catalogue rather than trusted |
| **↺ No scramble, shamble, best ball, greensomes, alternate shot, Chapman** | Not offered | A scramble's allowance is a weighted table over an ability order nobody has ranked on this screen. The others are mostly reasonable to add — this was a "short list" instinct, not a hard constraint |
| **2–8 players** | Pairs formats need exactly 4 | Two fourballs is the most that goes out together. Beyond it you want a field, flights and a tee sheet |
| **↺ Pairs only at two sides** | Four-Ball and Foursomes are 4 players, not 6 or 8 | Three pairs is a competition with a draw in it. Adding 6/8 is easy if you want society pairs days |
| **Three money games** | Skins, Birdie pot, Nassau | Nassau is offered only on a head-to-head — it is three bets on one match |
| **↺ No low gross / low net / eagles** | Not offered at setup | They exist and work; they are reachable on the round's money screen afterwards. Offering five at setup felt like the eighteen-format picker this screen exists to avoid |
| **↺ £1,000 a head stake cap** | Refuses more | Not a moral position — a typo of 50000 for 500 is a settle-up demanding a hundred times what anybody said |
| **24-hour expiry** | Round deletes itself | Your instruction. Clock starts at SET-UP, not at finish: a round nobody ever scored never finishes, and those are exactly the rows this clears |
| **"Keep this round"** | Clears the expiry permanently | A default that destroys something needs an exit before it ships |
| **↺ Daily sweep, not hourly** | Rounds live 24–48h | Hourly crons need a paid Vercel plan, and a rejected `vercel.json` fails the production deploy. On Pro, change to `0 * * * *` and the wording becomes exact |
| **Guests are not added to the roster** | Non-members play and are scored, and leave no trace | Your instruction. Also fixes a real corruption: a member with no email is matched BY NAME, so a second Dave overwrote the first Dave's index |
| **Sides in entry order** | First two v next two | No balancing, no draw. The screen says so above the name fields, so the rule is visible before it is applied |
| **No plan check** | Casual rounds don't consume the tournament allowance | A club at its cap was refused a Sunday fourball — the app declining a free feature because a paid one was full |
| **`moneyMode: "none"`** | The golf bet, never the travel-expenses ledger | Your instruction. "none" turns off fees and shared costs; skins and side bets still settle |
| **`leaderboardVisibility: "participants"`** | Never public by inheritance | A guest entered by a third party did not consent to their name on a link anyone can open |

## What is hidden, and what deliberately is not

`TOURNAMENT_ONLY_SCREENS` in `nav.ts` closes: **Flights, Tee sheet,
Announcements, Access & staff** (the field's apparatus) and **Club settings,
Members, Season standings, Prizes & payouts** (the organization's).

Deliberately kept: **Registration & field** — the only place a mistyped name or
wrong handicap gets fixed. **Rounds & formats** — changing 18 to 9 is the
second thought people have on the first tee. **Tournament details** — where the
course is set, and a round with no card cannot be scored net. **Group games** —
a round played for a fiver is the oldest bet in golf.

Hidden is not forbidden: every one stays reachable by URL, the same rule
Qualification has always followed.

## The three money defects this feature surfaced

All found by playing a round and reading the rows back, not by reading code.
The engines were right every time; what was wrong was which rows they read.

1. **Skins could never settle on a match-play round.** A stroke round writes
   `Scorecard`; a match round writes `MatchScorecard`, keyed by slot. The
   reader knew only the first. A £5 pot on a match Final at 5&4 read "0 skins ·
   provisional" for ever.
2. **Nor on a four-ball.** Fixed above, then left out with a note calling it
   deliberate — which was an assumption about storage that one query
   disproved. `TeamScorecard` carries its own `playerId`. Foursomes genuinely
   cannot settle: one ball, one card, no individual winner.
3. **The money screen named the wrong player.** Both readers matched on
   `p.email === email`, which for emailless guests is `"" === ""` — so it
   returned the first one and reported their money as yours.

## Still open

- **`CRON_SECRET` must be set on the Vercel project**, or the sweep returns 401
  and no round is ever deleted. That is the safe direction, but the feature is
  off until it is set. See `cron-expire-rounds.md`.
- **Skins on foursomes** stays unsettled, asserted so it cannot quietly become
  "settled wrongly".
- **A guest cannot see their own money.** They have no account by design, so
  the round's creator reads it to them — fine for four people standing
  together, worth revisiting if quick rounds grow.
