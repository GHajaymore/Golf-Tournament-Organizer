import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { readSource, readVerbatim } from "./source";
// Plain JavaScript on purpose, as in qa-framework.test.ts: the pipeline runs on a bare runner.
import { ABROAD, ARITHMETIC, ARITHMETIC_KEEPS_THREE_ROUNDS, CRAWL_PARTS, SCHEDULES, crawlNeeded, layersFor, partsFor, roundPlan, targetLine, tierOf } from "../../../scripts/qa/layers.mjs";
import { countRunning, roundCap } from "../../../scripts/qa/round-cap.mjs";
import { activeEntries, quarantineProblems, quarantinedBy, readQuarantine } from "../../../scripts/qa/quarantine.mjs";
import { infraReason } from "../../../scripts/qa/infra.mjs";
import { cleanNightlyShas, commitsWaiting, decideDeploy, mustSucceed, nightlyWait } from "../../../scripts/qa/deploy-rules.mjs";
import { AREAS } from "../../../scripts/qa/specs-by-area.mjs";

/**
 * THE TESTING PIPELINE THE PANEL DECIDED ON 2026-10-23 (docs/testing-panel-2026-10-23.md),
 * held to its own words. `qa-framework.test.ts` holds what a round IS; this holds which round
 * a change gets, when the nightly and the weekly run what, what counts as the machine's fault,
 * what quarantine means, and when the deploy job lets a commit through.
 */
const at = (p: string) => join(process.cwd(), p);
type Layer = { key: string; when: string[] };
type Part = { id: string; layer: string; args: string };

describe("rounds by tier (item A)", () => {
  it("tests, words and the front door need no round", () => {
    for (const files of [["e2e/members.spec.ts"], ["docs/testing.md", "CLAUDE.md"], ["src/app/page.tsx", "src/lib/landing/home-styles.ts"]]) {
      expect(roundPlan(files).rounds, files.join(", ")).toBe(0);
      expect(roundPlan(files).nightly).toBe(false);
    }
    expect(roundPlan([]).rounds).toBe(0);
  });

  it("function in one area needs ONE round of three countries, and (since 2026-11-01) the nightly before production", () => {
    const p = roundPlan(["src/components/RosterClient.tsx"]);
    expect([p.tier, p.rounds, p.countries, p.nightly]).toEqual(["function", 1, "trio", true]);
  });

  it("core needs ONE round of all six countries, and the nightly before production", () => {
    const p = roundPlan(["src/app/globals.css", "docs/testing.md"]);
    expect([p.tier, p.rounds, p.countries, p.nightly, p.crawl]).toEqual(["core", 1, "all", true, true]);
  });

  it("money or handicap arithmetic keeps THREE rounds while the switch says so", () => {
    expect(ARITHMETIC_KEEPS_THREE_ROUNDS).toBe(true);
    for (const file of ["src/lib/domain/handicap.ts", "src/lib/domain/money.ts", "src/lib/domain/skins.ts"]) {
      const p = roundPlan([file]);
      expect([p.rounds, p.countries, p.nightly], file).toEqual([3, "all", true]);
      expect(p.arithmetic).toEqual([file]);
    }
    // CONTROL: a core file that is not arithmetic is one round.
    expect(roundPlan(["src/lib/auth.ts"]).rounds).toBe(1);
  });

  it("every arithmetic file exists and is core — a rename cannot quietly drop it to one round", () => {
    for (const file of ARITHMETIC) {
      expect(existsSync(at(file)), file).toBe(true);
      expect(tierOf(file), file).toBe("core");
    }
  });

  it("all six countries in one round is a few more parts, not three repeats", () => {
    const trio = partsFor(1, { schedule: "pr" }) as Part[];
    const all = partsFor(1, { schedule: "pr", countries: "all" }) as Part[];
    expect(all.length - trio.length).toBe(ABROAD.flat().length - ABROAD[0].length);
    const abroad = new Set(all.filter((p) => p.layer.startsWith("abroad-")).map((p) => p.layer));
    expect(abroad.size).toBe(6);
    // Everything else is the same parts, once.
    expect(all.filter((p) => !p.layer.startsWith("abroad-")).map((p) => p.id)).toEqual(trio.filter((p) => !p.layer.startsWith("abroad-")).map((p) => p.id));
  });
});

