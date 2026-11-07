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

## Loading the catalogue into production (J29, 2026-11-06)

Nobody holds production's database credentials (CLAUDE.md), so the dev catalogue reaches production
through the app, by the owner:

1. `DOTENV_CONFIG_PATH=<main checkout>/.env npx tsx scripts/export-catalogue.ts [outDirOrFile]` reads the
   LOCAL dev database only (it refuses any other host) and writes ONE JSON file outside the repo
   (default `Documents/Apps/Golf Tournament App/catalogue-exports/`; it refuses a path inside the repo).
2. On `/owner`, the **Course catalogue** card takes that file. The browser checks the format/version and
   sends it in chunks (`chunkRows`: 100 rows and 600 KB at most per request, under a server action's 1 MB
   body limit); the server (`loadCourseCatalogue`, owner only, `services/catalogue-load.ts`) judges every row
   with `judgeRow` (`domain/catalogue-load.ts`), which calls `cardRefusal`.
3. **Never delete: a usable stored row is never touched, an unusable one is filled, and an empty value
   never replaces a stored one.** A refused card is SKIPPED and counted, never stored blank. The card
   reports loaded / updated / unchanged / skipped / refused (gca) and keeps one audit line per load
   (the last 30) in `PlatformSetting` `catalogue-load-log`.
4. **`gca:` rows are never exported and never loaded** (GolfCourseAPI's terms forbid compiling its
   dataset; Ajay). Refused by id, before anything else is read, and counted apart. Only OpenGolfAPI
   (ODbL, credit required — `DIRECTORY_ATTRIBUTION`, shown on the card and beside every catalogue search).
5. Measured 2026-11-06: of the dev rows with an empty `cardProblem`, 334 carry a stroke index of all zeros
   (a placeholder `catalogueRefusal` keeps on purpose, `cardRefusal` refuses). They are not exported, so
   production receives the cards that pass the strict rule: that is the point of the load.

Tests: `catalogue-load.test.ts` (judgement), `catalogue-load.audit.test.ts` (real rows),
`e2e/owner-catalogue-load.spec.ts` (the owner's press).
