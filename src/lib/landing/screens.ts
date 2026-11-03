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
/** `visitor`: nobody signed in — a public page (design F's event page and clubhouse screen). */
export type Who = "member" | "secretary" | "visitor";
/** `meeting`: the seed's tournament taking entries with no format yet — a dashboard still being set up. */
export type EventKey = "medal" | "team" | "champs" | "meeting";
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
  /**
   * A PUBLIC page of the tournament, by its share link (`eventLinks` in `src/lib/domain/event-page.ts`):
   * the capture script builds the address from the seeded tournament's own token, so `path` is not used.
   */
  share?: "event" | "clubhouse" | "board";
  /** A named step `capture-demo.mjs` takes on the screen before the shot (its `LANDING_ACTS`). */
  act?: string;
  /**
   * The club's colours for this shot (design E, 2026-11-02: Ajay, "the screens must not all be one
   * colour scheme"). A theme is a real setting a club can choose, so the screen stays a real one:
   * `capture-demo.mjs` saves this pair and ground on the seeded demo club, reads it back before the
   * shot, and puts the seed's own theme back after it. Absent: the seed's theme (Tournament, auto).
   */
  theme?: { pair: ThemePairKey; appearance: "dark" | "light" };
}

/** The `THEME_PAIRS` (src/lib/themes.ts) a capture may wear, with their two preset keys. */
export const CAPTURE_THEMES = {
  tournament: { accent: "verdigris", secondary: "optic" },
  desert: { accent: "bunker", secondary: "verdigris" },
  championship: { accent: "claret", secondary: "bunker" },
  coastal: { accent: "links", secondary: "bunker" },
} as const;
export type ThemePairKey = keyof typeof CAPTURE_THEMES;

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
  // Today's front door (`/`) still draws it behind the hero phone; PR #990 retires it with that hero.
  { id: "desk-leaderboard", viewport: laptop, preset: "crisp", onPage: true,
    capture: { who: "secretary", event: "medal", costume: "us", path: "/leaderboard" }, expect: ["Leaderboard"] },
  { id: "desk-matchplay", viewport: laptop, preset: "crisp", onPage: true,
    kept: "a match play of 128 in eight flights — a second club the seed does not build", expect: [] },

  // ── design E (`/new`, "one day's light", 2026-11-02): the same demo club in four club themes, so
  //    neighbouring screens differ, and the organizer's console beside the player's phone. Dark-ground
  //    themes are shown in the page's dark hours, light-ground ones in its bright hours. ──
  { id: "e-club-today", viewport: phone, preset: "crisp", onPage: true,
    capture: { who: "member", event: "medal", costume: "us", path: "/me", theme: { pair: "coastal", appearance: "light" } }, expect: ["October Stroke Play"] },
  { id: "e-club-card", viewport: phone, preset: "crisp", onPage: true,
    capture: { who: "member", event: "medal", costume: "us", path: "/me/card", theme: { pair: "championship", appearance: "light" } }, expect: ["Hole", "Par"] },
  { id: "e-club-board", viewport: phone, preset: "crisp", onPage: true,
    capture: { who: "member", event: "medal", costume: "us", path: "/me/board", theme: { pair: "tournament", appearance: "dark" } }, expect: ["Ranked by net strokes"] },
  { id: "e-club-final", viewport: phone, preset: "crisp", onPage: true,
    capture: { who: "member", event: "champs", costume: "us", path: "/me/board", theme: { pair: "desert", appearance: "dark" } }, expect: ["Board"] },
  { id: "e-desk-dashboard", viewport: laptop, preset: "crisp", onPage: true,
    capture: { who: "secretary", event: "medal", costume: "us", path: "/dashboard", theme: { pair: "championship", appearance: "light" } }, expect: ["Tournament dashboard"] },
  { id: "e-desk-tournaments", viewport: laptop, preset: "crisp", onPage: true,
    capture: { who: "secretary", event: "medal", costume: "us", path: "/tournaments", theme: { pair: "desert", appearance: "dark" } }, expect: ["Tournaments"] },
  { id: "e-desk-grouping", viewport: laptop, preset: "crisp", onPage: true,
    capture: { who: "secretary", event: "medal", costume: "us", path: "/grouping", theme: { pair: "coastal", appearance: "light" } }, expect: ["Flights"] },
  { id: "e-desk-prizes", viewport: laptop, preset: "crisp", onPage: true,
    capture: { who: "secretary", event: "champs", costume: "us", path: "/prizes", act: "prize-list", theme: { pair: "championship", appearance: "light" } }, expect: ["Prizes"] },
  { id: "e-desk-report", viewport: laptop, preset: "crisp", onPage: true,
    capture: { who: "secretary", event: "champs", costume: "us", path: "/reports/final", act: "final-report", theme: { pair: "tournament", appearance: "dark" } }, expect: ["Final report"] },

  // ── design F (`/new`, 2026-11-03): what has landed since D and E, each a real screen of a feature on
  //    main — a figure that explains itself (#953), the honest card (#959), the setup checklist on the
  //    dashboard (#954, #974), and the event page and clubhouse screen anybody can open (#956). ──
  { id: "f-why-board", viewport: phone, preset: "crisp", onPage: true,
    capture: { who: "member", event: "medal", costume: "us", path: "/me/board", act: "open-why", theme: { pair: "coastal", appearance: "light" } }, expect: ["Ranked by net strokes"] },
  { id: "f-card-sync", viewport: phone, preset: "crisp", onPage: true,
    capture: { who: "member", event: "medal", costume: "us", path: "/me/card", act: "offline-press", theme: { pair: "championship", appearance: "light" } }, expect: ["On your phone"] },
  { id: "f-desk-checklist", viewport: laptop, preset: "crisp", onPage: true,
    capture: { who: "secretary", event: "meeting", costume: "us", path: "/dashboard", theme: { pair: "desert", appearance: "dark" } }, expect: ["Still to set up"] },
  { id: "f-event-page", viewport: phone, preset: "crisp", onPage: true,
    capture: { who: "visitor", event: "medal", costume: "us", path: "", share: "event", theme: { pair: "coastal", appearance: "light" } }, expect: ["October Stroke Play"] },
  { id: "f-clubhouse", viewport: laptop, preset: "crisp", onPage: true,
    capture: { who: "visitor", event: "medal", costume: "us", path: "", share: "clubhouse", theme: { pair: "tournament", appearance: "dark" } }, expect: ["October Stroke Play"] },
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
