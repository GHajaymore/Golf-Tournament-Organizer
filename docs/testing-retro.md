# Testing retro — the last 19 round(s)

Written by `node scripts/qa/retro.mjs --last=20 --write` on 2026-10-24 02:52 UTC, from each round's own verdict on GitHub. Counts and minutes only. Read with docs/testing.md, "The retro".

## Time to merge

20 merged pull request(s); median **2.9 hours** from opened to merged.

| PR | Hours | Title |
|---|---|---|
| #930 | 6.6 | Security: Next 15.5.28 (critical RCE and DoS advisories), PostCSS and deepmerge- |
| #924 | 2.2 | The tournament report: highlights, movement, money and what's next, read from th |
| #923 | 50.1 | Every text box tried, 53 findings fixed; free tier keeps a completed tournament  |
| #922 | 1.4 | Two more refusals said where the press was: Save tees, and Use this course |
| #921 | 1.4 | Refusals said in view, and brought there once (not on every keystroke) |
| #920 | 2.4 | Measures batch 4: joining, owner console, venues and cards with their refusals;  |
| #919 | 1.4 | Measures batch 3: 21 actions pressed in a browser; side-game rename, roster refr |
| #918 | 3.3 | Round codes, the flights board, knockout flights and public links are walked: 9  |
| #917 | 1.6 | Rounds & formats, scoring and the final are walked: 13 actions pressed, three fa |
| #916 | 5.4 | player-words: the cup walk is given the time three sweeps take |
| #915 | 5.2 | Register your interest (25% at launch), side games not bets, and the landing put |
| #914 | 1.3 | Sign-ins held in production until launch; no discount printed on the notice |
| #913 | 3.5 | Measures batch 2: a round's results walked as the committee; clearing chosen pla |
| #911 | 1.4 | The front door says the organizer chooses how a match is kept |
| #910 | 1.3 | A tapped singles cup session is kept on the tap card on Score entry |
| #909 | 1.3 | A cup session has a name |
| #908 | 3.9 | A final report for every tournament, not only a cup |
| #907 | 7.0 | A round kept by tapping can sign off a finished result |
| #906 | 6.3 | A team cup's final report, made by the app |
| #905 | 4.9 | A cup counts points outside the matches: the team net total point |

## What each round cost

- **pr**: 19 round(s), median 481 runner-minutes, 7924 in all

| Run | Kind | Branch | Verdict | Wall min | Runner min | Parts | App / test / infra failures |
|---|---|---|---|---|---|---|---|
| 40045819391 | pr | round/phone-3 | CLEAN | 113 | 537 | 44 | 0 / 0 / 0 |
| 40045816786 | pr | round/phone-2 | CLEAN | 109 | 536 | 44 | 0 / 0 / 0 |
| 40045814788 | pr | round/phone-1 | CLEAN | 112 | 543 | 44 | 0 / 0 / 0 |
| 40044354244 | pr | round/textbox-3 | CLEAN | 128 | 645 | 47 | 0 / 0 / 0 |
| 40044351630 | pr | round/textbox-2 | CLEAN | 127 | 622 | 47 | 0 / 0 / 0 |
| 40044350133 | pr | round/textbox-1 | CLEAN | 118 | 589 | 47 | 0 / 0 / 0 |
| 40032249111 | pr | round/deps-3 | CLEAN | 125 | 8 | 44 | 0 / 0 / 0 |
| 40032246107 | pr | round/deps-2 | CLEAN | 88 | 556 | 44 | 0 / 0 / 0 |
| 40032241759 | pr | round/deps-1 | CLEAN | 111 | 575 | 44 | 0 / 0 / 0 |
| 40024816847 | pr | round/deps-3 | NOT CLEAN | 65 | 449 | 38 | 1 / 0 / 0 |
| 40024813273 | pr | round/deps-2 | NOT CLEAN | 65 | 461 | 38 | 1 / 0 / 0 |
| 40024809716 | pr | round/deps-1 | NOT CLEAN | 65 | 468 | 37 | 2 / 0 / 0 |
| 40007137178 | pr | round/deps-3 | CLEAN, BUT NOT ALL OVER | 137 | 474 | 37 | 0 / 0 / 0 |
| 40007133375 | pr | round/deps-2 | NOT CLEAN | 72 | 451 | 35 | 1 / 0 / 0 |
| 40007128945 | pr | round/deps-1 | CLEAN, BUT NOT ALL OVER | 81 | 481 | 33 | 0 / 0 / 0 |
| 40007022670 | pr | round/deps-3 | (no verdict: cancelled) | 1 | 0 | 0 | 0 / 0 / 0 |
| 40007021419 | pr | round/deps-2 | (no verdict: cancelled) | 1 | 0 | 0 | 0 / 0 / 0 |
| 40007016197 | pr | round/deps-1 | (no verdict: cancelled) | 1 | 0 | 0 | 0 / 0 / 0 |
| 39997135730 | pr | round/deps-3 | NOT CLEAN | 74 | 529 | 36 | 4 / 0 / 0 |

## Whose failures they were

9 failure(s) in the window: **9 the app's** (findings), 0 a test's own (quarantined or flaky), **0 the machine's — 0%**.

## Which layers found something

No layer recorded an assertion failure in the window.

**Found nothing in the window** — candidates to move to the nightly or the weekly, for the panel to decide; a layer that never fails may be the one holding a class of fault out:

- suite (16 run(s))
- motion (16 run(s))
- elsewhere (16 run(s))
- tablet-android (16 run(s))
- chrome (16 run(s))
- iphone (16 run(s))
- safari (16 run(s))
- ipad (16 run(s))
- scenarios (16 run(s))
- dependencies (16 run(s))
- us-club (15 run(s))
- edge (15 run(s))
- firefox (12 run(s))
- abroad-gb-de-DE (6 run(s))
- abroad-ie-en-IE (5 run(s))
- abroad-au-en-AU (5 run(s))
- abroad-in-en-IN (5 run(s))
- abroad-za-en-ZA (4 run(s))
- abroad-jp-ja-JP (4 run(s))
- text-boxes (3 run(s))

## Mutation score

Not kept yet: there is no `mutation-baseline.json` (the nightly mutation ratchet is being built on claude/foundation-pass).
