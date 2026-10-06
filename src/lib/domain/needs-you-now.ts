import type { ReviewQueue } from "./review-queue";

/**
 * THE ORGANIZER'S TO-DO LIST ON THE DAY — Ajay, 2026-10-05.
 *
 * Read off the dashboard at 393px: a disputed result was a paragraph in the
 * status card, cards to approve were an "Awaiting review" tile, and "1
 * disputed" sat under the round's progress bar. All three were right; an
 * organizer on a phone had to find them. This is one list — a line per thing
 * to do, each with the screen it is done on.
 *
 * From `state.reviewing` only, so it cannot disagree with the counts on the
 * same screen. Disputes first: they block finishing the tournament
 * (`finishRefusal`), and approving is never the answer to one.
 */
export interface NeedsYouItem {
  key: "disputed" | "review" | "knockouts" | "lineup";
  text: string;
  href: string;
  action: string;
}

const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export function needsYouNow(input: {
  reviewing: ReviewQueue;
  /**
   * A team cup's sessions, in order (2026-10-06). Its job before every
   * session is the lineup — picked, then announced — so a drafted lineup is
   * waiting on the organizer, and so is the NEXT session with none. Only the
   * next: Sunday's singles are not Saturday morning's problem.
   */
  cup?: { sessions: { name: string; published: boolean; matches: number }[] };
}): NeedsYouItem[] {
  const q = input.reviewing;
  const items: NeedsYouItem[] = [];

  if (q.disputed > 0) {
    items.push({ key: "disputed", text: `${n(q.disputed, "disputed result", "disputed results")} to settle`, href: "/entry", action: "Settle it" });
  }

  const toApprove = [
    q.cards > 0 ? n(q.cards, "card", "cards") : "",
    q.matches > 0 ? n(q.matches, "match result", "match results") : "",
  ].filter(Boolean);
  if (toApprove.length > 0) {
    items.push({ key: "review", text: `${toApprove.join(" and ")} to approve`, href: "/entry", action: "Review" });
  }

  if (q.knockouts > 0) {
    items.push({
      key: "knockouts",
      text: `${n(q.knockouts, "knockout result", "knockout results")} reported`,
      href: "/bracket",
      action: "Review",
    });
  }

  // After the results: a pairing waits on a person, a result waits on a field.
  for (const s of input.cup?.sessions ?? []) {
    if (!s.published && s.matches > 0) {
      items.push({ key: "lineup", text: `${s.name} lineup is ready to announce`, href: "/cup", action: "Announce" });
    }
  }
  const next = input.cup?.sessions.find((s) => !s.published && s.matches === 0);
  if (next) items.push({ key: "lineup", text: `${next.name} has no lineup yet`, href: "/cup", action: "Set the lineup" });

  return items;
}
