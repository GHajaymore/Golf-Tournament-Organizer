import type { NextRequest } from "next/server";
import { FRONT_DOOR_CSS, FRONT_DOOR_CSS_VERSION } from "@/lib/landing/front-door-sheet";

/**
 * The front door's stylesheet (`src/lib/landing/front-door-sheet.ts` says why
 * it is a file). Public, like the page it dresses.
 *
 * Kept for a year only when the address carries THIS sheet's fingerprint. A
 * page from an older deploy asking for its own version is given today's text
 * and told not to keep it, so the old address is never stored holding the new
 * sheet.
 */
export function GET(request: NextRequest) {
  const current = request.nextUrl.searchParams.get("v") === FRONT_DOOR_CSS_VERSION;
  return new Response(FRONT_DOOR_CSS, {
    headers: {
      "Content-Type": "text/css; charset=utf-8",
      "Cache-Control": current ? "public, max-age=31536000, s-maxage=31536000, immutable" : "public, max-age=0, must-revalidate",
    },
  });
}