describe("targeted rounds (2026-11-01: specs-by-area.mjs)", () => {
  it("a change inside one area is targeted at it, with its specs, scenarios and the crawl — and waits for the nightly", () => {
    const p = roundPlan(["src/components/BracketFlights.tsx", "e2e/bracket-sections.spec.ts", "src/lib/__tests__/qa-pipeline.test.ts", "docs/testing.md"]);
    expect([p.tier, p.rounds, p.target?.area, p.crawl, p.nightly]).toEqual(["function", 1, "bracket", true, true]);
    expect(p.target?.scenarios).toEqual(["e"]);
    expect(p.countries).toBe("trio");
    // An area whose specs read days visits all six.
    expect(roundPlan(["src/components/print/PrintPages.tsx"]).countries).toBe("all");
  });

  it("FAIL-SAFE: anything not plainly in one area is today's full round, and says which file", () => {
    const full = (files: string[]) => {
      const p = roundPlan(files);
      expect(p.target, files.join(", ")).toBeNull();
      return p;
    };
    // core, money, the schema, the workflows, the framework, an e2e helper, package files, two areas, an unnamed screen
    expect(full(["src/components/BracketFlights.tsx", "prisma/schema.prisma"]).tier).toBe("core");
    expect(full(["src/components/BracketFlights.tsx", "src/lib/domain/money.ts"]).rounds).toBe(3);
    expect(full(["src/components/BracketFlights.tsx", ".github/workflows/round.yml"]).fullBecause).toContain(".github/workflows/round.yml");
    expect(full(["src/components/BracketFlights.tsx", "scripts/qa/layers.mjs"]).fullBecause).toContain("scripts/qa/layers.mjs");
    expect(full(["src/components/BracketFlights.tsx", "e2e/fixture.mjs"]).fullBecause).toContain("e2e/fixture.mjs");
    expect(full(["src/components/BracketFlights.tsx", "package.json"]).tier).toBe("core");
    expect(full(["src/components/BracketFlights.tsx", "src/app/owner/page.tsx"]).fullBecause).toContain("more than one area");
    expect(full(["src/components/RosterClient.tsx"]).fullBecause).toContain("in no area");
    expect(full(["src/components/BracketFlights.tsx", "e2e/print-kit.spec.ts"]).fullBecause).toContain("more than one area");
    expect(full(["src/components/BracketFlights.tsx", "src/app/page.tsx"]).fullBecause).toContain("front door");
    // A full function round is the round it got before targeting existed (and, since 2026-11-01, waits for the nightly).
    expect(full(["src/components/RosterClient.tsx"])).toMatchObject({ tier: "function", rounds: 1, countries: "trio", nightly: true });
    // Swept out of their areas for being imported from outside them (#982 review): full rounds.
    for (const shared of ["src/components/BracketClient.tsx", "src/lib/services/messaging.ts", "src/lib/services/waitlist.ts", "src/components/CommentaryFeed.tsx", "src/lib/services/event-report.ts", "src/lib/bracket-visibility.ts"]) {
      expect(full([shared]).fullBecause, shared).toContain("in no area");
    }
    expect(tierOf("src/lib/owner.ts")).toBe("core");
  });

  it("a targeted round is a change's round only: the nightly and the weekly are never cut", () => {
    expect(() => layersFor(1, { schedule: "nightly", target: "bracket" })).toThrow();
    expect(() => layersFor(1, { schedule: "weekly", target: "bracket" })).toThrow();
    expect(() => layersFor(1, { schedule: "pr", target: "no-such-area" })).toThrow();
  });

  it("is smaller than the full round, and says so in its verdict and its plan", () => {
    const full = partsFor(1, { schedule: "pr" }) as Part[];
    const aimed = partsFor(1, { schedule: "pr", target: "bracket" }) as Part[];
    expect(aimed.length).toBeLessThan(full.length);
    // The count is the manifest's own, so a spec added to the area does not break this line.
    expect(targetLine("bracket")).toBe(`TARGETED round: bracket — ${AREAS.bracket.specs.length} specs, scenario e + the always-on set; the full suite runs in the nightly`);
    const merge = readVerbatim("scripts/qa/merge.mjs");
    expect(merge).toContain("targetLine(plan.target)");
    const round = readVerbatim(".github/workflows/round.yml");
    expect(round).toContain('ARGS="$ARGS --target=$TARGET"');
    expect(round).toContain("if [ \"$SCHEDULE\" != \"pr\" ]; then TARGET_MODE=full; fi");
  });
});

