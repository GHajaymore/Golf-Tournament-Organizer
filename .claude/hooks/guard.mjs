#!/usr/bin/env node
// The hard rules in CLAUDE.md, enforced before a command runs rather than remembered.
//
// Claude Code calls this as a PreToolUse hook for every Bash and PowerShell command
// (.claude/settings.json). It reads the hook's JSON on stdin and either exits 0 (the
// command runs) or exits 2 with the reason on stderr (the command is refused and the
// reason goes back to the session that tried it). It is a guard against mistakes, not
// against someone determined to get round it: text inside quotes and heredocs is never
// read as a command, so a commit message may quote the rules it is about.
//
// What it refuses, and the rule each comes from:
//   git add -A / --all / . / :/       Hard rule 4 — commit with explicit paths
//   git stash (any form)              Hard rule 5 — the working tree is shared
//   prisma migrate reset, db push --force-reset / --accept-data-loss, npm run db:reset
//                                     Hard rule 6 — never drop the development database
//   git push ... main (or --all / --mirror)
//                                     Hard rule 3 — main reaches production only via a PR
//   git commit whose changes hold a real-looking email address or phone number, or a local
//   absolute path (C:\Users\<you>, /c/Users/<you>, a profile's AppData folder) that names the Windows user
//                                     Hard rule 2 — the repository is public (ledger row 10)
//   gh pr merge (or the merge API), git push to round/*, running merge.sh or chain.sh — from any
//   session but the main one (its id is in the untracked .claude/main-session of the main
//   checkout), and from any subagent
//                                     Main-session rule — the main session merges and rounds,
//                                     with a QA GO line (ledger row 17)
//   prisma generate (or npm run db:generate) in a worktree whose prisma/schema.prisma differs
//                                     from the main checkout's: every worktree shares the main
//                                     checkout's node_modules, so it replaces EVERYONE's client
//   PowerShell writing a source file  "Never rewrite a source file with PowerShell"
//   gh run watch, gh pr checks --watch
//                                     Agent standard (a), .claude/agents/STANDARDS.md — never
//                                     wait on CI; the GitHub API budget is shared
//   on Windows only: Playwright, next dev/start/build, npm run dev/build/start/test:e2e/
//   smoke:all/electron:*              Ajay's ruling: no builds, servers or browsers on
//                                     the desktop; CI and the cloud run them.
//
// To change what it allows, edit this file; the test is
// src/lib/__tests__/claude-guard-hook.test.ts.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
// No "#!" line in that module, so vitest can import it from a CRLF checkout (no-local-paths-in-the-repository.test.ts).
import { UNSCANNED_FILE, findLocalPaths } from "./local-paths.mjs";

/** Addresses on these domains are invented or our own; anything else is somebody's. */
const ALLOWED_EMAIL_DOMAIN =
  /(^|\.)(example\.(invalid|com|org|net)|example|invalid|test|localhost|tourneyhq\.club|tourneyhq\.co\.uk|resend\.dev|users\.noreply\.github\.com|anthropic\.com)$/i;

/** The ranges set aside for drama and examples: US 555-01xx, UK Ofcom, Australia ACMA. */
const FICTIONAL_PHONE_DIGITS = ["5550", "7700900", "2079460", "1632960", "1134960", "491570"];


const SOURCE_FILE = /\.(ts|tsx|js|jsx|mjs|cjs|json|md|css|prisma|sql|ya?ml|html|txt)\b/i;

// ---------------------------------------------------------------- reading a command

/** Remove the bodies of heredocs, so text fed to a command is not read as commands. */
export function stripHeredocs(cmd) {
  const out = [];
  const lines = cmd.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    out.push(line);
    const m = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/.exec(line);
    if (!m) continue;
    const end = m[2];
    while (i + 1 < lines.length && lines[i + 1].trim() !== end) i++;
    i++; // the terminator line
  }
  return out.join("\n");
}

/**
 * Split a shell command into segments of words, honouring quotes. Quoted text stays one word.
 * In PowerShell a backslash is a path separator, never an escape.
 */
export function segments(cmd, powershell = false) {
  const segs = [];
  let words = [];
  let word = "";
  let inWord = false;
  let quote = null;
  const endWord = () => {
    if (inWord) words.push(word);
    word = "";
    inWord = false;
  };
  const endSeg = () => {
    endWord();
    if (words.length) segs.push(words);
    words = [];
  };
  const s = stripHeredocs(cmd);
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === "\\" && quote === '"' && !powershell && '$`"\\'.includes(s[i + 1] ?? "")) word += s[++i];
      else word += c;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      inWord = true;
      continue;
    }
    if (c === "\\" && !powershell && i + 1 < s.length && s[i + 1] !== "\n") {
      word += s[++i];
      inWord = true;
      continue;
    }
    if (c === "&" || c === "|" || c === ";" || c === "\n" || c === "(" || c === ")") {
      endSeg();
      continue;
    }
    if (c === " " || c === "\t" || c === "\r") {
      endWord();
      continue;
    }
    word += c;
    inWord = true;
  }
  endSeg();
  return segs;
}

