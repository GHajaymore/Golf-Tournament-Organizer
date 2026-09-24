import { CONTEST_LABEL, contestHasHole, type ContestKind } from "@/lib/domain/contests";
import { money } from "@/lib/domain/money-format";

/**
 * WHAT'S UP FOR GRABS TODAY — the on-course competitions, on the player's Today
 * screen.
 *
 * The organizer sets these up as Contests (closest to the pin, long drive), and
 * until now a player only ever met them on the money screen, mostly after the
 * result. But the point of a nearest-the-pin is knowing which hole to go for
 * WHILE you play, so it belongs on Today, beside the round and the day's notice.
 *
 * Reads the round's Contests as they already are — nothing new is stored. Only
 * the on-course kinds appear (a poker night is not something you aim at from the
 * 7th tee), and each shows its hole so a player knows where it is. A stake is
 * shown when there is one; a free club contest just says "free to enter".
 */

const ORD = ["th", "st", "nd", "rd"];
function ordinal(n: number): string {
  const v = n % 100;
  return `${n}${ORD[(v - 20) % 10] ?? ORD[v] ?? ORD[0]}`;
}

/** A small flag-in-hole mark for the card, tinted by the theme accent. */
function HoleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden style={{ flexShrink: 0 }}>
      <path d="M7 3v16" stroke="var(--color-accent-300)" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M7 4h9l-2.4 3L16 10H7" fill="var(--color-accent)" />
      <ellipse cx="12" cy="20" rx="6" ry="1.4" fill="var(--color-neutral-700)" />
    </svg>
  );
}

export interface TodayContest {
  id: string;
  kind: ContestKind;
  name: string;
  hole: number;
  buyInCents: number;
}

export function TodayContests({
  contests,
  currency,
}: {
  contests: TodayContest[];
  currency: string;
}) {
  // On the course only: a nearest-the-pin is somewhere you aim; a poker school
  // is not. `contestHasHole` is the one place that distinction lives.
  const onCourse = contests.filter((c) => contestHasHole(c.kind));
  if (onCourse.length === 0) return null;

  return (
    <section
      aria-label="On the course today"
      className="card elev-sm"
      style={{ marginTop: 16, gap: 10 }}
    >
      <span className="card-kicker">On the course today</span>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        {onCourse.map((c) => {
          // The kind names the game; the free-text `name` is shown only when it
          // adds something the label and hole do not (a themed or "other" bet).
          const label = CONTEST_LABEL[c.kind];
          const extra =
            c.kind === "other" && c.name.trim() ? c.name.trim() : "";
          const stake = c.buyInCents > 0 ? `${money(c.buyInCents, currency)} to enter` : "Free to enter";
          return (
            <li key={c.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <HoleMark />
              <span style={{ minWidth: 0, flex: 1 }}>
                <span style={{ fontWeight: 600, fontSize: 14 }}>
                  {c.kind === "other" && extra ? extra : label}
                </span>
                {c.hole > 0 && (
                  <span style={{ color: "var(--color-accent-300)", fontWeight: 600, fontSize: 14 }}>
                    {" — "}
                    {ordinal(c.hole)}
                  </span>
                )}
              </span>
              <span
                className="tag tag-neutral"
                style={{ fontSize: 11, flexShrink: 0 }}
              >
                {stake}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