describe("the round's own cap on parts at a time (Ajay, 2026-10-31)", () => {
  it("is 40 − running − 10, held between 4 and 16, and 12 when nothing could be counted", () => {
    expect(roundCap(2).cap).toBe(16);
    expect(roundCap(14).cap).toBe(16);
    expect(roundCap(18).cap).toBe(12);
    expect(roundCap(18).reason).toContain("40 − 18 job(s) already running");
    expect(roundCap(26).cap).toBe(4);
    expect(roundCap(60).cap).toBe(4);
    expect(roundCap(Number.NaN).cap).toBe(12);
    expect(roundCap(-1).cap).toBe(12);
  });

  it("counts the in-progress jobs of in-progress runs, and throws (so the fallback is taken) when GitHub does not answer", () => {
    const answers: Record<string, unknown> = {
      "repos/x/y/actions/runs?status=in_progress&per_page=100": { workflow_runs: [{ id: 1 }, { id: 2 }] },
      "repos/x/y/actions/runs/1/jobs?filter=latest&per_page=100": { jobs: [{ status: "in_progress" }, { status: "queued" }, { status: "completed" }] },
      "repos/x/y/actions/runs/2/jobs?filter=latest&per_page=100": { jobs: [{ status: "in_progress" }, { status: "in_progress" }] },
    };
    const fake = (args: string[]) => (answers[args[1]] ? { status: 0, stdout: JSON.stringify(answers[args[1]]), stderr: "" } : { status: 1, stdout: "", stderr: "HTTP 403" });
    const gh = fake as unknown as Parameters<typeof countRunning>[1];
    expect(countRunning("x/y", gh)).toBe(3);
    expect(() => countRunning("x/z", gh)).toThrow(/403/);
  });

  it("round.yml feeds it into max-parallel through the plan job, and prints it", () => {
    const round = readVerbatim(".github/workflows/round.yml");
    expect(round).toContain("max-parallel: ${{ fromJSON(needs.plan.outputs.cap || '12') }}");
    expect(round).toContain("cap: ${{ steps.cap.outputs.cap }}");
    expect(round).toContain("node scripts/qa/round-cap.mjs");
    expect(round).toContain("Parts at a time:");
    expect(round).not.toMatch(/max-parallel: \d+/);
  });
});

