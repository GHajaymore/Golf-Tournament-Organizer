"use client";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { CardPhotoReader } from "@/components/CardPhotoReader";
import { HoleByHoleCard } from "@/components/HoleByHoleCard";
import { computeStrokeCard, toParText, parseStrokesTranscript } from "@/lib/domain";
import { isCardLocked } from "@/lib/domain/card-approval";
import { saveScorecard } from "@/app/actions/tournament";

interface StrokePlayer {
  id: string;
  name: string;
  handicap: number;
}

function sum(arr: number[], from: number, to: number): number {
  let t = 0;
  for (let i = from; i < to; i += 1) t += arr[i] ?? 0;
  return t;
}

export function StrokePlayEntry({
  players,
  pars,
  yards,
  strokeIndex,
  holes,
  stageId,
  cardsByPlayer,
  cardStatus = {},
  teeGroups = [],
  shotsByPlayer = {},
}: {
  players: StrokePlayer[];
  pars: number[];
  yards: number[];
  strokeIndex: number[];
  holes: number;
  stageId: string;
  cardsByPlayer: Record<string, (number | null)[]>;
  /** Where each card is between "written down" and "accepted". An approved
   *  card is the committee's, and `saveScorecard` refuses to write one — so
   *  the screen has to know before it offers, rather than after it fails. */
  cardStatus?: Record<string, string>;
  /** The round's tee sheet: who is sharing a card with whom. Empty when no
   *  sheet has been drawn, in which case entry falls back to one player. */
  teeGroups?: Array<{ name: string; time: string; playerIds: string[] }>;
  /** Handicap strokes per hole, per player, from the real course-handicap
   *  allocation on the server. Absent for an event with no tee ratings. */
  shotsByPlayer?: Record<string, number[]>;
}) {
  const [playerId, setPlayerId] = useState(players[0]?.id ?? "");
  const [cards, setCards] = useState<Record<string, (number | null)[]>>(() => {
    const init: Record<string, (number | null)[]> = {};
    for (const p of players) init[p.id] = cardsByPlayer[p.id] ?? new Array(holes).fill(null);
    return init;
  });
  /**
   * Hole-at-a-time or the whole grid.
   *
   * Server-rendered as the grid and switched on mount, rather than read from
   * `window` in the initialiser: this is a client component, so it renders on
   * the server too, and touching `window` there is a hydration mismatch. The
   * cost is one re-render on a phone; the alternative is a console error and a
   * tree React re-creates from scratch.
   */
  const [view, setView] = useState<"hole" | "card">("card");
  useEffect(() => {
    if (window.matchMedia("(max-width: 767px)").matches) setView("hole");
  }, []);

  /**
   * Which tee group is being scored — the card, not the player.
   *
   * Defaults to the group containing the selected player, so arriving from
   * anywhere that already picked a player lands on the right card. `-1` means
   * "just this player", which is the only option when no sheet has been drawn
   * and the right one for a player posting their own round.
   */
  const [groupIdx, setGroupIdx] = useState(-1);
  useEffect(() => {
    const i = teeGroups.findIndex((g) => g.playerIds.includes(playerId));
    if (i !== -1) setGroupIdx(i);
    // Only when the player changes: re-running on teeGroups identity would
    // fight an organizer who has deliberately switched to another group.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerId]);

  const [listening, setListening] = useState(false);
  const [listenHint, setListenHint] = useState("Tap the mic and read scores in order, e.g. “four, par, birdie, six”.");
  const recognitionRef = useRef<unknown>(null);
  const [pending, startTransition] = useTransition();
  const [saveNote, setSaveNote] = useState("");

  const player = players.find((p) => p.id === playerId);
  const strokes = cards[playerId] ?? new Array(holes).fill(null);
  const card = useMemo(
    () => computeStrokeCard(strokes, pars, player?.handicap ?? 0, strokeIndex),
    [strokes, pars, strokeIndex, player],
  );
  const parTotal = pars.slice(0, holes).reduce((a, b) => a + b, 0);
  const isEighteen = holes > 9;

  /**
   * Who is on the card being scored.
   *
   * Kept in tee-sheet order rather than field order — that is the order the
   * scorer reads names off the paper sheet, and matching it is the difference
   * between checking and searching. Ids the sheet lists but the field no longer
   * has (a withdrawal after the draw) are dropped rather than rendered blank.
   */
  const cardPlayers = useMemo(() => {
    const group = groupIdx >= 0 ? teeGroups[groupIdx] : null;
    const chosen = group
      ? group.playerIds
          .map((id) => players.find((p) => p.id === id))
          .filter((p): p is StrokePlayer => !!p)
      : players.filter((p) => p.id === playerId);
    return chosen.map((p) => ({
      id: p.id,
      name: p.name,
      shotsOn: (hole: number) => shotsByPlayer[p.id]?.[hole] ?? 0,
    }));
  }, [groupIdx, teeGroups, players, playerId, shotsByPlayer]);

  const setHole = (i: number, val: string) => {
    const n = parseInt(val, 10);
    const next = [...strokes];
    next[i] = Number.isFinite(n) && n > 0 ? n : null;
    setCards((prev) => ({ ...prev, [playerId]: next }));
  };
  /**
   * Saves the cards that actually have scores on them.
   *
   * Two ways to get this wrong, and they pull in opposite directions. Saving
   * only the selected player drops the other three rounds the scorer just
   * entered, with a confirmation that said it worked. Saving everyone on the
   * tee sheet writes an empty card for each player who has not reported —
   * which is worse, because an empty card is not nothing: it marks a player as
   * having returned a round, and the approval step then has something to
   * approve that nobody wrote.
   *
   * So: a card is saved when it has at least one score on it. Scoring is
   * allowed to be partial — one player in a fourball entering their own round
   * is a normal thing to do, not an incomplete version of a group entry.
   */
  const save = () =>
    startTransition(async () => {
      const targets = (view === "hole" ? cardPlayers.map((p) => p.id) : [playerId]).filter((id) =>
        (cards[id] ?? []).some((s) => s != null),
      );
      // An approved card is left alone rather than attempted. The action
      // refuses it either way, but a group is saved in one loop — one throw
      // part-way through would drop the rounds of everyone after it in the
      // fourball, under a button that said Save.
      const locked = targets.filter((id) => isCardLocked(cardStatus[id] ?? ""));
      for (const id of targets.filter((id) => !locked.includes(id))) {
        await saveScorecard(stageId, id, cards[id] ?? new Array(holes).fill(null));
      }
      setSaveNote(
        locked.length
          ? `Saved. ${locked
              .map((id) => players.find((p) => p.id === id)?.name ?? "A card")
              .join(", ")} — already approved, so left unchanged. An organizer can reopen it below.`
          : "Saved.",
      );
    });

  const toggleListen = () => {
    const SpeechRecognition =
      (window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown })
        .SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setListenHint("Voice entry isn’t supported in this browser — type the scores instead.");
      return;
    }
    if (listening) {
      setListening(false);
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rec: any = new (SpeechRecognition as any)();
    recognitionRef.current = rec;
    rec.lang = "en-US";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    setListening(true);
    setListenHint("Listening…");
    rec.onresult = (e: { results: { 0: { 0: { transcript: string } } } }) => {
      const transcript = e.results[0][0].transcript;
      const startIndex = Math.max(0, strokes.findIndex((s) => s == null));
      const parsed = parseStrokesTranscript(transcript, pars.slice(0, holes), startIndex === -1 ? 0 : startIndex);
      if (parsed.length) {
        const next = [...strokes];
        parsed.forEach((v, i) => { next[startIndex + i] = v; });
        setCards((prev) => ({ ...prev, [playerId]: next }));
        setListenHint(`Heard: “${transcript}” — filled ${parsed.length} hole${parsed.length === 1 ? "" : "s"}. Review and Save.`);
      } else {
        setListenHint(`Heard: “${transcript}” — didn’t catch any scores, try again.`);
      }
      setListening(false);
    };
    rec.onerror = () => {
      setListenHint("Didn’t catch that — try again or type it.");
      setListening(false);
    };
    rec.onend = () => setListening(false);
    rec.start();
  };

  if (!player) {
    return (
      <div className="card elev-sm">
        <span className="text-muted" style={{ fontSize: 13 }}>
          No confirmed players yet — add them on the <Link href="/registration">Registration & field</Link> screen.
        </span>
      </div>
    );
  }

  const front = Array.from({ length: Math.min(9, holes) }, (_, i) => i);
  const back = isEighteen ? Array.from({ length: holes - 9 }, (_, i) => i + 9) : [];

  /**
   * One hole's box, marked the way a printed card is: under par ringed, over
   * par boxed.
   *
   * Not decoration. A 3 typed where a 5 belongs is just another digit in a row
   * of eighteen, but a birdie ring on a hole you know you bogeyed is caught
   * the moment it appears.
   */
  const scoreCell = (i: number) => {
    const v = strokes[i];
    const par = pars[i];
    const d = v != null && par ? v - par : null;
    const mark =
      d === null ? "" : d <= -2 ? " is-eagle" : d === -1 ? " is-under" : d === 1 ? " is-over" : d >= 2 ? " is-double" : "";
    return (
      <td key={i} style={{ padding: 2 }}>
        <input
          className={`input sc-score${mark}`}
          inputMode="numeric"
          value={strokes[i] ?? ""}
          onChange={(e) => setHole(i, e.target.value)}
          aria-label={`Hole ${i + 1}${par ? `, par ${par}` : ""}`}
        />
      </td>
    );
  };

  return (
    <div className="card elev-sm">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <div className="field" style={{ minWidth: 220 }}>
          <label>Player</label>
          <select className="input" value={playerId} onChange={(e) => setPlayerId(e.target.value)}>
            {players.map((p) => (
              <option key={p.id} value={p.id}>{p.name} (hcp {p.handicap})</option>
            ))}
          </select>
        </div>
        <div style={{ display: "flex", gap: 18, textAlign: "center" }}>
          <div><div className="card-kicker">Gross</div><div style={{ fontFamily: "var(--font-heading)", fontSize: 22 }}>{card.gross || "—"}</div></div>
          <div><div className="card-kicker">Net</div><div style={{ fontFamily: "var(--font-heading)", fontSize: 22 }}>{card.played ? card.net : "—"}</div></div>
          <div><div className="card-kicker">To par</div><div style={{ fontFamily: "var(--font-heading)", fontSize: 22, color: "var(--color-accent-200)" }}>{card.played ? toParText(card.toPar) : "—"}</div></div>
          <div><div className="card-kicker">Stableford</div><div style={{ fontFamily: "var(--font-heading)", fontSize: 22, color: "var(--color-accent-2-300)" }}>{card.played ? card.points : "—"}</div></div>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={toggleListen}
          style={listening ? { color: "var(--color-accent)", borderColor: "var(--color-accent)" } : undefined}
        >
          <i className={listening ? "ph-fill ph-microphone" : "ph ph-microphone"} />{" "}
          {listening ? "Listening…" : "Voice entry"}
        </button>
        <span className="text-muted" style={{ fontSize: 12 }}>{listenHint}</span>
      </div>

      {/* Beside the mic because it answers the same question — how do I get
          this card in without typing it. Both fill the grid below and neither
          saves; the organizer's own submit is still what writes anything. */}
      {player && (
        <div style={{ marginTop: 10 }}>
          <CardPhotoReader
            stageId={stageId}
            playerId={player.id}
            playerName={player.name}
            holeCount={holes}
            onReading={(read) =>
              setCards((prev) => {
                // Merge rather than replace: a hole the reader could not make
                // out must not wipe a score already typed in by hand.
                const current = prev[player.id] ?? new Array(holes).fill(null);
                return {
                  ...prev,
                  [player.id]: current.map((existing, i) => read[i] ?? existing ?? null),
                };
              })
            }
          />
        </div>
      )}

      {/* Two windows onto one card. The grid is for a desk and a stack of
          returned cards; the hole view is for a phone on the course. Both write
          to the same state, so switching never loses a score. */}
      <div style={{ display: "flex", gap: 6, marginTop: 14 }}>
        {(["hole", "card"] as const).map((v) => (
          <button
            key={v}
            type="button"
            className="btn btn-secondary"
            onClick={() => setView(v)}
            aria-pressed={view === v}
            style={
              view === v
                ? { color: "var(--color-accent)", borderColor: "var(--color-accent)", fontSize: 12.5 }
                : { fontSize: 12.5 }
            }
          >
            <i className={v === "hole" ? "ph ph-flag" : "ph ph-table"} />{" "}
            {v === "hole" ? "Hole by hole" : "Full card"}
          </button>
        ))}
      </div>

      {view === "hole" ? (
        <div style={{ marginTop: 14 }}>
          {teeGroups.length > 0 && (
            <div className="field" style={{ marginBottom: 14 }}>
              <label>Scoring</label>
              <select
                className="input"
                value={groupIdx}
                onChange={(e) => setGroupIdx(Number(e.target.value))}
              >
                <option value={-1}>{player ? `${player.name} only` : "One player"}</option>
                {teeGroups.map((g, i) => (
                  <option key={i} value={i}>
                    {[g.name || `Group ${i + 1}`, g.time].filter(Boolean).join(" · ")} —{" "}
                    {g.playerIds.length} players
                  </option>
                ))}
              </select>
            </div>
          )}
          <HoleByHoleCard
            players={cardPlayers}
            cards={cards}
            pars={pars}
            yards={yards}
            strokeIndex={strokeIndex}
            holes={holes}
            onSet={(pid, i, v) =>
              setCards((prev) => {
                const next = [...(prev[pid] ?? new Array(holes).fill(null))];
                next[i] = v;
                return { ...prev, [pid]: next };
              })
            }
          />
        </div>
      ) : (
      <div className="sc-wrap" style={{ marginTop: 12 }}>
        <table className="sc" style={{ minWidth: isEighteen ? 960 : 560 }}>
          <thead>
            <tr>
              <th>Hole</th>
              {front.map((i) => (<th key={i}>{i + 1}</th>))}
              {isEighteen && <th className="sc-tot">Out</th>}
              {back.map((i) => (<th key={i}>{i + 1}</th>))}
              {isEighteen && <th className="sc-tot">In</th>}
              <th className="sc-tot">Tot</th>
            </tr>
          </thead>
          <tbody>
            <tr className="sc-ref">
              <td>Yards</td>
              {front.map((i) => (<td key={i}>{yards[i] ?? "-"}</td>))}
              {isEighteen && <td className="sc-tot">{sum(yards, 0, 9)}</td>}
              {back.map((i) => (<td key={i}>{yards[i] ?? "-"}</td>))}
              {isEighteen && <td className="sc-tot">{sum(yards, 9, holes)}</td>}
              <td className="sc-tot">{sum(yards, 0, holes)}</td>
            </tr>
            <tr className="sc-ref sc-par">
              <td>Par</td>
              {front.map((i) => (<td key={i}>{pars[i] ?? "-"}</td>))}
              {isEighteen && <td className="sc-tot">{sum(pars, 0, 9)}</td>}
              {back.map((i) => (<td key={i}>{pars[i] ?? "-"}</td>))}
              {isEighteen && <td className="sc-tot">{sum(pars, 9, holes)}</td>}
              <td className="sc-tot">{parTotal}</td>
            </tr>
            <tr className="sc-ref">
              <td>S.I.</td>
              {front.map((i) => (<td key={i}>{strokeIndex[i] ?? "-"}</td>))}
              {isEighteen && <td className="sc-tot" />}
              {back.map((i) => (<td key={i}>{strokeIndex[i] ?? "-"}</td>))}
              {isEighteen && <td className="sc-tot" />}
              <td className="sc-tot" />
            </tr>
            <tr>
              <td>Score</td>
              {front.map((i) => scoreCell(i))}
              {isEighteen && <td className="sc-tot">{card.front || "—"}</td>}
              {back.map((i) => scoreCell(i))}
              {isEighteen && <td className="sc-tot">{card.back || "—"}</td>}
              <td className="sc-tot">{card.gross || "—"}</td>
            </tr>
          </tbody>
        </table>
      </div>
      )}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--color-divider)", flexWrap: "wrap", gap: 8 }}>
        <span className="text-muted" style={{ fontSize: 12 }}>
          Front {card.front || "—"} · Back {card.back || "—"} · {card.played}/{holes} holes
          {saveNote && (
            <>
              {" · "}
              <span role="status" aria-live="polite">{saveNote}</span>
            </>
          )}
        </span>
        <button type="button" className="btn btn-primary" disabled={pending} onClick={save}>
          <i className="ph ph-check" /> Save scorecard
        </button>
      </div>
    </div>
  );
}
