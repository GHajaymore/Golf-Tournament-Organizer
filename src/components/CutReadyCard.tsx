"use client";
import Link from "next/link";
import { useState } from "react";
import { setRoundClosed, settleCutTie } from "@/app/actions/tournament";
import { bringIntoView } from "@/lib/bring-into-view";
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
 *
 * AND A TIE FOR THE LAST PLACE IS SETTLED HERE (2026-10-23), on the card whose
 * button it holds up. Under a play-off, or a countback that could not separate
 * them, the cut cannot be made until the committee records who went through —
 * so the tie is named, with a tick for each player in it, and the button says
 * why it is waiting beside itself (`strokeCutOutcome`).
 */
export interface CutTieOnCard {
  tied: string[];
  names: string[];
  places: number;
  by: "playoff" | "draw";
  /** Who the committee recorded as going through; empty while undecided. */
  chosen: string[];
}

export function CutReadyCard({
  feederId,
  feederName,
  nextName,
  rule,
  through,
  missed,
  noCard = [],
  tieRule,
  ties = [],
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
  /** How a tie for the last place is settled, in the committee's words. */
  tieRule?: string;
  /** Ties at the line the committee settles here — decided or not. */
  ties?: CutTieOnCard[];
}) {
  const { pending, error, run } = useAction();
  const waiting = ties.filter((t) => t.chosen.length === 0);

  return (
    <section
      aria-label="The cut is ready"
      className="card elev-sm"
      style={{ marginBottom: 16, gap: 10, borderColor: "var(--color-accent-700)" }}
    >
      <span className="card-kicker">The cut</span>
      <p style={{ margin: 0, fontSize: 16, fontWeight: 600, lineHeight: 1.4 }}>
        {noCard.length > 0 ? `Every ${feederName} card returned is approved` : `All ${feederName} cards are approved`} —
        {waiting.length > 0 ? " settle the tie for the last place, then approve the cut." : " approve the cut."}
      </p>
      {noCard.length > 0 && (
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55 }}>
          No card from {listOf(noCard)}. {noCard.length === 1 ? "That player misses" : "They miss"} the cut unless you
          enter {noCard.length === 1 ? "the card" : "their cards"} on <Link href="/entry">Score entry</Link> first.
        </p>
      )}
      {ties.map((t) => (
        <CutTiePanel key={t.tied.join(",")} feederId={feederId} tie={t} tieRule={tieRule} />
      ))}
      <p className="text-muted" style={{ margin: 0, fontSize: 14, lineHeight: 1.55 }}>
        {rule}: {through} {through === 1 ? "player goes" : "players go"} through to {nextName}
        {waiting.length > 0 ? `, and ${waiting.reduce((n, t) => n + t.places, 0)} more out of the tie` : ""}
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
          disabled={pending || waiting.length > 0}
          onConfirm={() => run(() => setRoundClosed(feederId, true))}
          style={{ minHeight: 44 }}
        />
        <Link href="/leaderboard" className="btn btn-secondary" style={{ minHeight: 44 }}>
          See the board <Icon name="arrow-right" />
        </Link>
      </div>
      {/* Why the button is grey, beside the button — not in a tooltip. */}
      {waiting.length > 0 && (
        <p className="text-muted" style={{ margin: 0, fontSize: 13 }}>
          <Icon name="warning-circle" /> The cut waits on the tie above: record who went through, and this button opens.
        </p>
      )}
      {error && (
        <p className="form-error" role="alert" ref={bringIntoView}>
          <Icon name="warning-circle" /> {error}
        </p>
      )}
    </section>
  );
}

/** One tie at the line, with a tick for each player in it. */
function CutTiePanel({ feederId, tie, tieRule }: { feederId: string; tie: CutTieOnCard; tieRule?: string }) {
  const [picked, setPicked] = useState<string[]>(tie.chosen);
  const { pending, error, run } = useAction();
  const decided = tie.chosen.length > 0;
  const what = tie.by === "playoff" ? "play-off" : "draw";
  const places = tie.places === 1 ? "the last place" : `the last ${tie.places} places`;
  const toggle = (id: string, on: boolean) =>
    setPicked((now) => (on ? [...now.filter((x) => x !== id), id] : now.filter((x) => x !== id)));

  return (
    <fieldset
      aria-label={`Tied for ${places}`}
      style={{
        margin: 0,
        padding: "10px 12px",
        border: "1px solid color-mix(in srgb, var(--color-accent) 35%, transparent)",
        borderRadius: "var(--radius-md)",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <legend style={{ fontWeight: 600, fontSize: 14, padding: "0 4px" }}>
        {decided ? `The ${what} for ${places} is recorded` : `Tied for ${places}`}
      </legend>
      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55 }}>
        {listOf(tie.names)} are level for {places}.{" "}
        {tie.by === "playoff"
          ? `${tieRule ?? "This cut settles a tie by play-off"}. Tick who won it.`
          : `They are level on countback too (last 9, 6, 3 and the last hole), so lots are drawn. Tick who the draw sent through.`}{" "}
        Nobody in the tie has missed the cut until you do.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {tie.tied.map((id, i) => (
          <label key={id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, minHeight: 32, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={picked.includes(id)}
              disabled={pending}
              onChange={(e) => toggle(id, e.target.checked)}
            />
            {tie.names[i]}
          </label>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn btn-secondary"
          style={{ minHeight: 44 }}
          disabled={pending}
          onClick={() => run(() => settleCutTie(feederId, tie.tied, picked))}
        >
          <Icon name="check" /> {decided ? `Save the ${what} result` : `Record the ${what}`}
        </button>
        {decided && (
          <button
            type="button"
            className="btn btn-ghost"
            style={{ minHeight: 44 }}
            disabled={pending}
            onClick={() => run(() => settleCutTie(feederId, tie.tied, []), () => setPicked([]))}
          >
            Take it back
          </button>
        )}
      </div>
      {/* Said where the press was: the tick boxes and the button are here. */}
      {error && (
        <p className="form-error" role="alert" ref={bringIntoView}>
          <Icon name="warning-circle" /> {error}
        </p>
      )}
    </fieldset>
  );
}

/** "Ann", "Ann and Bob", "Ann, Bob and Cy". */
function listOf(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
