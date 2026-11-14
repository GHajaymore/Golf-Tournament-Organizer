"use client";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { applyRoundHandicapToRest, setRoundHandicapOverride } from "@/app/actions/tournament";
import {
  BAND_MAX,
  BAND_MIN,
  GIVE_STROKES,
  NEEDS_STROKES_ANCHOR,
  NOT_SAVED_TRY_AGAIN,
  NOT_SAVED_YET,
  SINK_LIVE,
  bandBoxLabel,
  bandEmptySaid,
  bandHeadingSaid,
  bandLeadSaid,
  bandStrokes,
  cardsInSaid,
  figureGivenSaid,
  figurePreviewSaid,
} from "@/lib/domain/committee-figure";
import { laterRoundsSaid } from "@/lib/domain/later-rounds-said";
import { isStablefordRound } from "@/lib/domain/week-basis";
import { effectiveAllowance, playingHandicapPartsInRound, type RoundPricing } from "@/lib/round-allowance";

/**
 * GIVE A PLAYER WITH NO HANDICAP INDEX THEIR STROKES (lane N, PR A; design `design-no-index-net.md`, §5 and
 * the panel's §12.2).
 *
 * The control was always there — the round's own handicap list, "Handicaps for this round", folded inside
 * Customize this round, seven presses per player per round — and nothing pointed at it. So it does not
 * move and is not copied: this band surfaces the players who need strokes at the top of Rounds & formats,
 * and Give writes through the SAME two actions that list uses (`setRoundHandicapOverride`, the one writer
 * of a round figure, then `applyRoundHandicapToRest`, "Use in later rounds too"), so one press covers the
 * week. The figure is a Course Handicap for the round in whole strokes — never an index on the player.
 *
 * Who needs strokes is `needsCommitteeFigure` (via `playersNeedingFigure`), never worked out here. Staff
 * only: the page mounts it only for somebody the actions accept.
 *
 * For the course: every link lands on `#needs-strokes` with the first empty box focused and the number
 * keypad up; Enter gives the row and moves on (a dozen blanks cost a dozen figures and a dozen Enters);
 * Tab moves without giving; a typed figure not given says "Not saved yet"; a Give that fails keeps the
 * figure and says "Not saved. Try again."
 */

export interface BandRound {
  stageId: string;
  /** "Round 1". */
  label: string;
  /** How the round is priced: the board's own calculation is asked for the "plays off" line. */
  pricing: RoundPricing;
  players: {
    id: string;
    name: string;
    /** False once the round has a card in: its handicaps are fixed (PR A), and the row says so. */
    editable: boolean;
    /** The roster's figure for this round (a no-index player's stored nought, converted). */
    member: number;
    /** The same before rounding (`RoundHandicapView.exact` while the round resolves the roster). */
    memberExact: number;
    /** Strokes for tees of a higher par, as the round's own list has them (Rule 6.2b). */
    parStrokes: number;
  }[];
}

/** The round's own words for how it is scored, lower case, as its tile says them. */
function scoredSaid(p: RoundPricing, allowance: number): string {
  const at = allowance !== 100 ? ` at ${allowance}%` : "";
  if (isStablefordRound(p.scoringBasis ?? "", p.format)) return `off handicap${at}`;
  if ((p.scoringBasis ?? "").trim().toLowerCase() === "both") return "gross and net";
  return `net${at}`;
}

const BOX = { minHeight: 48, fontSize: 16, width: 96 } as const;
const BUTTON = { minHeight: 48, padding: "6px 16px", fontSize: 14 } as const;

