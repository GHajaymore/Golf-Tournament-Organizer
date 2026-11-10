import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LifecycleStepper } from "@/components/LifecycleStepper";
import { lifecycleTrack } from "@/lib/domain/lifecycle-track";
import { tournamentJob, type TournamentJobFacts } from "@/lib/domain/needs-you-now";
import { shortDate } from "@/lib/domain/round-dates";
import { tournamentStatus, type TournamentFacts } from "@/lib/domain/tournament-status";
import { facts, launched, round } from "@/lib/domain/__tests__/tournament-facts-fixtures";
import { DARK_GROUND, SUNLIGHT_RATIO, themeVarsFor } from "@/lib/themes";
import { readSource } from "./source";
import { SCHEMES, declarationsOf, markContrast, themeOf } from "./token-contrast";

/**
 * THE LIFECYCLE STEPPER, DRAWN (B03; the panel's ruling, 9 Nov).
 *
 *   a list        the stops are an ordered list, the current one `aria-current="step"`, and the whole
 *                 stepper carries ONE aria-label (never repeated on the list)
 *   refused       a real disabled <button> with the machine's refusal, word for word, beside it
 *                 (`aria-describedby`), and its way out
 *   one button    never a filled button: on the dashboard no action (its status card holds it), on the
 *                 screen where the job is done no action, elsewhere a quiet link
 *   folded        one line off the dashboard (and off Tournament details once launched)
 *   legible       words reach 7:1 on the dark ground and 4.5:1 on the light, muted words 13px or more,
 *                 every target 44px tall — read out of the stylesheet itself
 *
 * Every name is invented.
 */

const TODAY = "2026-11-20";
const day = (iso: string) => shortDate(iso, "en-GB");

function trackOf(f: TournamentFacts, over: Partial<TournamentJobFacts> = {}, today = TODAY) {
  const status = tournamentStatus(f);
  const t: TournamentJobFacts = {
    eventId: "e1",
    name: "zz-stepper Quillstone Club Medal",
    awaitingApproval: 0,
    entriesClose: "",
    nextSheet: null,
    board: null,
    status,
    startOn: f.startOn,
    endOn: f.endOn,
    ...over,
  };
  return lifecycleTrack(status, tournamentJob(t, today, day));
}

const medal = (o: Partial<TournamentFacts> = {}) =>
  facts({ startOn: "2026-11-28", endOn: "2026-11-29", confirmed: 24, groups: 0, rounds: [round({ id: "r1", position: 0 }), round({ id: "r2", position: 1 })], ...o });
const refused = () => trackOf(medal({ missingCards: [{ stageId: "r2", label: "Round 2", course: "Quillstone — North Course" }] }));
const playing = () =>
  trackOf(
    launched(medal({ rounds: [round({ id: "r1", position: 0, hasResult: true }), round({ id: "r2", position: 1 })] })),
    { board: { roundId: "r1", round: "Round 1", day: "2026-11-28", closed: false, unit: "cards", started: 20, certified: 18, total: 24 } },
    "2026-11-28",
  );

const draw = (track: ReturnType<typeof trackOf>, here: string, preview = false) =>
  renderToStaticMarkup(<LifecycleStepper track={track} here={here} preview={preview} />);
const count = (s: string, needle: RegExp) => (s.match(needle) ?? []).length;

