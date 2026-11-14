// The hook in .claude/hooks/guard.mjs holds CLAUDE.md's hard rules before a command
// runs. These tests run it the way Claude Code does — JSON on stdin, exit code 2 to
// refuse — so a change that breaks the contract (wrong exit code, a crash that exits 1
// and lets everything through) fails here, not silently in a session.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const GUARD = path.join(process.cwd(), ".claude", "hooks", "guard.mjs");

function run(
  command: string,
  opts: { cwd?: string; tool?: string; platform?: string; sessionId?: string; agentId?: string } = {},
) {
  const input = JSON.stringify({
    hook_event_name: "PreToolUse",
    tool_name: opts.tool ?? "Bash",
    tool_input: { command },
    cwd: opts.cwd ?? process.cwd(),
    ...(opts.sessionId ? { session_id: opts.sessionId } : {}),
    ...(opts.agentId ? { agent_id: opts.agentId, agent_type: "tourneyhq-engineer" } : {}),
  });
  const r = spawnSync(process.execPath, [GUARD], {
    input,
    encoding: "utf8",
    env: { ...process.env, CLAUDE_GUARD_PLATFORM: opts.platform ?? "linux" },
  });
  return { code: r.status, stderr: r.stderr };
}

describe("the hard-rule guard refuses", () => {
  it.each([
    ["git add -A", "Hard rule 4"],
    ["git add --all", "Hard rule 4"],
    ["cd /tmp && git add . && git commit -m wip", "Hard rule 4"],
    ["git stash", "Hard rule 5"],
    ["git stash push -u -m mine", "Hard rule 5"],
    ["npx prisma migrate reset --force", "Hard rule 6"],
    ["npx prisma db push --force-reset", "Hard rule 6"],
    ["npx prisma db push --accept-data-loss", "Hard rule 6"],
    ["npm run db:reset", "Hard rule 6"],
    ["git push origin main", "Hard rule 3"],
    ["git push origin HEAD:main", "Hard rule 3"],
    ["git push -f origin claude/x:refs/heads/main", "Hard rule 3"],
    ["git push --all origin", "Hard rule 3"],
  ])("%s", (command, rule) => {
    const r = run(command);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain(rule);
  });

  it.each(["npx playwright test", "npm run dev", "npx next build", "npm run smoke:all", "npm run test:e2e"])(
    "%s on Windows, and lets it through elsewhere",
    (command) => {
      expect(run(command, { platform: "win32" }).code).toBe(2);
      expect(run(command, { platform: "linux" }).code).toBe(0);
    },
  );

  it("PowerShell writing a source file", () => {
    for (const command of [
      'Set-Content -Path src/lib/a.ts -Value $x -Encoding utf8',
      '"x" | Out-File docs/notes.md',
      'Get-Content a.txt > src/app/page.tsx',
    ]) {
      const r = run(command, { tool: "PowerShell" });
      expect(r.code, command).toBe(2);
      expect(r.stderr).toContain("PowerShell");
    }
  });
});

describe("waiting on CI (agent standard a: the GitHub API budget is shared)", () => {
  it.each([
    "gh run watch",
    "gh run watch 123456789 --exit-status",
    "gh pr checks 1127 --watch",
    "gh pr checks --watch --fail-fast",
    "gh pr checks 1127 --watch=true",
    "git push -u origin claude/x && gh pr checks --watch",
    "GH_TOKEN=x gh run watch 1",
  ])("is refused in Bash and PowerShell: %s", (command) => {
    for (const tool of ["Bash", "PowerShell"]) {
      const r = run(command, { tool });
      expect(r.code, `${tool}: ${command}`).toBe(2);
      expect(r.stderr).toContain("standard (a)");
      expect(r.stderr).toContain("STANDARDS.md");
    }
  });

  it.each([
    "gh run view 123456789 --log-failed",
    "gh api repos/o/r/commits/abc/check-runs",
    "gh pr checks 1127",
    "gh pr view 1127 --json headRefOid",
    // quoted or heredoc text is text, never a command
    'git commit --dry-run -m "Never gh run watch; never gh pr checks --watch"',
    "cat <<'EOF' > /dev/null\ngh run watch 1\ngh pr checks 2 --watch\nEOF",
    "echo 'gh run watch'",
  ])("lets through in Bash and PowerShell: %s", (command) => {
    for (const tool of ["Bash", "PowerShell"]) {
      const r = run(command, { tool });
      expect(r.stderr, `${tool}: ${command}`).toBe("");
      expect(r.code).toBe(0);
    }
  });
});

