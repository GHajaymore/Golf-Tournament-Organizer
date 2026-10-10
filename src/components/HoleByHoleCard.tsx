"use client";
import { useEffect, useRef, useState } from "react";
import { useDistanceWords } from "./DistanceUnitProvider";
import { useSeenOnce } from "./useSeenOnce";
import { toParText } from "@/lib/domain";
import { distinctLabels } from "@/lib/format";
import { parseStroke, scoreMark } from "@/lib/domain/score-payload";
import { Icon } from "./Icon";
import { MicNote } from "./MicNote";
import { startDictation, type Dictation } from "@/lib/dictation";
import { parseHoleTranscript } from "@/lib/domain/score-entry-input";
import { nextHoleToPlay } from "@/lib/domain/next-hole";
import { pinLong, pinShort, type PinSheet } from "@/lib/domain/pin-sheet";
import { holeNumber } from "@/lib/domain/hole-number";

/**
 * One hole at a time, for everyone sharing the card.
 *
 * The unit of score entry is the tee group, not the player. In a fourball one
 * person keeps the card for all four, and they write down hole 7 four times
 * before anybody walks to the 8th. A player-first screen inverts that: score a
 * hole, change player, score the same hole, change player — the selector
 * becomes the inner loop of the round, which is exactly backwards, and it is
 * the mistake this component was written to avoid. Hole is the outer loop.
 *
 * (Flights are a different axis and are not this component's business. A tee
 * group routinely spans several flights — you group by tee time for pace of
 * play and score by flight for fairness — so grouping here by flight would put
 * players on the screen who are not standing next to the scorer.)
 *
 * The control adapts to how many are on the card, because the right control is
 * not the same at one player as at four:
 *
 *   one   — the full par-relative pad, named the way golfers name the scores.
 *           A player posting their own round has the whole screen for it.
 *   many  — a row each with a stepper. Four pads do not fit a phone, and the
 *           scorer already knows the number; they need to enter it, not choose
 *           it from a menu.
 *
 * State lives in the parent, so this view and the full grid are two windows
 * onto one card and neither can drift from the other.
 */

/** Quick picks relative to par. Outside this, type it. */
const RELATIVE = [-2, -1, 0, 1, 2, 3];

export interface CardPlayer {
  id: string;
  name: string;
  /** Handicap strokes received on a given hole, from the real course-handicap
   *  allocation. Optional: an event with no ratings has none to show. */
  shotsOn?: (hole: number) => number;
  /**
   * Exactly what to call this card, bypassing the "First L." shortening.
   *
   * For a card that is not a person: a foursomes SIDE plays one ball and keeps
   * one card, and "ZZ Walker & ZZ Partner" shortened as a name came out as
   * "ZZ P." — a side presented as an individual, on the screen where the
   * scorer decides whose number goes where (walked 2026-10-04).
   */
  label?: string;
  /**
   * THEIR CARD IS SIGNED, so it is shown and not offered (2026-10-09). A
   * marker keeping the group's cards could step a partner's certified card —
   * walked: Faye signed a 72, her partner pressed + on the 1st, and the card
   * went back to unsigned at 73 with nothing said to either of them. Under
   * Rule 3.3b a returned card is the committee's to correct.
   */
  signed?: boolean;
}

/**
 * THE MARKING IS NOT DRAWN HERE ANY MORE.
 *
 * This file used to hold a fourth copy of the under-par/over-par rule, and it
 * was the only one that drew with INLINE STYLES rather than the `.sc-score`
 * classes in design-system.css. Which is how its over-par corner came to be
 * 4px where every other score box in the app draws 3px — nothing reported it,
 * because copies of a rule agree right up until they do not, and a 1px corner
 * is exactly the size of drift nobody notices and nobody can explain later.
 *
 * `scoreMark` returns the class suffix and `design-system.css` owns the
 * drawing. Both boxes below carry `sc-score` for that reason; their own
 * inline sizes stay, because those are about this screen's layout rather than
 * about what the score means.
 */

