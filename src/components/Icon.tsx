import type { CSSProperties } from "react";

/**
 * An icon, drawn from the sprite rather than a webfont.
 *
 * This replaced `<i className="ph ph-eye" />`. The webfont behind that was
 * 272.6 KB of woff2 for about 120 glyphs out of roughly 1,500, and it was
 * `font-display: block` — so every icon in the product was invisible until it
 * arrived. The sprite is 13.2 KB brotli and is already in the document.
 *
 * SIZED IN `em`, ON PURPOSE. The thing it replaced was text: every call site
 * sizes its icon with `fontSize`, and a hundred of them do it inline. An SVG
 * at `1em` square with `fill: currentColor` inherits size and colour from
 * exactly the same places the glyph did, so none of those call sites had to
 * change and none of them can drift. `vertical-align: -0.125em` is what puts
 * it back on the text baseline, which is where a glyph sat for free.
 *
 * `name` TAKES THE LEGACY SPELLING TOO — "ph ph-eye", "ph-fill ph-microphone"
 * — because icon names are carried as DATA in several places: `nav.ts` stores
 * `icon: "ph ph-squares-four"` on every entry, and the dashboard tiles and the
 * mobile tab bar render whatever string they are handed. Accepting both means
 * those tables did not have to be rewritten to change how an icon is drawn,
 * and a table of class names is a perfectly good table of icon names.
 */
export function Icon({
  name,
  weight,
  style,
  className,
  "aria-hidden": ariaHidden,
  "aria-label": ariaLabel,
  title,
}: {
  /** "eye", or the legacy "ph ph-eye" / "ph-fill ph-microphone". */
  name: string;
  weight?: IconWeight;
  style?: CSSProperties;
  className?: string;
  "aria-hidden"?: boolean | "true" | "false";
  "aria-label"?: string;
  /**
   * A hover tooltip, as `<i title="…">` gave for free.
   *
   * Rendered as a `<title>` CHILD rather than an attribute, because that is
   * the only spelling an SVG honours — `<svg title="…">` is an unknown
   * attribute that draws nothing. A `<title>` also names the element for a
   * screen reader, so it stops being decorative and the `aria-hidden` default
   * below has to give way.
   */
  title?: string;
}) {
  const parsed = parseIconName(name);
  // An empty name is a real state, not a mistake: `AvailabilityCalendar` uses
  // one for the "nothing to say about this day" tone. Rendering an empty <svg>
  // would still occupy its 1em box and push the layout around.
  if (!parsed.icon) return null;
  const id = `i-${weight ?? parsed.weight}-${parsed.icon}`;

  return (
    <svg
      className={className}
      // Decorative unless it was given a label. An icon beside its own word is
      // noise to a screen reader, and that is the overwhelming majority of
      // these — but a handful genuinely carry the meaning on their own, and
      // those pass `aria-label`.
      aria-hidden={ariaLabel || title ? undefined : (ariaHidden ?? true)}
      role={ariaLabel || title ? "img" : undefined}
      aria-label={ariaLabel}
      style={{
        width: "1em",
        height: "1em",
        // The glyph sat on the baseline for free; an inline SVG does not.
        verticalAlign: "-0.125em",
        fill: "currentColor",
        flex: "none",
        ...style,
      }}
    >
      {title ? <title>{title}</title> : null}
      <use href={`#${id}`} />
    </svg>
  );
}

/**
 * The weights this app draws. A webfont charged about 145 KB for each one,
 * which is why only two were ever imported; a sprite charges for the icon, so
 * a third weight used twice costs about 450 bytes.
 */
export type IconWeight = "regular" | "fill" | "bold";

const WEIGHTS: IconWeight[] = ["fill", "bold"];

/**
 * "eye" | "ph ph-eye" | "ph-fill ph-microphone" | "ph-bold ph-check" → the
 * icon and its weight.
 *
 * Deliberately tolerant of the legacy pair rather than requiring every caller
 * to be rewritten. It is exported so the sprite's test can prove the parser
 * and the generator agree about what a name means — the one place those two
 * could disagree is a blank square in production.
 *
 * THE WEIGHT COMES FROM THE FAMILY CLASS, NOT A NAME SUFFIX, and that
 * distinction was a live bug. `AvailabilityCalendar` asked for
 * `"ph-check-bold"` and `"ph-x-bold"` — reading as an icon called `check-bold`
 * — and neither stylesheet the app imported defines such a class, so both
 * rendered as nothing. Two icons in the availability grid had simply been
 * invisible. They are `ph-bold ph-check` now, which is a weight the sprite can
 * actually carry.
 */
export function parseIconName(name: string): { icon: string; weight: IconWeight } {
  const trimmed = name.trim();
  if (!trimmed) return { icon: "", weight: "regular" };

  const tokens = trimmed.split(/\s+/);
  const weight = WEIGHTS.find((w) => tokens.includes(`ph-${w}`)) ?? "regular";
  // The last `ph-` token is the icon; anything before it is a family class.
  const last = tokens[tokens.length - 1] ?? "";
  const icon = last.startsWith("ph-") ? last.slice(3) : last;
  // A bare family class with no icon after it ("ph") names nothing.
  return { icon: icon === "ph" || WEIGHTS.includes(icon as IconWeight) ? "" : icon, weight };
}
