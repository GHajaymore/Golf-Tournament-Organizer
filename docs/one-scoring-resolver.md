# One scoring engine, not several

Ajay, 2026-09-22, after correcting the same class of defect four times in one
evening: **"we should have one score engin vs multiple."**

He is describing the mechanism behind every defect found that day. This note
records the measurement, the shape of the fix, and what has already been done
so the next person does not start from scratch.

## The measurement

`holeStrokesReceived(handicap, strokeIndex, holeCount)` is the primitive that
turns a handicap into shots on a hole. Swept on 2026-09-22 it had **13 direct
callers, 7 of them outside `src/lib/domain`**:

```
src/app/actions/tournament.ts         score import
src/app/(player)/me/card/page.tsx     the player's own card
src/app/play/page.tsx                 casual round
src/app/(app)/entry/page.tsx          entry, individual path
src/lib/services/expenses.ts          money
src/lib/services/points-standings.ts  league points
src/lib/services/skins-pot.ts         skins
```

Calling it means deciding **two things for yourself**:

1. **Which handicap.** Index, course handicap (which tee, at which venue), the
   round's own override, the format's allowance, and — in a match — the
   difference off the lowest handicap in that match.
2. **Which stroke index.** The event's card, or the round's own nine, narrowed
   AND re-ranked. (`cardForStage` exists for exactly this and has its own guard,
   `a round's card is narrowed in exactly one place`.)

Two screens that each decide are two screens that will eventually decide
differently. That is not a prediction; it is the list of defects fixed that day:
the console board against the public board, the printed card against the entry
screen, and both against the engine that decides the result.

## What has been done

- **`matchStrokesCount` / `matchStrokesPerHole`** (`domain/team.ts`) are now the
  only definition of "how many shots does this player or side receive in this
  match". `matchHolesOffTheLow`, the printed scorecard and the team path of the
  score entry screen all call them. Pass `low: 0` on a medal round and it is the
  identity, so medal paths are unchanged.
- **A guard with inverted polarity**, `one engine decides how many strokes a
  hole gives` in `audit-guards.test.ts`: nothing outside `src/lib/domain` may
  call `holeStrokesReceived` unless it is on the exemption list above. The list
  is debt, written down, and it may only shrink — a new screen asks a resolver,
  or the resolver grows a case. It carries the two controls every filesystem
  sweep in this repo carries: that it finds files at all, and that every
  exemption still matches.

## The shape of the rest

One resolver that owns the whole chain and hands back per-hole strokes:

```
strokesFor({ subject, stageId, purpose })
   subject : a player, or a side
   purpose : "score" | "match" | "money"
```

- it resolves the handicap chain once (index → course handicap for the ROUND's
  venue and tee → round override → format allowance);
- it resolves the card once, through `cardForStage`;
- `purpose` is the only thing a caller chooses, and it is a golf question
  rather than an arithmetic one. `match` takes the difference off the lowest in
  the match; `money` deliberately does not — Ajay's rule, stated twice: the
  differential is "just for golf. Not for any skins or other bet/money game."

Then the seven exemptions collapse one at a time, each with its value pinned
before and after.

## The trap to avoid while doing it

Consolidation **removes the cross-check**. Eight callers resolving a card three
different ways can be caught by diffing two screens; eight callers behind one
resolver agree by construction — and they agree whether the resolver is right
or wrong. CLAUDE.md says this about the team-card consolidation already.

So every step must land with its value pinned **against the Rules of Golf**,
not against another reader: to-par against the played course's actual par, a
Stableford point, a skin, a match hole. Agreement between readers is not
evidence; it survives an error they all share.
