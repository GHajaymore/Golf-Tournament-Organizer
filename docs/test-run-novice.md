# Test-run playbook — for a tester who doesn't play golf

**Who this is for.** Someone with little or no golf knowledge, sitting down to put TourneyHQ
through its paces: create every kind of competition, for every kind of audience, and judge
whether the **navigation and the experience** hold up. You do **not** need to understand the
golf — the app is supposed to make the right thing happen and explain itself. Where it doesn't,
that's exactly the finding we want.

**The one rule for a good test:** if at any point you're unsure what to click, what a word
means, or whether something worked — **write that down**. Confusion is a bug here, not a
failure on your part.

---

## 30-second glossary (everything you need)

- **Organizer / console** — you, running the event. The admin side.
- **Player** — someone in the field. They only ever score and sign up; they need no account.
- **Round** — one day's play (18 holes, sometimes 9). A tournament can have several.
- **Handicap** — a number that lets weaker and stronger players compete fairly; the app does
  all the maths. You never calculate it.
- **Gross vs net** — gross is raw score; net is after the handicap is applied.
- **Format** — the *game* being played (see the 16 below). **Field** — the list of players.
- **Flight** — a group within the field (e.g. by ability), scored separately.
- **Skins / sweeps / splits** — money games. The app works out who owes whom and **never moves
  any money** — it only does the sums and keeps the record.

---

## Before you start

1. Open the app and choose **Start free** to create an organizer account. Note how easy or hard
   it was to understand what you were signing up as.
2. You'll create a **club/organization** (your "home"). Give it a throwaway name like
   `Test Club`.
3. Use only invented people and `@example.invalid` email addresses. Never enter a real
   person's details.
4. Keep a running note as you go: **what you did → what you expected → what happened.**

Throughout, keep asking the three UX questions:
- **Could I find it?** (Was the next step where I expected?)
- **Did it explain itself?** (Or did I have to guess what a word/button meant?)
- **Did it do what it said?** (Board, money, and messages all agree and look right?)

---

## The 16 formats (what each one is, in one line)

You'll be asked to try these. You don't need to understand the golf — just pick each, add
players, enter some scores, and check the result reads sensibly.

**One player, on their own:**
1. **Match Play** — two players head-to-head, hole by hole.
2. **Stroke Play** — lowest total score wins (the classic).
3. **Stableford** — points per hole; a disaster hole costs one hole, not the round.
4. **Modified Stableford** — Stableford with bigger rewards and real penalties.
5. **Skins** — each hole is a prize; tie it and it "carries" to the next.
6. **Nassau** — three bets on one round: front 9, back 9, and all 18.

**Pairs playing their own balls:**
7. **Four-Ball** — two-a-side, each plays their own ball, best of the pair counts.
8. **Best Ball** — a team (up to 4), best score on each hole counts.
9. **Shamble** — team uses the best tee shot, then each plays their own ball.

**Sides sharing one ball:**
10. **Foursomes** — partners alternate shots on one ball.
11. **Alternate Shot** — same idea, simpler rules.
12. **Chapman / Pinehurst** — both drive, swap, then alternate.
13. **Greensomes** — both drive, pick the better drive, then alternate.

**Teams, best-shot:**
14. **Scramble** — everyone plays, team takes the best shot, repeat. (Kindest for mixed ability.)
15. **Texas Scramble** — a scramble that must use a minimum number of each player's drives.

