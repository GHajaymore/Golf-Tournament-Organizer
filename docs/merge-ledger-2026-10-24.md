# Merge ledger, 2026-10-24

The merge queue of 24 October, one line per pull request: the head that was tested, the rounds
`npm run qa:changed` asked for and what they said, the merge commit, and what the deploy gate did.
Rounds are named by their branch (`round/<name>-N`); a verdict is the Verdict job's own line.

Kept by the merge-queue runner. Nothing here is a person's name; the queue order was the owner's.

## Notes before the lines

- **Main was red for a while** after #937 (run 40075266243): `secretary-back-after-a-week.spec.ts`
  could not find a zone at seven o'clock at some hours. Fixed by #944 (test only). No merge was
  made while it was red; the first rounds of #942 and #929, pushed before the fix, were cancelled
  and run again on heads that contain it.
- **`qa-pipeline.test.ts` fails on this Windows machine and passes on Linux** (on main as well):
  vitest reports `SyntaxError: Invalid or unexpected token` importing `scripts/qa/quarantine.mjs`,
  the one module of the four with a `#!` line, checked out with CRLF. Every local gate below reads
  "1 failed" for that file alone; CI is the judge of it.

## The lines

| PR | Head tested | Rounds (verdicts) | Merged as | Deploy |
|---|---|---|---|---|