describe("the console crawl in a change's round", () => {
  it("runs for input screens and for core, not for a player screen or a word", () => {
    expect(crawlNeeded(["src/app/(app)/entry/page.tsx"]).needed).toBe(true);
    expect(crawlNeeded(["src/app/actions/tournament.ts"]).needed).toBe(true);
    expect(crawlNeeded(["src/components/HandicapPolicyPanel.tsx"]).needed).toBe(true);
    expect(crawlNeeded(["src/lib/domain/tee-choice.ts"]).needed).toBe(true);
    expect(crawlNeeded(["prisma/schema.prisma"]).needed).toBe(true);
    // CONTROLS: what the crawl cannot reach.
    expect(crawlNeeded(["src/app/(player)/me/help/page.tsx"]).needed).toBe(false);
    expect(crawlNeeded(["docs/testing.md", "e2e/entry.spec.ts"]).needed).toBe(false);
    expect(crawlNeeded(["src/app/api/health/route.ts"]).needed).toBe(false);
  });

  it("left out, its shares are not made, and the laptop shards still skip it", () => {
    const off = partsFor(1, { schedule: "pr", crawl: false }) as Part[];
    expect(off.some((p) => /--crawl=[1-9]/.test(p.args))).toBe(false);
    const desktop = off.filter((p) => p.layer === "suite" && p.args.includes("--projects=desktop"));
    expect(desktop.length).toBeGreaterThan(0);
    expect(desktop.every((p) => p.args.includes(`--crawl=0/${CRAWL_PARTS}`))).toBe(true);
    // CONTROL: on, all its shares are there.
    const on = partsFor(1, { schedule: "pr" }) as Part[];
    expect(on.filter((p) => /--crawl=[1-9]/.test(p.args)).length).toBe(CRAWL_PARTS);
  });
});

describe("what runs when (item B)", () => {
  const keys = (schedule: string) => (layersFor(1, { schedule, countries: "all" }) as Layer[]).map((l) => l.key);

  it("every layer runs under some schedule, and `all` is every layer", () => {
    const every = (layersFor(1, { countries: "all" }) as Layer[]).map((l) => l.key);
    const scheduled = new Set([...keys("pr"), ...keys("nightly"), ...keys("weekly")]);
    expect([...scheduled].sort()).toEqual([...every].sort());
  });

  it("the nightly is every pr layer plus the tablet, the libraries and the mutation ratchet; the weekly is Chrome, Edge and the motion", () => {
    expect(keys("nightly")).toEqual(expect.arrayContaining(keys("pr")));
    expect(keys("nightly").filter((k) => !keys("pr").includes(k)).sort()).toEqual(["dependencies", "mutation", "tablet-android"]);
    expect(keys("weekly").sort()).toEqual(["chrome", "edge", "motion"]);
    expect(keys("pr")).not.toContain("dependencies");
    // The ratchet costs a pull request nothing: it is never in a change's round.
    expect(keys("pr")).not.toContain("mutation");
  });

  it("a schedule or a country mode nobody defined is refused, not read as everything", () => {
    expect(() => layersFor(1, { schedule: "nighlty" })).toThrow();
    expect(() => layersFor(1, { countries: "six" })).toThrow();
    expect(Object.keys(SCHEDULES).sort()).toEqual(["all", "nightly", "pr", "weekly"]);
  });

  it("the workflows ask for the round they are said to", () => {
    const nightly = readVerbatim(".github/workflows/nightly.yml");
    expect(nightly).toContain('cron: "0 2 * * *"');
    expect(nightly).toMatch(/schedule: nightly\s+countries: all\s+crawl: "on"/);
    expect(nightly).toContain("uses: ./.github/workflows/deploy.yml");
    const weekly = readVerbatim(".github/workflows/weekly.yml");
    expect(weekly).toMatch(/schedule: weekly/);
    const round = readVerbatim(".github/workflows/round.yml");
    expect(round).toContain("workflow_call:");
    expect(round).toContain("node scripts/qa/what-changed.mjs origin/main --json");
    expect(round).toContain("--statuses=parts");
  });
});

