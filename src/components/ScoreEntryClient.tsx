"use client";
import { useMemo, useState, useRef, useTransition } from "react";
import Link from "next/link";
import {
  resolveMatch,
  parseResultTranscript,
  parseHolesTranscript,
  parseStrokesTranscript,
  deriveNetHoles,
  matchStrokesGiven,
  type HoleResult,
} from "@/lib/domain";
import { firstName } from "@/lib/format";
import {
  saveMatchHoles,
  applyMatchResult,
  clearMatch,
  confirmMatch,
  disputeMatch,
  reopenMatch,
  saveMatchScorecard,
} from "@/app/actions/tournament";
import { setMatchCourse } from "@/app/actions/courses";

export interface EntryMatch {
  id: string;
  aId: string;
  bId: string;
  aName: string;
  bName: string;
  aHandicap: number;
  bHandicap: number;
  groupName: string;
  round: number;
  holes: HoleResult[];
  status: string;
  aStrokes: (number | null)[];
  bStrokes: (number | null)[];
  /**
   * The card this match was actually played on, already resolved through
   * match → round → event and narrowed to the nine in play.
   *
   * Per match rather than per round because a venue-less league has every
   * pairing somewhere different, and handicap strokes are allocated by that
   * course's stroke index — scoring them all against the event's course would
   * give the wrong shots on the wrong holes. Absent when no course is known,
   * which gross match play doesn't need.
   */
  pars?: number[];
  yards?: number[];
  strokeIndex?: number[];
  /** Venue name, shown so whoever is entering can see which card is in use. */
  courseName?: string;
  /** The venue set on this match itself, if any. Null means it inherits from
   *  the round, and then the event — which the picker must show as such. */
  courseId?: string | null;
  /** full | front | back — which nine this match played, when 9 holes. */
  nine?: string;
}

const CONFIRM_META: Record<string, { label: string; tag: string }> = {
  pending: { label: "Pending confirmation", tag: "tag-neutral" },
  confirmed: { label: "Confirmed", tag: "tag-accent-2" },
  "auto-confirmed": { label: "Auto-confirmed (24h)", tag: "tag-accent-2" },
  disputed: { label: "Disputed", tag: "tag-accent" },
};

type Winner = "A" | "B" | "H";

/**
 * The badge on a match in the list.
 *
 * Takes the confirmation status as well as the holes, because play being
 * finished and the result being signed off are different things. Calling a
 * complete-but-unapproved match "Final" hides exactly the results an organizer
 * still has to review — and those are the ones they opened this screen for.
 *
 * "Not started" rather than "Pending" for an empty card, since "Pending
 * confirmation" already means something else on this same screen.
 */
function statusOf(holes: HoleResult[], confirmStatus: string): { tag: string; tagClass: string } {
  const r = resolveMatch(holes);
  if (r.complete) {
    if (confirmStatus === "disputed") return { tag: "Disputed", tagClass: "tag-accent" };
    if (confirmStatus === "confirmed" || confirmStatus === "auto-confirmed") {
      return { tag: "Final", tagClass: "tag-accent-2" };
    }
    return { tag: "Awaiting approval", tagClass: "tag-neutral" };
  }
  if (holes.some((h) => h !== null)) return { tag: "Live", tagClass: "tag-accent" };
  return { tag: "Not started", tagClass: "tag-neutral" };
}

function sum(arr: number[], from: number, to: number): number {
  let t = 0;
  for (let i = from; i < to; i += 1) t += arr[i] ?? 0;
  return t;
}

