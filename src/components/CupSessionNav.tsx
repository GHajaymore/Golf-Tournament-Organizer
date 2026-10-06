import Link from "next/link";

export interface CupSessionLink {
  id: string;
  /** "Saturday four-balls" — the session as the club named it. */
  name: string;
  /** "Four-Ball", "Foursomes", "Singles". */
  kind: string;
}

/**
 * THE CUP'S SESSIONS, AS LINKS — on Score entry.
 *
 * Score entry opened whichever round the tournament called active and offered
 * no way to another, so on a cup weekend the player in Saturday's foursomes
 * opened the four-balls and was told "No sides drawn yet". A pair session and
 * a singles session are two different screens (one card per side, one card
 * per match), so this is navigation between them rather than a dropdown inside
 * one: each link reloads Score entry on that session.
 */
export function CupSessionNav({ sessions, current }: { sessions: CupSessionLink[]; current: string }) {
  if (sessions.length < 2) return null;
  return (
    <nav aria-label="Cup sessions" style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "0 0 16px" }}>
      {sessions.map((s) => {
        const on = s.id === current;
        return (
          <Link
            key={s.id}
            href={`/entry?round=${encodeURIComponent(s.id)}`}
            aria-current={on ? "page" : undefined}
            className="btn btn-secondary"
            style={{
              fontSize: 14,
              ...(on ? { color: "var(--color-accent-200)", borderColor: "var(--color-accent)", fontWeight: 600 } : {}),
            }}
          >
            {s.name}
            <span className="text-muted" style={{ fontWeight: 400 }}>
              {" "}· {s.kind}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
