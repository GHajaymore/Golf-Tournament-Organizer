"use client";
import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { computeStrokeCard, toParText, parseStrokesTranscript } from "@/lib/domain";
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
}: {
  players: StrokePlayer[];
  pars: number[];
  yards: number[];
  strokeIndex: number[];
  holes: number;
  stageId: string;
  cardsByPlayer: Record<string, (number | null)[]>;
}) {
  const [playerId, setPlayerId] = useState(players[0]?.id ?? "");
  const [cards, setCards] = useState<Record<string, (number | null)[]>>(() => {
    const init: Record<string, (number | null)[]> = {};
    for (const p of players) init[p.id] = cardsByPlayer[p.id] ?? new Array(holes).fill(null);
    return init;
  });
  const [listening, setListening] = useState(false);
  const [listenHint, setListenHint] = useState("Tap the mic and read scores in order, e.g. “four, par, birdie, six”.");
  const recognitionRef = useRef<unknown>(null);
  const [pending, startTransition] = useTransition();

  const player = players.find((p) => p.id === playerId);
  const strokes = cards[playerId] ?? new Array(holes).fill(null);
  const card = useMemo(
    () => computeStrokeCard(strokes, pars, player?.handicap ?? 0, strokeIndex),
    [strokes, pars, strokeIndex, player],
  );
  const parTotal = pars.slice(0, holes).reduce((a, b) => a + b, 0);
  const isEighteen = holes > 9;

  const setHole = (i: number, val: string) => {
    const n = parseInt(val, 10);
    const next = [...strokes];
    next[i] = Number.isFinite(n) && n > 0 ? n : null;
    setCards((prev) => ({ ...prev, [playerId]: next }));
  };
  const save = () => startTransition(() => saveScorecard(stageId, playerId, strokes));

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

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--color-divider)", flexWrap: "wrap", gap: 8 }}>
        <span className="text-muted" style={{ fontSize: 12 }}>
          Front {card.front || "—"} · Back {card.back || "—"} · {card.played}/{holes} holes
        </span>
        <button type="button" className="btn btn-primary" disabled={pending} onClick={save}>
          <i className="ph ph-check" /> Save scorecard
        </button>
      </div>
    </div>
  );
}