/** A Git Bash path (/c/Users/...) as Node on Windows reads it. */
function nativePath(p, platform) {
  if (platform === "win32") {
    const m = /^\/([a-zA-Z])(\/.*)?$/.exec(p);
    if (m) return `${m[1].toUpperCase()}:${m[2] ?? "/"}`;
  }
  return p;
}

/** The gh command words of a segment (after any FOO=bar prefix), or null when it is not a gh call. */
function ghCall(words) {
  let i = 0;
  while (i < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i])) i++; // GH_TOKEN=x gh ...
  if (i >= words.length || !/(^|[\\/])gh(\.exe)?$/i.test(words[i])) return null;
  return words.slice(i + 1);
}

/** The git subcommand of a segment, its arguments, and any -C directory. */
function gitCall(words) {
  let i = 0;
  while (i < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i])) i++; // FOO=bar git ...
  if (i >= words.length || !/(^|[\\/])git(\.exe)?$/i.test(words[i])) return null;
  i++;
  let dir = null;
  while (i < words.length && words[i].startsWith("-")) {
    if (words[i] === "-C") dir = words[++i];
    else if (words[i] === "-c") i++;
    i++;
  }
  if (i >= words.length) return null;
  return { sub: words[i], args: words.slice(i + 1), dir };
}

// ---------------------------------------------------------------- the rules

function refuse(reason) {
  return { block: true, reason };
}

const NOT_ON_DESKTOP =
  "Builds, dev servers, Playwright and browsers do not run on Ajay's desktop (his ruling). " +
  "Push a round branch and let CI run it, or run it in a cloud session.";

const NO_CI_WAIT =
  "Agent standard (a), .claude/agents/STANDARDS.md: never wait on CI and never poll GitHub — no `gh run watch`, no " +
  "`gh pr checks --watch`, no loops around gh. Every agent shares one GitHub API budget (5,000 an hour). Push, hand back, " +
  "and let the main session read CI centrally (.qa/reader.txt in the main checkout); read branches with git, not gh.";

const MAIN_SESSION_FILE = path.join(".claude", "main-session");

/**
 * Merges and round pushes belong to the main session (process ledger row 17: on 14 Nov a separate session read
 * the handover and merged #1132 with no QA GO line). The main session writes its session id into the untracked
 * `.claude/main-session` of the main checkout when it starts; the hook compares the calling session's id with it.
 * A subagent carries its parent's session id, so a call made inside one (agent_id set) is refused as well.
 */
export function mainSessionRefusal(what, dir, who = {}) {
  const rule = `Main-session rule (process ledger row 17): ${what} is the main session's job alone — it merges and pushes rounds with a QA GO line.`;
  if (who.agentId) {
    return refuse(`${rule} This command came from a subagent (${who.agentType || "agent"}). Push your claude/* branch, hand back, and the main session takes it from there.`);
  }
  const root = mainCheckout(dir) ?? mainCheckout(path.dirname(fileURLToPath(import.meta.url)));
  const file = path.join(root ?? dir, MAIN_SESSION_FILE);
  if (!existsSync(file)) {
    return refuse(
      `${rule} ${file} is missing, so the hook cannot tell which session is the main one and refuses rather than guess. ` +
        "The main session writes its own session id there (one line, untracked) when it starts.",
    );
  }
  const id = readFileSync(file, "utf8").trim();
  if (!id || !who.sessionId || who.sessionId !== id) {
    return refuse(`${rule} This session (${who.sessionId || "no session id"}) is not the one named in ${file}. Hand the step to the main session.`);
  }
  return null;
}

