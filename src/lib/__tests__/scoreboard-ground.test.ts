import { describe, it, expect } from "vitest";
import {
  SCOREBOARD_GROUND as G,
  SCOREBOARD_ACCENT,
  SCOREBOARD_SECONDARY,
  scoreboardVars,
  scoreboardCss,
  contrastRatio,
  themeScale,
  SUNLIGHT_RATIO,
} from "@/lib/themes";

/**
 * THE PLAYER APP'S GROUND, MEASURED. Since 2026-09-19 every player screen is
 * drawn on the scoreboard ground rather than the club's theme, so the pairs
 * the two club grounds are held to are held here too — outdoors on a phone is
 * where this ground is read.
 *
 * `color-mix(…)` tokens are measured by mixing here, the way the browser does.
 */
function mix(fg: string, pct: number, bg: string): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [a, b] = [p(fg), p(bg)];
  return "#" + a.map((v, i) => Math.round(v * (pct / 100) + b[i] * (1 - pct / 100)).toString(16).padStart(2, "0")).join("");
}

describe("the scoreboard ground", () => {
  const vars = scoreboardVars();

  it("lettering on the field clears the sunlight bar", () => {
    expect(contrastRatio(G.text, G.bg)).toBeGreaterThanOrEqual(SUNLIGHT_RATIO);
    expect(contrastRatio(G.text, G.surface)).toBeGreaterThanOrEqual(SUNLIGHT_RATIO);
  });

  it("muted text — the 68% mix and neutral-400 — clears 4.5:1 on the card and on a 16% accent tint", () => {
    const tint = mix(vars["--color-accent"], 16, G.surface);
    for (const bg of [G.bg, G.surface, tint]) {
      expect(contrastRatio(mix(G.text, 68, bg), bg), `muted on ${bg}`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(G.neutrals[3], bg), `neutral-400 on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("the orange and the red read as text, and the button label reads on the orange", () => {
    const accent = themeScale(SCOREBOARD_ACCENT, G);
    const red = themeScale(SCOREBOARD_SECONDARY, G);
    expect(contrastRatio(accent[300], G.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(accent[500], G.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(red[300], G.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(G.onAccent, accent[500])).toBeGreaterThanOrEqual(4.5);
  });

  it("danger and warning read on the card", () => {
    expect(contrastRatio(G.danger, G.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(G.warning, G.surface)).toBeGreaterThanOrEqual(4.5);
  });

  it("the neutral ramp runs light to dark, so a label stays a label", () => {
    const lum = G.neutrals.map((n) => contrastRatio(n, "#000000"));
    for (let i = 1; i < lum.length; i += 1) expect(lum[i]).toBeLessThan(lum[i - 1]);
  });

  it("renders every token, none dropped by the stylesheet's value filter", () => {
    const css = scoreboardCss("#player-theme");
    for (const k of Object.keys(vars)) expect(css, `${k} dropped`).toContain(`${k}:`);
  });

  it("can fail — the club dark ground's muted grey is not enough on a tinted green", () => {
    // The control: a neutral chosen for a charcoal field does not automatically
    // read on this one, which is why the ramp above is its own.
    expect(contrastRatio("#595d6c", G.surface)).toBeLessThan(4.5);
  });
});
