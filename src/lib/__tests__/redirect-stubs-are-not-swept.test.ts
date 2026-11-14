import { describe, it, expect } from "vitest";
import { consoleScreens, standaloneScreens, isRedirectStub } from "../../../e2e/routes";

/**
 * A REDIRECT STUB IS NOT A SCREEN TO MEASURE (CI on #1133).
 *
 * `/start` (where an installed app opens, J39/J40 PR 2) only redirects. The
 * standalone list had no stub test at all, so `layout.spec` and `touch.spec`
 * measured it and failed "/start redirected away" on every run. One detector
 * now serves both lists, told by the page's shape rather than by where
 * `redirect(` sits on a line.
 */
describe("the route sweeps leave out pages that only redirect", () => {
  it("/start is a stub, and neither list measures it", () => {
    expect(standaloneScreens(), "the sweeps measure a page that only redirects").not.toContain("/start");
    expect(consoleScreens()).not.toContain("/scorecard");
    expect(consoleScreens()).not.toContain("/scoring");
  });

  it("CONTROL: real screens whose guards redirect stay in the sweeps", () => {
    // `/choose` calls `redirect(` on a line of its own and still draws a page.
    expect(standaloneScreens()).toContain("/choose");
    expect(standaloneScreens()).toContain("/match/new");
    expect(consoleScreens()).toContain("/dashboard");
  });

  it("the shape: redirects and draws nothing", () => {
    expect(isRedirectStub('export default async function P() {\n  if (a) redirect("/x");\n  redirect("/y");\n}')).toBe(true);
    expect(isRedirectStub('export default function P() {\n  if (!s) redirect("/");\n  return <main />;\n}')).toBe(false);
    expect(isRedirectStub('export default function P() {\n  if (!s)\n    redirect("/");\n  return (\n    <div>x</div>\n  );\n}')).toBe(false);
    expect(isRedirectStub("export default function P() { return null; }")).toBe(false);
  });
});
