import { Logo, LOGO_SIZE } from "./Logo";
import { BrandMark } from "./BrandMark";

export interface Brand {
  name: string;
  /** Quieter second line — the full club name under its short one. */
  secondary?: string;
  /** Initials for the no-logo mark; two letters where the name allows. */
  monogram?: string;
  logoUrl: string;
  /**
   * False on a WHITE-LABEL plan, true on every other. Kept under its old name
   * because it is set in one place (`organization.ts`, from
   * `features.whiteLabel`) and read here; what it now decides is whose mark
   * leads — see `clubLeads` below.
   */
  showAttribution?: boolean;
}

/** TourneyHQ's tagline, shown under the lockup wherever there is room. */
export const TAGLINE = "From Registration to Recognition.";

/**
 * Whether the CLUB's mark replaces TourneyHQ's.
 *
 * Decided 2026-09-18, in two steps. TourneyHQ first on every screen, in its
 * own colours — and then, minutes later: "tourney HQ logo and tagline should
 * be replaced by club logo if they submit it [and] it is paid tier". So both,
 * and only both: a plan with white-label AND a logo actually uploaded. A paid
 * club that has not uploaded one still shows TourneyHQ — a header with no mark
 * at all is worse than either.
 */
export function clubLeads(brand?: Brand | null): boolean {
  return Boolean(brand?.name && brand.logoUrl && brand.showAttribution === false);
}

/**
 * The mark at the top of every screen.
 *
 * TOURNEYHQ FIRST: the mark and the wordmark, in TourneyHQ's own colours
 * (`--thq-*`, which no club setting reaches), with the tagline where the
 * caller has room for it and the club's name — and its logo, small — on the
 * line beneath. A white-label club with its own logo gets that instead.
 */
export function OrgBrand({
  brand,
  size = LOGO_SIZE.md,
  tagline = false,
}: {
  brand?: Brand | null;
  size?: number;
  /**
   * Show "From Registration to Recognition." under the wordmark. Off by
   * default: on a phone header it costs a line of the round, so it is asked
   * for where there is room — the desktop sidebar, the sign-up page, the
   * public board.
   */
  tagline?: boolean;
}) {
  if (brand && clubLeads(brand)) {
    return (
      <>
        {/* Plain <img>: the URL points at an arbitrary external host, which
            next/image would need configured domains for. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={brand.logoUrl}
          alt=""
          style={{ height: size + 6, width: "auto", maxWidth: 130, objectFit: "contain", flex: "none" }}
        />
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
          {brand.secondary && (
            <span
              style={{
                fontSize: 10.5,
                fontWeight: 500,
                color: "var(--color-text-muted)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={brand.secondary}
            >
              {brand.secondary}
            </span>
          )}
        </span>
      </>
    );
  }

  return (
    <>
      <Logo size={size} style={{ flex: "none" }} />
      <span style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 3, lineHeight: 1.15 }}>
        {/* Sized from the same number as the mark beside it, so a caller that
            shrinks one shrinks both. They used to drift apart. */}
        <BrandMark size={size} />
        {tagline && (
          <span style={{ fontSize: 10.5, fontWeight: 500, color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>
            {TAGLINE}
          </span>
        )}
        {/* The club, under TourneyHQ — its name, and its logo small when it
            has one. Truncated rather than wrapped: the sidebar is a fixed
            width and a name that reflows pushes the whole nav down. */}
        {brand?.name && (
          <span
            style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}
            title={brand.secondary || brand.name}
          >
            {brand.logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={brand.logoUrl}
                alt=""
                style={{ height: 14, width: "auto", maxWidth: 40, objectFit: "contain", flex: "none" }}
              />
            )}
            <span
              style={{
                fontSize: 11.5,
                fontWeight: 600,
                color: "var(--color-text-muted)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {brand.name}
            </span>
          </span>
        )}
      </span>
    </>
  );
}
