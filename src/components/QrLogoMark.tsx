import { Logo } from "./Logo";
import type { LogoBox } from "@/lib/qr";

/**
 * THE TOURNEYHQ MARK IN THE CENTRE OF A QR CODE (2026-11-05).
 *
 * Drawn inside the code's own `<svg>` (viewBox in module units), over the
 * modules: a white square (`logoBox` — at most 15% of the code's area, with a
 * module of white all round) and the app's own mark in it. The mark is `<Logo>`,
 * the one component that draws it (`brand-consistency.test.ts` bans a second
 * copy of its geometry), with its colours passed in because a QR on paper is
 * ink on white, and because the print-kit test rasterises the SVG on its own,
 * where no stylesheet's `--logo-*` variables exist.
 *
 * The print kit's signs and cards, and the sign-up poster, draw it. The
 * landing page's demo code (`landing/demo-qr.ts`) does not.
 */
const INK = { flag: "#f2862e", stick: "#111111", ball: "#56c74c", cup: "#3f424d" } as const;

export function QrLogoMark({ logo }: { logo: LogoBox }) {
  return (
    <g data-qr-logo="">
      <rect x={logo.x} y={logo.y} width={logo.size} height={logo.size} fill="#fff" />
      {/* A nested <svg> sized in module units, placed by its parent group. */}
      <g transform={`translate(${logo.inner.x} ${logo.inner.y})`}>
        <Logo size={logo.inner.size} colors={INK} />
      </g>
    </g>
  );
}
