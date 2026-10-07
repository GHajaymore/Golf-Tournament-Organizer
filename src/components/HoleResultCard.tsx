"use client";
import { useEffect, useRef, useState } from "react";
import { useDistanceWords } from "./DistanceUnitProvider";
import { Icon } from "./Icon";
import { MicNote } from "./MicNote";
import { startDictation, type Dictation } from "@/lib/dictation";
import { parseHolesTranscript } from "@/lib/domain/match";
import { holeNumber } from "@/lib/domain/hole-number";
import type { HoleResult } from "@/lib/domain/types";

/**
 * ONE HOLE OF A MATCH, WON OR HALVED — a casual gross match's card
 * (2026-10-07).
 *
 * A gross match between friends is written down the way match play is
 * played: who won the hole, not how many strokes it took. That stays. What
 * did not fit the round's one screen was the SHAPE: the organizer's
 * eighteen-column grid, 900px wide, with three 32px pickers a hole — on a
 * 393px phone it scrolled sideways and opened on a legend and a "Voice
 * entry" bar. Every other casual format opens on the hole being played,
 * with the mic beside its number.
 *
 * So this is that, for a hole result: the hole, three thumb-sized answers
 * named for the players, and the next hole once one is pressed — one tap
 * decides a hole, as one tap on the solo pad decides a score. Tapping the
 * pressed answer again takes it back, the same rule as the grid.
 *
 * The grid is still one tap away ("See the full card"): it is how a card is
 * read ACROSS, which a hole at a time cannot do.
 */
