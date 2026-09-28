import Image from "next/image";

/**
 * A real capture of the app, in both of its appearances.
 *
 * Every product image on the front door is an UNEDITED screenshot of the app
 * running on invented demo data (the `scripts/seed-club.mjs` club), captured
 * once as a US club and once as a UK one, in dark and in light. Nothing is
 * drawn. The dark twin shows by default; the light twin is display:none until
 * the page's switch asks for it, and lazy, so it is never downloaded before.
 *
 * `unoptimized`: the files are already WebP at 2x their largest displayed size
 * (≤ 65 KB each), so a resizing pass would add a per-image cost and nothing
 * else. `width`/`height` still reserve the space, so nothing shifts as they
 * load.
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
  /** The hero: fetched first, never lazy. Applies to the default (dark) twin only. */
  priority?: boolean;
}

/** The file for one appearance. Phone captures name both ("-dark", "-light"); the rest name only the dark one. */
export function shotSrc(name: string, variant: string, appearance: "dark" | "light"): string {
  const both = name.startsWith("phone-");
  const stem = appearance === "dark" ? `${name}-dark` : both ? `${name}-light` : name;
  return `/landing/${stem}.${variant}.webp`;
}

/** Both twins, as siblings, so the surrounding layout sees one image. */
export function shot({ name, variant, width, height, alt, className = "", priority }: ShotSpec) {
  return (
    <>
      <Image
        className={`${className} is-dark`}
        src={shotSrc(name, variant, "dark")}
        width={width}
        height={height}
        alt={alt}
        unoptimized
        priority={priority}
      />
      <Image
        className={`${className} is-light`}
        src={shotSrc(name, variant, "light")}
        width={width}
        height={height}
        alt={alt}
        unoptimized
        loading="lazy"
      />
    </>
  );
}

/** One fixed file — a capture that does not follow the switch (the comparison viewer's own pair). */
export function fixedShot(src: string, width: number, height: number, alt: string, className = "") {
  return <Image className={className} src={src} width={width} height={height} alt={alt} unoptimized loading="lazy" />;
}
