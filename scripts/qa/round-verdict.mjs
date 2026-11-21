/**
 * WHAT MAKES A ROUND CLEAN (B99, QA ruling 20 Nov 2026) — ONE rule, ONE place.
 *
 * A round is clean when ITS OWN VERDICT says so: the `round-verdict` commit status round.yml's Verdict job
 * posts on the exact commit the round tested, in state `success`. NEVER the workflow run's conclusion: a
 * run can conclude success while its verdict is NOT CLEAN or was never posted (an INCOMPLETE verdict, a
 * skipped Verdict job), and a verdict on another commit says nothing about this one.
 * `round-verdict-is-the-only-reader.test.ts` refuses a second reader that matches a run's conclusion.
 */

export const ROUND_VERDICT_CONTEXT = "round-verdict";

/**
 * The newest `round-verdict` among a commit's statuses (the API lists newest first), or null.
 * `statuses` is [{ context, state, description?, target_url? }]; `sha` is the commit they were read from.
 */
export function newestRoundVerdict(statuses, sha) {
  const own = (statuses ?? []).find((s) => s?.context === ROUND_VERDICT_CONTEXT);
  return own ? { state: own.state, description: own.description ?? "", target_url: own.target_url ?? "", sha } : null;
}

/** Is this verdict a CLEAN one for `sha`? Success, and read from that very commit. */
export function isCleanVerdictFor(verdict, sha) {
  return Boolean(verdict) && Boolean(sha) && verdict.sha === sha && verdict.state === "success";
}

/**
 * The commits a round was clean on, out of the commits round runs were made for. `verdictOf(sha)` returns
 * the newest verdict read from that commit (or null). A run's own conclusion is not an input at all.
 */
export function cleanRoundShas(shas, verdictOf) {
  return [...new Set(shas)].filter((sha) => isCleanVerdictFor(verdictOf(sha), sha));
}
