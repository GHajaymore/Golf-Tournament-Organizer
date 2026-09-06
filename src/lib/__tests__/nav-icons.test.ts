import { describe, it, expect } from "vitest";
import { NAV } from "@/lib/nav";

/**
 * Every sidebar entry wears its own glyph.
 *
 * Three pairs did not, and each pair sat in the same eyeline:
 *
 *   ph-squares-four   Dashboard          and  Flights
 *   ph-trophy         Season standings   and  Prizes & payouts
 *   ph-users-three    Teams & pairs      and  Group games
 *
 * An icon in a list of twenty-one links has exactly one job — to let somebody
 * find a row without reading it — and a duplicate does the opposite of that
 * job, because the eye stops on the wrong row and has to fall back to reading
 * anyway. The last pair was the worst of the three: "Teams & pairs" and "Group
 * games" are already easy to confuse by NAME, and they were also wearing the
 * same picture.
 *
 * Asserted over the whole list rather than over the three that were found,
 * which is the difference between fixing this and stopping it: a twenty-second
 * entry added later reuses a glyph by accident, not on purpose, and nobody
 * scans twenty-one rows to notice.
 */
const ITEMS = NAV.flatMap((s) => s.items.map((i) => ({ ...i, section: s.label })));

describe("the sidebar's icons", () => {
  it("has a plausible number of entries to check", () => {
    // A sweep over an empty list passes everything below it.
    expect(ITEMS.length).toBeGreaterThan(15);
  });

  it("gives every entry an icon at all", () => {
    const bare = ITEMS.filter((i) => !i.icon || !/\bph-[a-z0-9-]+/.test(i.icon));
    expect(bare.map((i) => i.key), "entries with no usable icon").toEqual([]);
  });

  it("never gives two entries the same icon", () => {
    const seen = new Map<string, string[]>();
    for (const item of ITEMS) {
      seen.set(item.icon, [...(seen.get(item.icon) ?? []), `${item.section}/${item.label}`]);
    }
    const clashes = [...seen.entries()]
      .filter(([, where]) => where.length > 1)
      .map(([icon, where]) => `${icon} shared by ${where.join(" and ")}`);
    expect(clashes, clashes.join("; ")).toEqual([]);
  });

  it("never gives two entries the same label or href", () => {
    /**
     * The same failure one level up, and the reason to assert it while here:
     * a duplicate label is a worse version of a duplicate icon, and
     * `screenName()` resolves an href to a label by taking the FIRST match —
     * so a duplicate href would silently give one screen another's name in
     * every checklist row and refusal message that points at it.
     */
    for (const field of ["label", "href"] as const) {
      const values = ITEMS.map((i) => i[field]);
      const dupes = values.filter((v, i) => values.indexOf(v) !== i);
      expect(dupes, `duplicate ${field}: ${dupes.join(", ")}`).toEqual([]);
    }
  });
});
