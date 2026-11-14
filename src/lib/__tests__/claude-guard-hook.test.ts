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

function run(command: string, opts: { cwd?: string; tool?: string; platform?: string } = {}) {
  const input = JSON.stringify({
    hook_event_name: "PreToolUse",
    tool_name: opts.tool ?? "Bash",
    tool_input: { command },
    cwd: opts.cwd ?? process.cwd(),
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
    "git push origin HEAD:round/state-machine-3-2",
    "git push -u origin claude/guard-hooks",
    "npx prisma migrate deploy",
    "npx prisma migrate dev --create-only --name x",
    "npx vitest run src/lib/__tests__/x.test.ts",
    "npx tsc --noEmit",
    // the rules quoted inside text are text, not commands
    'git commit --dry-run -m "Never git stash; never git add -A; never prisma migrate reset"',
    "cat <<'EOF' > /dev/null\ngit stash\ngit push origin main\nEOF",
    'gh pr merge 1008 --squash --match-head-commit abc',
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
