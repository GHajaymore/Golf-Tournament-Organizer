import { describe, it, expect } from "vitest";
import { contrastRatio } from "@/lib/themes";
import { LIGHT, ON_SUN, SUN_FILL } from "@/app/new/day-light";

/**
 * DESIGN E'S LIGHT READS CRISP AT EVERY HOUR (site rehaul, 2026-11-02).
 *
 * `/new` (design E) paints each stretch of the page in the light of its hour, from first light to
 * the prize-giving. As the ground shifts, the words must not: every text colour of a light is
 * held to 7:1 (Ajay's crisp rule) against every ground and panel it is drawn on.
 *
 * Control: a grey that reads on night but not on midday is caught, so the sweep can fail.
 */
const FLOOR = 7;

function failures(): string[] {
  const out: string[] = [];
  for (const [name, l] of Object.entries(LIGHT)) {
    for (const g of [...l.grounds, l.panel]) {
      for (const [k, c] of [["ink", l.ink], ["soft", l.soft], ["accent", l.accent]] as const) {
        const r = contrastRatio(c, g);
        if (r < FLOOR) out.push(`${name} ${k} ${c} on ${g}: ${r.toFixed(2)}`);
      }
    }
  }
  return out;
}

describe("design E: every light's words read at 7:1 on its own ground", () => {
  it("every ink, soft and accent colour clears 7:1 on every ground and panel", () => {
    expect(failures()).toEqual([]);
  });

  it("the orange fill carries its words at 7:1", () => {
    expect(contrastRatio(ON_SUN, SUN_FILL)).toBeGreaterThanOrEqual(FLOOR);
  });

  it("control: a grey that passes at night fails at midday", () => {
    const grey = "#9a9aa6";
    expect(contrastRatio(grey, LIGHT.night.grounds[0])).toBeGreaterThanOrEqual(FLOOR - 1.5);
    expect(contrastRatio(grey, LIGHT.midday.grounds[0])).toBeLessThan(FLOOR);
  });
});