export function ScoreEntryClient({
  matches,
  isStaff = false,
  hideHeader = false,
  pars: parsProp = [],
  yards: yardsProp = [],
  strokeIndex: strokeIndexProp = [],
  netMode = false,
  courseKnown = true,
  isAdmin = false,
  venues = [],
}: {
  matches: EntryMatch[];
  isStaff?: boolean;
  hideHeader?: boolean;
  pars?: number[];
  yards?: number[];
  strokeIndex?: number[];
  netMode?: boolean;
  /** Whether real par/stroke-index data backs this event. False for a league
   *  with no fixed venue, where scorecard entry can't be offered yet. */
  courseKnown?: boolean;
  /** Organizer, as opposed to assistant. Only they may reopen a result. */
  isAdmin?: boolean;
  /** Courses this tournament may be played on. More than one turns on the
   *  per-match venue picker. */
  venues?: Array<{ id: string; name: string }>;
}) {
  const [holesById, setHolesById] = useState<Record<string, HoleResult[]>>(() =>
    Object.fromEntries(matches.map((m) => [m.id, m.holes])),
  );
  const [statusById, setStatusById] = useState<Record<string, string>>(() =>
    Object.fromEntries(matches.map((m) => [m.id, m.status])),
  );
  const [aStrokesById, setAStrokesById] = useState<Record<string, (number | null)[]>>(() =>
    Object.fromEntries(matches.map((m) => [m.id, m.aStrokes])),
  );
  const [bStrokesById, setBStrokesById] = useState<Record<string, (number | null)[]>>(() =>
    Object.fromEntries(matches.map((m) => [m.id, m.bStrokes])),
  );
  const [selectedId, setSelectedId] = useState<string>(matches[0]?.id ?? "");
  /** Per-match venue override, empty string meaning inherit. */
  const [courseByMatch, setCourseByMatch] = useState<Record<string, string>>(() =>
    Object.fromEntries(matches.map((m) => [m.id, m.courseId ?? ""])),
  );
  const [nineByMatch, setNineByMatch] = useState<Record<string, string>>(() =>
    Object.fromEntries(matches.map((m) => [m.id, m.nine === "back" ? "back" : "front"])),
  );
  const [mode, setMode] = useState<"holes" | "result" | "handicap">("holes");
  const [winner, setWinner] = useState<Winner>("A");
  const [margin, setMargin] = useState("");
  const [listening, setListening] = useState<string | null>(null);
  const [listenHint, setListenHint] = useState("Tap the mic and say e.g. “Sam wins 3 and 2”.");
  const recognitionRef = useRef<unknown>(null);
  const entryRef = useRef<HTMLDivElement>(null);
  const [, startTransition] = useTransition();

  // On phones, jump to the entry panel when a match is picked from the list.
  const openMatch = (id: string) => {
    setSelectedId(id);
    if (typeof window !== "undefined" && window.innerWidth <= 820) {
      requestAnimationFrame(() =>
        entryRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
      );
    }
  };

  const active = matches.find((m) => m.id === selectedId);
  // The selected match's own card wins over the round-level one: in a league
  // with no fixed venue every pairing may be somewhere different.
  const pars = active?.pars?.length ? active.pars : parsProp;
  const yards = active?.yards?.length ? active.yards : yardsProp;
  const strokeIndex = active?.strokeIndex?.length ? active.strokeIndex : strokeIndexProp;
  const holes = active ? holesById[active.id] ?? active.holes : [];
  const resolution = useMemo(() => resolveMatch(holes), [holes]);
  const activeStatus = active ? statusById[active.id] ?? active.status : "pending";
  const totalHoles = holes.length || 18;
  const isEighteen = totalHoles > 9;
  const front = Array.from({ length: Math.min(9, totalHoles) }, (_, i) => i);
  const back = isEighteen ? Array.from({ length: totalHoles - 9 }, (_, i) => i + 9) : [];

  if (!active) {
    return (
      <div className="card elev-sm">
        <span className="card-title">No matches yet</span>
        <p className="text-muted" style={{ fontSize: 13 }}>
          {isStaff ? (
            <>Generate flights on the <Link href="/grouping">Flights & divisions</Link> screen to create the round-robin schedule.</>
          ) : (
            "The schedule hasn't been generated yet — check back once flights are set."
          )}
        </p>
      </div>
    );
  }

  const aStrokes = aStrokesById[active.id] ?? active.aStrokes;
  const bStrokes = bStrokesById[active.id] ?? active.bStrokes;
  // Handicap strokes only apply when this round is scored Net; a Gross round
  // still gets the same "enter each hole's strokes" card, just decided scratch.
  const effAHandicap = netMode ? active.aHandicap : 0;
  const effBHandicap = netMode ? active.bHandicap : 0;
  const strokesGiven = useMemo(
    () => matchStrokesGiven(effAHandicap, effBHandicap, strokeIndex.length ? strokeIndex : new Array(totalHoles).fill(18)),
    [effAHandicap, effBHandicap, strokeIndex, totalHoles],
  );

  const persist = (id: string, next: HoleResult[]) => {
    setHolesById((prev) => ({ ...prev, [id]: next }));
    setStatusById((prev) => ({ ...prev, [id]: "pending" }));
    startTransition(() => {
      void saveMatchHoles(id, next);
    });
  };

  const setStatus = (id: string, s: string) => setStatusById((prev) => ({ ...prev, [id]: s }));
  const doConfirm = () => {
    if (!active) return;
    setStatus(active.id, "confirmed");
    startTransition(() => void confirmMatch(active.id));
  };
  const doDispute = () => {
    if (!active) return;
    setStatus(active.id, "disputed");
    startTransition(() => void disputeMatch(active.id));
  };
  const doReopen = () => {
    if (!active) return;
    setStatus(active.id, "pending");
    startTransition(() => void reopenMatch(active.id));
  };

  const setHole = (index: number, value: "A" | "B" | "H") => {
    const next = [...holes];
    next[index] = next[index] === value ? null : value;
    persist(active.id, next);
  };

  const doApplyResult = () => {
    const total = holes.length || 18;
    startTransition(() => {
      void applyMatchResult(active.id, winner, margin);
    });
    import("@/lib/domain").then(({ marginToHoles }) => {
      setHolesById((prev) => ({ ...prev, [active.id]: marginToHoles(winner, margin, total) }));
    });
  };

  const doClear = () => {
    const empty = new Array(holes.length || 18).fill(null) as HoleResult[];
    setHolesById((prev) => ({ ...prev, [active.id]: empty }));
    startTransition(() => {
      void clearMatch(active.id);
    });
  };

  const applyStrokes = (slot: "A" | "B", next: (number | null)[]) => {
    const nextA = slot === "A" ? next : aStrokes;
    const nextB = slot === "B" ? next : bStrokes;
    setAStrokesById((prev) => ({ ...prev, [active.id]: nextA }));
    setBStrokesById((prev) => ({ ...prev, [active.id]: nextB }));
    const derived = deriveNetHoles(nextA, nextB, effAHandicap, effBHandicap, strokeIndex.length ? strokeIndex : new Array(totalHoles).fill(18));
    setHolesById((prev) => ({ ...prev, [active.id]: derived }));
    setStatusById((prev) => ({ ...prev, [active.id]: "pending" }));
    startTransition(() => void saveMatchScorecard(active.id, slot, next));
  };

  const setStroke = (slot: "A" | "B", i: number, val: string) => {
    const n = parseInt(val, 10);
    const value = Number.isFinite(n) && n > 0 ? n : null;
    const strokes = slot === "A" ? aStrokes : bStrokes;
    const next = [...strokes];
    next[i] = value;
    applyStrokes(slot, next);
  };

  const startListen = (
    key: string,
    onTranscript: (transcript: string) => void,
  ) => {
    const SpeechRecognition =
      (window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown })
        .SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setListenHint("Voice entry isn’t supported in this browser — type it instead.");
      return;
    }
    if (listening === key) {
      setListening(null);
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rec: any = new (SpeechRecognition as any)();
    recognitionRef.current = rec;
    rec.lang = "en-US";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    setListening(key);
    setListenHint("Listening…");
    rec.onresult = (e: { results: { 0: { 0: { transcript: string } } } }) => {
      onTranscript(e.results[0][0].transcript);
      setListening(null);
    };
    rec.onerror = () => {
      setListenHint("Didn’t catch that — try again or type it.");
      setListening(null);
    };
    rec.onend = () => setListening(null);
    rec.start();
  };

  const toggleListenResult = () =>
    startListen("result", (transcript) => {
      const parsed = parseResultTranscript(transcript, firstName(active.aName), firstName(active.bName));
      if (parsed.winner) setWinner(parsed.winner);
      if (parsed.margin) setMargin(parsed.margin);
      setListenHint(`Heard: “${transcript}” — review and Apply.`);
    });

  const toggleListenHoles = () =>
    startListen("holes", (transcript) => {
      const startIndex = Math.max(0, holes.findIndex((h) => h == null));
      const parsed = parseHolesTranscript(transcript, firstName(active.aName), firstName(active.bName), startIndex, totalHoles);
      if (parsed.length) {
        const next = [...holes];
        parsed.forEach((v, i) => { next[startIndex + i] = v; });
        persist(active.id, next);
        setListenHint(`Heard: “${transcript}” — filled ${parsed.length} hole${parsed.length === 1 ? "" : "s"}.`);
      } else {
        setListenHint(`Heard: “${transcript}” — say a player's first name or “half” per hole.`);
      }
    });

  const toggleListenStrokes = (slot: "A" | "B") =>
    startListen(`hcp-${slot}`, (transcript) => {
      const strokes = slot === "A" ? aStrokes : bStrokes;
      const startIndex = Math.max(0, strokes.findIndex((s) => s == null));
      const parsed = parseStrokesTranscript(transcript, pars.length ? pars.slice(0, totalHoles) : new Array(totalHoles).fill(4), startIndex);
      if (parsed.length) {
        const next = [...strokes];
        parsed.forEach((v, i) => { next[startIndex + i] = v; });
        applyStrokes(slot, next);
      }
      setListenHint(parsed.length ? `Heard: “${transcript}” — filled ${parsed.length} hole${parsed.length === 1 ? "" : "s"}.` : `Heard: “${transcript}” — didn’t catch any scores.`);
    });

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

  const hasCourseData = pars.length > 0;

  return (
    <>
      {!hideHeader && (
        <div style={{ marginBottom: 20 }}>
          <div className="page-kicker">Manage</div>
          <h2 style={{ fontSize: 27, margin: "5px 0 0" }}>Score entry</h2>
          <p className="text-muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
            Tap each hole: home wins, halved, or away wins. Standings update live.
          </p>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 16, alignItems: "start" }}>
        <div className="card elev-sm entry-matchlist" style={{ gap: 6, maxHeight: "74vh", overflow: "auto" }}>
          <span className="card-kicker">Round-robin matches</span>
          {matches.map((m) => {
            const st = statusOf(holesById[m.id] ?? m.holes, statusById[m.id] ?? m.status);
            const selected = m.id === selectedId;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => openMatch(m.id)}
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

        <div className="card elev-sm" ref={entryRef} style={{ scrollMarginTop: 60 }}>
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

          <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "10px 0", flexWrap: "wrap" }}>
            <div className="seg">
              <label className="seg-opt">
                <input type="radio" name="entrymode" checked={mode === "holes"} onChange={() => setMode("holes")} />
                Hole-by-hole
              </label>
              <label className="seg-opt">
                <input type="radio" name="entrymode" checked={mode === "result"} onChange={() => setMode("result")} />
                Match result
              </label>
              {/* Strokes are meaningless without the card they were played
                  on — par for context, stroke index for net allowances. A
                  league with no fixed venue can still record who won each
                  hole, but it cannot take a scorecard until the course for
                  that match is known. */}
              <label
                className="seg-opt"
                title={
                  courseKnown
                    ? undefined
                    : "Set the course for this match before entering a scorecard — strokes need its par and stroke index."
                }
                style={courseKnown ? undefined : { opacity: 0.45 }}
              >
                <input
                  type="radio"
                  name="entrymode"
                  checked={mode === "handicap"}
                  disabled={!courseKnown}
                  onChange={() => setMode("handicap")}
                />
                Scorecard
              </label>
            </div>
            <span className={`tag ${netMode ? "tag-accent" : "tag-neutral"}`} style={{ fontSize: 11 }}>
              <i className={netMode ? "ph ph-percent" : "ph ph-flag-checkered"} />{" "}
              {netMode ? "Net scoring — strokes given by handicap" : "Gross scoring — lowest strokes wins the hole"}
            </span>

            {/* Which card this match is being scored against. Only meaningful
                when the tournament has more than one venue — otherwise it
                would state the obvious on every screen. */}
            {venues.length > 1 && (
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                <span className="text-muted">Played at</span>
                <select
                  className="input"
                  style={{ width: "auto", fontSize: 12, padding: "3px 8px" }}
                  value={courseByMatch[active.id] ?? ""}
                  onChange={(e) => {
                    const id = e.target.value;
                    setCourseByMatch((prev) => ({ ...prev, [active.id]: id }));
                    startTransition(() =>
                      void setMatchCourse(active.id, id || null, totalHoles === 9 ? nineByMatch[active.id] ?? "front" : "full"),
                    );
                  }}
                >
                  {/* Empty means inherit — from the round, then the event. The
                      label names whatever that resolves to, so "inherit" is a
                      visible default rather than a blank. */}
                  <option value="">
                    {active.courseName ? `${active.courseName} (inherited)` : "Not set"}
                  </option>
                  {venues.map((v) => (
                    <option key={v.id} value={v.id}>{v.name}</option>
                  ))}
                </select>
              </label>
            )}

            {/* Which nine, when this round is 9 holes. Front and back carry
                different pars and stroke indexes, so on a net match this
                decides which holes a player receives shots on. */}
            {totalHoles === 9 && venues.length > 1 && (
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                <span className="text-muted">Nine</span>
                <select
                  className="input"
                  style={{ width: "auto", fontSize: 12, padding: "3px 8px" }}
                  value={nineByMatch[active.id] ?? "front"}
                  onChange={(e) => {
                    const nine = e.target.value;
                    setNineByMatch((prev) => ({ ...prev, [active.id]: nine }));
                    startTransition(() =>
                      void setMatchCourse(active.id, courseByMatch[active.id] || null, nine),
                    );
                  }}
                >
                  <option value="front">Front</option>
                  <option value="back">Back</option>
                </select>
              </label>
            )}
          </div>

          {mode === "holes" && (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "12px 0", fontSize: 13, flexWrap: "wrap" }}>
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
                <button
                  type="button"
                  className="btn btn-icon"
                  onClick={toggleListenHoles}
                  title="Dictate hole results"
                  style={listening === "holes" ? { color: "var(--color-accent)", borderColor: "var(--color-accent)" } : undefined}
                >
                  <i className={listening === "holes" ? "ph-fill ph-microphone" : "ph ph-microphone"} />
                </button>
                <span className="text-muted" style={{ fontSize: 12 }}>{listening === "holes" ? "Listening…" : "Say each hole's winner in order, e.g. “Alex, half, Sam”."}</span>
              </div>

              <div style={{ overflowX: "auto" }}>
                <table className="table" style={{ fontSize: 11, minWidth: hasCourseData ? (isEighteen ? 920 : 520) : undefined }}>
                  {hasCourseData && (
                    <thead>
                      <tr>
                        <th>Hole</th>
                        {front.map((i) => (<th key={i} style={{ textAlign: "center" }}>{i + 1}</th>))}
                        {isEighteen && <th style={{ textAlign: "center" }}>OUT</th>}
                        {back.map((i) => (<th key={i} style={{ textAlign: "center" }}>{i + 1}</th>))}
                        {isEighteen && <th style={{ textAlign: "center" }}>IN</th>}
                      </tr>
                    </thead>
                  )}
                  <tbody>
                    {hasCourseData && (
                      <>
                        <tr>
                          <td className="text-muted">Yards</td>
                          {front.map((i) => (<td key={i} style={{ textAlign: "center", color: "var(--color-neutral-500)" }}>{yards[i] ?? "-"}</td>))}
                          {isEighteen && <td style={{ textAlign: "center", color: "var(--color-neutral-500)" }}>{sum(yards, 0, 9)}</td>}
                          {back.map((i) => (<td key={i} style={{ textAlign: "center", color: "var(--color-neutral-500)" }}>{yards[i] ?? "-"}</td>))}
                          {isEighteen && <td style={{ textAlign: "center", color: "var(--color-neutral-500)" }}>{sum(yards, 9, totalHoles)}</td>}
                        </tr>
                        <tr>
                          <td className="text-muted">Par</td>
                          {front.map((i) => (<td key={i} style={{ textAlign: "center", color: "var(--color-neutral-400)" }}>{pars[i] ?? "-"}</td>))}
                          {isEighteen && <td style={{ textAlign: "center", fontWeight: 600 }}>{sum(pars, 0, 9)}</td>}
                          {back.map((i) => (<td key={i} style={{ textAlign: "center", color: "var(--color-neutral-400)" }}>{pars[i] ?? "-"}</td>))}
                          {isEighteen && <td style={{ textAlign: "center", fontWeight: 600 }}>{sum(pars, 9, totalHoles)}</td>}
                        </tr>
                        <tr>
                          <td className="text-muted">S.I.</td>
                          {front.map((i) => (<td key={i} style={{ textAlign: "center", color: "var(--color-neutral-500)" }}>{strokeIndex[i] ?? "-"}</td>))}
                          {isEighteen && <td />}
                          {back.map((i) => (<td key={i} style={{ textAlign: "center", color: "var(--color-neutral-500)" }}>{strokeIndex[i] ?? "-"}</td>))}
                          {isEighteen && <td />}
                        </tr>
                      </>
                    )}
                    <tr>
                      <td style={{ fontWeight: 500 }}>Result</td>
                      {[...front, ...back].map((i) => (
                        <td key={i} style={{ padding: 2 }}>
                          <div style={{ border: "1px solid var(--color-divider)", borderRadius: 6, overflow: "hidden" }}>
                            <div style={{ display: "flex", flexDirection: "column" }}>
                              <button
                                type="button"
                                className="hole-btn"
                                onClick={() => setHole(i, "A")}
                                style={holes[i] === "A" ? { background: "var(--color-accent)", color: "var(--color-bg)" } : undefined}
                              >
                                A
                              </button>
                              <button
                                type="button"
                                className="hole-btn"
                                onClick={() => setHole(i, "H")}
                                style={holes[i] === "H" ? { background: "var(--color-neutral-600)", color: "var(--color-neutral-100)" } : undefined}
                              >
                                ½
                              </button>
                              <button
                                type="button"
                                className="hole-btn"
                                onClick={() => setHole(i, "B")}
                                style={holes[i] === "B" ? { background: "var(--color-accent-2-500)", color: "var(--color-bg)" } : undefined}
                              >
                                B
                              </button>
                            </div>
                          </div>
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
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
                    onClick={toggleListenResult}
                    title="Dictate result"
                    style={listening === "result" ? { color: "var(--color-accent)", borderColor: "var(--color-accent)" } : undefined}
                  >
                    <i className={listening === "result" ? "ph-fill ph-microphone" : "ph ph-microphone"} />
                  </button>
                </div>
                <div className="text-muted" style={{ fontSize: 12 }}>{listenHint}</div>
              </div>
              <button type="button" className="btn btn-primary btn-block" onClick={doApplyResult}>
                <i className="ph ph-check" /> Apply result
              </button>
            </div>
          )}

          {mode === "handicap" && (
            <div style={{ margin: "12px 0" }}>
              <p className="text-muted" style={{ fontSize: 12, margin: "0 0 10px" }}>
                {netMode
                  ? "Enter each player's gross strokes per hole — the net winner (after handicap strokes, marked •) is worked out automatically."
                  : "Enter each player's gross strokes per hole — the lower score wins each hole, straight up."}
              </p>
              <div style={{ overflowX: "auto" }}>
                <table className="table" style={{ fontSize: 11, minWidth: isEighteen ? 920 : 520 }}>
                  <thead>
                    <tr>
                      <th>Hole</th>
                      {front.map((i) => (<th key={i} style={{ textAlign: "center" }}>{i + 1}</th>))}
                      {isEighteen && <th style={{ textAlign: "center" }}>OUT</th>}
                      {back.map((i) => (<th key={i} style={{ textAlign: "center" }}>{i + 1}</th>))}
                      {isEighteen && <th style={{ textAlign: "center" }}>IN</th>}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="text-muted">Par</td>
                      {front.map((i) => (<td key={i} style={{ textAlign: "center", color: "var(--color-neutral-400)" }}>{pars[i] ?? "-"}</td>))}
                      {isEighteen && <td style={{ textAlign: "center", fontWeight: 600 }}>{sum(pars, 0, 9)}</td>}
                      {back.map((i) => (<td key={i} style={{ textAlign: "center", color: "var(--color-neutral-400)" }}>{pars[i] ?? "-"}</td>))}
                      {isEighteen && <td style={{ textAlign: "center", fontWeight: 600 }}>{sum(pars, 9, totalHoles)}</td>}
                    </tr>
                    <tr>
                      <td className="text-muted">S.I.</td>
                      {front.map((i) => (<td key={i} style={{ textAlign: "center", color: "var(--color-neutral-500)" }}>{strokeIndex[i] ?? "-"}</td>))}
                      {isEighteen && <td />}
                      {back.map((i) => (<td key={i} style={{ textAlign: "center", color: "var(--color-neutral-500)" }}>{strokeIndex[i] ?? "-"}</td>))}
                      {isEighteen && <td />}
                    </tr>
                    {(["A", "B"] as const).map((slot) => {
                      const strokes = slot === "A" ? aStrokes : bStrokes;
                      const given = slot === "A" ? strokesGiven.toA : strokesGiven.toB;
                      const name = slot === "A" ? active.aName : active.bName;
                      const gross = sum(strokes.filter((s): s is number => s != null), 0, strokes.length);
                      return (
                        <tr key={slot}>
                          <td style={{ fontWeight: 500, display: "flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}>
                            {firstName(name)}
                            <button
                              type="button"
                              className="btn btn-icon"
                              onClick={() => toggleListenStrokes(slot)}
                              title={`Dictate ${firstName(name)}'s scores`}
                              style={{ width: 20, height: 20, padding: 0, ...(listening === `hcp-${slot}` ? { color: "var(--color-accent)", borderColor: "var(--color-accent)" } : {}) }}
                            >
                              <i className={listening === `hcp-${slot}` ? "ph-fill ph-microphone" : "ph ph-microphone"} style={{ fontSize: 11 }} />
                            </button>
                          </td>
                          {front.map((i) => (
                            <td key={i} style={{ textAlign: "center", padding: 2, position: "relative" }}>
                              <input
                                className="input"
                                inputMode="numeric"
                                value={strokes[i] ?? ""}
                                onChange={(e) => setStroke(slot, i, e.target.value)}
                                style={{ width: 30, textAlign: "center", padding: "4px 2px", minHeight: 30 }}
                              />
                              {given[i] > 0 && (
                                <span style={{ position: "absolute", top: 0, right: 2, color: "var(--color-accent)", fontSize: 10 }}>•</span>
                              )}
                            </td>
                          ))}
                          {isEighteen && <td style={{ textAlign: "center", fontWeight: 600 }}>{sum(strokes.slice(0, 9).map((s) => s ?? 0), 0, 9) || "—"}</td>}
                          {back.map((i) => (
                            <td key={i} style={{ textAlign: "center", padding: 2, position: "relative" }}>
                              <input
                                className="input"
                                inputMode="numeric"
                                value={strokes[i] ?? ""}
                                onChange={(e) => setStroke(slot, i, e.target.value)}
                                style={{ width: 30, textAlign: "center", padding: "4px 2px", minHeight: 30 }}
                              />
                              {given[i] > 0 && (
                                <span style={{ position: "absolute", top: 0, right: 2, color: "var(--color-accent)", fontSize: 10 }}>•</span>
                              )}
                            </td>
                          ))}
                          {isEighteen && <td style={{ textAlign: "center", fontWeight: 600 }}>{sum(strokes.slice(9, totalHoles).map((s) => s ?? 0), 0, totalHoles - 9) || "—"}</td>}
                          <td style={{ textAlign: "center", fontWeight: 600 }}>{gross || "—"}</td>
                        </tr>
                      );
                    })}
                    <tr>
                      <td className="text-muted">Net result</td>
                      {[...front, ...back].map((i) => (
                        <td key={i} style={{ textAlign: "center" }}>
                          {holes[i] === "A" && <span style={{ color: "var(--color-accent)" }}>A</span>}
                          {holes[i] === "B" && <span style={{ color: "var(--color-accent-2-500)" }}>B</span>}
                          {holes[i] === "H" && <span className="text-muted">½</span>}
                        </td>
                      ))}
                      {isEighteen && <><td /><td /></>}
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="text-muted" style={{ fontSize: 12, margin: "8px 0 0" }}>{listenHint}</p>
            </div>
          )}

          {resolution.complete && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: 8,
                marginTop: 12,
                padding: "10px 12px",
                background: "var(--color-bg)",
                borderRadius: "var(--radius-md)",
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                <i className="ph ph-seal-check" style={{ color: "var(--color-accent)" }} />
                <span className={`tag ${CONFIRM_META[activeStatus]?.tag ?? "tag-neutral"}`}>
                  {CONFIRM_META[activeStatus]?.label ?? activeStatus}
                </span>
              </span>
              <div style={{ display: "flex", gap: 8 }}>
                {activeStatus !== "confirmed" && activeStatus !== "auto-confirmed" && (
                  <>
                    <button type="button" className="btn btn-secondary" onClick={doDispute}>
                      <i className="ph ph-warning" /> Dispute
                    </button>
                    <button type="button" className="btn btn-primary" onClick={doConfirm}>
                      <i className="ph ph-check" /> Confirm result
                    </button>
                  </>
                )}
                {/* Organizer-only: reopening undoes an approval, and the
                    action refuses anyone else. Showing it to assistants would
                    hand them a button that only ever errors. */}
                {isAdmin && (
                  <button type="button" className="btn btn-secondary" onClick={doReopen}>
                    <i className="ph ph-lock-key-open" /> Reopen
                  </button>
                )}
              </div>
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
              <Link className="btn btn-primary" href="/leaderboard">
                <i className="ph ph-ranking" /> Leaderboard
              </Link>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