describe("the stepper, drawn", () => {
  it("open on the dashboard: one list, one current stop, one aria-label, no action of its own", () => {
    const html = draw(playing(), "/dashboard");
    expect(count(html, /aria-current="step"/g)).toBe(1);
    expect(count(html, /aria-label=/g), "one aria-label in total").toBe(1);
    expect(html).toMatch(/<ol class="ls-track">/);
    expect(html).toContain("Play · 0 of 2 done");
    expect(html).toContain("Round 1 · 18 of 24 cards in.");
    // The status card below holds the button.
    expect(html).not.toMatch(/<button/);
    expect(html).not.toContain("Open score entry");
    // Every state is said in words.
    for (const w of ["Done", "Now", "To do"]) expect(html).toContain(`>${w}<`);
  });

  it("refused: a real disabled button, the refusal word for word beside it, and its way out", () => {
    const track = refused()!;
    const html = draw(track, "/event");
    const button = /<button type="button" class="ls-press-off" disabled="" aria-describedby="([^"]+)">Launch tournament<\/button>/.exec(html);
    expect(button, "a disabled Launch button described by its refusal").not.toBeNull();
    const described = new RegExp(`id="${button![1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>([^<]*)<`).exec(html);
    expect(described?.[1]).toBe(track.press.disabledBecause!.replace(/&/g, "&amp;"));
    expect(html).toMatch(/href="\/stages"[^>]*>Open Rounds &amp; formats/);
    expect(html).toContain(">Needs you<");
  });

  it("on the screen where the job is done there is no action; elsewhere a quiet link, never a filled button", () => {
    // Folded on Score entry: the job is done here.
    const here = draw(playing(), "/entry");
    expect(here).toContain("Round 1 · 18 of 24 cards in");
    expect(here).not.toMatch(/<a [^>]*>Open score entry/);
    // On Entries: one line, and a quiet link to where it is done.
    const there = draw(playing(), "/registration");
    expect(there).toMatch(/<a [^>]*href="\/entry"[^>]*class="ls-link"|<a [^>]*class="ls-link"[^>]*href="\/entry"/);
    expect(there).not.toMatch(/btn-primary/);
    expect(there).not.toMatch(/<ol/);
  });

  it("folded to one line off the dashboard, and on Tournament details once launched", () => {
    expect(draw(playing(), "/event")).toMatch(/class="ls ls-folded"/);
    expect(draw(refused(), "/event")).not.toMatch(/ls-folded/);
    expect(draw(refused(), "/foursomes")).toMatch(/ls-folded/);
  });

  it("the preview keeps itself on: every link carries ?stepper=1", () => {
    const html = draw(playing(), "/dashboard", true);
    const hrefs = [...html.matchAll(/<a [^>]*href="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs.length).toBeGreaterThan(5);
    for (const h of hrefs) expect(h).toMatch(/[?&]stepper=1$/);
  });

  it("draws nothing for a casual round", () => {
    expect(draw(null, "/dashboard")).toBe("");
  });
});

/* ------------------------------------------------------------ legible outdoors */

const SHEET = readSource("src", "components", "lifecycle-stepper.css");
const CSS = readSource("src", "app", "design-system.css") + "\n" + SHEET;

/** The stepper's words on fills, as the sheet declares them. */
const MARKS = [
  ".ls-kick",
  ".ls-preview",
  ".ls-phase-title",
  ".ls-stop-word",
  ".ls-chip",
  '.ls-chip[data-state="now"]',
  '.ls-chip[data-state="held"]',
  ".ls-press-off",
  ".ls-link",
  ".ls-every summary",
  ".ls-row-label",
  ".ls-row-word",
  ".ls-row-reason",
];

describe("the stepper reads outdoors, on every theme", () => {
  for (const s of SCHEMES) {
    const vars = themeVarsFor(themeOf(s.pair, s.ground), s.ground);
    it(`${s.pair} on the ${s.ground.key} ground: every word reaches ${s.floor}:1`, () => {
      const low = MARKS.map((m) => ({ m, ...markContrast(CSS, m, vars) }))
        .filter((x) => x.ratio < s.floor)
        .map((x) => `${x.m}: ${x.ratio.toFixed(2)}:1 on ${x.on}`);
      expect(low, low.join("\n")).toEqual([]);
    });
  }

  it("colours only from the club's tokens", () => {
    const raw = [...SHEET.matchAll(/(?:^|[;{\s])(color|background|border(?:-[a-z]+)?|box-shadow)\s*:\s*([^;}]+)/g)]
      .map((m) => m[2])
      .filter((v) => /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i.test(v));
    expect(raw).toEqual([]);
  });

  it("muted words are 13px or more, and every target is 44px tall", () => {
    const small = [...SHEET.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1])).filter((px) => px < 13);
    expect(small).toEqual([]);
    for (const target of [".ls-stop-link", ".ls-link", ".ls-press-off", ".ls-every summary"]) {
      expect(declarationsOf(SHEET, target)["min-height"], target).toBe("44px");
    }
  });

  it("from 768 to 1024 (and on a phone) it is the bar, not the track", () => {
    // The stepper's own width decides; at 1024 with the sidebar beside it, it is well under 860.
    expect(SHEET).toMatch(/@container \(max-width: 859px\)/);
    expect(declarationsOf(SHEET, ".ls")["container-type"]).toBe("inline-size");
  });

  it("CONTROL: a weak word is caught", () => {
    const vars = themeVarsFor(themeOf("desert", DARK_GROUND), DARK_GROUND);
    expect(markContrast(`.x { background: var(--color-accent-500); color: var(--color-accent-300); }`, ".x", vars).ratio).toBeLessThan(SUNLIGHT_RATIO);
  });
});
