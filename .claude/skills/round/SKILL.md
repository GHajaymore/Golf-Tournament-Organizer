---
name: round
description: Push a TourneyHQ pull request's head to a test round, watch it without polling, read its verdict and findings, and merge when the rules allow. Use for "run a round on #N", "is the round clean", or before merging any PR that changes the app.
---

# A test round, start to verdict

A round is the browser suite on GitHub's runners, about thirty parts side by side, 55–80 minutes.
`CLAUDE.md` ("The testing framework", "What gates a merge") is the authority; this is the routine.

## 1. Decide whether it needs one, and how many
- `npm run qa:changed` (against `origin/main`) prints the tier. Tests, words, docs and tooling need
  none: CI on the PR is the whole of it, and "The app itself is unchanged (<app id>)" means a clean
  count already earned still stands. Function in one area: ONE round. Core: ONE all-country round,
  then the nightly before production. Money or handicap arithmetic: THREE, while
  `ARITHMETIC_KEEPS_THREE_ROUNDS` in `scripts/qa/layers.mjs` is on.

## 2. Make the head worth testing
- The head must contain `origin/main`: `git merge-base --is-ancestor origin/main <head>`. If not,
  merge main into the branch FIRST and push — a round on a head that will need main merged later is
  a round paid for twice (unless the app id stays the same).
- Use the FULL sha everywhere (`git rev-parse`), never a short one.

## 3. Push the round
- Only the main session pushes a round or merges: the guard refuses both from any other session or a
  subagent (`.claude/agents/STANDARDS.md` j; its id is in the untracked `.claude/main-session`).
- Next free number: `git ls-remote --heads origin "round/<name>-*"`.
- `git push origin <full sha>:refs/heads/round/<name>-<N>` — a push of the sha, not of a local branch.
- Two rounds may run at once. Never push one into a deploy freeze window for a change you mean to
  ship that day.

## 4. Watch it — never poll
- In the background, from a checkout that has `scripts/qa/reader.mjs`:
  `PATH="/c/Program Files/nodejs:$PATH" node scripts/qa/reader.mjs --watch <full sha> [<more shas>]`
- It writes `.qa/reader.txt` in the main checkout and exits when every watched head has an answer;
  you are notified. Never `gh run watch`, never a sleep loop.

## 5. Read the verdict
- `.qa/reader.txt` gives each run's state and, for a round, "CLEAN — N of N layers" or the findings count.
- Detail: `gh run download <run id> -n verdict -D <dir>` and read `summary.md`.
- A failure: `gh run view <run id> --log --job <job id>` for the numbered failures, and the
  `playwright-report-*` artifact for `test-failed-1.png` and `error-context.md`.
- `INCOMPLETE — re-run` is the machine, not the app (`round-waiter.yml` re-runs it). A crashed
  browser or a timed-out test is still a finding. A red part matching a known signature in
  `docs/claude/ci-failure-signatures.md` is named, not "fixed".
- Every finding is app or spec: read the snapshot before deciding. Fix, push a NEW head, and run a
  new round on it.

## 6. Merge — only when all hold
- A clean round on this exact head (or on the same app id), as many as the tier needs.
- `verify` green on this exact head: `gh api repos/<repo>/commits/<sha>/check-runs`.
- The head contains main (or the app id is unchanged since the clean round).
- No deploy freeze in force.
- Then: `gh pr ready <N>` if draft, and
  `gh pr merge <N> --squash --match-head-commit <full sha>`.
- Confirm with `gh pr view <N> --json state,mergeCommit`. "Merged" is not "live": core changes wait
  for the nightly; read the deployment to `tourneyhq-production`.
