/**
 * PROVE A TEST BY BREAKING THE APP — one break at a time, each on its own.
 *
 * A test is only worth its green if the app, broken, turns it red. "Break it,
 * watch the test fail, put it back" is asked of every change (CLAUDE.md), and
 * for a browser test it takes a build per break. Done one after another on the
 * machine the app is written on, eighteen breaks took eighty-five minutes and
 * held the working tree the whole time (2026-10-13; Ajay: "are you doing the
 * things right way? you have 4 roles to make it efficient"). So a list of
 * breaks is a file, and `.github/workflows/breaks.yml` gives each one a machine.
 *
 *     node scripts/qa/breaks.mjs --plan qa-breaks.json          the list, as a matrix for the workflow
 *     node scripts/qa/breaks.mjs --run=3 qa-breaks.json         apply break 3, run its tests, say what happened
 *     node scripts/qa/breaks.mjs --verdict <directory>          add the results up
 *
 * THE LIST is a JSON array. Each break:
 *
 *     { "what":  "T4 one set for everyone still lets a flight differ",   what is broken, in words
 *       "file":  "src/lib/domain/handicap.ts",
 *       "from":  "  if (policy === \"one\") return defaultTeeId ?? \"\";",  found EXACTLY once, or `nth`
 *       "to":    "  if (policy === \"never\") return defaultTeeId ?? \"\";",
 *       "spec":  "e2e/organizer-tees.spec.ts",    a browser test …    ("project", "grep" optional)
 *       "unit":  ["src/lib/__tests__/x.test.ts"], … or unit tests …
 *       "audit": ["src/lib/__tests__/y.audit.test.ts"] }   … or database tests. Any of the three; at least one.
 *
 * A break is CAUGHT when a test it names fails. It is NOT CAUGHT when they all
 * pass, which is the result this exists to find: either the test cannot see
 * that fault, or the break changes nothing a person would notice — and which
 * of the two it is has to be worked out and written down, not assumed.
 *
 * THREE WAYS A BREAK PROVES NOTHING, each reported in its own words so that
 * none of them can be read as "caught":
 *
 *     NOT APPLIED       the line was not found exactly once. A replace that
 *                       silently did nothing leaves the tests green, which
 *                       reads exactly like "the test cannot catch this".
 *     DOES NOT COMPILE  the type checker refuses the break, so nothing ran.
 *     DID NOT RUN       a browser test's build or server failed. A break that
 *                       leaves a variable unused fails the build's lint: keep
 *                       the variable used (`x * 0`, `x && ""`).
 *
 * Run by hand it puts the file back with `git checkout`, so the work must be
 * committed first, as CLAUDE.md asks before any mutation check.
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
const value = (name) => (flag(name) ?? "").split("=").slice(1).join("=");
const rest = args.filter((a) => !a.startsWith("--"));

/** The verdicts, and which of them mean the tests did their job. */
export const VERDICTS = ["CAUGHT", "NOT CAUGHT", "NOT APPLIED", "DOES NOT COMPILE", "DID NOT RUN"];

/** Read a list and refuse one that could not prove anything. */
export function readBreaks(path) {
  const list = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(list) || list.length === 0) throw new Error(`${path} holds no breaks`);
  list.forEach((b, i) => {
    for (const key of ["what", "file", "from", "to"]) {
      if (typeof b[key] !== "string" || !b[key]) throw new Error(`break ${i + 1} has no "${key}"`);
    }
    if (b.from === b.to) throw new Error(`break ${i + 1} (${b.what}) changes nothing`);
    if (!b.spec && !(b.unit?.length || b.audit?.length)) throw new Error(`break ${i + 1} (${b.what}) names no test`);
  });
  return list;
}

/** Apply one break to a file's text: exactly once, or the `nth` of several. Null when it cannot be. */
export function applyBreak(text, b) {
  const nl = text.includes("\r\n") ? "\r\n" : "\n";
  const flat = text.split(nl).join("\n");
  const pieces = flat.split(b.from);
  const seen = pieces.length - 1;
  if (b.nth ? seen < b.nth : seen !== 1) return { text: null, seen };
  const at = b.nth ? b.nth - 1 : 0;
  const out = pieces.map((piece, i) => (i < seen ? piece + (i === at ? b.to : b.from) : piece)).join("");
  return { text: out.split("\n").join(nl), seen };
}

