"use client";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { HoleByHoleCard } from "@/components/HoleByHoleCard";
import { ScorecardTable, type CardBrand } from "@/components/ScorecardTable";
import { saveScorecard, certifyScorecard } from "@/app/actions/tournament";
import { usePendingCard } from "@/components/usePendingCard";
import { RuleCite } from "@/components/RuleCite";
import { toParText } from "@/lib/domain";

/**
 * A player's own card, on a phone, outdoors, mid-round.
 *
 * Deliberately thinner than the console's StrokePlayEntry: no player picker,
 * no tee-group switch, no voice entry. A player entering their own round needs
 * none of it, and every control that offers one is a thing to get wrong with a
 * glove on.
 *
 * Three things this screen has to do that the old one did not:
 *
 *   1. Show where the round stands, always. A player taps a score and
 *      immediately wants "so what am I?" — and was getting no answer at all
 *      without leaving for the board. Gross, to par, net and thru now sit
 *      above the hole and never move.
 *   2. Save itself. There was a Save button, and a Save button on a golf
 *      course is a round lost to a phone that went in a pocket. Every tap
 *      writes, and the screen says which state that write is in — the same
 *      sticky, honest reporting the console's entry card uses, for the same
 *      reason: a failed write and a successful one otherwise look identical.
 *   3. Say what a shot is worth. The strokes this player receives on each hole
 *      come from the SERVER, resolved off their tee and the round's allowance.
 *      Net worked out on the phone from a roster Index is arithmetic the
 *      tournament will not agree with.
 *
 * Certify stays a button, and stays deliberate. Saving is bookkeeping;
 * certifying is a statement under Rule 3.3b that these hole scores are right.
 */
