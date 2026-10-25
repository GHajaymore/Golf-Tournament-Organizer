"use client";
import { useEffect, useState, useTransition } from "react";
import type { ReactNode } from "react";
import { usePendingCard } from "./usePendingCard";
import type { HoleResult } from "@/lib/domain";
import { countedHoles, marginRefusal, matchIsOverAfter, matchStandingText, resolveMatch } from "@/lib/domain/match";
import { holeNumber } from "@/lib/domain/hole-number";
import { Icon } from "./Icon";
import { HoleResultCard } from "./HoleResultCard";
import { distinctLabels, firstName } from "@/lib/format";
import type { KeptMatch } from "@/lib/services/match-card";

/** A save's answer: its refusal in words, and the holes the row holds after it (A-relative) — the read-back. */
type Saved = { ok: boolean; error?: string; holes?: HoleResult[] };

export interface MatchKeeperProps {
  match: KeptMatch;
  /** How many holes THIS ROUND is played over — see `PlayClient`'s `holes`. */
  holes?: number;
  pars?: number[];
  yards?: number[];
  strokeIndex?: number[];
  /** The club card's own stroke index for these holes, to print in place of the 1–9 ranking on a nine. */
  cardStrokeIndex?: number[];
  /** The course's number for the card's first hole — 10 on a back nine. */
  firstHole?: number;
  /** The organizer's "Voice entry" setting — off, the card offers no microphone. */
  voiceEntry?: boolean;
  /** A net match's shots per hole, from the holder's side. */
  matchShots?: { mine: number[]; theirs: number[] } | null;
  /** The tournament takes the whole round at the end. */
  submitWhole?: boolean;
  /** The round, for keeping the holes on the phone while they are sent. */
  stageId?: string;
  roundLabel?: string;
  eventName?: string;
  /** The holder's other matches in this round, as links. */
  otherMatches?: { href: string; label: string }[];
  /** Saves the holes, A-relative. Returns its refusal in words rather than throwing. */
  saveHoles: (matchId: string, holes: Array<"A" | "B" | "H" | null>) => Promise<Saved>;
  /** Saves a finished match phoned in as a result ("3&2"). */
  saveResult: (matchId: string, winner: "A" | "B" | "H", margin: string) => Promise<Saved>;
  /** What the "Match over" box offers next — another round's code, or the way back to Today. */
  next?: ReactNode;
  /** Under the card: who is keeping it, and how to leave. */
  footer?: ReactNode;
}

/**
 * ONE MATCH, KEPT HOLE BY HOLE: who won each hole, one at a time (2026-10-18).
 *
 * This is the card a round-code holder keeps their match on, lifted out of
 * `PlayClient` unchanged so the player app can draw the very same one. At the
 * first real cup it was praised for being simple, and Ajay asked for it in the
 * player app too: "keep it in player app … it was very simple today and I want
 * to keep it that way". One card, so the two cannot drift; each page says how
 * it saves (`saveHoles`, `saveResult`) and what comes after (`next`).
 *
 * Side A is always the person holding the phone (`matchCardFor`), and every
 * answer names who won the hole — never "Us" or "Me", which mean whoever's
 * name was picked (the cup, where that turned a four-ball round).
 */
