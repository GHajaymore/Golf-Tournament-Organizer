import "server-only";
import { headers } from "next/headers";
import { mergesShown, type ScreenKey } from "@/lib/domain/console-merges";
import { isOwner } from "@/lib/owner";

/**
 * WHICH REDESIGNED SCREENS DOES THIS REQUEST SHOW? (R1c). One answer for a page: the request's own
 * query (`x-search`, set by the middleware) asked of `mergesShown` for this viewer, exactly as the
 * layout asks it. A page that varies by a redesigned screen calls this and never `mergesShown`
 * itself (`console-merges.test.ts` refuses a second caller). Server only: it reads the request.
 */
export async function screensShownFor(session: { email: string }): Promise<ReadonlySet<ScreenKey>> {
  const asked = await headers();
  return mergesShown(asked.get("x-search") ?? "", { owner: isOwner(session.email) });
}
