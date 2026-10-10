"use client";
import Link from "next/link";
import { setRoundClosed } from "@/app/actions/tournament";
import { ConfirmButton } from "./ConfirmButton";
import { Icon } from "./Icon";
import { useAction } from "./useAction";

/**
 * THE CUT, WAITING ON THE ORGANIZER — Ajay, 2026-10-05.
 *
 * "Cut can't be final unless organizer approve all cards and approve the Cut."
 * This appears only once every card in the round is approved (`cutReady`), and
 * it is where the organizer approves the cut: the button marks the round
 * finished, which is the act that makes it (`setRoundClosed` →
 * `applyStrokeCut`). Before this card existed the only door was a checkbox on
 * Rounds & formats that said nothing about a cut.
 *
 * It shows what will happen before it happens — how many go through and how
 * many miss — because approving a cut sends people home. Two taps, and the
 * second says so. Re-opening the round on Rounds & formats undoes it.
 */
export function CutReadyCard({
  feederId,
  feederName,
  nextName,
  rule,
  through,
  missed,
  noCard = [],
}: {
  feederId: string;
  feederName: string;
  nextName: string;
  /** "Top 16 and ties" — the rule as the committee set it. */
  rule: string;
  through: number;
  missed: number;
  /** Players in the round's field with no card — they miss the cut too. */
  noCard?: string[];
}) {
  const { pending, error, run } = useAction();

  return (
    <section
      aria-label="The cut is ready"
      className="card elev-sm"
      style={{ marginBottom: 16, gap: 10, borderColor: "var(--color-accent-700)" }}
    >
      <span className="card-kicker">The cut</span>
      <p style={{ margin: 0, fontSize: 16, fontWeight: 600, lineHeight: 1.4 }}>
        {noCard.length > 0 ? `Every ${feederName} card returned is approved` : `All ${feederName} cards are approved`} —
        approve the cut.
      </p>
      {noCard.length > 0 && (
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55 }}>
          No card from {listOf(noCard)}. {noCard.length === 1 ? "That player misses" : "They miss"} the cut unless you
          enter {noCard.length === 1 ? "the card" : "their cards"} on <Link href="/entry">Score entry</Link> first.
        </p>
      )}
      <p className="text-muted" style={{ margin: 0, fontSize: 14, lineHeight: 1.55 }}>
        {rule}: {through} {through === 1 ? "player goes" : "players go"} through to {nextName}
        {missed > 0 ? `, ${missed} ${missed === 1 ? "misses" : "miss"} the cut` : ""}. Approving marks{" "}
        {feederName} finished and gives {nextName} cards to those going through.
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <ConfirmButton
          className="btn btn-primary"
          icon="check-circle"
          label="Approve the cut"
          title={`Approve the cut after ${feederName}`}
          confirmLabel="Make the cut"
          note={`${through} go through to ${nextName}. You can re-open ${feederName} on Rounds & formats to correct a card.`}
          disabled={pending}
          onConfirm={() => run(() => setRoundClosed(feederId, true))}
          style={{ minHeight: 44 }}
        />
        <Link href="/leaderboard" className="btn btn-secondary" style={{ minHeight: 44 }}>
          See the board <Icon name="arrow-right" />
        </Link>
      </div>
      {error && (
        <p className="form-error">
          <Icon name="warning-circle" /> {error}
        </p>
      )}
    </section>
  );
}

/** "Ann", "Ann and Bob", "Ann, Bob and Cy". */
function listOf(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
