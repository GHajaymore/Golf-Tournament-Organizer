import SHOT_WIDTHS from "@/lib/landing/shot-widths.json";

/**
 * A real capture of the app, in both of its appearances.
 *
 * Every product image on the front door is an UNEDITED screenshot of the app
 * running on invented demo data (the `scripts/seed-club.mjs` club), captured
 * once as a US club and once as a UK one, in dark and in light. Nothing is
 * drawn. The page is light, so a section shows the light twin (`lightShot`);
 * the comparison slider shows both twins of the same screen on purpose.
 *
 * SHARP AT EVERY SIZE (Ajay, 2026-09-30: "the text or the screen doesn't look
 * rich or crisp"). Each capture is kept at the resolution it was taken, and
 * `crop-landing` also writes smaller copies resized with Lanczos and a light
 * unsharp mask (`shot-widths.json` lists them). The `srcset` lets each screen
 * take the copy nearest its own need, instead of the browser shrinking one
 * 1170px file 2–4.5x with its fast, soft filter — which greyed thin strokes.
 * `sizes` says how wide the image is shown, per section. A plain <img>:
 * next/image's optimiser would re-encode the files, which is what this avoids.
 * `width`/`height` still reserve the space, so nothing shifts as they load.
 */
export interface ShotSpec {
  /** The capture's name, without appearance or edition: "crop-live-board". */
  name: string;
  /** Which edition's capture: "us" or "uk", or a currency for the money screen. */
  variant: string;
  width: number;
  height: number;
  alt: string;
  className?: string;
  /** The hero: fetched first, never lazy. */
  priority?: boolean;
  /** How wide it is shown, as an <img sizes>. Defaults to a phone screen in a section. */
  sizes?: string;
}

/** A phone screen shown in a section: most of a phone's width, 340px elsewhere. */
export const PHONE_SIZES = "(max-width: 760px) min(84vw, 330px), 408px";

/** The sharp smaller copies of one file, largest last, as a srcset — or none. */
export function srcSetFor(src: string): string | undefined {
  const key = src.replace(/^\/landing\//, "").replace(/\.webp$/, "");
  const e = (SHOT_WIDTHS as Record<string, { w: number; v: number[] }>)[key];
  if (!e || e.v.length === 0) return undefined;
  return [...e.v.map((w) => `/landing/${key}.w${w}.webp ${w}w`), `${src} ${e.w}w`].join(", ");
}

function Shot({ src, width, height, alt, className, priority, sizes }: { src: string; width: number; height: number; alt: string; className: string; priority?: boolean; sizes: string }) {
  const srcSet = srcSetFor(src);
  return (
    // eslint-disable-next-line @next/next/no-img-element -- pre-sized copies with a srcset; next/image would re-encode them
    <img
      className={className || undefined}
      src={src}
      srcSet={srcSet}
      sizes={srcSet ? sizes : undefined}
      width={width}
      height={height}
      alt={alt}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : undefined}
      decoding="async"
    />
  );
}

/** The file for one appearance. Phone captures name both ("-dark", "-light"); the rest name only the dark one. */
export function shotSrc(name: string, variant: string, appearance: "dark" | "light"): string {
  const both = name.startsWith("phone-");
  const stem = appearance === "dark" ? `${name}-dark` : both ? `${name}-light` : name;
  return `/landing/${stem}.${variant}.webp`;
}

/** One fixed file — a capture that does not follow the switch (the comparison viewer's own pair). */
export function fixedShot(src: string, width: number, height: number, alt: string, className = "", sizes = PHONE_SIZES) {
  return <Shot src={src} width={width} height={height} alt={alt} className={className} sizes={sizes} />;
}

/**
 * The LIGHT capture alone. The page has been light since the 2026-09-29
 * redesign, so a screen that illustrates a section shows its light twin only;
 * the dark twins remain for the comparison slider, which shows both on purpose.
 */
export function lightShot({ name, variant, width, height, alt, className = "", priority, sizes = PHONE_SIZES }: ShotSpec) {
  return <Shot src={shotSrc(name, variant, "light")} width={width} height={height} alt={alt} className={className} priority={priority} sizes={sizes} />;
}
