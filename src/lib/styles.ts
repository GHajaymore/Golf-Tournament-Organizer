/**
 * A CLUB'S STYLE — a second axis beside its colour.
 *
 * `themes.ts` decides a club's COLOURS; this decides its LOOK: the typefaces and
 * the treatment (a hung-board rail, a ruled programme, an operational sheet).
 * The two are independent — every style works in every colour, dark or light —
 * because a style only ever re-points the *type* and *treatment* tokens
 * (`--font-heading`, `--font-body`, the board rail), never the `--color-*` ones
 * that `themeCss` owns. So the mechanism mirrors the colour theme exactly: the
 * club's `styleKey` becomes a `data-style` attribute on the theme root, and
 * `design-system.css` carries one `[data-style="…"]` block per style.
 *
 * DEFAULT is `scoreboard` — Ajay's call (2026-09-24): the hung-board look the
 * club already chose for the player app, now the whole product's default, with
 * the club free to pick another.
 *
 * `ready` gates the picker. A style is only offered once its fonts are actually
 * loaded and its `[data-style]` block is written; the rest are declared here so
 * the set is visible and stable while they are built in.
 */

export type StyleKey = "scoreboard" | "program" | "sheet" | "modern" | "heritage";

export interface StylePreset {
  key: StyleKey;
  name: string;
  blurb: string;
  /** Shown in the picker only when true — its fonts and CSS are in place. */
  ready: boolean;
}

export const STYLE_PRESETS: StylePreset[] = [
  {
    key: "scoreboard",
    name: "Scoreboard",
    blurb: "The hung-board look — condensed caps, a gold leader, tabular scores. Sporty, and built to read on a phone in the sun.",
    ready: true,
  },
  {
    key: "program",
    name: "Championship Programme",
    blurb: "An editorial serif on paper, like a printed championship programme. Traditional and unhurried.",
    ready: true,
  },
  {
    key: "sheet",
    name: "Starter's Sheet",
    blurb: "Dense and monospaced, like a pro-shop tee sheet. For the organiser who lives in it.",
    ready: false,
  },
  {
    key: "modern",
    name: "Fairway Modern",
    blurb: "Clean, airy and rounded — one fresh green and a lot of space. Understated and contemporary.",
    ready: false,
  },
  {
    key: "heritage",
    name: "Heritage",
    blurb: "A classical serif in cream and brass, an engraved honours board. For a club that wears its history.",
    ready: false,
  },
];

export const DEFAULT_STYLE: StyleKey = "scoreboard";

/** The styles a club may actually choose right now. */
export const READY_STYLES = STYLE_PRESETS.filter((s) => s.ready);

export function isStyleKey(v: unknown): v is StyleKey {
  return typeof v === "string" && STYLE_PRESETS.some((s) => s.key === v);
}

/** The stored value narrowed to a usable, READY style — anything else is the default. */
export function styleKeyOr(v: unknown, fallback: StyleKey = DEFAULT_STYLE): StyleKey {
  return isStyleKey(v) && STYLE_PRESETS.find((s) => s.key === v)?.ready ? v : fallback;
}
