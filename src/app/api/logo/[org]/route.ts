import { prisma } from "@/lib/db";
import { isDataUrl, dataUrlProblem, logoVersion } from "@/lib/domain/logo-upload";

/**
 * An uploaded club logo, served as an image rather than inlined in the page.
 *
 * The bytes live in `Organization.logoUrl` as a data URI — see
 * `domain/logo-upload.ts` for why there is no bucket. This route is what stops
 * that choice being paid for on every render: the public board polls every 30
 * seconds and `router.refresh()` re-sends the whole payload, so an inlined
 * logo is re-downloaded each time. Measured at 81KB per render for a 40KB
 * image, since the string appears in both the HTML and the RSC data.
 *
 * Under `/api/` deliberately. The middleware matcher excludes that prefix, and
 * its own comment gives the reason this route wants: keep the requests that
 * outnumber page views off the hot path.
 *
 * PUBLIC, and it has to be — the spectator board at `/live/[token]` is
 * unauthenticated, and a club's own mark on its own board is the least secret
 * thing in the product. Nothing else is reachable through it: the only value
 * returned is a logo that is already rendered on every public page the club
 * has, and an id that is not a logo returns 404 rather than anything about
 * the organization.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ org: string }> },
) {
  const { org } = await params;

  const row = await prisma.organization.findUnique({
    where: { id: org },
    select: { logoUrl: true },
  });

  // Not found, no logo, or a LINKED logo — in the last case the page renders
  // the club's own URL directly and never asks for this.
  if (!row || !isDataUrl(row.logoUrl)) {
    return new Response("Not found", { status: 404 });
  }

  /**
   * Re-checked on the way out, not trusted because it is already stored.
   *
   * A row could predate the rules, or have been written by something else. The
   * cost is a regex on a string we have already loaded, and the alternative is
   * this route serving whatever content type a stored value claims.
   */
  if (dataUrlProblem(row.logoUrl)) {
    return new Response("Not found", { status: 404 });
  }

  const [, mime, payload] = /^data:([^;]+);base64,(.*)$/s.exec(row.logoUrl.trim())!;
  const bytes = Buffer.from(payload.replace(/\s+/g, ""), "base64");

  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": mime,
      "Content-Length": String(bytes.byteLength),
      /**
       * Immutable, because the URL carries a fingerprint of the content —
       * `logoSrc` appends `?v=`, so a club that changes its logo changes the
       * URL and nobody is left holding the old one.
       */
      "Cache-Control": "public, max-age=31536000, immutable",
      ETag: `"${logoVersion(row.logoUrl)}"`,
    },
  });
}