export function MatchKeeper(props: MatchKeeperProps) {
  const m = props.match;
  // The round's own answer first. The card's length is a fallback for a caller
  // that has not been taught to send one, and 18 the last resort — but neither
  // of those is what decides how many holes a round is.
  const holeCount = props.holes || props.pars?.length || m.holes.length || 18;

  // Local copy of the hole results, from the holder's point of view.
  const [holes, setHoles] = useState<HoleResult[]>(m.holes ?? []);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  // Two ways a finished match arrives: tapped hole by hole as it was played,
  // or phoned in from the green as "3&2". Both write the same record.
  const [entryMode, setEntryMode] = useState<"holes" | "result">("holes");
  const [resultWinner, setResultWinner] = useState<"me" | "them" | "halved">("me");
  // The Final result's own "saved", apart from the hole-by-hole one: sharing it
  // read "Saved" on a result nobody had sent.
  const [resultSaved, setResultSaved] = useState(false);
  const [resultMargin, setResultMargin] = useState("");

  /**
   * "SAVES AS YOU GO" (2026-09-19): each change is written to the phone FIRST,
   * then sent a moment later, retried when signal returns, and a refusal is
   * reported as a refusal rather than retried for ever — the queue the
   * signed-in stroke card uses too. Keyed by the match, so a phone keeping two
   * matches never mixes their copies.
   */
  // The match as the server held it when this card was drawn: every hole on it is "Sent".
  const [drawn] = useState<HoleResult[]>(() => Array.from({ length: holeCount }, (_, i) => m.holes?.[i] ?? null));
  // Stored results are always A-relative; the card is the holder's. One flip, both ways.
  const fromHolder = (list: readonly HoleResult[]) => (m.flipped ? list.map((h) => (h === "A" ? "B" : h === "B" ? "A" : h)) : [...list]);
  const matchQueue = usePendingCard<HoleResult[]>({
    stageId: props.stageId ?? "play",
    playerId: `match:${m.id}`,
    drawnFrom: drawn,
    cells: (v) => Array.from({ length: holeCount }, (_, i) => v[i] ?? null),
    enabled: true,
    // Held until the MATCH is decided, not until every cell is filled: a match
    // won 5&4 is over with four holes nobody plays (Rule 3.2a(3)). Asked of the
    // round's length, since a short list would read as fewer holes left.
    holding: !!props.submitWhole && !matchIsOverAfter(holes, holeCount),
    send: async (value) => {
      // Stored results are always A-relative; flip back if this player is B.
      const outgoing = fromHolder(value);
      const res = await props.saveHoles(m.id, outgoing as Array<"A" | "B" | "H" | null>);
      if (!res.ok) throw new Error(res.error ?? "Couldn't save.");
      // READ BACK: the match as the row now holds it, turned to the holder's side.
      return res.holes ? { serverHolds: fromHolder(res.holes) } : "sent";
    },
  });
  /**
   * HOLES LEFT ON THE PHONE LAST TIME ARE TAKEN BACK UP AND SENT. The device
   * copy only ever holds holes the server had not confirmed, so finding one
   * means this phone has work nobody else has seen: it is picked up where it
   * was left.
   */
  const { recovered, clearRecovered, push } = matchQueue;
  useEffect(() => {
    if (!recovered) return;
    setHoles(recovered);
    clearRecovered();
    push(recovered);
  }, [recovered, clearRecovered, push]);

  const filled = holes.filter((h) => h !== null).length;

  const setHole = (i: number, value: HoleResult) => {
    const next = [...holes];
    while (next.length < holeCount) next.push(null);
    next[i] = next[i] === value ? null : value;
    setHoles(next);
    // Onto the phone now, to the server a moment later — see matchQueue.
    matchQueue.push(next);
  };

  // Try again THROUGH THE QUEUE, so it is kept, sent, read back and marked like any tap.
  const save = () => {
    setError("");
    matchQueue.push(Array.from({ length: holeCount }, (_, i) => holes[i] ?? null));
  };

  const saveResult = () => {
    setError("");
    // A RESULT REPLACES THE CARD. Typed over holes already tapped, it used to
    // overwrite them without a word (the cup's UI review, 2026-10-17).
    const tapped = holes.filter((h) => h !== null).length;
    if (tapped > 0 && !window.confirm(`This replaces the ${tapped} hole${tapped === 1 ? "" : "s"} already entered with the result. Save it?`)) {
      return;
    }
    startTransition(async () => {
      // A-relative like everything stored: "me" flips when this player is B.
      const w = resultWinner === "halved" ? "H" : (resultWinner === "me") !== !!m.flipped ? "A" : "B";
      const res = await props.saveResult(m.id, w, resultMargin);
      if (!res.ok) {
        setError(res.error ?? "Couldn't save.");
        return;
      }
      setResultSaved(true);
    });
  };

  // Why this result cannot be sent as it stands — the rule the server asks too.
  // "I won" with this box empty used to be stored as a halved match.
  const resultRefusal = marginRefusal(resultWinner === "halved" ? "H" : "A", resultMargin, holeCount);

  // Counted up to the closeout only: a hole tapped after the match was decided
  // does not count, and the tally said it did (the cup's UI review).
  const counted = countedHoles(Array.from({ length: holeCount }, (_, i) => holes[i] ?? null));
  const won = counted.filter((h) => h === "A").length;
  const lost = counted.filter((h) => h === "B").length;
  const halved = counted.filter((h) => h === "H").length;

  /**
   * EVERY ANSWER NAMES WHO WON THE HOLE (2026-10-18). They said "Us" and
   * "Them" on a four-ball, "Me" and the opponent's name in a single — words
   * that mean whoever's name was tapped on the list, and a scorer who taps
   * the wrong name gets a card from the other side. At the first real cup a
   * scorer did exactly that: tapped an opponent's name, then tapped "Us"
   * for his own pair's holes, and the four-ball was recorded the wrong way
   * round, every hole, on a card that looked right to him. The board showed
   * all five four-balls reversed.
   *
   * So the answers carry the players' own first names ("Sachin & Ajay",
   * "Pinakin & Girish"; widened only where two clash), and so do the line
   * saying how the match stands and the tally. A tap on the pair that won is
   * then right whichever name was picked.
   */
  const [sideA, sideB] = matchSideLabels(m);

  return (
    <>
      <div style={{ marginBottom: 14 }}>
        <div className="page-kicker">{props.roundLabel} · {props.eventName}</div>
        <h1 style={{ fontSize: 22, margin: "5px 0 0", fontFamily: "var(--font-heading)" }}>
          {m.aName} <span className="text-muted" style={{ fontSize: 15 }}>vs</span> {m.bName}
        </h1>
        {/* THE OTHER MATCHES THIS HOLDER HAS IN THE ROUND — a round robin
            has several, and only one was ever reachable. */}
        {props.otherMatches && props.otherMatches.length > 0 && (
          <nav aria-label="Your other matches" style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
            <span className="text-muted" style={{ fontSize: 13, alignSelf: "center" }}>
              Your other matches:
            </span>
            {props.otherMatches.map((o) => (
              <a key={o.href} href={o.href} className="btn btn-secondary" style={{ fontSize: 13, minHeight: 44 }}>
                {o.label}
              </a>
            ))}
          </nav>
        )}
        <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
          Tap who won each hole. {props.submitWhole
            ? "Your organizer wants the full round submitted at the end."
            : "Saves as you go."}
        </p>
      </div>

      <div className="seg" style={{ marginBottom: 10 }}>
        <label className="seg-opt">
          <input type="radio" name="playmode" checked={entryMode === "holes"} onChange={() => setEntryMode("holes")} />
          Hole by hole
        </label>
        <label className="seg-opt">
          <input type="radio" name="playmode" checked={entryMode === "result"} onChange={() => setEntryMode("result")} />
          Final result
        </label>
      </div>

      {entryMode === "result" && (
        <div className="card elev-sm" style={{ gap: 12 }}>
          <p className="text-muted" style={{ fontSize: 13, margin: 0, lineHeight: 1.5 }}>
            The finished match, straight from the green. This replaces anything tapped hole by hole.
          </p>
          <div className="seg" style={{ width: "100%" }}>
            {(["me", "halved", "them"] as const).map((w) => (
              <label key={w} className="seg-opt" style={{ flex: 1, justifyContent: "center" }}>
                <input type="radio" name="playwinner" checked={resultWinner === w} onChange={() => setResultWinner(w)} />
                {w === "me" ? `${sideA} won` : w === "halved" ? "Halved" : `${sideB} won`}
              </label>
            ))}
          </div>
          {resultWinner !== "halved" && (
            <div className="field">
              <label>By how much</label>
              <input
                className="input"
                value={resultMargin}
                onChange={(e) => setResultMargin(e.target.value)}
                placeholder={'e.g. "3&2", "2 UP", "1 UP"'}
                inputMode="text"
              />
            </div>
          )}
          {resultRefusal && (
            <p
              className={resultMargin.trim() ? undefined : "text-muted"}
              style={{ fontSize: 13, margin: 0, color: resultMargin.trim() ? "var(--color-danger)" : undefined }}
            >
              {resultRefusal}
            </p>
          )}
          <button type="button" className="btn btn-primary" disabled={pending || !!resultRefusal} onClick={saveResult}>
            {pending ? "Saving…" : resultSaved ? "Result saved" : "Save result"}
          </button>
          {error && (
            <p role="alert" style={{ fontSize: 13, margin: 0, color: "var(--color-danger)" }}>
              <Icon name="warning-circle" /> {error}
            </p>
          )}
        </div>
      )}

      {entryMode === "holes" && (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", gap: 14, fontSize: 13 }}>
          <span>{sideA} <b>{won}</b></span>
          <span>Halved <b>{halved}</b></span>
          <span>{sideB} <b>{lost}</b></span>
          <span className="text-muted" style={{ marginLeft: "auto" }}>{filled}/{holeCount} holes</span>
        </div>
        {/* WHERE THE MATCH STANDS, in golf's words, and that it is OVER when
            it is (found in the 2026-10-16 rehearsal: a match won 2&1 still
            offered the 18th with nothing to say it was done). Holes tapped
            after the closeout do not count — `resolveMatch` stops at it — so
            the card stays open for correcting an earlier hole. */}
        {(() => {
          const padded = Array.from({ length: holeCount }, (_, i) => holes[i] ?? null);
          const r = resolveMatch(padded);
          if (r.played === 0) return null;
          const text = matchStandingText(r, sideA, sideB);
          // A hole left EMPTY behind ones that have results — a second tap on
          // an answer clears it — is said, so a standing that counts it as
          // still to play is not read as the match (the cup's UI review).
          const last = padded.reduce((at, h, i) => (h !== null ? i : at), -1);
          const gaps = padded
            .slice(0, last)
            .map((h, i) => (h === null ? holeNumber(i, props.firstHole ?? 1) : null))
            .filter((n): n is number => n !== null);
          if (gaps.length > 0) {
            return (
              <p role="status" style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
                <Icon name="warning-circle" /> No result yet on hole{gaps.length > 1 ? "s" : ""} {gaps.join(", ")}. Tap who won {gaps.length > 1 ? "them" : "it"}.
              </p>
            );
          }
          // The next step is said where the player is looking.
          return r.complete ? (
            <div className="card elev-sm" style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
              <p role="status" style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
                Match over: {text}. Nothing more to enter.
              </p>
              {props.next}
            </div>
          ) : (
            <p style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{text}</p>
          );
        })()}

        {/* ONE HOLE AT A TIME (2026-10-07). This was eighteen tiles of three
            13px buttons about 28px tall under the thumb of somebody walking
            off a green. Slot A is always the phone's holder. */}
        <HoleResultCard
          holes={Array.from({ length: holeCount }, (_, i) => holes[i] ?? null)}
          aName={m.aName}
          bName={m.bName}
          aLabel={sideA}
          bLabel={sideB}
          pars={props.pars ?? []}
          yards={props.yards ?? []}
          strokeIndex={props.strokeIndex ?? []}
          shownStrokeIndex={props.cardStrokeIndex}
          firstHole={props.firstHole ?? 1}
          // The mic listens for the first word of each answer — a player's
          // first name, or a pair's first player's — which two can share.
          canHearNames={sideA.split(" ")[0].toLowerCase() !== sideB.split(" ")[0].toLowerCase()}
          showVoice={props.voiceEntry ?? true}
          shotsOn={props.matchShots ? (h) => ({ a: props.matchShots?.mine[h] ?? 0, b: props.matchShots?.theirs[h] ?? 0 }) : undefined}
          wonLost
          // Where each hole's result is — on this phone, sent, or not sent — from the queue itself.
          sync={matchQueue.holes}
          refusal={matchQueue.refusal}
          noteFor={
            m.sideShots
              ? (h) => {
                  const four = m.sideShots ?? [];
                  // First names, unless two of the four share one.
                  const firsts = four.map((p) => firstName(p.name) || p.name);
                  const called = (i: number) => (firsts.filter((f) => f === firsts[i]).length > 1 ? four[i].name : firsts[i]);
                  const getting = four
                    .map((p, i) => ({ p, i }))
                    .filter(({ p }) => (p.perHole[h] ?? 0) > 0)
                    .map(({ p, i }) => `${called(i)}${(p.perHole[h] ?? 0) > 1 ? ` (${p.perHole[h]})` : ""}`);
                  return getting.length ? `Shots here: ${getting.join(", ")}` : "No shots on this hole";
                }
              : undefined
          }
          onPick={(i, v) => setHole(i, v)}
          onSay={(start, values) => {
            const next = Array.from({ length: holeCount }, (_, i) => holes[i] ?? null);
            values.forEach((v, k) => { next[start + k] = v; });
            setHoles(next);
            matchQueue.push(next);
          }}
        />

        {error && (
          <p style={{ fontSize: 13, margin: 0, color: "var(--color-danger)" }}>
            <Icon name="warning-circle" /> {error}
          </p>
        )}

        {/* Where the holes are — saved as they are tapped, so there is no
            button to forget. Only a refusal offers one, to try by hand. */}
        <p role="status" style={{ fontSize: 13, margin: 0, lineHeight: 1.5 }}>
          {matchQueue.status.label}
        </p>
        {/* Counted out of the ROUND's holes — render.test pins nine for a nine. */}
        {props.submitWhole && !matchIsOverAfter(holes, holeCount) && (
          <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
            Fill in each hole until the match is decided, up to all {holeCount}. The card goes in when it is.
          </p>
        )}
        {matchQueue.status.tone === "warn" && (
          <button type="button" className="btn btn-secondary btn-block" disabled={pending} onClick={save}>
            Try saving again
          </button>
        )}
      </div>
      )}

      {props.footer}
    </>
  );
}

/** The two sides as the card names them — first names, widened only where two clash. */
export function matchSideLabels(m: { side?: boolean; aName: string; bName: string }): [string, string] {
  const a = m.side ? m.aName.split(" & ") : [m.aName];
  const b = m.side ? m.bName.split(" & ") : [m.bName];
  const short = distinctLabels([...a, ...b]);
  return [short.slice(0, a.length).join(" & "), short.slice(a.length).join(" & ")];
}