/** What a golfer calls it, which is what belongs on the button. */
function nameFor(rel: number, par: number | undefined): string {
  if (!par) return "";
  if (par + rel === 1) return "Ace";
  switch (rel) {
    case -2: return "Eagle";
    case -1: return "Birdie";
    case 0: return "Par";
    case 1: return "Bogey";
    case 2: return "Double";
    default: return `+${rel}`;
  }
}

/**
 * There was a second, private copy of `firstName` here, and with it the same
 * blind spot as the one in format.ts: two players in the same tee group
 * called Dave got two rows both headed "Dave".
 *
 * On this screen that is not merely confusing. One person keeps the card for
 * the whole group, the two rows are adjacent, and the score goes onto the
 * wrong card. `distinctLabels` widens only the names that clash, so a
 * fourball of four different first names looks exactly as it did.
 */

export function HoleByHoleCard({
  players,
  cards,
  pars,
  yards,
  strokeIndex,
  holes,
  onSet,
  meId,
  startHole = 1,
  showVoice = true,
  pins = [],
  firstHole = 1,
  pickedUp,
  onPickUp,
  voice = false,
  dense = false,
}: {
  /**
   * HOLE 1 FOR THE WHOLE FOURSOME ON ONE PHONE SCREEN — a casual round's card
   * (2026-10-06). Measured at 393x727 the fourth player's row ended at 808px,
   * and a four-ball's at 985 under four "Picked up" buttons. So: a shorter
   * hole header with the mic beside the number, the mic's notes under the
   * rows, and the pick-ups behind one control — opened by itself whenever
   * anybody has picked up on the hole. Scoring is every hole; picking up is
   * occasional.
   */
  dense?: boolean;
  /**
   * Offer the mic even when nobody on the card is known to be holding the
   * phone — a casual round's card (2026-10-06), whose voice entry stays on
   * the main screen whoever set the round up. Names and card order ("four
   * five three four") still resolve; only "me" needs `meId`.
   */
  voice?: boolean;
  /**
   * Which holes each card picked up on, and the control to say so. Two
   * callers, both where the Rules allow it: MATCH PLAY (2026-10-06), where a
   * pick-up is out of the hole and concedes it once the whole side is out;
   * and a STANDARD STABLEFORD card (2026-10-08, Rule 21.1b), where it scores
   * zero points and is recorded as net double bogey. Absent on a medal card,
   * which must be holed out, so no other card grows a button.
   */
  pickedUp?: Record<string, boolean[]>;
  onPickUp?: (playerId: string, hole: number, on: boolean) => void;
  /** The round's pin sheet, one entry per hole of the card. Empty for none. */
  pins?: PinSheet;
  /** The course's number for the first hole on this card — 10 on a back nine (`firstHoleOf`). */
  firstHole?: number;
  players: CardPlayer[];
  cards: Record<string, (number | null)[]>;
  pars: number[];
  yards: number[];
  strokeIndex: number[];
  holes: number;
  onSet: (playerId: string, hole: number, value: number | null) => void;
  /**
   * The player holding the phone. When given, the hole gets a microphone:
   * "four five three four", or "Marcus five, me four". Names resolve against
   * THESE players only — see `parseHoleTranscript`.
   */
  meId?: string;
  /** Where the holder's group teed off, from the published sheet. 1 when unknown. */
  startHole?: number;
  /**
   * Whether to offer the microphone at all.
   *
   * The organizer's "Voice entry" setting (Play settings), carried by every
   * PLAYER caller — `PlayerCard`, `GroupScoring` and `/play`'s `PlayClient` —
   * since 2026-09-27; before that nothing passed it and the setting was never
   * read. Defaults TRUE so the organizer's own entry screen, which the setting
   * does not govern, behaves exactly as it did.
   *
   * It hides the mic and nothing else: the pad and the steppers always render.
   * They are how a misheard "four" for "five" gets fixed, which the mic's own
   * read-back line exists to prompt — removing them with the mic on would leave
   * a player who was misheard no way to correct it.
   */
  showVoice?: boolean;
}) {
  // Yards or metres — the course's own unit, from the nearest provider.
  const distance = useDistanceWords();
  const [listening, setListening] = useState(false);
  const dictationRef = useRef<Dictation | null>(null);
  const [heard, setHeard] = useState("");
  /**
   * "Or say it: four, par, bogey" is how somebody learns the mic exists. Once
   * they have pressed it they know, and the line goes — the button and its
   * read-back stay. Shared with the full card's "Say the card" hint, so
   * learning it on one is learning it on both. `seen !== true` keeps it on the
   * server and the first render, where it sits beside a 48px button and so
   * moves nothing when it leaves.
   */
  const micHint = useSeenOnce("mic-hint");
  // Open where the card has got to.
  //
  // With the phone's holder known, that is THEIR next hole in playing order —
  // `nextHoleToPlay`, the same number Today's "Finish my card · hole N next"
  // button names, so tapping it lands on the hole it promised. A group sent off
  // the 10th opens on the 10th, not the 1st. Without this, the group view
  // opened at the first hole nobody in the group had scored, which is hole 18
  // for a marker whose partners' cards the committee had already entered.
  //
  // Otherwise: the first hole nobody has scored yet. Not "the first hole
  // someone is missing" — scoring is allowed to be partial, so one player who
  // has not reported would pin the screen to hole 1 for the whole round while
  // everyone else played on.
  const [hole, setHole] = useState(() => {
    if (meId) {
      const mine = Array.from({ length: holes }, (_, i) => (cards[meId] ?? [])[i] ?? null);
      const next = nextHoleToPlay(mine, startHole);
      return next === null ? Math.max(0, holes - 1) : next - 1;
    }
    for (let i = 0; i < holes; i += 1) {
      if (players.every((p) => (cards[p.id] ?? [])[i] == null)) return i;
    }
    return Math.max(0, holes - 1);
  });

  /** One label per player, in the same order, guaranteed to differ. */
  const shortened = distinctLabels(players.map((p) => p.name));
  const labels = players.map((p, i) => p.label?.trim() || shortened[i]);

  const par = pars[hole];
  const solo = players.length === 1;

  /**
   * ONE PENDING ADVANCE, CANCELLED BY ANYTHING THAT MOVES THE CARD (2026-10-09).
   *
   * Each score set a bare 160ms timer to `go(hole + 1)`, captured at the hole
   * it was set on and cancelled by nothing. A player who moved on themselves —
   * the strip, Next — inside that window was yanked back by the stale timer,
   * and their next score landed on the hole behind: walked on a member's card,
   * the 12th's 3 written over the 11th. So there is one timer, any navigation
   * clears it, and when it fires it advances only from the hole it was set on.
   */
  const advance = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelAdvance = () => {
    if (advance.current) clearTimeout(advance.current);
    advance.current = null;
  };
  useEffect(() => cancelAdvance, []);
  const go = (next: number) => {
    cancelAdvance();
    setHole(Math.max(0, Math.min(holes - 1, next)));
  };
  const advanceFrom = (from: number) => {
    cancelAdvance();
    if (from >= holes - 1) return;
    advance.current = setTimeout(() => {
      advance.current = null;
      setHole((h) => (h === from ? from + 1 : h));
    }, 160);
  };

  const strokesOf = (id: string) => cards[id] ?? new Array(holes).fill(null);

  /** Running to-par over the holes that player has actually completed. */
  const toParOf = (id: string) => {
    const s = strokesOf(id);
    let total = 0;
    let played = 0;
    for (let i = 0; i < holes; i += 1) {
      if (s[i] == null) continue;
      total += (s[i] as number) - (pars[i] ?? 0);
      played += 1;
    }
    return { toPar: total, played };
  };

  /**
   * `moveOn` is false while a score is being TYPED: "10" arrives as "1" then
   * "0", and advancing on the "1" recorded a 10 as an ace and threw the "0" at
   * the next hole (walked 2026-10-09: GROSS 1, TO PAR -3 on a par 4). The pad's
   * buttons are one deliberate value each and move on; the typed box moves on
   * at Enter.
   */
  const set = (playerId: string, v: number | null, moveOn = true) => {
    onSet(playerId, hole, v);
    // Only advance on a solo card. On a group card the scorer is part way
    // through the hole and moving the screen out from under them would be
    // actively hostile.
    if (solo && moveOn && v != null) advanceFrom(hole);
    else cancelAdvance();
  };

  /**
   * SAY THE HOLE. One press, one hole, the whole group. What was heard is
   * written through `onSet` exactly as taps are, then read back in a line so
   * a misheard "four" for "five" is seen and fixed with the stepper.
   */
  const listen = () => {
    // A second tap stops it. The ring said "listening" and the tap did
    // nothing, so the only way to stop the mic was to wait for it to give up.
    if (listening) {
      dictationRef.current?.stop();
      dictationRef.current = null;
      setListening(false);
      return;
    }
    setHeard("");
    micHint.markSeen();
    const started = startDictation({
      onTranscript: (transcript) => {
        const got = parseHoleTranscript(
          transcript,
          players.map((p) => ({ id: p.id, name: p.name, isMe: p.id === meId })),
          par ?? 4,
        );
        const names = players.filter((p) => got[p.id] !== undefined);
        for (const p of names) onSet(p.id, hole, got[p.id]);
        setHeard(
          names.length
            ? `Heard “${transcript}” — ${names.map((p) => `${p.name.split(" ")[0]} ${got[p.id]}`).join(", ")}. Check and fix with − and +.`
            : `Heard “${transcript}” but no scores in it. Try “four five three four”.`,
        );
      },
      onError: () => setHeard("Didn’t catch that. Try again, or tap the scores in."),
      onEnd: () => setListening(false),
    });
    dictationRef.current = started;
    if (started) setListening(true);
    else setHeard("This browser can’t listen. Tap the scores in instead.");
  };

  /**
   * THE HOLE STRIP KEEPS THE CURRENT HOLE IN VIEW. At a thumb-sized 36px a
   * button, eighteen of them are wider than a phone and the strip scrolls —
   * so moving to the 14th must bring the 14th on screen, or the strip shows
   * holes 1 to 9 while the card says 14. Scrolled on the strip itself, never
   * with `scrollIntoView`, which would also move the page under the scorer.
   */
  const stripRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const strip = stripRef.current;
    const chip = strip?.children[hole] as HTMLElement | undefined;
    if (!strip || !chip) return;
    const left = chip.offsetLeft - strip.offsetLeft - (strip.clientWidth - chip.offsetWidth) / 2;
    strip.scrollLeft = Math.max(0, left);
  }, [hole]);

  /**
   * Said, not tapped — a round button beside the hole rather than a
   * full-width bar, so the pad stays above the fold on a phone. The name says
   * what it does for a screen reader; the ring says it is listening.
   */
  const micOn = !!(meId || voice) && showVoice;
  const micButton = micOn ? (
    <button
      type="button"
      className="btn btn-secondary"
      onClick={listen}
      aria-pressed={listening}
      aria-label={solo ? `Say your score for hole ${holeNumber(hole, firstHole)}` : `Say the scores for hole ${holeNumber(hole, firstHole)}`}
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
  ) : null;
  /* aria-live, NOT role="status": the card's save line is THE status of this
     screen (offline.spec finds it by that role), and a hint that is always
     there is not a status — only what was heard needs announcing, which a
     polite live region does. */
  const micWords = micOn ? (
    <span style={{ fontSize: 14, lineHeight: 1.45, color: "var(--color-neutral-400)", minWidth: 0 }} aria-live="polite">
      {listening
        ? "Listening…"
        : heard ||
          (micHint.seen === true
            ? ""
            : solo
              ? "Or say it: “four”, “par”, “bogey”."
              : !meId
                ? // Nobody here is "me", so the example must not use the word.
                  `Or say them in card order: “${players.map((_, i) => ["four", "five", "four", "three"][i % 4]).join(", ")}”.`
                : `Or say it: “${(players.find((p) => p.id !== meId)?.name ?? "").split(" ")[0] || "Sam"} five, me four”.`)}
    </span>
  ) : null;

  /** Dense: the pick-ups behind one control, open whenever one is in use. */
  const [picksAsked, setPicksAsked] = useState(false);
  const picksOpen = !dense || picksAsked || players.some((p) => pickedUp?.[p.id]?.[hole] === true);

  const holeDone = (i: number) => players.every((p) => strokesOf(p.id)[i] != null);
  const holeStarted = (i: number) => players.some((p) => strokesOf(p.id)[i] != null);

  /**
   * Swipe between holes.
   *
   * The way a phone is actually held walking up the next fairway — one hand,
   * thumb across the screen. The Previous/Next buttons stay: swipe is an
   * addition, never the only way through, because it is invisible and
   * undiscoverable on its own and impossible with a glove.
   *
   * Horizontal intent only, and a real distance: a vertical drag is the page
   * scrolling, and a 12px twitch while tapping a score is not a swipe.
   */
  const touch = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.changedTouches[0];
    touch.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touch.current;
    touch.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    go(dx < 0 ? hole + 1 : hole - 1);
  };

  return (
    <div>
      {/* Position in the round, and which holes are in. Doubles as navigation,
          so a hole written down wrong is two taps away. */}
      <div ref={stripRef} style={{ display: "flex", gap: 4, marginBottom: dense ? 10 : 16, overflowX: "auto", paddingBottom: 2 }}>
        {Array.from({ length: holes }, (_, i) => {
          const done = holeDone(i);
          const part = !done && holeStarted(i);
          const here = i === hole;
          return (
            <button
              key={i}
              type="button"
              className="hole-nav-btn"
              onClick={() => go(i)}
              aria-label={`Hole ${holeNumber(i, firstHole)}${done ? ", complete" : part ? ", partly scored" : ", not scored"}`}
              aria-current={here ? "true" : undefined}
              style={{
                flex: "1 0 auto",
                // 36 x 40, from 26 x 30 (2026-10-05): the most-tapped control
                // on the most-used screen. A coarse pointer lifts the height
                // to 44 in globals.css; the width is what this sets.
                minWidth: 36,
                height: 40,
                fontSize: 15,
                fontVariantNumeric: "tabular-nums",
                fontWeight: here ? 700 : 500,
                cursor: "pointer",
                borderRadius: 6,
                border: here ? "2px solid var(--color-accent)" : "1px solid var(--color-divider)",
                background: done
                  ? "var(--color-accent-900)"
                  : part
                    ? "color-mix(in srgb, var(--color-accent) 8%, transparent)"
                    : "transparent",
                color: "var(--color-text)",
              }}
            >
              {holeNumber(i, firstHole)}
            </button>
          );
        })}
      </div>

      <div
        className="card elev-sm"
        style={{ padding: dense ? "14px 14px" : "18px 16px", touchAction: "pan-y" }}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        <div style={{ display: "flex", alignItems: dense ? "center" : "flex-start", justifyContent: "space-between", gap: dense ? 10 : 14 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: "var(--color-neutral-400)" }}>
              Hole
            </div>
            <div style={{ fontFamily: "var(--font-heading)", fontSize: 54, lineHeight: 1, fontVariantNumeric: "tabular-nums", ...(dense ? { fontSize: 42 } : {}) }}>
              {holeNumber(hole, firstHole)}
            </div>
          </div>
          {/* Dense: the mic beside the number, where the eye already is. */}
          {dense && micButton}
          <div style={{ textAlign: "right", fontSize: 15, lineHeight: dense ? 1.45 : 1.6, color: "var(--color-neutral-400)" }}>
            <div>Par <strong style={{ color: "var(--color-text)", fontSize: 20 }}>{par ?? "—"}</strong></div>
            {/* A length of 0 is a card with no yardage on it, not a hole of
                nought yards — "0 yds" on the first tee reads as a broken card.
                Dense puts the length and the index on one line. */}
            {dense ? (
              <div style={{ fontVariantNumeric: "tabular-nums" }}>
                {[(yards[hole] ?? 0) > 0 ? `${yards[hole]} ${distance.short}` : "", strokeIndex[hole] != null ? `S.I. ${strokeIndex[hole]}` : ""]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            ) : (
              <>
                {(yards[hole] ?? 0) > 0 && <div style={{ fontVariantNumeric: "tabular-nums" }}>{yards[hole]} {distance.short}</div>}
                {strokeIndex[hole] != null && <div>S.I. {strokeIndex[hole]}</div>}
              </>
            )}
            {/* Where the hole is cut today, from the committee's pin sheet. */}
            {pins[hole] && (
              <div style={{ fontVariantNumeric: "tabular-nums" }}>
                {/* The long form is read aloud; an aria-label here, on a
                    role-less div, was ignored and the short code read instead. */}
                <span aria-hidden="true">
                  Pin <strong style={{ color: "var(--color-text)" }}>{pinShort(pins[hole])}</strong>
                </span>
                <span className="sr-only">{`Pin: ${pinLong(pins[hole])}`}</span>
              </div>
            )}
          </div>
        </div>

        {/* Said, not tapped — a round button beside the hole rather than a
            full-width bar, so the pad stays above the fold on a phone. The
            name says what it does for a screen reader; the ring says it is
            listening. */}
        {micOn && !dense && (
          <>
            <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 10 }}>
              {micButton}
              {micWords}
            </div>
            {/* What the mic does, in the one place it is offered on this card. */}
            <MicNote style={{ marginTop: 6, marginBottom: 2 }} />
          </>
        )}

        {solo ? (
          <>
            <SoloPad
              player={players[0]}
              hole={hole}
              firstHole={firstHole}
              par={par}
              value={strokesOf(players[0].id)[hole] ?? null}
              onPick={(v, moveOn) => set(players[0].id, v, moveOn)}
              onDone={() => advanceFrom(hole)}
            />
            {onPickUp && (
              <PickUpToggle
                name={players[0].name}
                hole={holeNumber(hole, firstHole)}
                on={pickedUp?.[players[0].id]?.[hole] === true}
                onToggle={(on) => {
                  onPickUp(players[0].id, hole, on);
                  // Out of the hole is a hole finished: on to the next.
                  if (on) advanceFrom(hole);
                  else cancelAdvance();
                }}
              />
            )}
          </>
        ) : (
          <div style={{ marginTop: dense ? 10 : 16, display: "flex", flexDirection: "column", gap: dense ? 8 : 10 }}>
            {players.map((p, idx) => {
              const value = strokesOf(p.id)[hole] ?? null;
              const shots = p.shotsOn?.(hole) ?? 0;
              const { toPar, played } = toParOf(p.id);
              const picked = pickedUp?.[p.id]?.[hole] === true;
              return (
                <div key={p.id} style={{ paddingTop: 10, borderTop: "1px solid var(--color-divider)" }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 16, fontWeight: 550, overflowWrap: "anywhere" }}>
                      {labels[idx]}
                      {shots > 0 && (
                        <span
                          title={`${shots} handicap ${shots === 1 ? "stroke" : "strokes"} on this hole`}
                          style={{ marginLeft: 5, color: "var(--color-accent-200)", fontWeight: 700 }}
                        >
                          {"•".repeat(shots)}
                        </span>
                      )}
                    </span>
                    <span style={{ display: "block", fontSize: 13, color: "var(--color-neutral-400)", fontVariantNumeric: "tabular-nums" }}>
                      {/* A to-par only where there is a par to be under.
                          `toParOf` sums `s[i] - (pars[i] ?? 0)`, so with no
                          course card it returns the GROSS — and this line then
                          read "+16 thru 4" for four bogeys. The holes played
                          are still a fact and still worth saying. */}
                      {played
                        ? pars.length > 0
                          ? `${toParText(toPar)} thru ${played}`
                          : `thru ${played}`
                        : "no score yet"}
                      {p.signed && " · signed — only the committee can change it"}
                    </span>
                  </span>

                  {/* A stepper, not a pad: the scorer knows the number and is
                      entering it, not choosing from a menu. First tap of + or −
                      starts from par, which is the commonest score on any hole. */}
                  {!p.signed && (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      aria-label={`One fewer stroke for ${p.name} on hole ${holeNumber(hole, firstHole)}`}
                      onClick={() => set(p.id, Math.max(1, (value ?? (par ?? 4) + 1) - 1))}
                      style={{ minWidth: 44, minHeight: 44, fontSize: 18, padding: 0 }}
                    >
                      −
                    </button>
                  )}
                  <span
                    className={`sc-score${scoreMark(value, par)}`}
                    role="img"
                    aria-label={`${p.name}, hole ${holeNumber(hole, firstHole)}${picked ? ", picked up" : value == null ? ", not scored" : `, ${value} strokes`}`}
                    style={{
                      // `.sc-score` is `width: 100%` for the grid cells it was
                      // written for; in this row that took 193 of 311px and
                      // squeezed the player's name to a letter per line. The
                      // group view was never rendered until 2026-09-19.
                      width: 44,
                      flex: "none",
                      minWidth: 44,
                      minHeight: 44,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 19,
                      fontWeight: 700,
                      fontVariantNumeric: "tabular-nums",
                      color: value == null ? "var(--color-neutral-400)" : "var(--color-text)",
                    }}
                  >
                    {picked ? "X" : value ?? "–"}
                  </span>
                  {!p.signed && (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      aria-label={`One more stroke for ${p.name} on hole ${holeNumber(hole, firstHole)}`}
                      onClick={() => set(p.id, (value ?? (par ?? 4) - 1) + 1)}
                      style={{ minWidth: 44, minHeight: 44, fontSize: 18, padding: 0 }}
                    >
                      +
                    </button>
                  )}
                </div>
                {/* Under the row rather than a fifth control in it: at 320px
                    the name already shares the row with three 44px targets. */}
                {onPickUp && picksOpen && !p.signed && (
                  <PickUpToggle
                    name={p.name}
                    hole={holeNumber(hole, firstHole)}
                    on={picked}
                    compact
                    onToggle={(on) => onPickUp(p.id, hole, on)}
                  />
                )}
                </div>
              );
            })}
            {onPickUp && !picksOpen && (
              <button
                type="button"
                className="btn btn-ghost"
                style={{ alignSelf: "flex-start", minHeight: 44, fontSize: 14 }}
                onClick={() => setPicksAsked(true)}
              >
                <Icon name="x" /> Somebody picked up?
              </button>
            )}
          </div>
        )}

        {/* Dense: what the mic heard, and what it does, under the rows — so
            the rows themselves start right under the hole. */}
        {micOn && dense && (
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 4 }}>
            {micWords}
            <MicNote />
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button type="button" className="btn btn-secondary" onClick={() => go(hole - 1)} disabled={hole === 0} style={{ flex: 1, minHeight: 46 }}>
          <Icon name="caret-left" /> Previous
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => go(hole + 1)} disabled={hole === holes - 1} style={{ flex: 1, minHeight: 46 }}>
          Next <Icon name="caret-right" />
        </button>
      </div>
    </div>
  );
}

