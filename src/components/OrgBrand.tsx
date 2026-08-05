import { Logo } from "./Logo";
import { BrandMark } from "./BrandMark";

export interface Brand {
  name: string;
  logoUrl: string;
  /** Keep a small TourneyHQ credit beside the club's mark (non-white-label plans). */
  showAttribution?: boolean;
}

/**
 * The mark shown at the top of the console.
 *
 * Falls back to TourneyHQ's own logo and wordmark when the organization hasn't
 * set branding, so the header is never empty — and a club that has set a logo
 * sees its own identity on every screen its members open.
 */
export function OrgBrand({ brand, size = 22 }: { brand?: Brand | null; size?: number }) {
  if (!brand?.name) {
    return (
      <>
        <Logo size={size} />
        <BrandMark />
      </>
    );
  }

  return (
    <>
      {brand.logoUrl ? (
        // Plain <img>: the URL points at an arbitrary external host, which
        // next/image would need configured domains for.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={brand.logoUrl}
          alt=""
          style={{ height: size + 6, width: "auto", maxWidth: 130, objectFit: "contain", flex: "none" }}
        />
      ) : (
        <span
          style={{
            width: size + 6,
            height: size + 6,
            borderRadius: 7,
            display: "grid",
            placeItems: "center",
            background: "color-mix(in srgb, var(--color-accent) 16%, transparent)",
            color: "var(--color-accent)",
            fontSize: size * 0.6,
            fontWeight: 600,
            flex: "none",
          }}
        >
          {brand.name.trim().charAt(0).toUpperCase()}
        </span>
      )}
      <span style={{ minWidth: 0, display: "flex", flexDirection: "column", lineHeight: 1.15 }}>
        <span
          style={{
            fontFamily: "var(--font-heading)",
            fontWeight: 600,
            letterSpacing: "-0.01em",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {brand.name}
        </span>
        {brand.showAttribution && (
          <span
            className="text-muted"
            style={{ fontSize: 9, letterSpacing: "0.06em", textTransform: "uppercase", fontWeight: 500 }}
          >
            Powered by TourneyHQ
          </span>
        )}
      </span>
    </>
  );
}
