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
 *
 * SINCE 2026-11-01 rule 2 holds EVERY commit that changes function, not only core:
 * targeted rounds (specs-by-area.mjs) run an area's specs, not every spec, so the
 * full suite has not yet seen such a commit. The gate does NOT ask the manifest
 * which commits were targeted: asked at the deploying commit, a later edit of the
 * manifest (or turning targeting off) would reclassify a held targeted commit as
 * "full" and let it through unseen (the Operations/Reliability Lead's review of
 * #982). So the rule reads only the TIER of each commit's files: core or function
 * waits for a clean nightly; tests and words do not. Fail-closed: a commit whose
 * files cannot be read waits too.
 */
import { tierOf } from "./layers.mjs";

/**
 * Whether a commit, by the files it changed, must be inside a clean nightly before production:
 * "core", "function" (whether its round was targeted or full), "unknown" (no files could be read —
 * it waits, the safe mistake), or null (tests and words only).
 */
export function nightlyWait(files) {
  if (!files || !files.length) return "unknown";
  const tiers = files.map(tierOf);
  if (tiers.includes("core")) return "core";
  if (tiers.includes("function")) return "function";
  return null;
}

/** A git or gh result that must have succeeded: anything else THROWS, so the gate exits 1 and nothing ships. */
export function mustSucceed(result, what) {
  if (!result || result.status !== 0) throw new Error(`${what} failed (exit ${result?.status ?? "none"}): ${String(result?.stderr ?? "").trim().slice(0, 200)}`);
  return result.stdout;
}

/** The commits of `list` that wait for the nightly, with why: `filesOf(sha)` is each commit's changed files. */
export function commitsWaiting(list, filesOf, subjectOf = () => "") {
  const waiting = [];
  for (const sha of list) {
    const kind = nightlyWait(filesOf(sha));
    if (kind) waiting.push({ sha, kind, subject: subjectOf(sha) });
  }
  return waiting;
}

/**
 * @param {object} f
 * @param {string} f.sha                    the commit asked for
 * @param {boolean} f.verifyGreen           `verify` succeeded on it
 * @param {string|null} f.deployed          the commit production holds, or null when nobody can tell
 * @param {boolean} f.alreadyThere          `sha` is `deployed` or an ancestor of it
 * @param {Array<{sha:string, subject:string, kind?:string}>} f.coreCommits   commits in deployed..sha that wait for
 *                                          the nightly (`nightlyWait`): kind "core", "function" or "unknown"
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
    const list = f.uncovered.slice(0, 5).map((c) => `${short(c.sha)}${c.kind && c.kind !== "core" ? ` (${c.kind})` : ""} ${c.subject}`).join("; ");
    const what = f.uncovered.every((c) => !c.kind || c.kind === "core") ? "core change(s)" : "core or function change(s)";
    return {
      decision: "hold",
      reason: `${f.uncovered.length} ${what} since production's ${short(f.deployed)} wait for a clean nightly round that contains them: ${list}${f.uncovered.length > 5 ? " …" : ""}`,
      notes,
    };
  }
  if (f.coreCommits.length) notes.push(`${f.coreCommits.length} core or function change(s) since the last deploy, each in a clean nightly round`);
  if (f.overrideFreeze) {
    notes.push(`the freeze was OVERRIDDEN by hand${f.window.checked && f.window.frozen ? ` — it said: ${f.window.reason}` : ""}`);
  } else if (!f.window.checked) {
    notes.push(`the freeze was not checked — ${f.window.reason}; deploying as if it were open`);
  } else if (f.window.frozen) {
    return { decision: "hold", reason: `deploy freeze: ${f.window.reason}`, notes };
  }
  return { decision: "deploy", reason: `${short(f.sha)} may go: verify is green${f.coreCommits.length ? ", its core and function changes are in a clean nightly round" : ", no core or function change waits for the nightly"}${f.overrideFreeze ? ", and the freeze was overridden" : ", and no club is in its freeze"}`, notes };
}

/**
 * The commits Nightly rounds were clean on. A round counts when its Verdict JOB succeeded, whether or not the
 * run has finished: the deploy job of the very round that cleared a commit runs inside that still-running
 * run, so reading only completed runs made a round blind to its own result (production held 8741a2ac from
 * 26 Oct to 31 Oct that way). `runs` is [{ headSha, jobs: [{ name, conclusion }] }].
 */
export function cleanNightlyShas(runs) {
  return runs.filter((r) => (r.jobs ?? []).some((j) => j.name.endsWith("Verdict") && j.conclusion === "success")).map((r) => r.headSha);
}
