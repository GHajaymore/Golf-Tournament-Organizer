# Course cards

> Moved out of `CLAUDE.md` on 2026-10-24, verbatim, so that the file every session reads stays short. Read this when your task touches: card validation, the catalogue, `--revalidate`. Index: `CLAUDE.md`.

## Course cards: measure a guard before you ship it

A wrong card is invisible — a bad stroke index allocates shots to the wrong holes for the
life of the course — so the instinct is to add another check. **A guard that refuses a real
golf course is worse than no guard**, and on 2026-08-23 four separate plausible-looking
guards would each have thrown one away:

- a par range that assumed a regulation course, which made **par-3 courses** unstorable
  (9 holes = 27, 18 = 54);
- sorted-par detection on a **nine**, where 3,3,3,3,4,4,4,5,5 is a real executive routing,
  not a scrambled card — nine values across three pars is too small a sample;
- treating a **flat card** as a placeholder, when every one in the catalogue was a genuine
  par-3 course with a real per-hole stroke index;
- refusing a card that disagreed with the source's own stated par, whose single observed
  catch was a **real par-72 course** whose `par` field described one nine.

The yardage version of this actually landed: a re-validation pass cleared 33 good cards
because their yardage was missing or odd. Yardage is optional and nothing scores off it —
it must never be why a card is thrown away.

So before adding or tightening a card rule:

1. **Judge the real catalogue first, READ-ONLY.** `--revalidate` is not a report — it
   **DESTROYS every card it refuses**, writing `pars`, `yards` and `strokeIndex` back as
   empty strings. That is precisely how 33 good cards were lost, and re-fetching them costs
   API quota at 500 requests a day. This file used to describe it as costing no quota and
   say nothing about the wipe, which reads like a safe check. It is not one.

   So write a throwaway script that reads `courseCatalog`, calls `cardRefusal` on each row
   and PRINTS what would go — no `update` anywhere in it. Run that, read it, delete it.
   Against 892 stored cards on 2026-09-04 it took seconds and refused nothing, which made
   the real command a proven no-op before it was run.
2. **Look at what it would refuse, by name**, before believing the count — which is only
   possible if step 1 came first. A rule that clears a large slice is wrong about golf, not
   right about the data.
3. **Use `cardRefusal`** — do not reimplement the range in a script. An ad-hoc checker that
   omitted the par-3 exemption reported three good courses as failures. Judge pars and
   stroke index only: pass an empty yards array, exactly as `revalidateStored` does, or the
   range check on yardage takes good scoring data down with it.
