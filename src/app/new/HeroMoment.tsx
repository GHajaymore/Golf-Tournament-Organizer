"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

type Rect = { x: number; y: number; w: number; h: number };

/**
 * THE HERO'S ONE MOMENT (the site rehaul, 2026-11-01): a member taps 4 on the 10th, and the same
 * round moves on the committee's laptop. Every picture is a real capture of the demo club, taken
 * before and after that press by `npm run landing:capture`; every figure in the caption, and every
 * outline's place, is read from `screen-facts.json`, which the same command writes.
 *
 * It plays ONCE, after the page has settled, and rests on the "after" state; "Watch again" replays
 * it. Under reduced motion it goes straight to the settled state. The pictures only cross-fade —
 * nothing a person reads is turned or moved.
 */
export function HeroMoment({
  deskBefore,
  deskAfter,
  card,
  board,
  facts,
  deskView,
  startAfter = 900,
}: {
  /**
   * How long after the page settles the moment plays (design F, 2026-11-03): long enough for the
   * headline's putt to drop first, so the putt, the press and the board are ONE sequence.
   */
  startAfter?: number;
  /**
   * Design D (2026-11-02): the laptop shows a framed crop of its capture so the leaderboard can be
   * read: drawn `z` windows wide, with the fractions `fx`/`fy` of it left of and above the window.
   * The capture's image and aspect are the window's, so a measured rectangle maps by (v - f) * z.
   */
  deskView?: { z: number; fx: number; fy: number };
  deskBefore: ReactNode;
  deskAfter: ReactNode;
  card: ReactNode;
  board: ReactNode;
  facts: {
    player: string;
    hole: number;
    score: number;
    field: number;
    holesBefore: number;
    holesAfter: number;
    placeBefore: string;
    placeAfter: string;
    deskBefore: Rect;
    deskAfter: Rect;
    press: Rect;
    boardRow: Rect;
  };
}) {
  // 0: before (the card, the desk before) · 1: the press · 2: after (the board, the desk after)
  const [step, setStep] = useState(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const clear = () => { timers.current.forEach(clearTimeout); timers.current = []; };

  const play = useCallback(() => {
    clear();
    setStep(0);
    timers.current.push(setTimeout(() => setStep(1), 1100));
    timers.current.push(setTimeout(() => setStep(2), 2300));
  }, []);

  useEffect(() => {
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (calm) { setStep(2); return; }
    const t = setTimeout(play, startAfter);
    return () => { clearTimeout(t); clear(); };
  }, [play, startAfter]);

  const at = (r: Rect): CSSProperties => ({ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` });
  // A desk rectangle seen through the crop, kept inside the window.
  const atDesk = (r: Rect): CSSProperties => {
    if (!deskView) return at(r);
    const { z, fx, fy } = deskView;
    const x = Math.max(0, (r.x - fx) * z), y = Math.max(0, (r.y - fy) * z);
    return at({ x, y, w: Math.min(1 - x, r.w * z), h: Math.min(1 - y, r.h * z) });
  };
  const view = deskView ? ({ "--z": deskView.z, "--fx": deskView.fx, "--fy": deskView.fy } as CSSProperties) : undefined;
  const after = step === 2;
  const holes = after ? facts.holesAfter : facts.holesBefore;
  const nth = ordinal(facts.hole);

  return (
    <>
      <div className="n-laptop" role="img" aria-label={`The committee's live leaderboard on a laptop: ${facts.player} moves from ${facts.placeBefore} to ${facts.placeAfter} when a score on the ${nth} goes in.`}>
        <div className="n-lid">
          <div className={deskView ? "n-lid-screen n-zoom" : "n-lid-screen"} style={view}>
            <div className={after ? "n-frame n-off" : "n-frame"}>{deskBefore}</div>
            <div className={after ? "n-frame" : "n-frame n-off"}>{deskAfter}</div>
            <span className={step >= 1 ? "n-mark n-show" : "n-mark"} style={atDesk(after ? facts.deskAfter : facts.deskBefore)} aria-hidden="true" />
          </div>
        </div>
        <div className="n-base" aria-hidden="true" />
      </div>
      <div className="n-phone" role="img" aria-label={`${facts.player}'s phone: the card on hole ${facts.hole}, then the board with that player's own line marked.`}>
        <div className="n-phone-screen">
          <div className={after ? "n-frame n-off" : "n-frame"}>{card}</div>
          <div className={after ? "n-frame" : "n-frame n-off"}>{board}</div>
          <span className={step === 1 ? "n-tap n-show" : "n-tap"} style={at(facts.press)} aria-hidden="true" />
          <span className={after ? "n-mark n-show" : "n-mark"} style={at(facts.boardRow)} aria-hidden="true" />
        </div>
      </div>
      <div className="n-live" aria-live="polite">
        <span className="n-dot" aria-hidden="true" />
        <span className="n-big n-num">{after ? facts.placeAfter : facts.placeBefore}</span>
        <span>
          <b>{facts.player}, {facts.score} on the {nth}</b>
          <br />
          <span className="n-num">{facts.field} players · {holes} holes in</span>
        </span>
        <button type="button" className="n-replay" onClick={play}>Watch again</button>
      </div>
    </>
  );
}

/** 1st, 2nd, 3rd, 4th … 11th, 12th, 13th … 21st: the hole as a person says it. */
function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const tail = teen ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${tail}`;
}