export function HoleResultCard({
  holes,
  aName,
  bName,
  aLabel,
  bLabel,
  pars,
  yards,
  strokeIndex,
  firstHole = 1,
  canHearNames,
  showVoice = true,
  shotsOn,
  onPick,
  onSay,
}: {
  /** The organizer's "Voice entry" setting, where a player is holding the phone. */
  showVoice?: boolean;
  /**
   * The handicap shots each side receives on a hole, in a net match — the
   * same dots the stroke card puts beside a name, so a scorer deciding who
   * won the hole knows who was getting one.
   */
  shotsOn?: (hole: number) => { a: number; b: number };
  holes: HoleResult[];
  /** Full names, for what a screen reader says. */
  aName: string;
  bName: string;
  /** What the buttons say: first names, widened where they clash. */
  aLabel: string;
  bLabel: string;
  pars: number[];
  yards: number[];
  strokeIndex: number[];
  firstHole?: number;
  /** False when both players share a first name — see `namesAreDistinct`. */
  canHearNames: boolean;
  /** Press an answer; pressing the one already pressed clears it. */
  onPick: (hole: number, value: "A" | "B" | "H") => void;
  /** What was heard, from `start` onwards, one hole per word. */
  onSay: (start: number, values: HoleResult[]) => void;
}) {
  const distance = useDistanceWords();
  const count = holes.length || 18;
  // Open on the first hole with no result; the last once every one has one.
  const [hole, setHole] = useState(() => {
    const next = Array.from({ length: count }, (_, i) => holes[i] ?? null).findIndex((h) => h == null);
    return next === -1 ? count - 1 : next;
  });
  const go = (i: number) => setHole(Math.max(0, Math.min(count - 1, i)));
  const value = holes[hole] ?? null;

  const press = (v: "A" | "B" | "H") => {
    const clearing = value === v;
    onPick(hole, v);
    // On to the next hole once this one has an answer — never on a clear,
    // which is somebody fixing the hole in front of them.
    if (!clearing && hole < count - 1) window.setTimeout(() => go(hole + 1), 160);
  };

  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState("");
  const dictationRef = useRef<Dictation | null>(null);
  const aFirst = aLabel.split(" ")[0];
  const bFirst = bLabel.split(" ")[0];
  const listen = () => {
    if (listening) {
      dictationRef.current?.stop();
      dictationRef.current = null;
      setListening(false);
      return;
    }
    setHeard("");
    const start = hole;
    const started = startDictation({
      onTranscript: (transcript) => {
        const got = parseHolesTranscript(transcript, aFirst, bFirst, start, count);
        if (got.length) {
          onSay(start, got);
          go(start + got.length);
          setHeard(`Heard “${transcript}” — ${got.length === 1 ? `hole ${holeNumber(start, firstHole)}` : `holes ${holeNumber(start, firstHole)} to ${holeNumber(start + got.length - 1, firstHole)}`}. Tap a hole to fix it.`);
        } else {
          setHeard(`Heard “${transcript}” — say ${aFirst}, ${bFirst} or “half”.`);
        }
      },
      onError: () => setHeard("Didn’t catch that. Try again, or tap who won."),
      onEnd: () => setListening(false),
    });
    dictationRef.current = started;
    if (started) setListening(true);
    else setHeard("This browser can’t listen. Tap who won instead.");
  };

  // The strip keeps the current hole in view, as on the stroke card.
  const stripRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const strip = stripRef.current;
    const chip = strip?.children[hole] as HTMLElement | undefined;
    if (!strip || !chip) return;
    strip.scrollLeft = Math.max(0, chip.offsetLeft - strip.offsetLeft - (strip.clientWidth - chip.offsetWidth) / 2);
  }, [hole]);

  const tint = (h: HoleResult) =>
    h === "A"
      ? "color-mix(in srgb, var(--color-accent) 30%, transparent)"
      : h === "B"
        ? "color-mix(in srgb, var(--color-accent-2) 30%, transparent)"
        : h === "H"
          ? // Neutral: a half belongs to nobody, and an accent wash read as
            // the first player's colour on the dark ground.
            "color-mix(in srgb, var(--color-text) 14%, transparent)"
          : "transparent";
  const said = (h: HoleResult) => (h === "A" ? `won by ${aName}` : h === "B" ? `won by ${bName}` : h === "H" ? "halved" : "not played");

  const n = holeNumber(hole, firstHole);
  const shots = shotsOn?.(hole) ?? { a: 0, b: 0 };
  const gets = (k: number) => (k > 0 ? `, who gets ${k === 1 ? "a shot" : `${k} shots`}` : "");
  const answers: Array<{ v: "A" | "H" | "B"; label: string; dots: number; cls: string; aria: string }> = [
    { v: "A", label: aLabel, dots: shots.a, cls: "is-a", aria: `Hole ${n} to ${aName}${gets(shots.a)}` },
    { v: "H", label: "Halved", dots: 0, cls: "is-h", aria: `Hole ${n} halved` },
    { v: "B", label: bLabel, dots: shots.b, cls: "is-b", aria: `Hole ${n} to ${bName}${gets(shots.b)}` },
  ];

  return (
    <div>
      <div ref={stripRef} style={{ display: "flex", gap: 4, marginBottom: 10, overflowX: "auto", paddingBottom: 2 }}>
        {Array.from({ length: count }, (_, i) => (
          <button
            key={i}
            type="button"
            className="hole-nav-btn"
            onClick={() => go(i)}
            aria-label={`Hole ${holeNumber(i, firstHole)}, ${said(holes[i] ?? null)}`}
            aria-current={i === hole ? "true" : undefined}
            style={{
              flex: "1 0 auto",
              minWidth: 36,
              height: 40,
              fontSize: 15,
              fontVariantNumeric: "tabular-nums",
              fontWeight: i === hole ? 700 : 500,
              cursor: "pointer",
              borderRadius: 6,
              border: i === hole ? "2px solid var(--color-accent)" : "1px solid var(--color-divider)",
              background: tint(holes[i] ?? null),
              color: "var(--color-text)",
            }}
          >
            {holeNumber(i, firstHole)}
          </button>
        ))}
      </div>

      <div className="card elev-sm" style={{ padding: "14px 14px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: "var(--color-neutral-400)" }}>
              Hole
            </div>
            <div style={{ fontFamily: "var(--font-heading)", fontSize: 42, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{n}</div>
          </div>
          {canHearNames && showVoice && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={listen}
              aria-pressed={listening}
              aria-label={`Say who won hole ${n}`}
              style={{
                width: 48,
                height: 48,
                minHeight: 48,
                padding: 0,
                borderRadius: "50%",
                justifyContent: "center",
                flex: "none",
                boxShadow: listening ? "0 0 0 3px var(--color-accent)" : undefined,
              }}
            >
              <Icon name="microphone" style={{ fontSize: 20 }} />
            </button>
          )}
          <div style={{ textAlign: "right", fontSize: 15, lineHeight: 1.45, color: "var(--color-neutral-400)" }}>
            <div>
              Par <strong style={{ color: "var(--color-text)", fontSize: 20 }}>{pars[hole] ?? "—"}</strong>
            </div>
            <div style={{ fontVariantNumeric: "tabular-nums" }}>
              {[(yards[hole] ?? 0) > 0 ? `${yards[hole]} ${distance.short}` : "", strokeIndex[hole] != null ? `S.I. ${strokeIndex[hole]}` : ""]
                .filter(Boolean)
                .join(" · ")}
            </div>
          </div>
        </div>

        <div className="sc-pick sc-pick-row" role="group" aria-label={`Who won hole ${n}`} style={{ marginTop: 12 }}>
          {answers.map((a) => (
            <button
              key={a.v}
              type="button"
              className={a.cls}
              aria-pressed={value === a.v}
              aria-label={a.aria}
              onClick={() => press(a.v)}
            >
              {a.label}
              {a.dots > 0 && (
                <span aria-hidden="true" style={{ marginLeft: 4, fontWeight: 700 }}>
                  {"•".repeat(a.dots)}
                </span>
              )}
            </button>
          ))}
        </div>

        {showVoice && (
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 4 }}>
            {/* What the mic heard, or how to use it; or why it is not offered. */}
            <span style={{ fontSize: 14, lineHeight: 1.45, color: "var(--color-neutral-400)" }} aria-live="polite">
              {canHearNames
                ? listening
                  ? "Listening…"
                  : heard || `Or say it: “${aFirst}”, “half”, “${bFirst}” — several holes in a row if you like.`
                : `Both players are called ${aFirst}, so the mic can’t tell them apart. Tap who won.`}
            </span>
            {canHearNames && <MicNote />}
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button type="button" className="btn btn-secondary" onClick={() => go(hole - 1)} disabled={hole === 0} style={{ flex: 1, minHeight: 46 }}>
          <Icon name="caret-left" /> Previous
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => go(hole + 1)} disabled={hole === count - 1} style={{ flex: 1, minHeight: 46 }}>
          Next <Icon name="caret-right" />
        </button>
      </div>
    </div>
  );
}