/** What a segment does that only the main session may do, or null. */
function mainSessionOnly(words, gh, git) {
  if (gh) {
    const plain = gh.filter((a) => !a.startsWith("-"));
    if (plain[0] === "pr" && plain[1] === "merge") return "`gh pr merge`";
    if (plain[0] === "api" && gh.some((a) => /(^|\/)pulls\/\d+\/merge$/.test(a))) {
      const put = gh.some((a, i) => /^(-X|--method)=?PUT$/i.test(a) || (/^(-X|--method)$/.test(a) && /^PUT$/i.test(gh[i + 1] ?? "")));
      if (put) return "merging a pull request through the API";
    }
  }
  if (git?.sub === "push") {
    const plain = git.args.filter((a) => !a.startsWith("-"));
    if (plain.slice(1).some((a) => /^\+?(?:[^:]*:)?(?:refs\/heads\/)?round\//.test(a))) return "a push to `round/*`";
  }
  if (words.some((w) => /(^|[\\/])(merge|chain)\.sh$/i.test(w))) return "running merge.sh or chain.sh";
  return null;
}

/** The main checkout's folder, from any worktree of it; null when dir is not in a repository. */
function mainCheckout(dir) {
  try {
    const common = git(dir, ["rev-parse", "--path-format=absolute", "--git-common-dir"]).trim();
    return path.dirname(common);
  } catch {
    return null;
  }
}

function readSchema(root) {
  const file = path.join(root, "prisma", "schema.prisma");
  return existsSync(file) ? readFileSync(file, "utf8").replace(/\r\n/g, "\n") : null;
}

/**
 * Every worktree reaches the main checkout's node_modules (.claude/settings.json), so there is ONE generated
 * Prisma client. `prisma generate` from a branch whose schema differs from main's replaces it for every other
 * worktree: their tsc and audit tests then fail with "The column ... does not exist" (6-7 Nov, three engineers).
 */
export function sharedClientRefusal(dir, env = process.env) {
  if (env.PRISMA_SHARED_CLIENT_OK === "1") return null;
  const main = mainCheckout(dir);
  if (!main) return null;
  let top;
  try {
    top = git(dir, ["rev-parse", "--show-toplevel"]).trim();
  } catch {
    return null;
  }
  if (path.resolve(top) === path.resolve(main)) return null; // regenerating from main itself is the repair
  const mine = readSchema(top);
  const theirs = readSchema(main);
  if (mine === null || theirs === null || mine === theirs) return null;
  return refuse(
    "Shared Prisma client: this worktree's prisma/schema.prisma differs from the main checkout's, and every worktree shares " +
      "the main checkout's node_modules, so `prisma generate` here would replace the client under every other engineer " +
      '(their tsc and audit tests fail with "The column ... does not exist"). Do not generate from a branch with a schema change. ' +
      "Run `node scripts/prisma-client-check.mjs` (read-only) to see whose schema the shared client holds, say in your report that " +
      "the client is stale, and leave regenerating to the main session after merge. If you are sure nobody else is mid-run, repeat " +
      "the command with PRISMA_SHARED_CLIENT_OK=1 in front of it. Long form: docs/claude/migrations.md.",
  );
}

function checkSegment(words, platform, dir, who = {}) {
  // A word holding spaces came from quotes (a message, a title): text, not part of the command.
  const joined = words.map((w) => (/\s/.test(w) ? "_" : w)).join(" ");
  const git = gitCall(words);

  const gh = ghCall(words);
  if (gh) {
    const plain = gh.filter((a) => !a.startsWith("-"));
    const watchesRun = plain[0] === "run" && plain[1] === "watch";
    const watchesChecks = plain[0] === "pr" && plain[1] === "checks" && gh.some((a) => /^--watch(=|$)/.test(a));
    if (watchesRun || watchesChecks) return refuse(NO_CI_WAIT);
  }
  if (git?.sub === "stash") {
    return refuse("Hard rule 5: never `git stash` — the working tree and its stash are shared with other sessions. Commit to a WIP branch instead.");
  }
  if (git?.sub === "add") {
    const bad = git.args.find((a) => a === "." || a === ":/" || a === "*" || a === "--all" || a === "--no-ignore-removal" || /^-[a-zA-Z]*A/.test(a));
    if (bad) return refuse(`Hard rule 4: commit with explicit paths — \`git add ${bad}\` can sweep an untracked scratch file with real data into a public repository. Name each file.`);
  }
  if (git?.sub === "push") {
    const plain = git.args.filter((a) => !a.startsWith("-"));
    if (git.args.some((a) => a === "--all" || a === "--mirror")) {
      return refuse("Hard rule 3: `git push --all/--mirror` would push main, which deploys to production. Push the one branch you mean.");
    }
    if (plain.slice(1).some((a) => /^\+?(?:[^:]*:)?(?:refs\/heads\/)?main$/.test(a))) {
      return refuse("Hard rule 3: main auto-deploys to production and reaches it only through a pull request and the gate. Push your branch and open a PR.");
    }
  }
  const onlyMain = mainSessionOnly(words, gh, git);
  if (onlyMain) {
    const at = git?.dir ? path.resolve(dir, nativePath(git.dir, platform)) : dir;
    const hit = mainSessionRefusal(onlyMain, at, who);
    if (hit) return hit;
  }
  if (/\bprisma (migrate reset|db push\b.*--(force-reset|accept-data-loss))/.test(joined) || /\bnpm (run )?db:reset\b/.test(joined)) {
    return refuse("Hard rule 6: never drop or reset the development database. If Prisma asks for a reset, fix the drift by hand (docs/claude/migrations.md).");
  }
  if (dir && (/\bprisma generate\b/.test(joined) || /\bnpm (run )?db:generate\b/.test(joined))) {
    const env = { ...process.env };
    for (const w of words) {
      const m = /^PRISMA_SHARED_CLIENT_OK=(.*)$/.exec(w);
      if (m) env.PRISMA_SHARED_CLIENT_OK = m[1];
      else if (!/^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) break;
    }
    const hit = sharedClientRefusal(dir, env);
    if (hit) return hit;
  }
  if (platform === "win32") {
    if (/\bplaywright (test|install|codegen|open|show-report|ui)\b/.test(joined)) return refuse(NOT_ON_DESKTOP);
    if (/\bnext (dev|start|build)\b/.test(joined)) return refuse(NOT_ON_DESKTOP);
    if (/\bnpm (run )?(dev|build|start|test:e2e(:ui)?|smoke:all|electron:\w+)\b/.test(joined)) return refuse(NOT_ON_DESKTOP);
  }
  return null;
}

const POWERSHELL_WRITE = /\b(Set-Content|Add-Content|Out-File)\b|\[(System\.)?IO\.File\]::(Write|Append)/i;
const POWERSHELL_REDIRECT = /(^|[^-=])>>?\s*["']?[^\s"'|;]+\.(ts|tsx|js|jsx|mjs|cjs|json|md|css|prisma|sql|ya?ml|html)\b/i;

function checkPowerShell(cmd) {
  if ((POWERSHELL_WRITE.test(cmd) && SOURCE_FILE.test(cmd)) || POWERSHELL_REDIRECT.test(cmd)) {
    return refuse("Never rewrite a source file with PowerShell: it adds a BOM and turns every em-dash and curly quote into mojibake, invisibly (CLAUDE.md, Shell). Use the Edit or Write tool.");
  }
  return null;
}

// ---------------------------------------------------------------- the commit scan

function git(dir, args) {
  const r = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed in ${dir}: ${(r.stderr || "").trim()}`);
  return r.stdout;
}

/** Lines a diff adds, with the file each belongs to. */
function addedLines(diff) {
  const out = [];
  let file = null;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) file = line.slice(4).replace(/^b\//, "");
    else if (line.startsWith("+") && file && file !== "/dev/null") out.push({ file, text: line.slice(1) });
  }
  return out;
}

/** Everything the commit would carry: what is staged, plus what a `git add` earlier in the same command will stage. */
function commitContent(dir, addPaths, includeWorking) {
  const lines = addedLines(git(dir, ["diff", "--cached", "-U0", "--no-color", "--no-ext-diff"]));
  if (includeWorking) lines.push(...addedLines(git(dir, ["diff", "-U0", "--no-color", "--no-ext-diff"])));
  for (const p of addPaths) {
    lines.push(...addedLines(git(dir, ["diff", "HEAD", "-U0", "--no-color", "--no-ext-diff", "--", p])));
    for (const f of git(dir, ["ls-files", "--others", "--exclude-standard", "-z", "--", p]).split("\0").filter(Boolean)) {
      const abs = path.join(dir, f);
      if (!existsSync(abs) || statSync(abs).size > 4 * 1024 * 1024) continue;
      const text = readFileSync(abs, "utf8");
      if (text.includes("\0")) continue;
      for (const t of text.split("\n")) lines.push({ file: f, text: t });
    }
  }
  return lines;
}

const EMAIL = /[A-Za-z0-9._%+-]+@((?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,})/g;
const PHONE = /\+\d[\d ().-]{7,}\d|\(\d{3}\)\s?\d{3}[-.\s]\d{4}|\b\d{3}[-.]\d{3}[-.]\d{4}\b|\b0\d{2,4}[ .]\d{3,4}[ .]\d{3,4}\b/g;

function mask(s) {
  return s.length <= 3 ? "***" : `${s.slice(0, 2)}***${s.slice(-1)}`;
}

/** Real-looking personal data in added lines: emails off the allowed domains, phones outside the fictional ranges. */
export function findPersonalData(lines) {
  const found = [];
  for (const { file, text } of lines) {
    if (UNSCANNED_FILE.test(file)) continue;
    for (const m of text.matchAll(EMAIL)) {
      const domain = m[1];
      if (/\.(png|jpe?g|gif|svg|webp)$/i.test(domain) || ALLOWED_EMAIL_DOMAIN.test(domain)) continue;
      found.push(`${file}: email ${mask(m[0])}`);
    }
    for (const m of text.matchAll(PHONE)) {
      const digits = m[0].replace(/\D/g, "");
      if (digits.length < 9 || digits.length > 15) continue;
      if (FICTIONAL_PHONE_DIGITS.some((d) => digits.includes(d))) continue;
      found.push(`${file}: phone ${mask(m[0])}`);
    }
  }
  return found;
}

function checkCommit(dir, addPaths, args) {
  if (args.includes("--dry-run")) return null;
  const includeWorking = args.some((a) => a === "--all" || /^-[a-zA-Z]*a[a-zA-Z]*$/.test(a));
  let found;
  let paths;
  try {
    const content = commitContent(dir, addPaths, includeWorking);
    found = findPersonalData(content);
    paths = findLocalPaths(content);
  } catch (e) {
    return refuse(`The privacy check could not read what this commit carries, so it is refused rather than waved through (${e.message}). Run the commit with \`git -C <dir>\` or from the repository's folder.`);
  }
  if (!found.length && paths.length) {
    const list = [...new Set(paths)].slice(0, 10).map((f) => `  - ${f}`).join("\n");
    return refuse(
      "Hard rule 2: the repository is public, and this commit carries a local absolute path that names the Windows user " +
        `(C:\\Users\\<you>, /c/Users/<you> or a profile's AppData folder; ledger row 10):\n${list}\n` +
        "Write paths relative to the repository, or a placeholder such as `<main checkout>` or `C:\\Users\\<you>`. " +
        "src/lib/__tests__/no-local-paths-in-the-repository.test.ts sweeps every tracked file for the same.",
    );
  }
  if (!found.length) return null;
  const list = found.slice(0, 10).map((f) => `  - ${f}`).join("\n");
  const more = found.length > 10 ? `\n  …and ${found.length - 10} more` : "";
  return refuse(
    "Hard rule 2: the repository is public, and this commit carries what looks like a real person's contact details:\n" +
      `${list}${more}\n` +
      "Use invented ones: an @example.invalid address, and a phone number in a fictional range (+1 555 01xx, +44 7700 900xxx). " +
      "If an address is a business's own and must ship, add its domain to ALLOWED_EMAIL_DOMAIN in .claude/hooks/guard.mjs, in the same commit.",
  );
}

// ---------------------------------------------------------------- the verdict

/** Decide on one hook input. Returns { block, reason } or null. */
export function verdict(input, platform = process.platform) {
  const cmd = input?.tool_input?.command;
  if (typeof cmd !== "string" || !cmd.trim()) return null;
  if (input.tool_name === "PowerShell") {
    const ps = checkPowerShell(cmd);
    if (ps) return ps;
  }
  let dir = input.cwd || process.cwd();
  const who = { sessionId: input.session_id, agentId: input.agent_id, agentType: input.agent_type };
  const addPaths = [];
  for (const words of segments(cmd, input.tool_name === "PowerShell")) {
    if (words[0] === "cd" && words[1]) {
      const target = nativePath(words[1], platform);
      dir = path.resolve(dir, target);
      continue;
    }
    if (words[0] === "Set-Location" && words[1]) {
      dir = path.resolve(dir, words[1]);
      continue;
    }
    const hit = checkSegment(words, platform, dir, who);
    if (hit) return hit;
    const call = gitCall(words);
    if (!call) continue;
    const at = call.dir ? path.resolve(dir, nativePath(call.dir, platform)) : dir;
    if (call.sub === "add") addPaths.push(...call.args.filter((a) => !a.startsWith("-")).map((a) => path.resolve(at, nativePath(a, platform))));
    if (call.sub === "commit") {
      const hitCommit = checkCommit(at, addPaths.map((p) => path.relative(at, p) || "."), call.args);
      if (hitCommit) return hitCommit;
    }
  }
  return null;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let raw = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (d) => (raw += d));
  process.stdin.on("end", () => {
    let input;
    try {
      input = JSON.parse(raw);
    } catch {
      process.exit(0); // not a tool call we understand; nothing to guard
    }
    const v = verdict(input, process.env.CLAUDE_GUARD_PLATFORM || process.platform);
    if (v?.block) {
      process.stderr.write(`${v.reason}\n`);
      process.exit(2);
    }
    process.exit(0);
  });
}
