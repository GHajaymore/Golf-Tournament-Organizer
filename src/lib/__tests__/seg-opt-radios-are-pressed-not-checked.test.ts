import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { readSource } from "./source";

/**
 * A segmented control's radio is drawn invisible, so a spec never `.check()`s it.
 *
 * `.seg-opt input` (and `.radio input`) is `opacity: 0; width: 0; height: 0` in
 * design-system.css. Playwright's `.check()` waits for the input to be visible
 * and actionable. If the option is ALREADY chosen it returns at once (nothing to
 * do), so the test passes; if it is NOT chosen it waits for ever for a radio that
 * will never be visible. A test can therefore pass for the wrong reason (the
 * option happened to be chosen) or hang. Found 5 Nov 2026 in sprint 1
 * (`getByLabel("X won").check()` on the match keeper).
 *
 * The shape that works: press what a person presses (the label, by its words),
 * then `expect(radio).toBeChecked()`.
 *
 * The GUARANTEE pinned here: no `.check(` without `force` on a locator that can
 * reach a radio. A locator can reach a radio by role (`getByRole("radio"...)`,
 * `radiogroup`, `input[type="radio"]`), or by label when the label words are those
 * of a `.seg-opt` option in `src/`. A variable is followed to the line that made
 * it. Real checkboxes are never touched (`getByRole("checkbox")`).
 */

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
    else if (/\.tsx?$/.test(rel)) out.push(rel);
  }
  return out;
}

/** Literal words of every `<label className="seg-opt">` option in the app. */
function segOptLabels(): string[] {
  const words = new Set<string>();
  for (const file of walk("src").filter((f) => f.endsWith(".tsx"))) {
    const src = readSource(file);
    const re = /<label[^>]*className="seg-opt"[^>]*>\s*<input[\s\S]*?\/>\s*([^<{}]+?)\s*</g;
    for (const m of src.matchAll(re)) if (m[1].trim()) words.add(m[1].trim());
  }
  return [...words];
}

/** Files that may `.check(` a locator that names a radio, with the reason. */
export const ALLOWLIST: Record<string, string> = {
  // (none: every radio in the app is drawn inside a label that hides it)
};

/** Is this receiver one that reaches a radio? `decl` follows a bare variable. */
function reachesRadio(receiver: string, labels: string[], decl: (name: string) => string | null, depth = 0): boolean {
  if (/force\s*:\s*true/.test(receiver)) return false;
  if (/["'`]radio(group)?["'`]|type=["'\\]*radio|\[type=.?radio/.test(receiver)) return true;
  for (const m of receiver.matchAll(/getByLabel\(\s*(["'`])((?:(?!\1).)*)\1/g)) {
    const text = m[2];
    if (labels.some((l) => l === text || l.startsWith(text) || text.startsWith(l))) return true;
  }
  const bare = receiver.trim().match(/^[A-Za-z_$][\w$]*$/);
  if (bare && depth < 3) {
    const d = decl(bare[0]);
    if (d) return reachesRadio(d, labels, decl, depth + 1);
  }
  // `x.nth(i)`, `x.first()` and the like start from an identifier.
  const head = receiver.trim().match(/^([A-Za-z_$][\w$]*)\s*\./);
  if (head && depth < 3) {
    const d = decl(head[1]);
    if (d) return reachesRadio(d, labels, decl, depth + 1);
  }
  return false;
}

/** Every `.check(` call in a source text that reaches a radio, as `line: text`. */
export function radioChecks(src: string, labels: string[]): string[] {
  const lines = src.split("\n");
  const found: string[] = [];
  lines.forEach((line, i) => {
    const at = line.indexOf(".check(");
    if (at < 0) return;
    // A variable means its LAST declaration above this line (names are reused per test).
    const before = lines.slice(0, i + 1).join("\n");
    const decl = (name: string): string | null => {
      const re = new RegExp(`(?:const|let)\\s+${name.replace(/\$/g, "\\$")}\\s*=\\s*([^;]*);`, "g");
      const all = [...before.matchAll(re)];
      return all.length ? all[all.length - 1][1] : null;
    };
    // The receiver: this line before `.check(`, plus the line above when it is a continuation.
    let receiver = line.slice(0, at);
    if (!/\b(await|const|let)\b/.test(receiver) && i > 0) receiver = `${lines[i - 1]} ${receiver}`;
    receiver = receiver.replace(/^\s*(?:await\s+)?/, "").replace(/^(?:const|let)\s+\w+\s*=\s*(?:await\s+)?/, "");
    const call = line.slice(at);
    if (/force\s*:\s*true/.test(call)) return;
    if (reachesRadio(receiver, labels, decl)) found.push(`${i + 1}: ${line.trim()}`);
  });
  return found;
}

describe("a segmented control's radio is pressed by its label, never .check()ed", () => {
  const labels = segOptLabels();

  it("the sweep sees seg-opt options in the app (a control for the label reader)", () => {
    expect(labels.length).toBeGreaterThan(5);
    expect(labels).toContain("Hole by hole");
  });

  it("CONTROL: it refuses planted bad lines, in each shape, and passes the good ones", () => {
    const bad = [
      `await page.getByLabel("Hole by hole").check();`,
      `await row.getByRole("radio", { name: "I won" }).check();`,
      `await page.getByRole("radiogroup", { name: "Who" }).getByRole("radio", { name: "Whites" }).check();`,
      `const pick = page.getByRole("radio", { name: "A4" });\nawait pick.check();`,
      `await scope.locator('input[type="radio"]').nth(2).check();`,
    ];
    for (const line of bad) expect(radioChecks(line, labels), line).toHaveLength(1);

    const good = [
      `await page.getByText("Hole by hole", { exact: true }).click();\nawait expect(radio).toBeChecked();`,
      `await page.getByRole("checkbox", { name: "Use X" }).check();`,
      `await page.getByRole("radio", { name: "A4" }).check({ force: true });`,
      `const box = page.getByRole("checkbox", { name: "Cut" });\nawait box.check();`,
    ];
    for (const line of good) expect(radioChecks(line, labels), line).toHaveLength(0);
  });

  it("no spec in e2e/ checks a radio", () => {
    const files = walk("e2e");
    expect(files.length).toBeGreaterThan(20);
    const offences: string[] = [];
    for (const file of files) {
      if (ALLOWLIST[file]) continue;
      for (const hit of radioChecks(readSource(file), labels)) offences.push(`${file}:${hit}`);
    }
    expect(
      offences,
      "press the option's label by its words, then expect(radio).toBeChecked() — see docs/claude/e2e-traps.md",
    ).toEqual([]);
  });
});
