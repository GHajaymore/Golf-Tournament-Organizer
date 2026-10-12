import SHOT_WIDTHS from "@/lib/landing/shot-widths.json";

/**
 * A real capture of the app.
 *
 * Every product image on the front door is an UNEDITED screenshot of the app
 * running on invented demo data (the `scripts/seed-club.mjs` club, dressed as
 * a named demo club in the development database and put back afterwards).
 * Nothing is drawn, and nothing on a capture is edited after it is taken.
 *
 * SHARP AT EVERY SIZE (Ajay, 2026-09-30: "the text or the screen doesn't look
 * rich or crisp"; again 2026-10-11). Each capture is kept at the resolution it
 * was taken — a phone at three device pixels per point, the desk at two — and
 * `scripts/place-landing-shots.mjs` also writes smaller copies resized with
 * Lanczos and a light unsharp mask (`shot-widths.json` lists them). The
 * `srcset` lets each screen take the copy nearest its own need, instead of the
 * browser shrinking one large file several times over with its fast, soft
 * filter — which greyed thin strokes. `sizes` says how wide the image is
 * shown. A plain <img>: next/image's optimiser would re-encode the files,
 * which is what this avoids. `width`/`height` still reserve the space, so
 * nothing shifts as they load.
 */

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

/**
 * A capture by its own name, at its own size (2026-10-11).
 *
 * The redesigned front door shows ONE demo club everywhere — Braid Hollow, in
 * Indiana — and other clubs only in "Wherever you play", so its pictures are
 * not an edition's or an appearance's: each is a single capture, named for what
 * the screen is (`club-board`, `world-gbp-money`), placed by
 * `scripts/place-landing-shots.mjs`, which records its true width and height
 * and its smaller copies in `shot-widths.json`. Nothing here states a size the
 * file does not have.
 *
 * `sizes` is NOT optional in spirit: it must be true of where the picture sits.
 * A wrong one is worse than none — the browser takes a copy far too large (and
 * shrinks it with its soft filter) or far too small (and stretches it), and
 * then reuses that copy for every other place the same picture appears.
 */
export function plainShot({
  name,
  alt,
  sizes,
  className = "",
  priority,
}: {
  name: string;
  alt: string;
  sizes: string;
  className?: string;
  priority?: boolean;
}) {
  const e = (SHOT_WIDTHS as Record<string, { w: number; h?: number; v: number[] }>)[name];
  if (!e || !e.h) throw new Error(`landing picture "${name}" is not in shot-widths.json with its size — place it with scripts/place-landing-shots.mjs`);
  return <Shot src={`/landing/${name}.webp`} width={e.w} height={e.h} alt={alt} className={className} priority={priority} sizes={sizes} />;
}

/** One sharp small copy of a capture, for a decorative tile that is never read. */
export function thumbShot(name: string, width: number) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a pre-sized copy; next/image would re-encode it
    <img src={`/landing/${name}.w${width}.webp`} alt="" loading="lazy" decoding="async" />
  );
}
