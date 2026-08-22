"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { memberHandicapSuggestion, acceptClubHandicap } from "@/app/actions/roster";
import type { MemberRecord } from "@/lib/services/handicap-record";

/**
 * What this member's own cards say they should play off.
 *
 * It SUGGESTS and never applies. A club's handicaps are the club's, and a
 * number that moved on its own is one nobody can answer a question about on
 * the first tee. The committee reads the working and accepts it, or does not.
 *
 * The working is the point. A handicap offered without it is a number to take
 * on trust, and a committee will not — so this shows how many cards were
 * found, how many counted, which of the lowest were averaged, what the Rules'
 * adjustment did, and what was left out with the reason for each.
 *
 * Loaded on demand rather than for the whole roster: the record costs several
 * queries per member, and a club of two hundred would pay six hundred of them
 * to render a list nobody has asked a question about yet.
 */

const REASONS: Record<string, string> = {
  "unrated-tee": "played off a tee with no Course Rating and Slope",
  "nine-hole": "nine holes — the Rules pair two of those into one score",
  incomplete: "more than a third of the card missing",
};

export function ClubHandicapPanel({
  memberId,
  memberName,
  currentHandicap,
  onClose,
}: {
  memberId: string;
  memberName: string;
  currentHandicap: number;
  onClose: () => void;
}) {
  const router = useRouter();
  const [record, setRecord] = useState<MemberRecord | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();

  // Loaded when the panel appears, because the parent only mounts it once
  // somebody has asked. Doing it for every row on page load would be several
  // queries per member to answer a question nobody put.
  useEffect(() => {
    setError("");
    startTransition(async () => {
      const res = await memberHandicapSuggestion(memberId);
      if (!res.ok || !res.record) {
        setError(res.error ?? "Couldn't read that member's record.");
        return;
      }
      setRecord(res.record);
    });
    // Once, for this member. The panel is remounted when another is opened.
  }, [memberId]);

  const accept = () => {
    setError("");
    startTransition(async () => {
      const res = await acceptClubHandicap(memberId);
      if (!res.ok) {
        setError(res.error ?? "Couldn't apply that handicap.");
        return;
      }
      setNote(`${memberName} now plays off ${res.handicap}. Rounds already played are unchanged.`);
      setRecord(null);
      router.refresh();
    });
  };

  const skipped = record ? Object.entries(record.skipped).filter(([, n]) => n > 0) : [];

  return (
    <div className="card elev-sm" style={{ gap: 8, marginTop: 8 }}>
      <span className="card-title" style={{ fontSize: 14 }}>
        {memberName} — what their cards say
      </span>

      {pending && !record && (
        <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
          Reading their approved cards…
        </p>
      )}

      {record && (
        <>
          <p className="text-muted" style={{ fontSize: 12, margin: 0, lineHeight: 1.6 }}>
            {record.cardsFound === 0
              ? "No approved cards yet. A card counts once the committee has accepted it."
              : `${record.cardsFound} approved ${record.cardsFound === 1 ? "card" : "cards"}, of which ` +
                `${record.differentials.length} could be scored for handicap.`}
          </p>

          {skipped.length > 0 && (
            // Named, not merely subtracted. A member who played six rounds and
            // sees "from 3" will otherwise assume the app lost three of them.
            <ul className="text-muted" style={{ fontSize: 11.5, margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
              {skipped.map(([reason, n]) => (
                <li key={reason}>
                  {n} {n === 1 ? "round" : "rounds"} not counted — {REASONS[reason] ?? reason}
                </li>
              ))}
            </ul>
          )}

          {record.suggestion ? (
            <>
              <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
                <span className="text-muted" style={{ fontSize: 12 }}>
                  Plays off <b>{currentHandicap}</b> today
                </span>
                <span style={{ fontFamily: "var(--font-heading)", fontSize: 22, color: "var(--color-accent)" }}>
                  {record.suggestion.handicap}
                </span>
                <span className="text-muted" style={{ fontSize: 11.5 }}>
                  from the lowest {record.suggestion.lowestCounted} of {record.suggestion.scoresUsed}
                  {record.suggestion.adjustment !== 0 && `, ${record.suggestion.adjustment} adjustment`}
                </span>
              </div>

              {/* The one thing this number is not, said where the number is. */}
              <p className="text-muted" style={{ fontSize: 11, margin: 0, lineHeight: 1.5 }}>
                A club handicap from this club&rsquo;s own cards — not a WHS Handicap Index, which only a
                national association can issue. It carries no Playing Conditions adjustment, because that
                is worked out from every card played that day across every club.
              </p>

              {record.maySuggest ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ alignSelf: "flex-start" }}
                  disabled={pending}
                  onClick={accept}
                >
                  <i className="ph ph-check" /> Set {memberName} to {record.suggestion.handicap}
                </button>
              ) : (
                // Shown, never offered. The association is the authority and the
                // action refuses this too — hiding a button stops nobody.
                <p style={{ fontSize: 12, margin: 0, color: "var(--color-accent)", lineHeight: 1.6 }}>
                  <i className="ph ph-lock-simple" /> Their handicap comes from their association, so
                  TourneyHQ won&rsquo;t replace it. The record is here to read.
                </p>
              )}
            </>
          ) : (
            record.cardsFound > 0 && (
              <p className="text-muted" style={{ fontSize: 12, margin: 0, lineHeight: 1.6 }}>
                Not enough yet — the Rules issue no handicap below three scored rounds.
              </p>
            )
          )}
        </>
      )}

      {note && (
        <p style={{ fontSize: 12, margin: 0, color: "var(--color-accent-2-300)" }}>
          <i className="ph ph-check-circle" /> {note}
        </p>
      )}
      {error && (
        <p style={{ fontSize: 12, margin: 0, color: "var(--color-danger)" }}>
          <i className="ph ph-warning-circle" /> {error}
        </p>
      )}

      <button
        type="button"
        className="btn btn-ghost"
        style={{ alignSelf: "flex-start", fontSize: 12 }}
        onClick={onClose}
      >
        Close
      </button>
    </div>
  );
}
