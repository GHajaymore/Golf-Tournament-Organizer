import { STEPPER_PREVIEW } from "@/lib/domain/lifecycle-track";
import { BUILD_PREVIEW } from "@/lib/domain/console-merges";

/**
 * THE ADDRESS OF A REDESIGNED SCREEN WHILE IT IS ONLY PREVIEWED (R1a).
 *
 * `preview` draws the new console (`?stepper=1`); `build` also draws the screens still "building"
 * (`?stepper=1&build=1`, never in production). Specs and engineers asked for these by writing the
 * query by hand, and a hand-written one drops the path's own query (`?round=`) or lands after a hash.
 * The path's own query and its `#place` are kept; a preview query already on it is not doubled.
 */
export type ConsoleMode = "build" | "preview";

export function consoleUrl(path: string, mode: ConsoleMode): string {
  const at = path.indexOf("#");
  const before = at === -1 ? path : path.slice(0, at);
  const place = at === -1 ? "" : path.slice(at);
  const q = before.indexOf("?");
  const base = q === -1 ? before : before.slice(0, q);
  const params = new URLSearchParams(q === -1 ? "" : before.slice(q + 1));
  params.set(STEPPER_PREVIEW, "1");
  if (mode === "build") params.set(BUILD_PREVIEW, "1");
  else params.delete(BUILD_PREVIEW);
  return `${base}?${params.toString()}${place}`;
}

/**
 * THE ONE ADDRESS OF A MEMBER'S HISTORY (R7), built here for every caller: `/member?member=` while Members is
 * not shown, a section of `/roster` (`#history`) while it is. Inside a preview the preview parameters stay on.
 */
export function memberHistoryHref(id: string, base: "/member" | "/roster", mode: ConsoleMode | null): string {
  const href = `${base}?member=${encodeURIComponent(id)}${base === "/roster" ? "#history" : ""}`;
  return mode ? consoleUrl(href, mode) : href;
}

/**
 * WHICH PREVIEW A REQUEST IS IN (R7), read off its query: `build` when both preview parameters are on,
 * `preview` when only the first is, and null when the redesign is not being previewed (a plain address).
 * A link or a redirect that stays inside a previewed screen goes through `consoleUrl(href, mode)` when this is
 * not null, so the person is not dropped back onto the screen that is still live.
 */
export function previewModeOf(search: string): ConsoleMode | null {
  const q = new URLSearchParams(search);
  if (q.get(STEPPER_PREVIEW) !== "1") return null;
  return q.get(BUILD_PREVIEW) === "1" ? "build" : "preview";
}
