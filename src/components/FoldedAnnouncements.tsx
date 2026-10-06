"use client";
import { useEffect, useState } from "react";
import { AnnouncementCard, type AnnouncementItem } from "./AnnouncementCard";
import { hasSeen, markSeen } from "./useSeenOnce";

const keyFor = (id: string) => `announcement.${id}`;

/**
 * A NOTICE IS READ ONCE, THEN FOLDED.
 *
 * New ones are shown in full; ones this phone has already shown fold into a
 * single "N earlier messages" line that opens to the same cards. Nothing is
 * dropped — the folded cards stay in the page, and the organizer's dashboard
 * keeps the plain list.
 *
 * Everything renders open on the server and the first client render — exactly
 * the list as it always was — and folds once the browser has said what this
 * phone has seen. That is the safe direction: a player whose storage is
 * blocked sees every notice, never none. It sits at the foot of Today, so
 * folding moves nothing above it.
 *
 * `earlierFold: false` is the PINNED list (2026-10-06, the one-screen Today):
 * a pinned notice is never folded away — pinning means it outranks the rest —
 * but once read it is ONE LINE, its title, with the text a tap away. Read
 * before it shrinks, always: the fixture's own "Round 2 tee times are up"
 * carries the first tee time in its body, and a title alone would hide it.
 */
export function FoldedAnnouncements({
  items,
  earlierFold = true,
}: {
  items: AnnouncementItem[];
  earlierFold?: boolean;
}) {
  const [seen, setSeen] = useState<Set<string> | null>(null);

  // Keyed on the ids, not the array: a refresh hands down a new array of the
  // same notices, and re-reading then would fold the ones just shown as new.
  const ids = items.map((a) => a.id).join("|");
  useEffect(() => {
    const list = ids ? ids.split("|") : [];
    setSeen(new Set(list.filter((id) => hasSeen(keyFor(id)))));
    for (const id of list) markSeen(keyFor(id));
  }, [ids]);

  const fresh = seen ? items.filter((a) => !seen.has(a.id)) : items;
  const earlier = seen ? items.filter((a) => seen.has(a.id)) : [];

  if (!earlierFold) {
    return (
      <div style={{ marginBottom: 16, display: "flex", flexDirection: "column", gap: 8 }}>
        {items.map((a) => (
          <AnnouncementCard key={a.id} a={a} compact={!!seen?.has(a.id)} />
        ))}
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 16, display: "flex", flexDirection: "column", gap: 8 }}>
      {fresh.map((a) => (
        <AnnouncementCard key={a.id} a={a} />
      ))}
      {earlier.length > 0 && (
        <details>
          <summary
            className="touch-target"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 14, fontWeight: 600, color: "var(--color-accent-200)" }}
          >
            {earlier.length === 1 ? "1 earlier message" : `${earlier.length} earlier messages`}
          </summary>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
            {earlier.map((a) => (
              <AnnouncementCard key={a.id} a={a} />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
