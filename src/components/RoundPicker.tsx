"use client";
import { useRouter, usePathname } from "next/navigation";

/**
 * "Which round am I looking at?" — on whichever screen is asking.
 *
 * Every screen that shows one round at a time reads `?round=<stageId>` and
 * falls back to the active one. The control that sets it was written twice and
 * both copies were wrong:
 *
 *   - Group games rendered the picker `disabled`. It listed all four rounds of
 *     a four-round event, showed the current one, and could not be changed —
 *     while the page it sat on supported `?round=` perfectly. The only way to
 *     see another round's pots was to edit the URL.
 *   - The pot card's own picker worked, and navigated to a HARD-CODED
 *     `/prizes?round=…`. That card is rendered on Group games too, so choosing
 *     a round there threw the organizer onto Prizes & payouts — a different
 *     screen, showing the club's money instead of the fourball's.
 *
 * So this one does not know what screen it is on and cannot be told: it reads
 * `usePathname()` and returns there. A picker that never names a destination
 * cannot navigate to the wrong one, and the third screen to need it is correct
 * without anybody remembering the rule.
 */

export interface PickableRound {
  stageId: string;
  label: string;
}

export function RoundPicker({
  rounds,
  activeStageId,
  className = "input",
  style,
  label = "Round",
}: {
  rounds: PickableRound[];
  activeStageId: string;
  className?: string;
  style?: React.CSSProperties;
  /** The accessible name. Visible labels are the caller's business. */
  label?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();

  // One round is not a choice. Rendering a select with a single option is a
  // control that looks live and does nothing, which is the fault above in a
  // quieter form.
  if (rounds.length <= 1) return null;

  return (
    <select
      className={className}
      style={style}
      aria-label={label}
      value={activeStageId}
      onChange={(e) => router.push(`${pathname}?round=${e.target.value}`)}
    >
      {rounds.map((r) => (
        <option key={r.stageId} value={r.stageId}>
          {r.label}
        </option>
      ))}
    </select>
  );
}