**The escape hatch:**
16. **Other (scored by hand)** — for a game the app can't score; it holds the event and the
    committee posts the result. (Check it says so honestly, and doesn't pretend to score.)

---

## The audiences to run (each is a scenario)

Run each of these end to end. They map to the app's plans, but you don't pay anything to test.

### A. A single golfer & their group — a **casual round** (Free)
The simplest thing: one person sets up a quick, informal round with a few friends and a money
game, no committee.
- Create a **casual round**, add 3–4 invented players, pick **Skins** (or a simple money split).
- Enter scores for each player.
- Check: the board reads sensibly, the money game shows who "won" each hole, and it's obvious
  nothing real is being charged.
- **UX watch:** is it genuinely quick? Could a non-golfer do this without help?

### B. A league or society running a season (Season)
Several events across weeks with a running table.
- Create a **league/season**; add ~8 players.
- Run **two or three rounds** on different "weeks" (e.g. Stableford one week, Stroke Play another).
- Enter scores each week.
- Check: the **season table** adds up across weeks, and someone who misses a week is handled
  sensibly (not silently top or bottom).
- **UX watch:** is it clear which week you're in and how the table is ranked?

### C. A golf club championship (Club)
The full committee experience.
- Create a **club championship**; add ~16 players.
- Try a **cut** (top N advance after a round) and **flights** (split the field into groups).
- Try a **knockout / bracket** format too (Match Play through rounds).
- Turn on **your club's colours** (and a logo if offered) and check they show on the screens.
- Check: the leaderboard shows the **whole field** (not just who's scored), positions are right,
  and a player who hasn't started yet shows **no position** rather than a fake one.
- **UX watch:** brackets, cuts and flights are the hardest to understand — do the screens make
  them legible to a non-expert?

### D. A corporate / society outing (mixed ability, fun)
The social end: teams, best-shot, prizes.
- Create an event with a **team format** — **Scramble** or **Best Ball** — and 4-player teams.
- Add a couple of **on-course prizes** (nearest-the-pin, longest drive) if offered, and a
  **prize split**.
- Check: teams are drawn sensibly, the team score is right, and prizes/money read clearly.
- **UX watch:** would a company organizer with zero golf admin experience get through this?

---

## The player experience (test this for real, on a phone)

For at least one event above, act as a **player**, not the organizer:
- Open the **player link** (or type the **round code**) the organizer shares — you should need
  **no account and no app install**.
- Enter your own scores hole by hole.
- View the **public leaderboard**.
- If there's a money game, check **your own** money view is clear and honest.
- **UX watch:** try it on a real phone, ideally outdoors. Is the text readable in sunlight? Does
  it work if you lose signal for a moment? Is it obvious what to tap next?

---

## The combinations matrix (tick as you go)

Aim to cover every format at least once, spread across the four audiences. A compact target:

| Audience | Formats to run through it |
|---|---|
| A. Casual round | Skins, Stroke Play, Stableford, Nassau |
| B. League / season | Stableford, Modified Stableford, Match Play |
| C. Club championship | Stroke Play (+ cut + flights), Match Play (knockout/bracket), Four-Ball |
| D. Outing / corporate | Scramble, Texas Scramble, Best Ball, Shamble, Foursomes, Greensomes, Alternate Shot, Chapman/Pinehurst, "Other (by hand)" |

For **each** cell: create → add players/teams → enter scores → read the board and the money →
write down anything confusing, wrong, ugly, or slow.

---

## What "a good result" looks like (so you can judge without knowing golf)

- **The board can be read top to bottom** and the order makes sense with the numbers shown.
- **Nobody who hasn't played yet is given a finishing position.**
- **The same fact never disagrees with itself** across two screens (e.g. a player's position on
  the leaderboard vs. their own screen; a total on one panel vs. another). If two numbers that
  should match don't — that's an important find.
- **Money adds up** and is clearly only a record, never a charge.
- **Every screen has a clear heading** and a clear way back.
- **Words are plain.** If you meet jargon with no explanation, note it.

---

## How to report

For each issue, capture: **where** (which screen), **what you did**, **what you expected**,
**what happened**, and a **screenshot** if you can. Group them as:
- **Blocking** — couldn't complete the task.
- **Confusing** — completed it, but had to guess or got lost.
- **Wrong** — a number, position, or message looked incorrect.
- **Rough** — works, but looks or feels unfinished.

---

*Companion docs for whoever sets this up: `docs/PROJECT-CONTEXT.md` (what the app is),
`CLAUDE.md` (how it's built and verified), `docs/handoff-2026-09-25.md` (current state). Exact
button labels in this playbook are described by intent rather than pinned, on purpose — where a
label is unclear, that's a UX finding to record.*