describe("the machine is not the app (item D)", () => {
  it("names the machine's failures, and only those", () => {
    expect(infraReason(undefined)).toMatch(/lost/);
    expect(infraReason({ id: "x", setup: "success", build: "success", browser: "failure", run: "skipped" })).toMatch(/browser/);
    expect(infraReason({ id: "x", setup: "success", build: "failure", browser: "skipped", run: "skipped" })).toMatch(/build/);
    expect(infraReason({ id: "x", setup: "failure", build: "skipped", browser: "skipped", run: "skipped" })).toMatch(/dependencies/);
    // CONTROLS: a round that ran and failed is the app's, whatever its exit.
    expect(infraReason({ id: "x", setup: "success", build: "success", browser: "success", run: "failure" })).toBeNull();
    expect(infraReason({ id: "x", setup: "success", build: "success", browser: "skipped", run: "failure" })).toBeNull();
  });

  it("the waiter re-runs INCOMPLETE and nothing else", () => {
    const waiter = readVerbatim(".github/workflows/round-waiter.yml");
    expect(waiter).toContain("INCOMPLETE*)");
    expect(waiter).toContain('gh run rerun "$RUN_ID" -R "$REPO" --failed');
    expect(waiter).toContain("run_attempt < 3");
    const merge = readVerbatim("scripts/qa/merge.mjs");
    expect(merge).toContain('const INCOMPLETE = "INCOMPLETE — re-run";');
  });

  it("the packages job cannot fail a round", () => {
    const round = readVerbatim(".github/workflows/round.yml");
    const job = round.slice(round.indexOf("  browser-packages:"), round.indexOf("  part:"));
    expect(job).toContain("continue-on-error: true");
    expect(job).toContain("timeout-minutes: 20");
  });
});

describe("quarantine (item E)", () => {
  const entry = { spec: "e2e/offline.spec.ts", test: "taking their card clears the queue", owner: "zz-owner", reason: "a race in the test", expires: "2026-11-01" };

  it("starts empty, and the list on disk is sound", () => {
    expect(readQuarantine()).toEqual([]);
    expect(quarantineProblems(readQuarantine(), "2026-10-23")).toEqual([]);
  });

  it("matches a failure by spec AND test, with either slash", () => {
    expect(quarantinedBy("[desktop] › offline.spec.ts:245:5 › taking their card clears the queue without sending anything", [entry])).toBe(entry);
    expect(quarantinedBy("[phone] › e2e\\offline.spec.ts:245:5 › taking their card clears the queue", [entry])).toBe(entry);
    // CONTROL: the same spec, another test, counts.
    expect(quarantinedBy("[desktop] › offline.spec.ts:218:5 › a card changed while you were offline asks", [entry])).toBeNull();
  });

  it("an entry past its date quarantines nothing and is a finding; so is one granted too long or missing a field", () => {
    expect(activeEntries([entry], "2026-11-02")).toEqual([]);
    expect(quarantineProblems([entry], "2026-11-02", () => true).join()).toMatch(/expired/);
    expect(quarantineProblems([{ ...entry, expires: "2027-06-01" }], "2026-10-23", () => true).join()).toMatch(/more than 30 days/);
    expect(quarantineProblems([{ ...entry, owner: "" }], "2026-10-23", () => true).join()).toMatch(/no owner/);
    expect(quarantineProblems([entry], "2026-10-23", () => false).join()).toMatch(/no such spec/);
    // CONTROL: in date, sound, on disk.
    expect(quarantineProblems([entry], "2026-10-23", () => true)).toEqual([]);
  });

  it("the nightly holds the list to its dates, beside the libraries' holes", () => {
    const deps = (layersFor(1, { schedule: "nightly" }) as Array<{ key: string; command?: string }>).find((l) => l.key === "dependencies");
    expect(deps?.command).toContain("node scripts/qa/quarantine.mjs");
  });
});

