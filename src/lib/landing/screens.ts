/**
 * EVERY SCREEN ON THE FRONT DOOR, IN ONE LIST (2026-11-01).
 *
 * Ajay, 1 Nov: "build it so we can easily update the screens". Before this
 * file a landing screen was named in three places — the capture script's shot
 * list, the placing script's name table and the page — and nothing failed when
 * a new capture changed shape. Now:
 *
 *   - `scripts/capture-demo.mjs` reads this list to know WHAT to shoot (who is
 *     signed in, which tournament, which country, which path, on a phone or a
 *     laptop) and, for the hero's live moment, the order of before, press and
 *     after;
 *   - `scripts/place-landing-shots.mjs` reads it to know where each capture
 *     goes, which look preset it gets, how it is cropped, and what must be
 *     true of it — it REFUSES, before writing anything, a capture of the wrong
 *     size, a crop outside the capture, or a screen whose words lack an
 *     `expect` line;
 *   - the page draws only screens named here (`plainShot` throws on any other).
 *
 *   npm run landing:capture            re-shoots every screen that has a `capture`
 *   npm run landing:capture -- --only=live-card-before,live-board-after
 *
 * Local development database and a local server only — both scripts refuse
 * any other host (hard rule 1).
 *
 * WHAT MAY BE DONE TO A CAPTURE (Ajay, 30 Oct: "if AI can enhance the real
 * screen I am okay with that", and 1 Nov: "real screens enhanced to match the
 * page"): crop, resize, sharpen and a light grade — the `PRESETS` below, and
 * nothing else. Never a word, a figure, a name or a layout. Glare, glass and
 * light are LAYERS drawn by the page over and around the picture, never baked
 * into it, and there is no text in any image.
 *
 * This file is plain data with no imports, so the two Node scripts can import
 * it as it stands (Node strips the types).
 */

export type Viewport = "phone" | "laptop";
export type Who = "member" | "secretary";
export type EventKey = "medal" | "team" | "champs";
export type Costume = "us" | "gbp" | "eur" | "zar" | "inr";

/** A look preset: how a capture is resized and finished. Nothing in it can change what the screen says. */
export interface Preset {
  /** Unsharp mask for the smaller copies (sharp's `sharpen`). */
  sharpen: { sigma: number; m1: number; m2: number };
  /** A linear grade, `a * value + b` per channel — a little contrast; never a colour change. */
  grade?: { a: number; b: number };
  /** WebP quality of the smaller copies, and of the full-size file. */
  quality: number;
  fullQuality: number;
}

export const PRESETS = {
  /** What every landing picture has had since 2026-09-30: Lanczos down, a light unsharp mask. */
  crisp: { sharpen: { sigma: 0.6, m1: 0.6, m2: 1.4 }, quality: 92, fullQuality: 96 },
  /**
   * The hero's (2026-11-01). The screens sit under a glass layer and beside a lit laptop, so a
   * touch more edge and a little contrast keep the small print as black as the app draws it.
   */
  hero: { sharpen: { sigma: 0.65, m1: 0.7, m2: 1.7 }, grade: { a: 1.04, b: -6 }, quality: 90, fullQuality: 94 },
} as const satisfies Record<string, Preset>;

export type PresetName = keyof typeof PRESETS;

/** The geometry each viewport is captured at, and so the only size a capture of it may have. */
export const VIEWPORTS: Record<Viewport, { width: number; height: number; scale: number; widths: number[] }> = {
  phone: { width: 393, height: 852, scale: 3, widths: [420, 640, 860] },
  laptop: { width: 1440, height: 900, scale: 2, widths: [1080, 1620, 2160] },
};

/** How to shoot a screen. Absent on a screen this command cannot yet reproduce — see `kept`. */
export interface CaptureSpec {
  who: Who;
  event: EventKey;
  costume: Costume;
  path: string;
  /** A named step `capture-demo.mjs` takes on the screen before the shot (its `LANDING_ACTS`). */
  act?: string;
}

export interface LandingScreen {
  /** The name the page uses: `public/landing/<id>.webp` and its copies. */
  id: string;
  viewport: Viewport;
  capture?: CaptureSpec;
  /** Why a screen without `capture` is kept as last placed, until the command learns to shoot it. */
  kept?: string;
  /** Words that must be on the captured screen (case-insensitive) — a capture without them is refused. */
  expect: string[];
  preset: PresetName;
  /** A crop in CSS pixels of the capture (top and height), applied before resizing. None today. */
  crop?: { top: number; height: number };
  /** Extra copy widths beyond the viewport's, e.g. a phone drawn large on a 3x phone. */
  extraWidths?: number[];
  /** Measured at capture time and written to `screen-facts.json`: the row of the signed-in player, the button pressed. */
  measure?: Array<"self-row" | "press">;
  /** On the page, or captured only for a fact it proves (a "before" whose picture is never shown). */
  onPage: boolean;
}

