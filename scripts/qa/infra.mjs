/**
 * A PART THAT DID NOT RUN IS NOT A PART THAT FAILED (the panel, 2026-10-23).
 *
 * On 2026-10-23 three rounds in a row read "failure" because Ubuntu's mirror
 * served the browsers' packages at 40 KB/s: every part that drives a browser
 * died installing it, before a single test, and each verdict said NOT CLEAN in
 * the same words it uses for a wrong score. A finding about the machine read as
 * a finding about the app. So the verdict now tells them apart:
 *
 *   NOT CLEAN               the app, or a test, said something was wrong
 *   INCOMPLETE — re-run     nothing was wrong that anybody could see, but some
 *                           part never got as far as testing: the machine, the
 *                           network or the runner. The waiter (round-waiter.yml)
 *                           re-runs exactly those parts.
 *   CLEAN, BUT NOT ALL OVER a layer was left out on purpose, or could not run
 *                           for a reason that is not the machine's
 *
 * What counts as the machine, and nothing else does — a crashed browser, a
 * test that timed out and a server that would not start are NOT on this list,
 * because each of those has been the app before:
 *
 *   the runner was lost, or the job ran out of time before it wrote a result
 *   checking out, installing the dependencies or migrating the throwaway database
 *   taking the round's one build from the artifacts
 *   installing the browser (apt and the browser download)
 *   a registry that could not be asked (the libraries layer's exit 2)
 *
 * Each part job writes `job-status.json` with the outcome of those steps
 * (round.yml, "Say what ran"); `infraReason` reads it.
 */

/** The steps of a part job whose failure is the machine's, in the order they run, with what to say. */
export const INFRA_STEPS = [
  ["setup", "installing the dependencies or migrating its database failed"],
  ["build", "taking the round's build from the artifacts failed"],
  ["browser", "installing the browser failed"],
];

/**
 * Why a part that wrote no result did not, when the reason is the machine's; null when it is not.
 * `status` is that part's job-status.json, or undefined when the job left none at all.
 */
export function infraReason(status) {
  if (!status) return "the machine was lost before it wrote anything (no result, no status)";
  for (const [step, words] of INFRA_STEPS) {
    if (status[step] === "failure" || status[step] === "cancelled") return words;
  }
  // Every infrastructure step went through and the round itself was cut off by the job's own limit.
  if (status.run === "cancelled") return "the job ran out of time before the round wrote its result";
  return null;
}
