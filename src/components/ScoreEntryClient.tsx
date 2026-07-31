"use client";
import { useMemo, useState, useRef, useTransition } from "react";
import { resolveMatch, parseResultTranscript, type HoleResult } from "@/lib/domain";
import { firstName } from "@/lib/format";
import { saveMatchHoles, applyMatchResult, clearMatch } from "@/app/actions/tournament";

export interface EntryMatch {
  id: string;
  aId: string;
  bId: string;
  aName: string;
  bName: string;
  groupName: string;
  round: number;
  holes: HoleResult[];
}

type Winner = "A" | "B" | "H";

function statusOf(holes: HoleResult[]): { tag: string; tagClass: string } {
  const r = resolveMatch(holes);
  if (r.complete) return { tag: "Final", tagClass: "tag-accent-2" };
  if (holes.some((h) => h !== null)) return { tag: "Live", tagClass: "tag-accent" };
  return { tag: "Pending", tagClass: "tag-neutral" };
}

export function ScoreEntryClient({ matches }: { matches: EntryMatch[] }) {
  const [holesById, setHolesById] = useState<Record<string, HoleResult[]>>(() =>
    Object.fromEntries(matches.map((m) => [m.id, m.holes])),
  );
  const [selectedId, setSelectedId] = useState<string>(matches[0]?.id ?? "");
  const [mode, setMode] = useState<"holes" | "result">("holes");
  const [winner, setWinner] = useState<Winner>("A");
  const [margin, setMargin] = useState("");
  const [listening, setListening] = useState(false);
  const [listenHint, setListenHint] = useState("Tap the mic and say e.g. “Sam wins 3 and 2”.");
  const recognitionRef = useRef<unknown>(null);
  const [, startTransition] = useTransition();

  const active = matches.find((m) => m.id === selectedId);
  const holes = active ? holesById[active.id] ?? active.holes : [];
  const resolution = useMemo(() => resolveMatch(holes), [holes]);

  if (!active) {
    return (
      <div className="card elev-sm">
        <span className="card-title">No matches yet</span>
        <p className="text-muted" style={{ fontSize: 13 }}>
          Generate groups on the Grouping screen to create the round-robin schedule.
        </p>
      </div>
    );
  }

  const persist = (id: string, next: HoleResult[]) => {
    setHolesById((prev) => ({ ...prev, [id]: next }));
    startTransition(() => {
      void saveMatchHoles(id, next);
    });
  };

  const setHole = (index: number, value: "A" | "B" | "H") => {
    const next = [...holes];
    next[index] = next[index] === value ? null : value;
    persist(active.id, next);
  };

  const doApplyResult = () => {
    startTransition(() => {
      void applyMatchResult(active.id, winner, margin);
    });
    // Reflect locally via the pure margin conversion for instant feedback.
    import("@/lib/domain").then(({ marginToHoles }) => {
      setHolesById((prev) => ({ ...prev, [active.id]: marginToHoles(winner, margin, 18) }));
    });
  };

  const doClear = () => {
    const empty = new Array(18).fill(null) as HoleResult[];
    setHolesById((prev) => ({ ...prev, [active.id]: empty }));
    startTransition(() => {
      void clearMatch(active.id);
    });
  };

  const toggleListen = () => {
    const SpeechRecognition =
      (window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown })
        .SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setListenHint("Voice entry isn’t supported in this browser — type the result instead.");
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
      const parsed = parseResultTranscript(transcript, firstName(active.aName), firstName(active.bName));
      if (parsed.winner) setWinner(parsed.winner);
      if (parsed.margin) setMargin(parsed.margin);
      setListenHint(`Heard: “${transcript}” — review and Apply.`);
      setListening(false);
    };
    rec.onerror = () => {
      setListenHint("Didn’t catch that — try again or type it.");
      setListening(false);
    };
    rec.onend = () => setListening(false);
    rec.start();
  };

  const holesWonA = holes.filter((h) => h === "A").length;
  const holesWonB = holes.filter((h) => h === "B").length;

  const statusBig = resolution.complete
    ? resolution.winner === "H"
      ? "Halved"
      : `${resolution.winner === "A" ? firstName(active.aName) : firstName(active.bName)} ${resolution.resultText}`
    : holes.some((h) => h !== null)
      ? resolution.lead === 0
        ? "All square"
        : `${resolution.lead > 0 ? firstName(active.aName) : firstName(active.bName)} ${Math.abs(resolution.lead)} up`
      : "Not started";

  return (
    <>
      <div style={{ marginBottom: 20 }}>
        <div className="page-kicker">Scoring</div>
        <h2 style={{ fontSize: 27, margin: "5px 0 0" }}>Score entry</h2>
        <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
          Tap each hole: home wins, halved, or away wins. Standings update live.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 16, alignItems: "start" }}>
        <div className="card elev-sm" style={{ gap: 6, maxHeight: "74vh", overflow: "auto" }}>
          <span className="card-kicker">Round-robin matches</span>
          {matches.map((m) => {
            const st = statusOf(holesById[m.id] ?? m.holes);
            const selected = m.id === selectedId;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setSelectedId(m.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  textAlign: "left",
                  background: selected ? "var(--color-accent-900)" : "transparent",
                  border: `1px solid ${selected ? "var(--color-accent)" : "var(--color-divider)"}`,
                  borderRadius: "var(--radius-md)",
                  padding: "8px 10px",
                  cursor: "pointer",
                  color: "var(--color-text)",
                }}
              >
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span
                    style={{
                      display: "block",
                      fontSize: 13,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {m.aName} v {m.bName}
                  </span>
                  <span style={{ fontSize: 11, color: "var(--color-neutral-500)" }}>
                    {m.groupName} · Round {m.round}
                  </span>
                </span>
                <span className={`tag ${st.tagClass}`}>{st.tag}</span>
              </button>
            );
          })}
        </div>

        <div className="card elev-sm">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
            <div>
              <div className="text-muted" style={{ fontSize: 12 }}>
                {active.groupName} · Round {active.round}
              </div>
              <div style={{ fontFamily: "var(--font-heading)", fontSize: 18, marginTop: 2 }}>
                {active.aName} <span className="text-muted" style={{ fontSize: 13 }}>vs</span> {active.bName}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontFamily: "var(--font-heading)", fontSize: 22, color: "var(--color-accent-200)" }}>
                {statusBig}
              </div>
              <div className="text-muted" style={{ fontSize: 12 }}>
                {resolution.played} played · {resolution.remaining} to play
              </div>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "10px 0" }}>
            <div className="seg">
              <label className="seg-opt">
                <input type="radio" name="entrymode" checked={mode === "holes"} onChange={() => setMode("holes")} />
                Hole-by-hole
              </label>
              <label className="seg-opt">
                <input type="radio" name="entrymode" checked={mode === "result"} onChange={() => setMode("result")} />
                Match result
              </label>
            </div>
          </div>

          {mode === "holes" && (
            <>
              <div style={{ display: "flex", gap: 12, margin: "12px 0", fontSize: 13 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 12, height: 12, borderRadius: 3, background: "var(--color-accent)" }} />
                  {firstName(active.aName)}
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 12, height: 12, borderRadius: 3, background: "var(--color-neutral-600)" }} />
                  Halved
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 12, height: 12, borderRadius: 3, background: "var(--color-accent-2-500)" }} />
                  {firstName(active.bName)}
                </span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(9, 1fr)", gap: 6 }}>
                {holes.map((h, i) => (
                  <div
                    key={i}
                    style={{
                      border: "1px solid var(--color-divider)",
                      borderRadius: 6,
                      overflow: "hidden",
                      textAlign: "center",
                    }}
                  >
                    <div style={{ fontSize: 10, padding: "2px 0", color: "var(--color-neutral-500)", background: "var(--color-bg)" }}>
                      {i + 1}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column" }}>
                      <button
                        type="button"
                        className="hole-btn"
                        onClick={() => setHole(i, "A")}
                        style={h === "A" ? { background: "var(--color-accent)", color: "var(--color-bg)" } : undefined}
                      >
                        A
                      </button>
                      <button
                        type="button"
                        className="hole-btn"
                        onClick={() => setHole(i, "H")}
                        style={h === "H" ? { background: "var(--color-neutral-600)", color: "var(--color-neutral-100)" } : undefined}
                      >
                        ½
                      </button>
                      <button
                        type="button"
                        className="hole-btn"
                        onClick={() => setHole(i, "B")}
                        style={h === "B" ? { background: "var(--color-accent-2-500)", color: "var(--color-bg)" } : undefined}
                      >
                        B
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {mode === "result" && (
            <div className="card elev-sm" style={{ margin: "12px 0", gap: 12, background: "var(--color-bg)" }}>
              <div>
                <div className="text-muted" style={{ fontSize: 12, marginBottom: 6 }}>Winner</div>
                <div className="seg">
                  <label className="seg-opt">
                    <input type="radio" name="rwin" checked={winner === "A"} onChange={() => setWinner("A")} />
                    {active.aName}
                  </label>
                  <label className="seg-opt">
                    <input type="radio" name="rwin" checked={winner === "H"} onChange={() => setWinner("H")} />
                    Halved
                  </label>
                  <label className="seg-opt">
                    <input type="radio" name="rwin" checked={winner === "B"} onChange={() => setWinner("B")} />
                    {active.bName}
                  </label>
                </div>
              </div>
              <div className="field">
                <label>Result (e.g. “3&2”, “1 UP”, “AS”)</label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    className="input"
                    value={margin}
                    onChange={(e) => setMargin(e.target.value)}
                    placeholder="3&2"
                  />
                  <button
                    type="button"
                    className="btn btn-icon"
                    onClick={toggleListen}
                    title="Dictate result"
                    style={listening ? { color: "var(--color-accent)", borderColor: "var(--color-accent)" } : undefined}
                  >
                    <i className={listening ? "ph-fill ph-microphone" : "ph ph-microphone"} />
                  </button>
                </div>
                <div className="text-muted" style={{ fontSize: 12 }}>{listenHint}</div>
              </div>
              <button type="button" className="btn btn-primary btn-block" onClick={doApplyResult}>
                <i className="ph ph-check" /> Apply result
              </button>
            </div>
          )}

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginTop: 14,
              paddingTop: 12,
              borderTop: "1px solid var(--color-divider)",
            }}
          >
            <span className="text-muted" style={{ fontSize: 12 }}>
              Holes won — {firstName(active.aName)} {holesWonA} · {firstName(active.bName)} {holesWonB}
            </span>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" className="btn btn-secondary" onClick={doClear}>
                Clear
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
