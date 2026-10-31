/**
 * WHETHER A COMMIT MAY GO TO PRODUCTION NOW — the rule, with no network in it.
 *
 * The panel of 2026-10-23 (docs/testing-panel-2026-10-23.md), item C:
 *
 *   1. `verify` is green on the commit — as it always had to be;
 *   2. every "Core and shared" commit since the last deploy is contained in a
 *      clean NIGHTLY round: the nightly ran on that commit, or on a later one
 *      that contains it. A core change merges after one round and waits here;
 *   3. no club is in its freeze — a tournament on today in the club's own time,
 *      or a weekend morning (05:00–14:00) in any club's zone — unless a person
 *      overrides the freeze by hand for an emergency.
 *
 * `scripts/qa/deploy-gate.mjs` gathers the facts (GitHub's API, git, the app's
 * /api/deploy-window) and hands them to `decideDeploy`, which is pure so every
 * branch of it is unit-tested (`deploy-gate.test.ts`).
 *
 * Decisions: "deploy", "hold" (not now: a reason, and the hourly deploy.yml or
 * the nightly will try again), "done" (production already has this commit).
 */

/**
 * @param {object} f
 * @param {string} f.sha                    the commit asked for
 * @param {boolean} f.verifyGreen           `verify` succeeded on it
 * @param {string|null} f.deployed          the commit production holds, or null when nobody can tell
 * @param {boolean} f.alreadyThere          `sha` is `deployed` or an ancestor of it
 * @param {Array<{sha:string, subject:string}>} f.coreCommits   core commits in deployed..sha
 * @param {Array<{sha:string}>} f.uncovered  of those, the ones no clean nightly contains
 * @param {boolean} [f.nightlyCoversSha]    a clean nightly round contains `sha` itself (asked when `deployed` is unknown)
 * @param {{checked:boolean, frozen:boolean, reason:string}} f.window   the freeze, as the app answered
 * @param {boolean} f.overrideFreeze        a person said to deploy through the freeze
 */
export function decideDeploy(f) {
  const short = (s) => String(s).slice(0, 8);
  const notes = [];
  if (!f.verifyGreen) return { decision: "hold", reason: `verify is not green on ${short(f.sha)} — nothing reaches production without it`, notes };
  if (f.alreadyThere) return { decision: "done", reason: `production already has ${short(f.sha)} (it holds ${short(f.deployed)})`, notes };
  if (f.deployed === null) {
    // Nobody can say what production holds, so nobody can say which commits are new: the safe mistake is to wait.
    if (!f.nightlyCoversSha) return { decision: "hold", reason: `cannot tell which commit production holds, so ${short(f.sha)} waits for a clean nightly round that contains it`, notes };
    notes.push("which commit production holds could not be read; a clean nightly round contains this one, so it goes");
  } else if (f.uncovered.length) {
    const list = f.uncovered.slice(0, 5).map((c) => `${short(c.sha)} ${c.subject}`).join("; ");
    return {
      decision: "hold",
      reason: `${f.uncovered.length} core change(s) since production's ${short(f.deployed)} wait for a clean nightly round that contains them: ${list}${f.uncovered.length > 5 ? " …" : ""}`,
      notes,
    };
  }
  if (f.coreCommits.length) notes.push(`${f.coreCommits.length} core change(s) since the last deploy, each in a clean nightly round`);
  if (f.overrideFreeze) {
    notes.push(`the freeze was OVERRIDDEN by hand${f.window.checked && f.window.frozen ? ` — it said: ${f.window.reason}` : ""}`);
  } else if (!f.window.checked) {
    notes.push(`the freeze was not checked — ${f.window.reason}; deploying as if it were open`);
  } else if (f.window.frozen) {
    return { decision: "hold", reason: `deploy freeze: ${f.window.reason}`, notes };
  }
  return { decision: "deploy", reason: `${short(f.sha)} may go: verify is green${f.coreCommits.length ? ", its core changes are in a clean nightly round" : ", no core change waits for the nightly"}${f.overrideFreeze ? ", and the freeze was overridden" : ", and no club is in its freeze"}`, notes };
}
