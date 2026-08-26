import "server-only";
import { revalidateTag } from "next/cache";
import { boardTag } from "./live-board";

/**
 * Say that a tournament's standings moved.
 *
 * The public board is cached per event — one computation shared by everyone
 * watching — so something has to retire that entry when a score lands. This is
 * that something, and it is one function rather than a `revalidateTag` call
 * spelled out in a dozen action files, because the tag string is a contract
 * between the writer and the reader and a contract with twelve authors drifts.
 *
 * `services/live-board.ts` owns the tag; nothing else composes it by hand.
 *
 * WHAT HAPPENS IF SOMEBODY FORGETS to call this: the board is stale until its
 * sixty-second backstop expires. That is the whole reason the backstop exists.
 * A missed call here is a nuisance — a board a minute behind — rather than a
 * board that is wrong until the next deploy, and the difference between those
 * two failures is why the cache is not tag-invalidation alone.
 */
export function boardChanged(eventId: string): void {
  if (!eventId) return;
  revalidateTag(boardTag(eventId));
}
