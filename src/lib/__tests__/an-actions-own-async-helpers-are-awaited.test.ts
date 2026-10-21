import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readSource } from "./source";

/**
 * AN ACTION FILE'S OWN ASYNC HELPER IS AWAITED (2026-10-21).
 *
 * `addFieldToRoster` ended with `if (linked > 0) refresh();` — and roster.ts's
 * `refresh` is async: it reads the session, then retires the public board's
 * cache entry. Left floating, that second half ran after the action had
 * answered, inside the re-render of /roster, where Next refuses a
 * revalidateTag: "Route /roster used revalidateTag … during render", an
 * unhandled rejection in the server log, and a public board that waited out
 * its sixty-second backstop. Found by the first browser test to press
 * "Add the field to the roster", in the server's log rather than on the
 * screen.
 *
 * The other actions' `refresh` helpers are synchronous, which is why the same
 * line is harmless in five other files and why a reader cannot tell the two
 * apart by looking at the call. So the rule is read off the DECLARATION: a
 * helper declared `async function name(` in an action file is never called
 * as a bare statement.
 */
const DIR = "src/app/actions";

function bareCallsOfAsyncHelpers(src: string): string[] {
  const helpers = [...src.matchAll(/(?:^|\n)\s*async function (\w+)\(/g)].map((m) => m[1]);
  const found: string[] = [];
  for (const name of helpers) {
    for (const line of src.split("\n")) {
      const at = line.indexOf(`${name}(`);
      if (at < 0) continue;
      const before = line.slice(0, at);
      if (/async function\s*$/.test(before)) continue; // the declaration itself
      if (/\b(await|return|void)\s*$/.test(before)) continue;
      if (/[=(,:?]\s*$/.test(before) || /\b(?:then|catch)\s*\(\s*$/.test(before)) continue; // a value somebody holds
      const preceding = before.slice(-1);
      if (preceding && /[\w.$]/.test(preceding)) continue; // a longer name that ends in this one
      // A statement: nothing before the call but indentation, or an `if (…)` / `else`.
      if (/^\s*$/.test(before) || /^\s*(?:if\s*\(.*\)|else)\s*$/.test(before)) found.push(`${name}: ${line.trim()}`);
    }
  }
  return found;
}

describe("an action file's own async helper is awaited", () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith(".ts"));

  it("finds the action files", () => {
    expect(files.length).toBeGreaterThan(40);
  });

  it("no action file calls one of its own async helpers as a bare statement", () => {
    const bad = files.flatMap((f) => bareCallsOfAsyncHelpers(readSource(join(DIR, f))).map((b) => `${f} — ${b}`));
    expect(bad, bad.join("\n")).toEqual([]);
  });

  it("control: the line that shipped is caught, and the awaited one is not", () => {
    const shipped = "async function refresh() {\n  x();\n}\nexport async function a() {\n  if (linked > 0) refresh();\n}\n";
    const fixed = shipped.replace("if (linked > 0) refresh();", "if (linked > 0) await refresh();");
    expect(bareCallsOfAsyncHelpers(shipped)).toEqual(["refresh: if (linked > 0) refresh();"]);
    expect(bareCallsOfAsyncHelpers(fixed)).toEqual([]);
    // A synchronous helper of the same name is not this rule's business.
    expect(bareCallsOfAsyncHelpers("function refresh() {}\nrefresh();\n")).toEqual([]);
  });
});