const sh = (command, env = {}) => {
  const r = spawnSync(command, { shell: true, encoding: "utf8", env: { ...process.env, ...env }, maxBuffer: 256 * 1024 * 1024 });
  return { status: r.status ?? 1, text: `${r.stdout ?? ""}${r.stderr ?? ""}` };
};
const clean = (s) => s.replace(/\u001b\[[0-9;]*m/g, "");

function run(index, listPath) {
  const list = readBreaks(listPath);
  const b = list[index - 1];
  if (!b) throw new Error(`there is no break ${index} in ${listPath} (it holds ${list.length})`);
  const result = { index, what: b.what, file: b.file, verdict: "", detail: "" };
  const before = readFileSync(b.file, "utf8");
  const applied = applyBreak(before, b);
  if (applied.text === null) {
    result.verdict = "NOT APPLIED";
    result.detail = `the line was found ${applied.seen} times in ${b.file}`;
    return result;
  }
  writeFileSync(b.file, applied.text);
  try {
    const tsc = sh("npx tsc --noEmit");
    if (tsc.status !== 0) {
      result.verdict = "DOES NOT COMPILE";
      result.detail = clean(tsc.text).split("\n").find((l) => l.includes("error TS"))?.trim().slice(0, 220) ?? "";
      return result;
    }
    const failures = [];
    if (b.unit?.length) {
      const r = sh(`npx vitest run ${b.unit.join(" ")}`);
      if (r.status !== 0) failures.push(...[...clean(r.text).matchAll(/FAIL\s+\S+\s*>\s*([^\n]*)/g)].map((m) => m[1].trim()));
    }
    if (b.audit?.length) {
      const r = sh(`npx vitest run --config vitest.audit.config.ts ${b.audit.join(" ")}`);
      if (r.status !== 0) failures.push(...[...clean(r.text).matchAll(/FAIL\s+\S+\s*>\s*([^\n]*)/g)].map((m) => m[1].trim()));
    }
    if (b.spec && failures.length === 0) {
      // The Playwright config builds and serves the app itself (`webServer`), so this is the one build.
      const grep = b.grep ? ` -g "${b.grep}"` : "";
      const r = sh(`npx playwright test ${b.spec} --project=${b.project ?? "desktop"} --reporter=line${grep}`, {
        AUTH_SECRET: process.env.AUTH_SECRET ?? "breaks-signing-key-not-for-deployment",
      });
      const text = clean(r.text);
      const ran = /\b\d+ (passed|failed)\b/.test(text);
      if (!ran) {
        result.verdict = "DID NOT RUN";
        result.detail = (text.split("\n").find((l) => /Type error|Error:|Failed to compile|error TS|✖/.test(l)) ?? text.split("\n").filter(Boolean).pop() ?? "").trim().slice(0, 220);
        return result;
      }
      if (r.status !== 0 && /\b\d+ failed\b/.test(text)) {
        failures.push((text.split("\n").find((l) => /^\s+Error:/.test(l)) ?? "a browser test failed").trim());
      }
    }
    result.verdict = failures.length ? "CAUGHT" : "NOT CAUGHT";
    result.detail = [...new Set(failures)].slice(0, 3).join(" | ").slice(0, 400);
    return result;
  } finally {
    // On a desk the file goes back. On a runner the checkout is thrown away, and this is harmless.
    sh(`git checkout -- "${b.file}"`);
  }
}

function verdict(dir) {
  const files = existsSync(dir) ? readdirSync(dir, { recursive: true }).filter((f) => String(f).endsWith(".json")) : [];
  const results = files.map((f) => JSON.parse(readFileSync(join(dir, String(f)), "utf8"))).sort((a, b) => a.index - b.index);
  const expected = Number(value("expect") || 0);
  const lines = ["| # | Break | Result | What the tests said |", "|---|---|---|---|"];
  for (const r of results) lines.push(`| ${r.index} | ${r.what} | **${r.verdict}** | ${String(r.detail ?? "").replace(/\|/g, "/")} |`);
  const caught = results.filter((r) => r.verdict === "CAUGHT").length;
  const missing = expected ? expected - results.length : 0;
  const summary = `${caught} of ${expected || results.length} breaks caught${missing > 0 ? `; ${missing} never reported` : ""}`;
  const text = `## Proving the tests by breaking the app\n\n${summary}.\n\n${lines.join("\n")}\n\nA break that is NOT CAUGHT is either a fault the tests cannot see or a change nobody would notice. Which it is must be worked out and written down.\n`;
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, text, { flag: "a" });
  return caught === (expected || results.length) && results.length > 0 ? 0 : 1;
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop());
if (isMain) {
  if (flag("plan")) {
    const list = readBreaks(rest[0]);
    console.log(JSON.stringify(list.map((b, i) => ({ index: i + 1, what: b.what.slice(0, 90), browser: b.spec ? "yes" : "" }))));
  } else if (flag("run")) {
    const index = Number(value("run"));
    const result = run(index, rest[0]);
    mkdirSync(".qa/breaks", { recursive: true });
    writeFileSync(`.qa/breaks/${index}.json`, JSON.stringify(result, null, 1));
    console.log(`${result.verdict.padEnd(17)} ${result.what}${result.detail ? ` — ${result.detail}` : ""}`);
    // Green only when the tests did their job: a break the tests missed is a red line somebody reads.
    process.exit(result.verdict === "CAUGHT" ? 0 : 1);
  } else if (flag("verdict")) {
    process.exit(verdict(rest[0] ?? ".qa/breaks"));
  } else {
    console.error("usage: node scripts/qa/breaks.mjs --plan <list.json> | --run=<n> <list.json> | --verdict <directory> [--expect=<n>]");
    process.exit(2);
  }
}
