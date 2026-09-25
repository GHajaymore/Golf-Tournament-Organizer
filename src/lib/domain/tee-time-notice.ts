/**
 * Who to notify when a tee sheet is published, and whether it is news or a change.
 *
 * Publishing is the confirmed, outward-facing act (`teeSheetPublished`), so it
 * is the only moment a notice goes out — never on a draft save. The interesting
 * part is the SECOND publish: an organizer who fixes one group should not ping
 * the whole field, so a re-publish notifies only the players whose time or
 * start actually moved. The FIRST publish is news to everyone in the sheet.
 *
 * Pure and separate from the send so the decision — the part that would spam a
 * field if it were wrong — can be tested without a push service or a database.
 * The DIFF baseline (the previously stored sheet) and whether this is a first
 * publish are the caller's to resolve; here it is just old vs new.
 */

import { groupForPlayer, type TeeSheet } from "./tee-sheet";

export interface TeeTimeNotice {
  playerId: string;
  /** "new" the first time they are told; "changed" when their time/start moved. */
  kind: "new" | "changed";
  /** The published tee time, e.g. "8:10 AM" — as the sheet stores it. */
  time: string;
  startHole: number;
}

/**
 * The notices a publish produces.
 *
 * On a first publish (or with no previous sheet to compare) everyone drawn is
 * told, as "new". On a re-publish, a player is told only when their group's
 * time or start hole differs from the previous sheet — a player who is newly
 * added is "new", one whose time moved is "changed", and one whose time is
 * unchanged is silent. A player dropped from the sheet is not notified here;
 * their withdrawal is a separate message.
 */
export function teeTimeNotices(
  previous: TeeSheet | null,
  next: TeeSheet,
  firstPublish: boolean,
): TeeTimeNotice[] {
  const out: TeeTimeNotice[] = [];
  for (const group of next.groups) {
    for (const playerId of group.playerIds) {
      if (firstPublish || !previous) {
        out.push({ playerId, kind: "new", time: group.time, startHole: group.startHole });
        continue;
      }
      const before = groupForPlayer(previous, playerId);
      if (!before) {
        // In the new sheet but not the old one: news to them.
        out.push({ playerId, kind: "new", time: group.time, startHole: group.startHole });
        continue;
      }
      if (before.time !== group.time || before.startHole !== group.startHole) {
        out.push({ playerId, kind: "changed", time: group.time, startHole: group.startHole });
      }
      // Unchanged: no notice. Re-publishing a fixed typo must not ping them.
    }
  }
  return out;
}
