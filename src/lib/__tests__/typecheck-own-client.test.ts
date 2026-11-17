import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import ts from "typescript";
import { readSource } from "./source";
// Plain JavaScript on purpose: it runs before anything is built.
import {
  withPrivateOutput,
  privateTsconfig,
  SHARED_CLIENT_FILES,
  EXIT_SETUP,
  EXIT_SHARED_CHANGED,
} from "../../../scripts/qa/typecheck-own-client.mjs";

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

  it("TypeScript itself resolves @prisma/client to the PRIVATE client under the private tsconfig — and, the control, not under the real one", () => {
    // Inside the repository, so the real tsconfig's resolution reaches the repository's node_modules.
    const dir = path.join(process.cwd(), ".qa", "tmp", `own-client-test-${process.pid}-${Date.now()}`);
    mkdirSync(path.join(dir, "src"), { recursive: true });
    try {
      const realConfig = path.join(dir, "tsconfig.json");
      writeFileSync(realConfig, JSON.stringify({ compilerOptions: { moduleResolution: "bundler", module: "esnext", paths: { "@/*": ["./src/*"] } }, include: ["src/**/*.ts"] }));
      const from = path.join(dir, "src", "uses-client.ts");
      writeFileSync(from, 'import type { PrismaClient } from "@prisma/client";\nexport type C = PrismaClient;\n');
      const clientDir = path.join(dir, "private", "client");
      mkdirSync(clientDir, { recursive: true });
      writeFileSync(path.join(clientDir, "index.d.ts"), "export declare class PrismaClient { readonly privateMarker: true }\n");
      const privateConfig = path.join(dir, "private", "tsconfig.json");
      writeFileSync(privateConfig, JSON.stringify(privateTsconfig(realConfig, dir, clientDir)));

      const resolve = (configFile: string) => {
        const parsed = ts.getParsedCommandLineOfConfigFile(configFile, {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} });
        if (!parsed) throw new Error(`could not read ${configFile}`);
        return ts.resolveModuleName("@prisma/client", from, parsed.options, ts.sys).resolvedModule?.resolvedFileName ?? null;
      };
      const norm = (p: string | null) => (p === null ? null : path.resolve(p).toLowerCase());

      expect(norm(resolve(privateConfig))).toBe(norm(path.join(clientDir, "index.d.ts")));
      const viaReal = norm(resolve(realConfig));
      expect(viaReal, "control: the real tsconfig must NOT reach the private client").not.toBe(norm(path.join(clientDir, "index.d.ts")));
      expect(viaReal ?? "", "control: the real tsconfig reaches the shared @prisma/client").toContain(`${path.sep}node_modules${path.sep}`.toLowerCase());
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the shared client is fingerprinted by its schema copy, its types and the package that points at it; failures are not tsc's codes", () => {
    expect(SHARED_CLIENT_FILES.map((p: string[]) => p.join("/"))).toEqual([
      "node_modules/.prisma/client/schema.prisma",
      "node_modules/.prisma/client/index.d.ts",
      "node_modules/@prisma/client/package.json",
    ]);
    expect([EXIT_SETUP, EXIT_SHARED_CHANGED]).toEqual([3, 4]); // tsc exits 1 or 2 on type errors
    const src = readSource("scripts", "qa", "typecheck-own-client.mjs");
    expect(src.match(/"generate"/g)?.length).toBe(1); // the one generate call…
    expect(src).toMatch(/run\("prisma", \["generate", "--schema", path\.join\(work, "schema\.prisma"\)\]\)/); // …names the private schema
    expect(src).toMatch(/PRISMA_GENERATE_SKIP_AUTOINSTALL: "1"/);
  });
});