export function PlayerCard({
  stageId,
  playerId,
  playerName,
  roundLabel,
  courseName = "",
  venueIsHome = false,
  holes,
  pars,
  yards,
  strokeIndex,
  shotsPerHole = [],
  playingHandicap = 0,
  status,
  brand,
  initialStrokes,
}: {
  stageId: string;
  playerId: string;
  playerName: string;
  roundLabel: string;
  /** The round's venue, when it is not simply the tournament's. */
  courseName?: string;
  /** Whether that course is the club's own — decides whether the club's mark
   *  heads the card or is named beneath the course. */
  venueIsHome?: boolean;
  holes: number;
  pars: number[];
  yards: number[];
  strokeIndex: number[];
  /** Handicap strokes received per hole, allocated on the server. */
  shotsPerHole?: number[];
  /** The Playing Handicap those strokes add up to, for the header. */
  playingHandicap?: number;
  status: string;
  /** The club's mark, for the head of the card — the badge that is on the
   *  paper one. Optional; an unbranded card simply has no header. */
  brand?: CardBrand | null;
  /** The card as already returned. Opening blank and then saving would erase
   *  a round that was half entered on the ninth tee. */
  initialStrokes: (number | null)[];
}) {
  const [strokes, setStrokes] = useState<(number | null)[]>(() =>
    Array.from({ length: holes }, (_, i) => initialStrokes[i] ?? null),
  );
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState("");
  const [state, setState] = useState(status);
  /** Hole by hole for the round; the full card for checking it after. */
  const [view, setView] = useState<"hole" | "card">("hole");
  const [error, setError] = useState("");

  const filled = strokes.filter((s) => s != null).length;
  const complete = filled >= holes;
  const locked = state === "approved";
  const knownCourse = pars.length > 0;

  /**
   * Where the round stands, over the holes actually played.
   *
   * Par to date rather than par for the course, and strokes received on the
   * holes played rather than the whole allowance — so the numbers mean
   * something through six holes as well as through eighteen. The same rule the
   * server totals by, so this screen and the board cannot disagree.
   */
  const summary = useMemo(() => {
    let gross = 0;
    let parThru = 0;
    let received = 0;
    let played = 0;
    for (let i = 0; i < holes; i += 1) {
      const s = strokes[i];
      if (typeof s !== "number" || s <= 0) continue;
      gross += s;
      parThru += pars[i] ?? 0;
      received += shotsPerHole[i] ?? 0;
      played += 1;
    }
    return { gross, played, toPar: gross - parThru, net: gross - Math.round(received), received };
  }, [strokes, pars, shotsPerHole, holes]);

  /**
   * Write on every change, not on a button.
   *
   * Debounced so tapping through a hole is one request rather than four, and
   * the latest card is read from a ref: two taps inside one render both
   * started from the same array otherwise, and the second wrote the first
   * one's hole back to null.
   */
  const latest = useRef(strokes);
  latest.current = strokes;
  const dirty = useRef(false);

  /**
   * The card is kept on the phone BEFORE the network is tried.
   *
   * This used to be a bare debounce whose only copy of the strokes was React
   * state, so a scorer behind the 12th with no signal who locked their phone
   * lost the holes they had entered — and the screen went on showing them
   * until it reloaded. See domain/pending-card.ts.
   */
  const card = usePendingCard<(number | null)[]>({
    stageId,
    playerId,
    enabled: !locked,
    send: async (value) => {
      await saveScorecard(stageId, playerId, value);
      setError("");
      // A save takes the card back to "entered" if it had been certified;
      // saying so is better than leaving a stale badge on screen.
      setState((s) => (s === "certified" ? "entered" : s));
    },
  });

  useEffect(() => {
    if (!dirty.current || locked) return;
    card.push(latest.current);
    // `card.push` is stable and the ref carries the latest strokes, so this
    // deliberately watches the VALUE rather than the callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strokes, locked]);

  const setHole = (hole: number, value: number | null) => {
    dirty.current = true;
    setNote("");
    setStrokes((prev) => {
      const next = [...prev];
      next[hole] = value;
      return next;
    });
  };

  const certify = () =>
    startTransition(async () => {
      try {
        // Save first: certifying a card the server has not seen would certify
        // whatever was last written, which is not what is on this screen.
        await saveScorecard(stageId, playerId, latest.current);
        await certifyScorecard(stageId, playerId);
        setState("certified");
        setNote("Certified. It's with the committee now.");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't certify that card.");
      }
    });

  return (
    <div>
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.09em",
          textTransform: "uppercase",
          color: "var(--color-neutral-400)",
        }}
      >
        {[roundLabel, courseName].filter(Boolean).join(" · ")}
      </div>
      <h1 style={{ fontFamily: "var(--font-heading)", fontSize: 24, margin: "6px 0 14px" }}>
        {playerName || "My card"}
      </h1>

      {locked ? (
        <p style={{ fontSize: 14.5, lineHeight: 1.6, color: "var(--color-neutral-400)" }}>
          This card has been approved by the committee. Ask an organizer if something needs changing.
        </p>
      ) : (
        <>
          {/* Where I stand. Above the hole and never moving, because it is the
              question that follows every single tap. */}
          <section
            className="card elev-sm"
            style={{
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              padding: "12px 14px",
              marginBottom: 12,
            }}
          >
            <Stat label="Thru" value={summary.played === 0 ? "–" : String(summary.played)} />
            <Stat label="Gross" value={summary.gross === 0 ? "–" : String(summary.gross)} />
            {knownCourse && (
              <Stat
                label="To par"
                value={summary.played === 0 ? "–" : toParText(summary.toPar)}
                tone={summary.played === 0 ? undefined : summary.toPar < 0 ? "good" : undefined}
              />
            )}
            {knownCourse && shotsPerHole.length > 0 && (
              <Stat
                label="Net"
                value={summary.played === 0 ? "–" : String(summary.net)}
                hint={`Playing handicap ${playingHandicap}`}
              />
            )}
          </section>

          {/* Two ways to fill the same card, because they are two different
              moments. Hole by hole is the round: one number, big targets, on
              a phone between shots. The full card is the check afterwards —
              against the paper one in your pocket, where every hole, the
              shots you got and both totals have to be visible at once. */}
          <div className="seg" style={{ marginBottom: 12 }}>
            <label className="seg-opt">
              <input
                type="radio"
                name="card-view"
                checked={view === "hole"}
                onChange={() => setView("hole")}
              />
              <i className="ph ph-flag" /> Hole by hole
            </label>
            <label className="seg-opt">
              <input
                type="radio"
                name="card-view"
                checked={view === "card"}
                onChange={() => setView("card")}
              />
              <i className="ph ph-table" /> Full card
            </label>
          </div>

          {view === "hole" ? (
            <HoleByHoleCard
              players={[
                {
                  id: playerId,
                  name: playerName,
                  shotsOn: (hole: number) => shotsPerHole[hole] ?? 0,
                },
              ]}
              cards={{ [playerId]: strokes }}
              pars={pars}
              yards={yards}
              strokeIndex={strokeIndex}
              holes={holes}
              onSet={(_pid, hole, value) => setHole(hole, value)}
            />
          ) : (
            <ScorecardTable
              holes={holes}
              pars={pars}
              yards={yards}
              strokeIndex={strokeIndex}
              strokes={strokes}
              shotsPerHole={shotsPerHole}
              playingHandicap={playingHandicap}
              brand={brand}
              courseName={courseName}
              venueIsHome={venueIsHome}
              onSet={setHole}
            />
          )}

          {/* No Save button. The card writes itself; this says what happened,
              and stays put when it failed. */}
          <div
            role="status"
            aria-live="polite"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              minHeight: 22,
              marginTop: 12,
              fontSize: 12.5,
              fontWeight: card.status.tone === "warn" ? 600 : 400,
              color:
                card.status.tone === "warn"
                  ? "var(--color-danger)"
                  : card.status.tone === "idle"
                    ? "var(--color-accent-2-300)"
                    : "var(--color-neutral-400)",
            }}
          >
            {/*
              What the scorer is told, from domain/pending-card.

              The old wording here — "Not saved… check your signal and tap a
              hole again" — is now false in the case that matters most. The
              holes ARE saved, on the phone, and they will send themselves. A
              scorer told otherwise stands on a tee hunting for a bar of signal
              instead of playing their shot.
            */}
            {card.status.tone === "working" && (<><i className="ph ph-circle-notch" /> {card.status.label}</>)}
            {card.status.tone === "queued" && (<><i className="ph ph-cloud-arrow-up" /> {card.status.label}</>)}
            {card.status.tone === "warn" && (<><i className="ph ph-warning-circle" /> {card.status.label}</>)}
            {card.status.tone === "idle" && filled > 0 && (
              <><i className="ph ph-check" /> Saved — {filled} of {holes} holes in</>
            )}
          </div>

          <button
            type="button"
            className="btn btn-primary"
            // Certifying an unfinished card would be claiming holes that were
            // never played were right.
            disabled={pending || !complete || state === "certified"}
            onClick={certify}
            style={{ width: "100%", minHeight: 52, marginTop: 10 }}
          >
            <i className="ph ph-check" /> {state === "certified" ? "Certified" : "Certify my card"}
          </button>

          <p style={{ margin: "10px 0 0", fontSize: 12.5, lineHeight: 1.6, color: "var(--color-neutral-400)" }}>
            {complete
              ? "Certifying says these hole scores are correct. The committee accepts it after that."
              : `Certify once all ${holes} holes are in.`}
          </p>
          <p style={{ margin: "6px 0 0" }}>
            <RuleCite rule="scorecardCertification" />
          </p>
          {note && (
            <p style={{ margin: "10px 0 0", fontSize: 13, color: "var(--color-accent-2-300)" }}>
              <i className="ph ph-check" /> {note}
            </p>
          )}
          {error && (
            <p style={{ margin: "10px 0 0", fontSize: 13, color: "var(--color-danger)" }}>
              <i className="ph ph-warning-circle" /> {error}
            </p>
          )}
        </>
      )}
    </div>
  );
}

/** One number in the running summary. Big enough to read at arm's length. */
function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "good";
}) {
  return (
    <div style={{ minWidth: 0, textAlign: "center" }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--color-neutral-400)" }}>
        {label}
      </div>
      <div
        title={hint}
        style={{
          fontFamily: "var(--font-heading)",
          fontSize: 26,
          lineHeight: 1.1,
          fontVariantNumeric: "tabular-nums",
          color: tone === "good" ? "var(--color-accent-2-300)" : "var(--color-text)",
        }}
      >
        {value}
      </div>
    </div>
  );
}
