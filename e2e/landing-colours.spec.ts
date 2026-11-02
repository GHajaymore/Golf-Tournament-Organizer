import { expect, test, type Page } from "./coverage";
import { landingSettled } from "./landing-settled";

/**
 * THE FRONT DOOR IS ONE SET OF COLOURS ON EVERY DEVICE (Ajay, 2026-11-01).
 *
 * "keep the default color on all platforms for the landing page … entire landing page
 * desktop/laptop/tablet or mobile the same color", and, asked again, "I need all same". From
 * 2026-10-13 to that day two sections (the three feature cards and pricing) were drawn green on a
 * phone only, as his outdoor test; he ended it. This is the check that a width cannot bring a colour
 * of its own back.
 *
 * At a phone (393), a tablet (768) and a laptop (1440) it reads, for every section of the page and
 * for the panels inside it (cards, plans), the colour it is filled with and the colours it is told to
 * draw with — the page's own colour names, which is what the green test changed — and holds the three
 * widths to the same answers. A gradient's SHAPE may change with the width (a glow sits higher on a
 * phone); its colours may not, and those are what is read.
 *
 * CONTROL: the reading is refused if it found fewer than eight sections, or no panels at all, so a
 * page that drew nothing cannot pass by having nothing to compare.
 */
test.use({ storageState: { cookies: [], origins: [] }, deviceScaleFactor: 1, contextOptions: { reducedMotion: "reduce" } });

const WIDTHS = [393, 768, 1440];
const NAMES = ["--ground", "--ground-2", "--panel", "--paper", "--ink", "--ink-soft", "--brass", "--brass-ui", "--flag", "--m-ground", "--m-ground-deep", "--m-on-ground", "--m-hl", "--m-label"];

async function colours(page: Page, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto("/");
  await landingSettled(page);
  return page.evaluate((names) => {
    const read = (el: Element) => {
      const cs = getComputedStyle(el);
      const tokens = names.map((n) => `${n}=${cs.getPropertyValue(n).trim()}`).join(" ");
      return `bg=${cs.backgroundColor} fg=${cs.color} ${tokens}`;
    };
    const sections = Array.from(document.querySelectorAll("main.m-home > section, main.m-home > div > section, main.m-home section[id]"));
    const out: Record<string, string> = {};
    const seen = new Set<Element>();
    sections.forEach((s, i) => {
      if (seen.has(s)) return;
      seen.add(s);
      const key = s.id || `section-${i}`;
      out[key] = read(s);
      const panel = s.querySelector(".m-card, .m-plan");
      if (panel) out[`${key} › panel`] = read(panel);
    });
    return out;
  }, NAMES);
}

test("every section of the front door has the same colours at 393, 768 and 1440", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "one run is enough: it sets the three widths itself");
  test.setTimeout(120_000);
  const at: Record<number, Record<string, string>> = {};
  for (const w of WIDTHS) at[w] = await colours(page, w);

  const keys = Object.keys(at[1440]);
  expect(keys.filter((k) => !k.includes("›")).length, `sections found: ${keys.join(", ")}`).toBeGreaterThanOrEqual(8);
  expect(keys.some((k) => k.includes("› panel")), "no card or plan panel was found to compare").toBe(true);

  const differ: string[] = [];
  for (const k of keys) {
    for (const w of [393, 768]) {
      if (at[w][k] === undefined) { differ.push(`${k}: not on the page at ${w}`); continue; }
      if (at[w][k] !== at[1440][k]) differ.push(`${k} at ${w}:\n    ${at[w][k]}\n  at 1440:\n    ${at[1440][k]}`);
    }
  }
  expect(differ, differ.join("\n")).toEqual([]);
});
