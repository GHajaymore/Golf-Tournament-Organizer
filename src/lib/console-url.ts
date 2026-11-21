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