export function NeedsStrokesBand({ rounds }: { rounds: BandRound[] }) {
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState("");
  const [given, setGiven] = useState<{ key: string; round: string; text: string }[]>([]);
  const band = useRef<HTMLElement>(null);

  // ARRIVAL: a link to #needs-strokes scrolls the band into view and focuses the first empty box.
  useEffect(() => {
    if (typeof window === "undefined" || window.location.hash !== `#${NEEDS_STROKES_ANCHOR}`) return;
    band.current?.scrollIntoView({ block: "start" });
    band.current?.querySelector<HTMLInputElement>("input[data-strokes-box]")?.focus();
  }, []);

  // LEAVING WITH A FIGURE TYPED AND NOT GIVEN asks first.
  const unsaved = Object.values(typed).some((v) => v.trim() !== "");
  useEffect(() => {
    if (!unsaved) return;
    const ask = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", ask);
    return () => window.removeEventListener("beforeunload", ask);
  }, [unsaved]);

  const asking = rounds.filter((r) => r.players.length > 0);
  if (asking.length === 0 && given.length === 0) return null;

  const focusNextEmpty = (from: HTMLInputElement | null) => {
    const boxes = Array.from(band.current?.querySelectorAll<HTMLInputElement>("input[data-strokes-box]") ?? []);
    const at = from ? boxes.indexOf(from) : -1;
    const next = [...boxes.slice(at + 1), ...boxes.slice(0, Math.max(at, 0))].find((b) => b !== from && b.value.trim() === "");
    next?.focus();
  };

  const give = async (r: BandRound, p: BandRound["players"][number], box: HTMLInputElement | null) => {
    const key = `${r.stageId}:${p.id}`;
    const read = bandStrokes(typed[key] ?? "");
    if (!read || !read.ok) return;
    // The committee's figure is what the round resolves first, so the member figures only fill the shape.
    const { allowance, playing } = playingHandicapPartsInRound(r.pricing, { override: read.value }, { whole: p.member, exact: p.memberExact, parStrokes: p.parStrokes });
    setSaving(key);
    setFailed((f) => ({ ...f, [key]: "" }));
    try {
      const set = await setRoundHandicapOverride(r.stageId, p.id, read.value);
      if (!set.ok) {
        setFailed((f) => ({ ...f, [key]: set.error ? `${NOT_SAVED_TRY_AGAIN} ${set.error}` : NOT_SAVED_TRY_AGAIN }));
        return;
      }
      // One press covers the week: every later round on the same card, not yet scored, as its own fact.
      const rest = await applyRoundHandicapToRest(r.stageId, p.id);
      const later = rest.ok && rest.written + rest.skippedCards + rest.skippedOther > 0 ? ` ${laterRoundsSaid(rest.written, rest.skippedCards, rest.skippedOther)}` : "";
      setGiven((g) => [...g, { key, round: r.label, text: figureGivenSaid({ name: p.name, strokes: read.value, playing, allowance, round: r.label }) + later }]);
      setTyped((t) => ({ ...t, [key]: "" }));
      focusNextEmpty(box);
    } catch {
      setFailed((f) => ({ ...f, [key]: NOT_SAVED_TRY_AGAIN }));
    } finally {
      setSaving("");
    }
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>, r: BandRound, p: BandRound["players"][number]) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    void give(r, p, e.currentTarget);
  };

  return (
    <section
      ref={band}
      id={NEEDS_STROKES_ANCHOR}
      aria-labelledby={`${NEEDS_STROKES_ANCHOR}-title`}
      className="card"
      style={{ display: "flex", flexDirection: "column", gap: 12, borderLeft: "4px solid var(--color-warning)", minWidth: 0 }}
    >
      {asking.map((r, i) => {
        // The round's allowance, from the one reader of it (the committee's, or the Rules' figure).
        const allowance = effectiveAllowance(r.pricing.format, r.pricing.handicapAllowance, r.pricing.type);
        return (
          <div key={r.stageId} style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
            <h2 id={i === 0 ? `${NEEDS_STROKES_ANCHOR}-title` : undefined} style={{ fontSize: 16, margin: 0 }}>
              {bandHeadingSaid(r.players.length, r.label)}
            </h2>
            <p className="text-muted" style={{ fontSize: 14, margin: 0, lineHeight: 1.5 }}>
              {bandLeadSaid(scoredSaid(r.pricing, allowance), SINK_LIVE)}
            </p>
            {r.players.map((p) => {
              const key = `${r.stageId}:${p.id}`;
              const raw = typed[key] ?? "";
              const read = bandStrokes(raw);
              const preview =
                read && read.ok
                  ? figurePreviewSaid({
                      strokes: read.value,
                      playing: playingHandicapPartsInRound(r.pricing, { override: read.value }, { whole: p.member, exact: p.memberExact, parStrokes: p.parStrokes }).playing,
                      allowance,
                      round: r.label,
                    })
                  : "";
              const boxId = `strokes-${r.stageId}-${p.id}`;
              return (
                <div key={p.id} style={{ display: "flex", flexDirection: "column", gap: 4, borderTop: "1px solid var(--color-divider)", paddingTop: 8, minWidth: 0 }}>
                  {!p.editable ? (
                    <p style={{ fontSize: 14, margin: 0 }}>{cardsInSaid(p.name, r.label)}</p>
                  ) : (
                    <>
                      <div style={{ display: "flex", alignItems: "flex-end", gap: 8, flexWrap: "wrap", minWidth: 0 }}>
                        <span style={{ fontSize: 14, fontWeight: 600, flex: "1 1 160px", minWidth: 0 }}>
                          {p.name} <span className="text-muted" style={{ fontWeight: 400 }}>· no index</span>
                        </span>
                        <label htmlFor={boxId} style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}>
                          {bandBoxLabel(r.label)}
                          <input
                            id={boxId}
                            data-strokes-box=""
                            className="input"
                            inputMode="numeric"
                            autoComplete="off"
                            min={BAND_MIN}
                            max={BAND_MAX}
                            value={raw}
                            disabled={saving === key}
                            onChange={(e) => setTyped((t) => ({ ...t, [key]: e.target.value }))}
                            onKeyDown={(e) => onKey(e, r, p)}
                            style={BOX}
                          />
                        </label>
                        <button
                          type="button"
                          className="btn btn-primary"
                          style={BUTTON}
                          disabled={saving === key || !read || !read.ok}
                          aria-label={`${GIVE_STROKES} to ${p.name} for ${r.label}`}
                          onClick={(e) => void give(r, p, (e.currentTarget.parentElement?.querySelector("input[data-strokes-box]") as HTMLInputElement | null) ?? null)}
                        >
                          Give
                        </button>
                      </div>
                      {read && !read.ok && (
                        <p role="alert" style={{ fontSize: 14, margin: 0, color: "var(--color-danger)" }}>{read.error}</p>
                      )}
                      {preview && <p className="text-muted" style={{ fontSize: 14, margin: 0 }}>{preview}</p>}
                      {raw.trim() !== "" && !failed[key] && saving !== key && (
                        <p style={{ fontSize: 13, margin: 0, color: "var(--color-warning)" }}>{NOT_SAVED_YET}</p>
                      )}
                      {failed[key] && (
                        <p role="alert" style={{ fontSize: 14, margin: 0, color: "var(--color-danger)" }}>{failed[key]}</p>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}

      {given.length > 0 && (
        <div role="status" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {given.map((g) => (
            <p key={g.key} style={{ fontSize: 14, margin: 0 }}>
              {g.text}
            </p>
          ))}
          {[...new Set(given.map((g) => g.round))]
            .filter((round) => !asking.some((r) => r.label === round))
            .map((round) => (
              <p key={round} style={{ fontSize: 14, margin: 0, fontWeight: 600 }}>
                {bandEmptySaid(round)}
              </p>
            ))}
        </div>
      )}
    </section>
  );
}
