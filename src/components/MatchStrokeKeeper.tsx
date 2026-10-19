"use client";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { usePendingCard } from "./usePendingCard";
import { HoleByHoleCard } from "./HoleByHoleCard";
import { matchStandingText, resolveMatch } from "@/lib/domain/match";
import { matchSideLabels } from "./MatchKeeper";
import type { KeptMatch, MatchStrokeCard } from "@/lib/services/match-card";

/**
 * A MATCH KEPT ON STROKE CARDS (2026-10-19) — the other half of Ajay's ruling
 * "provide both options for organizer to decide while setting up". Where the
 * organizer chose stroke cards for a round (`matchKeptBy`), the player enters
 * their own ball's strokes, one hole at a time, on the same grid the medal
 * card uses (`HoleByHoleCard`), and the app works out who won each hole from
 * both cards, shots included. Where the round is tapped, `MatchKeeper` is the
 * card instead; a round is never both.
 *
 * Shared by the round-code page and the player app, like `MatchKeeper`: each
 * hands in its own save, which answers a refusal in words.
 */
export function MatchStrokeKeeper(props: {
  match: KeptMatch;
  card: MatchStrokeCard;
  holes: number;
  pars: number[];
  yards: number[];
  strokeIndex: number[];
  firstHole: number;
  voiceEntry?: boolean;
  /** Whole cards only, where the tournament asks for the full round at the end. */
  submitWhole?: boolean;
  stageId: string;
  /** Whose ball this is, for the phone's own copy of the card. */
  holderId: string;
  holderName: string;
  roundLabel?: string;
  eventName?: string;
  save: (matchId: string, strokes: (number | null)[]) => Promise<{ ok: boolean; error?: string }>;
  otherMatches?: Array<{ href: string; label: string }>;
  next?: ReactNode;
  footer?: ReactNode;
}) {
  const holeCount = props.holes || props.pars.length || 18;
  const [card, setCard] = useState<(number | null)[]>(() =>
    Array.from({ length: holeCount }, (_, i) => props.card.strokes[i] ?? null),
  );
  // The server says WHY it refused, and that sentence is shown, not a generic one.
  const [refusal, setRefusal] = useState("");
  const filled = card.filter((v) => typeof v === "number" && v > 0).length;

  // Onto the phone first, to the server a moment later — the queue every card uses.
  const queue = usePendingCard<(number | null)[]>({
    stageId: props.stageId,
    playerId: `${props.holderId}:${props.match.id}`,
    holding: !!props.submitWhole && filled < holeCount,
    send: async (value) => {
      const res = await props.save(props.match.id, value);
      if (!res.ok) {
        setRefusal(res.error ?? "");
        throw new Error(res.error ?? "Couldn't save that card.");
      }
      setRefusal("");
      return "sent";
    },
  });
  const { recovered, clearRecovered, push } = queue;
  useEffect(() => {
    if (!recovered) return;
    const back = Array.from({ length: holeCount }, (_, i) => recovered[i] ?? null);
    setCard(back);
    clearRecovered();
    push(back);
  }, [recovered, clearRecovered, push, holeCount]);

  const [sideA, sideB] = matchSideLabels(props.match);
  const padded = Array.from({ length: holeCount }, (_, i) => props.match.holes[i] ?? null);
  const standing = resolveMatch(padded);

  return (
    <>
      <div style={{ marginBottom: 14 }}>
        {(props.roundLabel || props.eventName) && (
          <div className="page-kicker">
            {[props.roundLabel, props.eventName].filter(Boolean).join(" · ")}
          </div>
        )}
        <h1 style={{ fontSize: 22, margin: "5px 0 0", fontFamily: "var(--font-heading)" }}>
          {props.match.aName} <span className="text-muted" style={{ fontSize: 15 }}>vs</span> {props.match.bName}
        </h1>
        <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 14 }}>
          {props.card.sideBall ? "Your side's card" : "Your own card"}, hole by hole. The app works out who won each
          hole from both cards{props.card.sideBall ? "" : ", shots included"}.
        </p>
      </div>

      <div className="card elev-sm" style={{ gap: 10 }}>
        <div style={{ display: "flex", gap: 14, fontSize: 15, flexWrap: "wrap" }}>
          <span>
            <b>{card.reduce<number>((t, v) => t + (typeof v === "number" ? v : 0), 0) || "—"}</b> gross
          </span>
          <span className="text-muted" style={{ marginLeft: "auto" }}>
            {filled}/{holeCount} holes
          </span>
        </div>

        {/* Where the match stands, worked out from both cards once both are in. */}
        <p role="status" style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
          {standing.played === 0
            ? "The match starts once both cards have a hole."
            : standing.complete
              ? `Match over: ${matchStandingText(standing, sideA, sideB)}.`
              : matchStandingText(standing, sideA, sideB)}
        </p>

        <HoleByHoleCard
          players={[{ id: "me", name: props.holderName, shotsOn: (h: number) => props.card.shots[h] ?? 0 }]}
          cards={{ me: card }}
          pars={props.pars}
          yards={props.yards}
          strokeIndex={props.strokeIndex}
          holes={holeCount}
          firstHole={props.firstHole}
          dense
          onSet={(_id, hole, value) => {
            const nextCard = Array.from({ length: holeCount }, (_, i) => card[i] ?? null);
            nextCard[hole] = value;
            setCard(nextCard);
            queue.push(nextCard);
          }}
          meId="me"
          showVoice={props.voiceEntry ?? true}
        />

        <p role="status" style={{ fontSize: 14, margin: 0, lineHeight: 1.5 }}>
          {queue.status.label}
        </p>
        {refusal && (
          <p style={{ fontSize: 14, margin: 0, lineHeight: 1.5, color: "var(--color-danger)" }}>{refusal}</p>
        )}
        {standing.complete && props.next}
      </div>

      {props.otherMatches && props.otherMatches.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
          {props.otherMatches.map((o) => (
            <a key={o.href} href={o.href} className="btn btn-secondary">
              {o.label}
            </a>
          ))}
        </div>
      )}
      {!standing.complete && props.next && <div style={{ marginTop: 12 }}>{props.next}</div>}
      {props.footer}
    </>
  );
}