/**
 * "Picked up" — out of the hole, in match play. A toggle, pressed state and
 * all, so a scorer can see it is on and take it back. Its 44px height is the
 * on-course touch minimum.
 */
function PickUpToggle({
  name,
  hole,
  on,
  onToggle,
  compact = false,
}: {
  name: string;
  hole: number;
  on: boolean;
  onToggle: (on: boolean) => void;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      className="btn btn-secondary"
      aria-pressed={on}
      aria-label={`${name} picked up on hole ${hole}`}
      onClick={() => onToggle(!on)}
      style={{
        marginTop: compact ? 6 : 12,
        minHeight: 44,
        width: compact ? undefined : "100%",
        fontSize: 14,
        ...(on ? { borderColor: "var(--color-accent)", color: "var(--color-accent-200)", fontWeight: 600 } : {}),
      }}
    >
      <Icon name={on ? "check" : "x"} /> {on ? "Picked up — tap to undo" : "Picked up"}
    </button>
  );
}

/** The one-player pad: named, par-relative, and big enough for a gloved thumb. */
function SoloPad({
  player,
  hole,
  par,
  value,
  onPick,
  onDone,
  firstHole = 1,
}: {
  player: CardPlayer;
  hole: number;
  /** The course's number for index 0 — 10 on a back nine. */
  firstHole?: number;
  par: number | undefined;
  value: number | null;
  /** `moveOn` false while a score is still being typed — see `set`. */
  onPick: (v: number | null, moveOn?: boolean) => void;
  /** The typed score is finished (Enter): move on as a tap would. */
  onDone?: () => void;
}) {
  const shots = player.shotsOn?.(hole) ?? 0;
  return (
    <>
      {shots > 0 && (
        <p style={{ margin: "10px 0 0", fontSize: 14, color: "var(--color-accent-200)", fontWeight: 600 }}>
          {"•".repeat(shots)} {shots === 1 ? "1 shot" : `${shots} shots`} on this hole
        </p>
      )}
      {/* `keep-grid` is not decoration. globals.css stacks every inline grid
          inside <main> on phones — `main [style*="grid-template-columns"]` with
          !important — because most two-column layouts have no business staying
          side by side at 375px. This one does: six par-relative picks in a
          single column is a scrolling list, not a keypad. The rule's own
          comment says the hole grid opts out; it simply never did, so the pad
          shipped as six stacked full-width buttons. */}
      <div
        className="keep-grid"
        style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, marginTop: 16 }}
      >
        {RELATIVE.map((rel) => {
          const n = (par ?? 4) + rel;
          if (n < 1) return null;
          const chosen = value === n;
          return (
            <button
              key={rel}
              type="button"
              // A tap SETS the score, it never clears it (2026-10-09). This
              // toggled: tapping the chosen value again cleared the hole. With
              // the card moving on 160ms after a tap, a double-tap on "4 Par" —
              // a glove, a bump in the cart — set the 4, cleared it, then
              // advanced anyway, and the hole was silently blank: walked on a
              // member's phone, both of her first two holes gone. Clearing is
              // still there, deliberately, by emptying "Other".
              onClick={() => onPick(n)}
              aria-pressed={chosen}
              style={{
                // 56px: above the 44px touch minimum, with a glove on.
                minHeight: 56,
                borderRadius: 10,
                cursor: "pointer",
                border: chosen ? "2px solid var(--color-accent)" : "1px solid var(--color-divider)",
                background: chosen ? "var(--color-accent-900)" : "var(--color-surface)",
                color: "var(--color-text)",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 1,
              }}
            >
              <span style={{ fontSize: 24, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{n}</span>
              <span style={{ fontSize: 13, color: "var(--color-neutral-400)" }}>{nameFor(rel, par)}</span>
            </button>
          );
        })}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14 }}>
        <label htmlFor="hbh-other" style={{ fontSize: 14, color: "var(--color-neutral-400)" }}>Other</label>
        <input
          id="hbh-other"
          className={`input sc-score${scoreMark(value, par)}`}
          inputMode="numeric"
          value={value ?? ""}
          onChange={(e) => onPick(parseStroke(e.target.value), false)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && value != null) onDone?.();
          }}
          aria-label={`Strokes on hole ${holeNumber(hole, firstHole)}`}
          style={{ width: 76, minHeight: 44, textAlign: "center", fontSize: 17, fontVariantNumeric: "tabular-nums" }}
        />
      </div>
    </>
  );
}
