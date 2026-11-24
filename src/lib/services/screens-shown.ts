import "server-only";
import { headers } from "next/headers";
import { mergesShown, type ScreenKey } from "@/lib/domain/console-merges";
import { isOwner } from "@/lib/owner";
import { consoleUrl, previewModeOf, type ConsoleMode } from "@/lib/console-url";

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

/** The preview this request is in (`previewModeOf`), for a redirect or a link that must stay inside it. */
export async function previewModeNow(): Promise<ConsoleMode | null> {
  return previewModeOf((await headers()).get("x-search") ?? "");
}

/** A path as this request should be sent to it: the preview kept while the screen is only previewed. */
export async function keepingPreview(path: string): Promise<string> {
  const mode = await previewModeNow();
  return mode ? consoleUrl(path, mode) : path;
}