/**
 * THE LIVE MOMENT (the hero, 2026-11-01). The signed-in member's card is open on the hole they are
 * about to play; the `before` screens are shot; the member presses `press` on their card, as a
 * member does; the `after` screens are shot. Every figure the hero says about it — the field, the
 * holes in before and after, the place moved — is read off these captures by the capture script and
 * written to `screen-facts.json`. Nothing about it is typed by hand.
 */
export const LIVE_MOMENT = {
  before: ["live-desk-before", "live-board-before", "live-card-before"],
  press: { on: "live-card-before", button: "^4\\s*Par$" },
  after: ["live-card-after", "live-board-after", "live-desk-after"],
} as const;

const phone = "phone" as const;
const laptop = "laptop" as const;

export const SCREENS: LandingScreen[] = [
  // ── the hero's live moment ──
  { id: "live-card-before", viewport: phone, preset: "hero", onPage: true, extraWidths: [1000], measure: ["press"],
    capture: { who: "member", event: "medal", costume: "us", path: "/me/card" },
    expect: ["October Stroke Play", "Hole", "Par"] },
  { id: "live-card-after", viewport: phone, preset: "hero", onPage: false,
    capture: { who: "member", event: "medal", costume: "us", path: "/me/card" },
    expect: ["October Stroke Play", "Hole"] },
  { id: "live-board-before", viewport: phone, preset: "hero", onPage: false, measure: ["self-row"],
    capture: { who: "member", event: "medal", costume: "us", path: "/me/board" },
    expect: ["Ranked by net strokes"] },
  { id: "live-board-after", viewport: phone, preset: "hero", onPage: true, extraWidths: [1000], measure: ["self-row"],
    capture: { who: "member", event: "medal", costume: "us", path: "/me/board" },
    expect: ["Ranked by net strokes"] },
  { id: "live-desk-before", viewport: laptop, preset: "hero", onPage: true, measure: ["self-row"],
    capture: { who: "secretary", event: "medal", costume: "us", path: "/leaderboard" },
    expect: ["Leaderboard", "Thru", "To par"] },
  { id: "live-desk-after", viewport: laptop, preset: "hero", onPage: true, measure: ["self-row"],
    capture: { who: "secretary", event: "medal", costume: "us", path: "/leaderboard" },
    expect: ["Leaderboard", "Thru", "To par"] },

  // ── the player's week (and the wall of small screens) ──
  { id: "club-today", viewport: phone, preset: "crisp", onPage: true,
    capture: { who: "member", event: "medal", costume: "us", path: "/me" }, expect: ["October Stroke Play"] },
  { id: "club-card", viewport: phone, preset: "crisp", onPage: true,
    capture: { who: "member", event: "medal", costume: "us", path: "/me/card" }, expect: ["Hole", "Par"] },
  { id: "club-board", viewport: phone, preset: "crisp", onPage: true,
    capture: { who: "member", event: "medal", costume: "us", path: "/me/board" }, expect: ["Ranked by net strokes"] },
  { id: "club-money", viewport: phone, preset: "crisp", onPage: true,
    capture: { who: "member", event: "medal", costume: "us", path: "/me/money" }, expect: ["Money"] },
  { id: "club-enter", viewport: phone, preset: "crisp", onPage: true,
    capture: { who: "member", event: "medal", costume: "us", path: "/me/events" }, expect: ["Events"] },
  { id: "club-final", viewport: phone, preset: "crisp", onPage: true,
    capture: { who: "member", event: "champs", costume: "us", path: "/me/board" }, expect: ["Board"] },

  // ── the organizer ──
  { id: "org-dashboard", viewport: phone, preset: "crisp", onPage: true,
    capture: { who: "secretary", event: "medal", costume: "us", path: "/dashboard" }, expect: ["Needs you now"] },
  { id: "org-teesheet", viewport: phone, preset: "crisp", onPage: true,
    kept: "shot with two pairing requests open on a draw not yet in the seed; the command does not set that up yet", expect: [] },
  { id: "desk-dashboard", viewport: laptop, preset: "crisp", onPage: true,
    capture: { who: "secretary", event: "medal", costume: "us", path: "/dashboard" }, expect: ["Tournament dashboard", "Pace of play"] },
  { id: "desk-matchplay", viewport: laptop, preset: "crisp", onPage: true,
    kept: "a match play of 128 in eight flights — a second club the seed does not build", expect: [] },

  // ── the public boards (no sign-in) ──
  { id: "public-stableford", viewport: phone, preset: "crisp", onPage: true, kept: "a public board of a Stableford round — the seed's link is not yet named here", expect: [] },
  { id: "public-pairs", viewport: phone, preset: "crisp", onPage: true, kept: "a public four-ball board — the seed's link is not yet named here", expect: [] },
  { id: "public-cup", viewport: phone, preset: "crisp", onPage: true, kept: "a public team cup board — the seed's link is not yet named here", expect: [] },
  { id: "public-final", viewport: phone, preset: "crisp", onPage: true, kept: "a public final board — the seed's link is not yet named here", expect: [] },
  { id: "public-matchplay", viewport: phone, preset: "crisp", onPage: true, kept: "the 128-player draw's public page — a second club the seed does not build", expect: [] },

  // ── wherever you play ──
  { id: "world-gbp-money", viewport: phone, preset: "crisp", onPage: true,
    capture: { who: "member", event: "medal", costume: "gbp", path: "/me/money" }, expect: ["£"] },
  { id: "world-eur-money", viewport: phone, preset: "crisp", onPage: true,
    capture: { who: "member", event: "medal", costume: "eur", path: "/me/money" }, expect: ["€"] },
  { id: "world-zar-money", viewport: phone, preset: "crisp", onPage: true,
    capture: { who: "member", event: "medal", costume: "zar", path: "/me/money" }, expect: ["R"] },
  { id: "world-inr-money", viewport: phone, preset: "crisp", onPage: true,
    capture: { who: "member", event: "medal", costume: "inr", path: "/me/money" }, expect: ["₹"] },
  { id: "world-gbp-board", viewport: phone, preset: "crisp", onPage: true,
    capture: { who: "member", event: "medal", costume: "gbp", path: "/me/board" }, expect: ["Ranked by"] },
  { id: "world-inr-board", viewport: phone, preset: "crisp", onPage: true,
    capture: { who: "member", event: "medal", costume: "inr", path: "/me/board" }, expect: ["Ranked by"] },

  // ── one board in four club themes ──
  { id: "look-tournament-light", viewport: phone, preset: "crisp", onPage: true, kept: "a club theme switched for the shot — the command does not switch themes yet", expect: [] },
  { id: "look-championship-dark", viewport: phone, preset: "crisp", onPage: true, kept: "a club theme switched for the shot — the command does not switch themes yet", expect: [] },
  { id: "look-coastal-light", viewport: phone, preset: "crisp", onPage: true, kept: "a club theme switched for the shot — the command does not switch themes yet", expect: [] },
  { id: "look-midnight-dark", viewport: phone, preset: "crisp", onPage: true, kept: "a club theme switched for the shot — the command does not switch themes yet", expect: [] },
];

/** The scene behind the hero's devices: atmosphere only, never a screen, never text. */
export interface Scene {
  id: string;
  source: string;
  /** The part of the source kept, in its own pixels — the plinth and its light, not the empty dark. */
  crop: { left: number; top: number; width: number; height: number };
  widths: number[];
  quality: number;
}

/**
 * Placed with `node scripts/place-landing-shots.mjs --scene=<the exported image>` (it is not
 * re-shot by landing:capture: nothing in it comes from the app).
 */
export const SCENES: Scene[] = [
  {
    id: "hero-scene",
    /** Made with Canva's AI image tool (design DAHZuNPOEjw, page 1), 1 Nov 2026: a plinth, a ball, an orange glow. No screen, no words. */
    source: "Canva AI, design DAHZuNPOEjw page 1, exported 1920x1080",
    crop: { left: 560, top: 180, width: 1360, height: 900 },
    widths: [1100],
    quality: 80,
  },
];

/** One screen by its id — or a loud failure, so the page can only draw what this file names. */
export function landingScreen(id: string): LandingScreen {
  const s = SCREENS.find((x) => x.id === id);
  if (!s) throw new Error(`landing screen "${id}" is not in src/lib/landing/screens.ts — add it there, then npm run landing:capture`);
  return s;
}