describe("the deploy gate (item C)", () => {
  const sha = "a".repeat(40);
  const open = { checked: true, frozen: false, reason: "" };
  const base = { sha, verifyGreen: true, deployed: "b".repeat(40), alreadyThere: false, coreCommits: [], uncovered: [], nightlyCoversSha: false, window: open, overrideFreeze: false };

  it("deploys a green commit with nothing core waiting, outside the freeze", () => {
    expect(decideDeploy(base).decision).toBe("deploy");
  });

  it("holds without verify, whatever else is true", () => {
    expect(decideDeploy({ ...base, verifyGreen: false, overrideFreeze: true }).decision).toBe("hold");
  });

  it("holds a core change no clean nightly contains, and lets it go once one does", () => {
    const core = [{ sha: "c".repeat(40), subject: "a scoring change" }];
    expect(decideDeploy({ ...base, coreCommits: core, uncovered: core }).decision).toBe("hold");
    expect(decideDeploy({ ...base, coreCommits: core, uncovered: [] }).decision).toBe("deploy");
    // The override is for the FREEZE; it never skips the nightly.
    expect(decideDeploy({ ...base, coreCommits: core, uncovered: core, overrideFreeze: true }).decision).toBe("hold");
  });

  it("EVERY function commit waits for a clean nightly, targeted or full — and a later manifest change cannot release one", () => {
    const targetedFiles = ["src/components/BracketFlights.tsx", "e2e/bracket-sections.spec.ts"];
    expect(roundPlan(targetedFiles).target?.area).toBe("bracket");
    expect(nightlyWait(targetedFiles)).toBe("function");
    // A function commit whose round was FULL waits too.
    expect(nightlyWait(["src/components/RosterClient.tsx"])).toBe("function");
    expect(nightlyWait(["src/lib/domain/bracket.ts"])).toBe("core");
    // The manifest changes after the targeted commit merged (an area dropped, as the documented revert
    // of targeting would): the commit's round no longer reads as targeted, and it STILL waits.
    const bracket = AREAS.bracket;
    try {
      delete (AREAS as Record<string, unknown>).bracket;
      expect(roundPlan(targetedFiles).target).toBeNull();
      expect(nightlyWait(targetedFiles)).toBe("function");
    } finally {
      (AREAS as Record<string, unknown>).bracket = bracket;
    }
    // CONTROLS: words and tests do not wait.
    expect(nightlyWait(["docs/testing.md"])).toBeNull();
    expect(nightlyWait(["e2e/bracket-sections.spec.ts", "src/lib/__tests__/qa-pipeline.test.ts"])).toBeNull();
    // Since production, a function commit with no clean nightly containing it: HOLD; with one: DEPLOY.
    const waiting = [{ sha: "e".repeat(40), subject: "the bracket reads its flights", kind: "function" }];
    const held = decideDeploy({ ...base, coreCommits: waiting, uncovered: waiting });
    expect(held.decision).toBe("hold");
    expect(held.reason).toContain("function");
    expect(decideDeploy({ ...base, coreCommits: waiting, uncovered: [] }).decision).toBe("deploy");
    // The gate reads tiers through commitsWaiting, never the manifest.
    const gate = readVerbatim("scripts/qa/deploy-gate.mjs");
    expect(gate).toContain("commitsWaiting(");
    // (Code only: the comments say why the manifest is NOT asked.)
    expect(readSource("scripts/qa/deploy-gate.mjs")).not.toMatch(/roundPlan|targetFor|specs-by-area/);
    expect(readSource("scripts/qa/deploy-rules.mjs")).not.toMatch(/roundPlan|targetFor|specs-by-area/);
  });

  it("FAIL CLOSED: a git failure throws (the gate exits 1, nothing ships) and a commit with no readable files waits", () => {
    expect(() => mustSucceed({ status: 128, stdout: "", stderr: "fatal: bad revision" }, "git rev-list")).toThrow(/git rev-list failed \(exit 128\)/);
    expect(() => mustSucceed(null, "git diff-tree")).toThrow();
    expect(mustSucceed({ status: 0, stdout: "abc\n", stderr: "" }, "git")).toBe("abc\n");
    // A commit whose file list comes back empty or unknown is held, never waved through.
    const files: Record<string, string[]> = { a: [], b: ["docs/testing.md"], c: ["src/components/RosterClient.tsx"] };
    expect(commitsWaiting(["a", "b", "c"], (s: string) => files[s]).map((c) => `${c.sha}:${c.kind}`)).toEqual(["a:unknown", "c:function"]);
    expect(nightlyWait(undefined as unknown as string[])).toBe("unknown");
    // And the gate uses the throwing form for every git question it builds the list from.
    const gate = readVerbatim("scripts/qa/deploy-gate.mjs");
    const fn = gate.slice(gate.indexOf("function waitingCommitsSince"), gate.indexOf("/** The commits a Nightly round"));
    expect(fn).toContain('gitOut("rev-list"');
    expect(fn).toContain('gitOut("diff-tree"');
    expect(fn).not.toMatch(/\bgit\(/);
  });

  it("holds in the freeze unless overridden, and deploys — saying so — when the freeze cannot be asked", () => {
    const frozen = { checked: true, frozen: true, reason: "2 tournaments are being played today" };
    expect(decideDeploy({ ...base, window: frozen })).toMatchObject({ decision: "hold" });
    expect(decideDeploy({ ...base, window: frozen }).reason).toContain("2 tournaments");
    expect(decideDeploy({ ...base, window: frozen, overrideFreeze: true }).decision).toBe("deploy");
    const unasked = decideDeploy({ ...base, window: { checked: false, frozen: false, reason: "no token" } });
    expect(unasked.decision).toBe("deploy");
    expect(unasked.notes.join()).toContain("not checked");
  });

  it("does nothing when production already has it, and waits when nobody can tell what production holds", () => {
    expect(decideDeploy({ ...base, alreadyThere: true }).decision).toBe("done");
    expect(decideDeploy({ ...base, deployed: null }).decision).toBe("hold");
    expect(decideDeploy({ ...base, deployed: null, nightlyCoversSha: true }).decision).toBe("deploy");
  });

  it("a nightly run still in progress covers its commit once its Verdict job has succeeded, and not before", () => {
    const job = (name: string, conclusion: string | null) => ({ name, conclusion });
    const running = [
      { headSha: "a".repeat(40), jobs: [job("Round", "success"), job("Verdict", "success"), job("Deploy what the round cleared / Deploy to production", null)] },
      { headSha: "b".repeat(40), jobs: [job("Round", "success"), job("Verdict", null)] },
      { headSha: "c".repeat(40), jobs: [job("Verdict", "failure")] },
      { headSha: "d".repeat(40), jobs: [] },
    ];
    expect(cleanNightlyShas(running)).toEqual(["a".repeat(40)]);
  });

  it("deploy-gate.mjs does not filter nightly runs to completed ones", () => {
    const gate = readVerbatim("scripts/qa/deploy-gate.mjs");
    const fn = gate.slice(gate.indexOf("function cleanNightlies"), gate.indexOf("async function freeze"));
    expect(fn).toContain("cleanNightlyShas");
    expect(fn).not.toContain('"completed"');
  });

  it("ci.yml deploys only through deploy.yml, and deploy.yml asks the gate before every deploying step", () => {
    const ci = readVerbatim(".github/workflows/ci.yml");
    const job = ci.slice(ci.indexOf("  deploy:"));
    expect(job).toContain("needs: verify");
    expect(job).toContain("uses: ./.github/workflows/deploy.yml");
    expect(job).not.toContain("vercel deploy");
    // Line endings as GitHub sees them: a Windows checkout's CRLF would hide every step from `${name}\n`.
    const deploy = readVerbatim(".github/workflows/deploy.yml").replace(/\r\n/g, "\n");
    expect(deploy).toContain("node scripts/qa/deploy-gate.mjs");
    const steps = deploy.split("      - name: ").slice(1);
    for (const name of ["Install the Vercel CLI", "Link the project", "Deploy", "Record what production holds", "Smoke-test production"]) {
      const step = steps.find((s) => s.startsWith(`${name}\n`));
      expect(step, name).toBeTruthy();
      expect(step, name).toContain("if: steps.gate.outputs.decision == 'deploy'");
    }
    // The runner never holds production database credentials: no database URL anywhere in the deploy.
    expect(deploy).not.toMatch(/DATABASE_URL/);
  });
});
