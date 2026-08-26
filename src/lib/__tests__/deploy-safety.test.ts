import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A pull request must not migrate the production database.
 *
 * This project's `DATABASE_URL` is scoped to "Production, Preview" in Vercel —
 * one value, both environments — and the build ran `prisma migrate deploy`
 * unconditionally. So OPENING a pull request applied its migrations to the
 * database holding real members' names, handicaps and money. Not merging it,
 * not reviewing it: opening it.
 *
 * The gate is `scripts/deploy-migrations.mjs`, and it is one line in
 * package.json away from being removed by somebody simplifying a build script
 * who has no way of knowing what it is for. Hence a test rather than a comment.
 *
 * The right repair is a separate database for Preview, which is a Vercel
 * settings change and cannot be asserted from here. This asserts the half that
 * lives in the repository.
 */

const ROOT = process.cwd();
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
  scripts: Record<string, string>;
};
const gate = readFileSync(join(ROOT, "scripts", "deploy-migrations.mjs"), "utf8");

describe("only a production deploy may migrate", () => {
  it("routes the build's migrations through the gate", () => {
    const build = pkg.scripts["vercel-build"] ?? "";
    expect(build, "vercel-build must exist").not.toBe("");
    expect(build, "the build must call the gate").toContain("deploy-migrations.mjs");
  });

  it("never calls prisma migrate deploy directly from a build script", () => {
    /**
     * THE REGRESSION THIS CATCHES. Putting `prisma migrate deploy` back into
     * `vercel-build` looks like a simplification — one fewer indirection — and
     * silently restores the behaviour where a branch writes schema to the
     * production database.
     */
    for (const [name, script] of Object.entries(pkg.scripts)) {
      if (name === "migrate" || name === "migrate:dev") continue; // deliberate, run by a human
      expect(script, `${name} runs migrate deploy without the gate`).not.toMatch(
        /prisma\s+migrate\s+deploy/,
      );
    }
  });

  it("decides on VERCEL_ENV, which is the only thing that knows", () => {
    // Not on a branch name, not on a URL. Vercel sets VERCEL_ENV to
    // production/preview/development on every build, and it is the one signal
    // that cannot be spoofed by naming a branch "production".
    expect(gate).toMatch(/VERCEL_ENV/);
    expect(gate).toMatch(/!==\s*["']production["']/);
  });

  it("still migrates when there is no VERCEL_ENV at all", () => {
    // Local and CI runs choose their own database and must keep working —
    // a gate that blocked those would break `npm run vercel-build` for
    // everybody and get deleted within a week.
    expect(gate).toMatch(/if \(env && env !== ["']production["']\)/);
  });

  it("passes the migration's exit code through, so a failure fails the build", () => {
    // Swallowing the status would let a broken migration deploy anyway, which
    // is a worse failure than the one this file exists to prevent.
    expect(gate).toMatch(/process\.exit\(run\.status/);
    expect(gate).toMatch(/stdio:\s*["']inherit["']/);
  });
});
