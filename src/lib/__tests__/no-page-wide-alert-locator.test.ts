import { describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { readSource, stripComments } from "./source";

/**
 * A SPEC NEVER ASKS A WHOLE PAGE FOR "THE ALERT" (2026-11-14).
 *
 * Next draws its own `<div role="alert" id="__next-route-announcer__">` on every page. So
 * `page.getByRole("alert")` always matches TWO elements once the app shows a refusal, and
 * Playwright's strict mode fails the step — after every step before it has passed. It reached
 * CI twice in one night from two engineers who could not run Playwright on the desktop: the
 * owner-finance spec (#1123, `page.getByRole("alert")`) and the guest-link spec (#1125,
 * `c.getByRole("alert")` where `c = await context.newPage()`). Each cost a CI run and a re-queue.
 *
 * The rule, which this test holds for every file in e2e/: on a PAGE (the `page` fixture or
 * anything made by `.newPage()`), an alert is found by its own element and role (`p`, `div` or
 * `span[role="alert"]`) or narrowed with `.filter(...)`. Inside a card, section or dialog locator it is fine as it is —
 * the announcer is not in there.
 */

const E2E = join(process.cwd(), "e2e");

/** Every line of `src` that asks a page-wide receiver for an unfiltered alert. */
function pageWideAlerts(src: string): string[] {
  const code = stripComments(src).replace(/\r\n/g, "\n");
  const pages = new Set(["page"]);
  // const c = await ctx.newPage() / const p: Page = await (await b.newContext()).newPage({ viewport })
  for (const m of code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::\s*Page\s*)?=\s*await\b[^;]*?\.newPage\(/g)) pages.add(m[1]);
  // const [v, o] = [await a.newPage(), await b.newPage()]
  for (const m of code.matchAll(/\b(?:const|let|var)\s*\[([^\]]+)\]\s*=[^;]*?\.newPage\(/g)) {
    for (const n of m[1].split(",")) {
      const id = n.trim().match(/^[A-Za-z_$][\w$]*/);
      if (id) pages.add(id[0]);
    }
  }
  // helper parameters: (p: Page)
  for (const m of code.matchAll(/\b([A-Za-z_$][\w$]*)\??\s*:\s*Page\b/g)) pages.add(m[1]);
  // renamed fixture or destructure: ({ page: desk })
  for (const m of code.matchAll(/\bpage\s*:\s*([A-Za-z_$][\w$]*)\s*[,}]/g)) pages.add(m[1]);
  const lines = code.split("\n");
  const found: string[] = [];
  // Matched across the whole file, so a chain broken over lines is still seen and a `.filter(` on the next line is honoured.
  for (const m of code.matchAll(/\b([A-Za-z_$][\w$]*)\s*\.\s*getByRole\(\s*(["'`])alert\2\s*(?:,\s*\{[^}]*\})?\s*\)/g)) {
    if (!pages.has(m[1])) continue;
    if (/^\s*\.\s*filter\(/.test(code.slice((m.index ?? 0) + m[0].length))) continue;
    const line = code.slice(0, m.index).split("\n").length;
    found.push(lines[line - 1].trim());
  }
  return found;
}

describe("no spec asks a whole page for the alert", () => {
  it("CONTROL: the shapes that reached CI are seen, and scoped or filtered ones are not", () => {
    expect(pageWideAlerts(`await expect(page.getByRole("alert")).toContainText("figure");`)).toHaveLength(1);
    expect(
      pageWideAlerts(`const c = await phoneC.newPage();\nawait expect(c.getByRole("alert")).toContainText("This link no longer works.");`),
    ).toHaveLength(1);
    expect(pageWideAlerts(`await expect(card.getByRole("alert")).toContainText("https");`)).toHaveLength(0);
    expect(pageWideAlerts(`const r = page.getByRole("alert").filter({ hasText: "To create" });`)).toHaveLength(0);
    expect(pageWideAlerts(`await expect(page.locator('p[role="alert"]')).toContainText("figure");`)).toHaveLength(0);
    expect(pageWideAlerts(`// page.getByRole("alert") is a trap`)).toHaveLength(0);
    // the shapes a review found the first version missed
    expect(pageWideAlerts(`async function f(p: Page) {\n  await expect(p.getByRole("alert")).toBeVisible();\n}`)).toHaveLength(1);
    expect(pageWideAlerts(`const [v, o] = [await visitor.newPage(), await owner.newPage()];\nawait expect(o.getByRole("alert")).toBeVisible();`)).toHaveLength(1);
    expect(pageWideAlerts(`const { page: desk } = await helper();\nawait expect(desk.getByRole("alert")).toBeVisible();`)).toHaveLength(1);
    expect(pageWideAlerts(`const q = await browser.newPage({ viewport });\nawait expect(q.getByRole("alert")).toBeVisible();`)).toHaveLength(1);
    expect(pageWideAlerts(`const p: Page = await (await browser.newContext()).newPage();\nawait expect(p.getByRole("alert")).toBeVisible();`)).toHaveLength(1);
    expect(pageWideAlerts(`await expect(page\n  .getByRole("alert")).toBeVisible();`)).toHaveLength(1);
    expect(pageWideAlerts(`await expect(page.getByRole("alert", { name })).toBeVisible();`)).toHaveLength(1);
    expect(pageWideAlerts("await expect(page.getByRole(`alert`)).toBeVisible();")).toHaveLength(1);
    expect(pageWideAlerts(`const r = page.getByRole("alert")\n  .filter({ hasText: "x" });`)).toHaveLength(0);
  });

  it("every spec in e2e/ finds a page's alert by its markup or a filter", () => {
    const files = readdirSync(E2E, { recursive: true, withFileTypes: true })
      .filter((d) => d.isFile() && /\.(ts|mts|js|mjs)$/.test(d.name))
      .map((d) => join(d.parentPath ?? (d as unknown as { path: string }).path, d.name));
    expect(files.length, "no spec files were read — the sweep would pass on nothing").toBeGreaterThan(50);
    const offenders = files.flatMap((f) =>
      pageWideAlerts(readSource(f.slice(process.cwd().length + 1).split("\\").join("/"))).map((l) => `${f.slice(E2E.length + 1)}: ${l}`),
    );
    expect(offenders, 'find the refusal by its own element and role (p, div or span[role="alert"]) or .filter({ hasText }) — Next\'s route announcer is an alert too').toEqual([]);
  });

  it("the sweep reaches real code: e2e/ holds at least 20 scoped alert locators", () => {
    const files = readdirSync(E2E, { recursive: true, withFileTypes: true })
      .filter((d) => d.isFile() && /\.(ts|mts|js|mjs)$/.test(d.name))
      .map((d) => join(d.parentPath ?? (d as unknown as { path: string }).path, d.name));
    const n = files.reduce(
      (sum, f) =>
        sum + (readSource(f.slice(process.cwd().length + 1).split("\\").join("/")).match(/\.getByRole\(\s*["'`]alert["'`]/g) ?? []).length,
      0,
    );
    expect(n).toBeGreaterThanOrEqual(20);
  });
});