describe("the hard-rule guard lets through", () => {
  it.each([
    "git add src/lib/a.ts docs/b.md",
    "git add -u",
    "git status && git log --oneline -3",
    "git push -u origin claude/guard-hooks",
    "git push origin HEAD:refs/heads/claude/round-notes",
    "npx prisma migrate dev --create-only --name x",
    "npx vitest run src/lib/__tests__/x.test.ts",
    "npx tsc --noEmit",
    // the rules quoted inside text are text, not commands
    'git commit --dry-run -m "Never git stash; never git add -A; never prisma migrate reset"',
    "cat <<'EOF' > /dev/null\ngit stash\ngit push origin main\nEOF",
    'gh pr view 1008 --json state,mergeCommit',
  ])("%s", (command) => {
    const r = run(command);
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
  });

  it("PowerShell reading, or writing outside the source", () => {
    expect(run("Get-Content src/lib/a.ts | Select-String foo", { tool: "PowerShell" }).code).toBe(0);
    expect(run('Set-Content -Path $env:TEMP\\out.log -Value "x"', { tool: "PowerShell" }).code).toBe(0);
  });
});

describe("a commit carrying contact details", () => {
  let repo: string;
  const g = (...args: string[]) => {
    const r = spawnSync("git", ["-C", repo, "-c", "user.name=zz-guard", "-c", "user.email=zz-guard@example.invalid", ...args], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(r.stderr);
  };
  // Built at run time so this file itself never holds a real-looking address or number.
  const realEmail = ["pat.member", "gmail.com"].join("@");
  const realPhone = ["+1 312", "000", "1234"].join(" ");

  beforeAll(() => {
    repo = mkdtempSync(path.join(tmpdir(), "zz-guard-"));
    g("init", "-q");
    writeFileSync(path.join(repo, "seed.txt"), "zz\n");
    g("add", "seed.txt");
    g("commit", "-q", "-m", "seed");
  });
  afterAll(() => rmSync(repo, { recursive: true, force: true }));

  it("is refused when it is staged, and the value is not echoed whole", () => {
    writeFileSync(path.join(repo, "staged.ts"), `export const who = "${realEmail}";\n`);
    g("add", "staged.ts");
    const r = run("git commit -m x", { cwd: repo });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("Hard rule 2");
    expect(r.stderr).toContain("staged.ts: email");
    expect(r.stderr).not.toContain(realEmail);
    g("rm", "-q", "--cached", "staged.ts");
  });

  it("is refused when a git add in the same command will stage it", () => {
    writeFileSync(path.join(repo, "later.ts"), `const phone = "${realPhone}";\n`);
    const r = run(`cd "${repo}" && git add later.ts && git commit -m x`, { cwd: tmpdir() });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("later.ts: phone");
  });

  it("is let through with invented details", () => {
    writeFileSync(path.join(repo, "fine.ts"), 'const a = "zz-pat@example.invalid"; const b = "+1 202 555 0171"; const c = "+44 7700 900123";\n');
    const r = run("git add fine.ts && git commit -m x", { cwd: repo });
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
  });

  it("is refused, not waved through, when the check cannot read the repository", () => {
    const r = run("git commit -m x", { cwd: path.join(tmpdir(), "zz-guard-no-such-dir") });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("could not read");
  });
});

describe("a commit carrying a local absolute path (ledger row 10)", () => {
  let repo: string;
  const g = (...args: string[]) => {
    const r = spawnSync("git", ["-C", repo, "-c", "user.name=zz-guard", "-c", "user.email=zz-guard@example.invalid", ...args], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(r.stderr);
  };
  // Built at run time so this file itself never holds one.
  const winPath = ["C:", "Users", "zzperson", "repo", "x.ts"].join(String.fromCharCode(92));
  const bashPath = ["", "c", "Users", "zzperson", "repo"].join("/");

  beforeAll(() => {
    repo = mkdtempSync(path.join(tmpdir(), "zz-guard-paths-"));
    g("init", "-q");
    writeFileSync(path.join(repo, "seed.txt"), "zz\n");
    g("add", "seed.txt");
    g("commit", "-q", "-m", "seed");
  });
  afterAll(() => rmSync(repo, { recursive: true, force: true }));

  it.each([
    ["win.md", `Open ${winPath} first.\n`],
    ["bash.md", `cd "${bashPath}"\n`],
    ["json.json", `{ "p": ${JSON.stringify(winPath)} }\n`],
  ])("is refused, naming the file and the rule: %s", (file, text) => {
    writeFileSync(path.join(repo, file), text);
    const r = run(`git add ${file} && git commit -m x`, { cwd: repo });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("Hard rule 2");
    expect(r.stderr).toContain(`${file}: local path`);
    expect(r.stderr).not.toContain("zzperson");
    g("rm", "-q", "--cached", "--ignore-unmatch", file);
    rmSync(path.join(repo, file));
  });

  it("is let through with a placeholder or prose", () => {
    writeFileSync(path.join(repo, "fine.md"), "A Git Bash path (/c/Users/...); `%APPDATA%/TourneyHQ`; <main checkout>/node_modules\n");
    const r = run("git add fine.md && git commit -m x", { cwd: repo });
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
  });
});

describe("only the main session merges or pushes a round (ledger row 17)", () => {
  let main: string;
  let tree: string;
  let bare: string;
  const MAIN_ID = "zz-main-session-0001";
  const g = (dir: string, ...args: string[]) => {
    const r = spawnSync("git", ["-C", dir, "-c", "user.name=zz-guard", "-c", "user.email=zz-guard@example.invalid", ...args], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(r.stderr);
  };
  const ONLY_MAIN = [
    "gh pr merge 1008 --squash --match-head-commit abc",
    "GH_TOKEN=x gh pr merge 1008 --squash",
    "gh api -X PUT repos/o/r/pulls/1008/merge",
    "gh api --method PUT repos/o/r/pulls/1008/merge -f merge_method=squash",
    "git push origin HEAD:round/state-machine-3-2",
    "git push origin abc123:refs/heads/round/guest-train-1",
    "git push -f origin +HEAD:round/x-2",
    "git push origin --delete round/x-1",
    "bash ~/notes/merge.sh 1008",
    "bash ./chain.sh guest-train",
    "git status && gh pr merge 1008 --squash",
    // wrappers, a shell handed a script, and the repository flag before the subcommand (PE review 1127b)
    "env GH_TOKEN=x gh pr merge 1",
    "env -i gh pr merge 1",
    "command gh pr merge 1",
    "time gh pr merge 1",
    "time git push origin HEAD:round/x-3",
    'bash -c "git push origin HEAD:round/x"',
    "sh -c 'gh pr merge 1'",
    "bash -lc 'git status && gh pr merge 1'",
    "gh pr -R o/r merge 1",
    "gh pr --repo o/r merge 1",
    "sh ~/notes/merge.sh 1008",
    "source ~/notes/chain.sh",
    "./chain.sh x",
  ];

  beforeAll(() => {
    main = mkdtempSync(path.join(tmpdir(), "zz-guard-mainsession-"));
    tree = `${main}-tree`;
    bare = mkdtempSync(path.join(tmpdir(), "zz-guard-nofile-"));
    g(main, "init", "-q");
    writeFileSync(path.join(main, "seed.txt"), "zz\n");
    g(main, "add", "seed.txt");
    g(main, "commit", "-q", "-m", "seed");
    g(main, "worktree", "add", "-q", "-b", "zz-branch", tree);
    mkdirSync(path.join(main, ".claude"));
    writeFileSync(path.join(main, ".claude", "main-session"), `${MAIN_ID}\n`);
    g(bare, "init", "-q");
  });
  afterAll(() => {
    rmSync(tree, { recursive: true, force: true });
    rmSync(main, { recursive: true, force: true });
    rmSync(bare, { recursive: true, force: true });
  });

  it.each(ONLY_MAIN)("lets the main session through, from the main checkout and from a worktree: %s", (command) => {
    for (const cwd of [main, tree]) {
      const r = run(command, { cwd, sessionId: MAIN_ID });
      expect(r.stderr, `${cwd}: ${command}`).toBe("");
      expect(r.code).toBe(0);
    }
  });

  it.each(ONLY_MAIN)("refuses another session, naming the rule: %s", (command) => {
    for (const tool of ["Bash", "PowerShell"]) {
      const r = run(command, { cwd: tree, tool, sessionId: "zz-other-session" });
      expect(r.code, `${tool}: ${command}`).toBe(2);
      expect(r.stderr).toContain("Main-session rule");
      expect(r.stderr).toContain("ledger row 17");
    }
  });

  it("tells the refused session how the file is claimed, and never to rewrite it to get past", () => {
    const r = run(ONLY_MAIN[0], { cwd: tree, sessionId: "zz-other-session" });
    expect(r.stderr).toContain("Never rewrite .claude/main-session to get past this");
    expect(r.stderr).toContain("How it is claimed");
    expect(r.stderr).toContain("<session-id>/scratchpad");
  });

  it("reads an id file written with a BOM and CRLF, or as UTF-16 by PowerShell", () => {
    const file = path.join(main, ".claude", "main-session");
    try {
      for (const bytes of [
        Buffer.from(`﻿${MAIN_ID}\r\n`, "utf8"),
        Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(`${MAIN_ID}\r\n`, "utf16le")]),
      ]) {
        writeFileSync(file, bytes);
        const r = run(ONLY_MAIN[0], { cwd: tree, sessionId: MAIN_ID });
        expect(r.stderr).toBe("");
        expect(r.code).toBe(0);
      }
    } finally {
      writeFileSync(file, `${MAIN_ID}\n`);
    }
  });

  it("refuses a call with no session id at all", () => {
    const r = run(ONLY_MAIN[0], { cwd: main });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("Main-session rule");
  });

  it("refuses a subagent even though it carries the main session's id", () => {
    const r = run(ONLY_MAIN[4], { cwd: tree, sessionId: MAIN_ID, agentId: "zz-agent-1" });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("subagent");
  });

  it("refuses, saying so, when .claude/main-session is missing", () => {
    const r = run(ONLY_MAIN[0], { cwd: bare, sessionId: MAIN_ID });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("main-session is missing");
  });

  it("reads git -C as the repository the push runs in", () => {
    expect(run(`git -C "${tree}" push origin HEAD:round/x-1`, { cwd: bare, sessionId: MAIN_ID }).code).toBe(0);
    expect(run(`git -C "${tree}" push origin HEAD:round/x-1`, { cwd: bare, sessionId: "zz-other" }).code).toBe(2);
  });

  it.each([
    "git push -u origin claude/x",
    "git push origin HEAD:breaks/state-machine-1",
    "gh pr view 1008 --json state",
    "gh api repos/o/r/pulls/1008/merge",
    "gh pr create --draft --title x --body y",
    'git commit --dry-run -m "never gh pr merge from here; never push round/x"',
    "cat merge.sh.md",
    // a script's NAME in text or as an argument is not running it (PE review 1127b)
    'git commit --dry-run -m "see notes/chain.sh"',
    'gh pr create --draft --title x --body "runs ~/notes/merge.sh"',
    "cat ~/notes/merge.sh",
    "grep -n round ~/notes/chain.sh",
    // a local round/* pushed to a claude/* destination is not a round
    "git push origin round/x:claude/x",
    "gh pr -R o/r view 1",
    "env GH_TOKEN=x gh pr view 1",
    "bash -c 'git status'",
  ])("leaves every other session's ordinary work alone: %s", (command) => {
    const r = run(command, { cwd: tree, sessionId: "zz-other-session" });
    expect(r.stderr, command).toBe("");
    expect(r.code).toBe(0);
  });
});

describe("migrations reach the shared development database only from the main checkout", () => {
  let main: string;
  let tree: string;
  let outside: string;
  const g = (dir: string, ...args: string[]) => {
    const r = spawnSync("git", ["-C", dir, "-c", "user.name=zz-guard", "-c", "user.email=zz-guard@example.invalid", ...args], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(r.stderr);
  };
  const APPLIES = [
    "npx prisma migrate deploy",
    "npx prisma migrate dev",
    "npx prisma migrate dev --name a046_x",
    "npx prisma migrate resolve --applied A045_x",
    "npx prisma db push",
    "npm run db:push",
    "env DATABASE_URL=x npx prisma migrate deploy",
    "bash -c 'npx prisma migrate deploy'",
  ];

  beforeAll(() => {
    main = mkdtempSync(path.join(tmpdir(), "zz-guard-db-"));
    tree = `${main}-tree`;
    outside = mkdtempSync(path.join(tmpdir(), "zz-guard-db-out-"));
    g(main, "init", "-q");
    writeFileSync(path.join(main, "seed.txt"), "zz\n");
    g(main, "add", "seed.txt");
    g(main, "commit", "-q", "-m", "seed");
    g(main, "worktree", "add", "-q", "-b", "zz-db-branch", tree);
  });
  afterAll(() => {
    rmSync(tree, { recursive: true, force: true });
    rmSync(main, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it.each(APPLIES)("refuses from a worktree, naming the rule, in Bash and PowerShell: %s", (command) => {
    for (const tool of ["Bash", "PowerShell"]) {
      const r = run(command, { cwd: tree, tool });
      expect(r.code, `${tool}: ${command}`).toBe(2);
      expect(r.stderr).toContain("Shared development database rule");
      expect(r.stderr).toContain("only after it merges");
    }
  });

  it("refuses from outside any repository", () => {
    const r = run("npx prisma migrate deploy", { cwd: outside });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("outside the repository");
  });

  it.each(APPLIES)("lets the main checkout apply them: %s", (command) => {
    const r = run(command, { cwd: main });
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
  });

  it("reads `cd` into a worktree from the main checkout", () => {
    expect(run(`cd "${tree}" && npx prisma migrate deploy`, { cwd: main }).code).toBe(2);
  });

  it.each([
    "npx prisma migrate dev --create-only",
    "npx prisma migrate dev --create-only --name a046_x",
    "npx prisma migrate dev --name a046_x --create-only",
    "npx prisma generate",
    "npx prisma migrate status",
    "npx prisma validate",
    'git commit --dry-run -m "never prisma migrate deploy or prisma db push from a worktree"',
    "cat <<'EOF' > /dev/null\nnpx prisma migrate deploy\nEOF",
    "echo 'npx prisma db push'",
  ])("leaves a worktree's ordinary work alone: %s", (command) => {
    const r = run(command, { cwd: tree });
    expect(r.stderr, command).toBe("");
    expect(r.code).toBe(0);
  });
});

describe("prisma generate in a worktree (one shared client)", () => {
  let main: string;
  let tree: string;
  const g = (dir: string, ...args: string[]) => {
    const r = spawnSync("git", ["-C", dir, "-c", "user.name=zz-guard", "-c", "user.email=zz-guard@example.invalid", ...args], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(r.stderr);
  };

  beforeAll(() => {
    main = mkdtempSync(path.join(tmpdir(), "zz-guard-main-"));
    tree = `${main}-tree`;
    g(main, "init", "-q");
    mkdirSync(path.join(main, "prisma"));
    writeFileSync(path.join(main, "prisma", "schema.prisma"), "model A {\n  id Int @id\n}\n");
    g(main, "add", "prisma/schema.prisma");
    g(main, "commit", "-q", "-m", "seed");
    g(main, "worktree", "add", "-q", "-b", "zz-branch", tree);
  });
  afterAll(() => {
    rmSync(tree, { recursive: true, force: true });
    rmSync(main, { recursive: true, force: true });
  });

  it("is let through while the schema matches main's", () => {
    expect(run("npx prisma generate", { cwd: tree }).code).toBe(0);
  });

  it("is refused once the worktree's schema differs, in every spelling", () => {
    writeFileSync(path.join(tree, "prisma", "schema.prisma"), "model A {\n  id Int @id\n  extra Int?\n}\n");
    for (const command of ["npx prisma generate", "npm run db:generate", "cd . && npx prisma generate --no-hints"]) {
      const r = run(command, { cwd: tree });
      expect(r.code, command).toBe(2);
      expect(r.stderr).toContain("Shared Prisma client");
    }
  });

  it("is let through from the main checkout itself, and with the flag", () => {
    expect(run("npx prisma generate", { cwd: main }).code).toBe(0);
    expect(run("PRISMA_SHARED_CLIENT_OK=1 npx prisma generate", { cwd: tree }).code).toBe(0);
  });

  it("does not read other prisma commands as a generate", () => {
    expect(run("npx prisma validate", { cwd: tree }).code).toBe(0);
  });
});
