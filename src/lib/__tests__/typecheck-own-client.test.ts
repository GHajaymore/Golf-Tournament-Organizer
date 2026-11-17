import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readSource } from "./source";
// Plain JavaScript on purpose: it runs before anything is built.
import { withPrivateOutput, privateTsconfig } from "../../../scripts/qa/typecheck-own-client.mjs";

/**
 * A branch that adds a column used to be impossible to type-check outside CI: every worktree shares the main
 * checkout's generated Prisma client, and generating a branch's client there is refused (it would replace it
 * for everyone). scripts/qa/typecheck-own-client.mjs generates the branch's client into a PRIVATE folder and
 * points `@prisma/client` at it through a private tsconfig. Measured 17 Nov on train D's tip (#1158 adds
 * PlayerPass.slipPrintedAt): its new column type-checks, an invented column fails, the shared client is untouched.
 */
describe("type-checking a checkout against its own schema", () => {
  const schema = [
    "// a comment",
    "generator client {",
    '  provider = "prisma-client-js"',
    "}",
    "",
    'datasource db {\n  provider = "postgresql"\n  url = env("DATABASE_URL")\n}',
    "model A {\n  id String @id\n}",
  ].join("\n");

  it("moves ONLY the client generator's output to the private folder, with forward slashes", () => {
    const out = withPrivateOutput(schema, ["C:", "w", ".qa", "tmp", "own-client", "client"].join(path.sep));
    expect(out).toContain('generator client {\n  provider = "prisma-client-js"\n  output = "C:/w/.qa/tmp/own-client/client"\n}');
    expect(out.replace(/\n {2}output = "[^"]+"/, "")).toBe(schema);
  });

  it("refuses a schema it does not understand rather than guessing where the client would go", () => {
    expect(() => withPrivateOutput(schema.replace("generator client", "generator other"), "x")).toThrow(/one "generator client"/);
    expect(() => withPrivateOutput(schema.replace('provider = "prisma-client-js"', 'provider = "prisma-client-js"\n  output = "../x"'), "y")).toThrow(/already names an output/);
    expect(() => withPrivateOutput(`${schema}\ngenerator client {\n}`, "z")).toThrow(/found 2/);
  });

  it("the private tsconfig extends the real one, keeps its paths and files, and sends @prisma/client to the private client", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "own-client-"));
    try {
      const real = path.join(dir, "tsconfig.json");
      writeFileSync(real, JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] } }, include: ["src/**/*.ts"], exclude: ["node_modules"] }));
      const t = privateTsconfig(real, dir, path.join(dir, ".qa", "tmp", "own-client", "client"));
      const slash = (p: string) => p.split(path.sep).join("/");
      expect(t.extends).toBe(slash(real));
      expect(t.compilerOptions.paths["@/*"]).toEqual([slash(path.join(dir, "src", "*"))]);
      expect(t.compilerOptions.paths["@prisma/client"]).toEqual([slash(path.join(dir, ".qa", "tmp", "own-client", "client"))]);
      expect(t.include).toEqual([slash(path.join(dir, "src", "**", "*.ts"))]);
      expect(t.exclude).toEqual([slash(path.join(dir, "node_modules"))]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("never generates into the shared client: the generate call always names the private schema, and the shared copy is checked before and after", () => {
    const src = readSource("scripts", "qa", "typecheck-own-client.mjs");
    expect(src).toMatch(/run\("prisma", \["generate", "--schema", path\.join\(work, "schema\.prisma"\)\]\)/);
    expect(src.match(/"generate"/g)?.length).toBe(1); // control: the one generate call, and no other
    expect(src).toMatch(/sha\(sharedCopy\) !== before/);
  });
});
