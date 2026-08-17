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
import { MATCH_ENTRY_MODES, entryModesFor, type MatchEntryMode } from "@/lib/domain/match-entry";
import {
  matchStatusKey,
  filterMatches,
  statusCounts,
  visibleMatches,
  filterActive,
  STATUS_LABEL,
  STATUS_ORDER,
  EMPTY_FILTER,
  VISIBLE_CAP,
  type MatchFilter,
  type MatchStatusKey,
} from "@/lib/domain/match-filter";
import { confirmMatches } from "@/app/actions/tournament";
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
import { VenuePrompt, type VenueCourse } from "./VenuePrompt";

/**
 * The three ways a match gets written down, as the screen offers them.
 *
 * The wording comes from the scoring engine rather than being retyped here,
 * so the screen cannot drift from what the engine actually does with each
 * shape. That matters most for the scorecard option: it is the only one that
 * can be re-scored if the round switches between gross and net, and an
 * organizer choosing the quickest thing to type has no way to know that
 * unless the screen says so.
 */
/**
 * The right card for this round, without asking.
 *
 * The app already knows the format, whether the round is net, and whether a
 * course backs it — which is enough to land on the correct card every time.
 * Asking first made an entry screen open on a menu.
 *
 * There is still a real choice underneath, because match play arrives three
 * ways: a full card, a list of who won each hole, or "3&2" phoned in from the
 * green. But that is a question about what someone happens to be holding, not
 * a setting, so it belongs behind the card rather than in front of it.
 */
export function defaultEntryMode(
  format: string,
  netMode: boolean,
  courseKnown: boolean,
): "holes" | "result" | "handicap" {
  // A stroke-based round has nothing else it can be.
  if (format !== "Match Play") return "handicap";
  // Net match play off a full card lets the app allocate the shots itself,
  // off the course's stroke index. Taking hole results instead means trusting
  // that four people did the same allocation in their heads on the 14th tee.
  if (netMode && courseKnown) return "handicap";
  // Gross: who won each hole is what a player actually writes down.
  return "holes";
}

/** Who took the hole, as one glyph in a scorecard column. */
function holeMark(r: HoleResult): React.ReactNode {
  if (r === "A") return <span style={{ color: "var(--color-accent)" }}>A</span>;
  if (r === "B") return <span style={{ color: "var(--color-accent-2)" }}>B</span>;
  if (r === "H") return <span className="text-muted">½</span>;
  return null;
}

/** Under par is ringed, over par is boxed — the marking a printed card uses,
 *  and the reason a mis-keyed score is visible at all in a row of eighteen. */
function scoreMark(v: number | null | undefined, par: number | undefined): string {
  if (v == null || !par) return "";
  const d = v - par;
  return d <= -2 ? " is-eagle" : d === -1 ? " is-under" : d === 1 ? " is-over" : d >= 2 ? " is-double" : "";
}

const ENTRY_MODES: Array<{ key: "holes" | "result" | "handicap"; domain: MatchEntryMode; label: string; blurb: string; icon: string }> = ([
  { key: "holes", domain: "hole-results", icon: "ph ph-flag", label: "Hole-by-hole result" },
  { key: "handicap", domain: "gross-cards", icon: "ph ph-cards", label: "Full scorecard" },
  { key: "result", domain: "match-result", icon: "ph ph-check-circle", label: "Final result only" },
] as const).map((m) => ({
  ...m,
  blurb: MATCH_ENTRY_MODES.find((d) => d.key === m.domain)?.blurb ?? "",
}));

/** Where .entry-grid in design-system.css collapses to a single column. Kept in
 *  both places because CSS cannot tell JavaScript its breakpoints; if one
 *  moves, the other has to move with it. */
const ENTRY_STACK_WIDTH = 900;

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
  /** When a score was last written for this match, ISO. Null until one is. */
  scoredAt?: string | null;
  /** Who wrote it down, and who signed it off. Names, so a card stays
   *  readable after a member leaves and their row is gone. */
  enteredBy?: string;
  confirmedBy?: string;
  /** The tees each player is rated off, already formatted. Shown because the
   *  shots given come out of slope and rating, and with these invisible the
   *  handicap arithmetic is unauditable — "why did I only get 4 shots?" has
   *  no answer anywhere on the screen. */
  aTee?: string;
  bTee?: string;
  /** Nothing up the match -> round -> event chain says where this was played,
   *  and the tournament has no fixed venue. Decided on the server. */
  venueNeeded?: boolean;
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
const TAG_CLASS: Record<MatchStatusKey, string> = {
  disputed: "tag-accent",
  final: "tag-accent-2",
  awaiting: "tag-neutral",
  live: "tag-accent",
  "not-started": "tag-neutral",
};

/**
 * The row's tag, derived from the same reading the filter uses.
 *
 * This used to decide the words itself, which meant the chip counting eleven
 * "Awaiting approval" and the rows wearing that label were two separate
 * implementations of one rule — and a bulk action built on the first would
 * quietly disagree with the second.
 */
function statusOf(holes: HoleResult[], confirmStatus: string): { tag: string; tagClass: string } {
  const key = matchStatusKey({
    complete: resolveMatch(holes).complete,
    started: holes.some((h) => h !== null),
    confirmStatus,
  });
  return { tag: STATUS_LABEL[key], tagClass: TAG_CLASS[key] };
}

function sum(arr: number[], from: number, to: number): number {
  let t = 0;
  for (let i = from; i < to; i += 1) t += arr[i] ?? 0;
  return t;
}

export function ScoreEntryClient({
  matches,
  format = "Match Play",
  isStaff = false,
  hideHeader = false,
  pars: parsProp = [],
  yards: yardsProp = [],
  strokeIndex: strokeIndexProp = [],
  netMode = false,
  courseKnown = true,
  isAdmin = false,
  venues = [],
  openCourse = false,
  courseLibrary = [],
}: {
  matches: EntryMatch[];
  /** The round's format. Only match play can be written down three ways. */
  format?: string;
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
  /** No fixed venue: each match names its own before it can be scored. */
  openCourse?: boolean;
  courseLibrary?: VenueCourse[];
}) {
  const [holesById, setHolesById] = useState<Record<string, HoleResult[]>>(() =>
    Object.fromEntries(matches.map((m) => [m.id, m.holes])),
  );
  /**
   * The card as of the last edit, whether or not React has re-rendered yet.
   *
   * Every write to `holesById` goes through `writeHoles`, which updates this
   * first. `setHole` then reads it instead of the array its render closed over
   * — two taps landing inside one render both started from the same copy, so
   * the second wrote the first one's hole back to null, on screen and in the
   * database. A ref is the only thing that is current in the same tick.
   */
  const latestHoles = useRef<Record<string, HoleResult[]>>({});
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
  const [filter, setFilter] = useState<MatchFilter>(EMPTY_FILTER);
  const [showAll, setShowAll] = useState(false);
  const [bulkPending, setBulkPending] = useState(false);
  const [bulkNotice, setBulkNotice] = useState("");
  /** Per-match venue override, empty string meaning inherit. */
  const [courseByMatch, setCourseByMatch] = useState<Record<string, string>>(() =>
    Object.fromEntries(matches.map((m) => [m.id, m.courseId ?? ""])),
  );
  // Unanswered stays unanswered. This used to fall back to "front", so a
  // 9-hole match — which starts as "full", the schema default — showed
  // "Front" as though somebody had chosen it, and scored against the front
  // nine while the database still recorded no answer. On a back-nine round
  // that puts every handicap stroke on a hole nobody played, and the card
  // reads perfectly normally.
  const [nineByMatch, setNineByMatch] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      matches.map((m) => [m.id, m.nine === "back" || m.nine === "front" ? m.nine : ""]),
    ),
  );
  // Lazy initializer: derived once from the round, then owned by the
  // organizer if they change it.
  const [mode, setMode] = useState<"holes" | "result" | "handicap">(() =>
    defaultEntryMode(format, netMode, courseKnown),
  );

  /**
   * Which shapes this round's format can actually be written down as.
   *
   * Only match play has three. A stroke-based round — Stableford, Skins,
   * Four-Ball — has no concept of "winning a hole", so a hole result is a
   * shape its scoring simply cannot read, and a match margin is meaningless.
   * Offering them produced entries the leaderboard silently ignored.
   *
   * The rule lives in the engine, not here, so the screen and the resolver
   * cannot disagree about what a format accepts.
   */
  /**
   * The draw, tagged with what each match is doing.
   *
   * Read from the live edit state rather than the props, so a card confirmed
   * in this session leaves the "Awaiting approval" chip immediately instead of
   * waiting for a reload — otherwise "approve the 11 shown" would keep
   * offering the ones just approved.
   */
  const tagged = useMemo(
    () =>
      matches.map((m) => {
        const holes = holesById[m.id] ?? m.holes;
        return {
          ...m,
          status: matchStatusKey({
            complete: resolveMatch(holes).complete,
            started: holes.some((h) => h !== null),
            confirmStatus: statusById[m.id] ?? m.status,
          }),
        };
      }),
    [matches, holesById, statusById],
  );
  const counts = useMemo(() => statusCounts(tagged), [tagged]);
  const shown = useMemo(() => filterMatches(tagged, filter), [tagged, filter]);
  const visible = useMemo(() => visibleMatches(shown, showAll), [shown, showAll]);

  const approveShown = async () => {
    setBulkPending(true);
    setBulkNotice("");
    const ids = shown.map((m) => m.id);
    const res = await confirmMatches(ids);
    setBulkPending(false);
    if (!res.ok) {
      setBulkNotice(res.error ?? "Couldn't approve those.");
      return;
    }
    // Reflect it locally too. The server revalidates, but the list is driven
    // by this component's own edit state, which a revalidate does not reset.
    setStatusById((prev) => {
      const next = { ...prev };
      for (const id of ids) next[id] = "confirmed";
      return next;
    });
    setBulkNotice(
      res.confirmed === 0
        ? "Nothing left to approve — those were already signed off."
        : `Approved ${res.confirmed} result${res.confirmed === 1 ? "" : "s"}.`,
    );
  };

  const allowed = useMemo(() => entryModesFor(format), [format]);
  const availableModes = useMemo(
    () => ENTRY_MODES.filter((m) => allowed.includes(m.domain)),
    [allowed],
  );

  // A format change can strand the selection on a mode this round no longer
  // accepts. Snapping during render rather than in an effect keeps the card
  // below from painting once against a shape it cannot score.
  const effectiveMode = availableModes.some((m) => m.key === mode)
    ? mode
    : defaultEntryMode(format, netMode, courseKnown);
  const activeMode = availableModes.find((m) => m.key === effectiveMode) ?? availableModes[0];
  const [winner, setWinner] = useState<Winner>("A");
  const [margin, setMargin] = useState("");
  const [listening, setListening] = useState<string | null>(null);
  const [listenHint, setListenHint] = useState("Tap the mic and say e.g. “Sam wins 3 and 2”.");
  const recognitionRef = useRef<unknown>(null);
  const entryRef = useRef<HTMLDivElement>(null);
  const [, startTransition] = useTransition();
  // This card saves on every keystroke and has no Save button, so without
  // this a failed write and a successful one look exactly the same — which
  // is how an outage that blocked every score went unnoticed until someone
  // reported it. Now the screen says which happened.
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  /** Why a write failed, where the server had a reason worth repeating. An
   *  action that REFUSED is not an outage, and "check your connection" would
   *  send the scorer looking for the wrong problem. */
  const [saveNote, setSaveNote] = useState("");

  /** Run a write and report how it went. */
  const save = (run: () => Promise<unknown>) => {
    setSaveState("saving");
    setSaveNote("");
    startTransition(async () => {
      try {
        await run();
        setSaveState("saved");
      } catch {
        // Deliberately sticky: the entered value is still on screen and is
        // *not* stored, and clearing that warning on a timer would hide it.
        setSaveState("failed");
      }
    });
  };

  // Whenever the card is stacked under the list rather than beside it, jump to
  // it — otherwise picking a match silently changes something off-screen.
  //
  // 900px is the breakpoint in design-system.css where .entry-grid drops to one
  // column, and the two have to agree. They didn't: this said 820, so between
  // 821 and 900 the layout stacked but nothing scrolled, and the screen looked
  // completely unresponsive to a click.
  const openMatch = (id: string) => {
    setSelectedId(id);
    if (typeof window !== "undefined" && window.innerWidth <= ENTRY_STACK_WIDTH) {
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

  // Above the early return, and unconditional. It used to sit below, so a
  // round with no matches skipped this hook and React saw a different hook
  // order between renders — a crash the type checker cannot see and no test
  // exercised, because every fixture had at least one match.
  //
  // Handicap strokes only apply on a Net round; a Gross round gets the same
  // card, decided scratch.
  const effAHandicap = netMode ? active?.aHandicap ?? 0 : 0;
  const effBHandicap = netMode ? active?.bHandicap ?? 0 : 0;
  const strokesGiven = useMemo(
    () => matchStrokesGiven(effAHandicap, effBHandicap, strokeIndex.length ? strokeIndex : new Array(totalHoles).fill(18)),
    [effAHandicap, effBHandicap, strokeIndex, totalHoles],
  );

  if (!active) {
    return (
      <div className="card elev-sm">
        <span className="card-title">No matches yet</span>
        <p className="text-muted" style={{ fontSize: 13 }}>
          {isStaff ? (
            <>Generate flights on the <Link href="/grouping">Flights</Link> screen to create the round-robin schedule.</>
          ) : (
            "The schedule hasn't been generated yet — check back once flights are set."
          )}
        </p>
      </div>
    );
  }

  const aStrokes = aStrokesById[active.id] ?? active.aStrokes;
  const bStrokes = bStrokesById[active.id] ?? active.bStrokes;

  const writeHoles = (id: string, next: HoleResult[]) => {
    latestHoles.current[id] = next;
    setHolesById((prev) => ({ ...prev, [id]: next }));
  };

  const persist = (id: string, next: HoleResult[]) => {
    writeHoles(id, next);
    setStatusById((prev) => ({ ...prev, [id]: "pending" }));
    save(() => saveMatchHoles(id, next));
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
    const next = [...(latestHoles.current[active.id] ?? holes)];
    next[index] = next[index] === value ? null : value;
    persist(active.id, next);
  };

  const doApplyResult = () => {
    const total = holes.length || 18;
    save(() => applyMatchResult(active.id, winner, margin));
    import("@/lib/domain").then(({ marginToHoles }) => {
      writeHoles(active.id, marginToHoles(winner, margin, total));
    });
  };

  const doClear = () => {
    const empty = new Array(holes.length || 18).fill(null) as HoleResult[];
    // Not optimistic, unlike every other write on this card. The server can
    // refuse this one — a confirmed result has to be reopened first — and
    // blanking the card before the answer comes back would show a scorer an
    // erased match that is still stored, which is the one outcome worse than
    // the refusal itself.
    setSaveState("saving");
    setSaveNote("");
    startTransition(async () => {
      try {
        const res = await clearMatch(active.id);
        if (!res.ok) {
          setSaveState("failed");
          setSaveNote(res.error ?? "");
          return;
        }
        writeHoles(active.id, empty);
        setStatus(active.id, "pending");
        setSaveState("saved");
      } catch {
        setSaveState("failed");
      }
    });
  };

  const applyStrokes = (slot: "A" | "B", next: (number | null)[]) => {
    const nextA = slot === "A" ? next : aStrokes;
    const nextB = slot === "B" ? next : bStrokes;
    setAStrokesById((prev) => ({ ...prev, [active.id]: nextA }));
    setBStrokesById((prev) => ({ ...prev, [active.id]: nextB }));
    const derived = deriveNetHoles(nextA, nextB, effAHandicap, effBHandicap, strokeIndex.length ? strokeIndex : new Array(totalHoles).fill(18));
    writeHoles(active.id, derived);
    setStatusById((prev) => ({ ...prev, [active.id]: "pending" }));
    save(() => saveMatchScorecard(active.id, slot, next));
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

  /**
   * One hole's three-way picker.
   *
   * Named for the two players rather than "home/away": on a phone the column
   * is too narrow for a name, so the letters carry the colour and the label
   * carries the name for anyone using a screen reader.
   */
  const pick = (i: number) => (
    <div className="sc-pick">
      <button
        type="button"
        className="is-a"
        aria-pressed={holes[i] === "A"}
        aria-label={`Hole ${i + 1} to ${active.aName}`}
        onClick={() => setHole(i, "A")}
      >
        A
      </button>
      <button
        type="button"
        className="is-h"
        aria-pressed={holes[i] === "H"}
        aria-label={`Hole ${i + 1} halved`}
        onClick={() => setHole(i, "H")}
      >
        ½
      </button>
      <button
        type="button"
        className="is-b"
        aria-pressed={holes[i] === "B"}
        aria-label={`Hole ${i + 1} to ${active.bName}`}
        onClick={() => setHole(i, "B")}
      >
        B
      </button>
    </div>
  );

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

      <div className="entry-grid">
        {/* Height lives in .entry-matchlist, not here. As an inline style it
            beat the stylesheet's own narrow-screen cap, so on a single-column
            layout the list stayed 74vh tall and pushed the card below the
            fold — picking a match appeared to do nothing at all. */}
        <div className="card elev-sm entry-matchlist" style={{ gap: 6 }}>
          <span className="card-kicker">Round-robin matches</span>

          {/* Only worth the room once the draw is bigger than the list. Below
              that the filter costs more space than it saves. */}
          {matches.length > VISIBLE_CAP && (
            <>
              <input
                className="input"
                value={filter.query}
                onChange={(e) => setFilter((f) => ({ ...f, query: e.target.value }))}
                placeholder="Search player, flight or round…"
                style={{ fontSize: 13 }}
              />
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {STATUS_ORDER.filter((k) => counts[k] > 0).map((k) => {
                  const on = filter.status === k;
                  return (
                    <button
                      key={k}
                      type="button"
                      className={`tag ${on ? "tag-accent" : "tag-neutral"}`}
                      // Tapping the chip you are already on clears it, so the
                      // way back to everything is the control you just used.
                      onClick={() => setFilter((f) => ({ ...f, status: on ? null : k }))}
                      style={{ cursor: "pointer", border: "none" }}
                      aria-pressed={on}
                    >
                      {STATUS_LABEL[k]} {counts[k]}
                    </button>
                  );
                })}
                {filterActive(filter) && (
                  <button
                    type="button"
                    className="tag tag-neutral"
                    onClick={() => setFilter(EMPTY_FILTER)}
                    style={{ cursor: "pointer", border: "none" }}
                  >
                    <i className="ph ph-x" /> Clear
                  </button>
                )}
              </div>
            </>
          )}

          {/* Only where it is the whole point of the filter: approving the
              cards that are waiting. Offering it beside "Final" would be a
              button with nothing to do, and beside "Disputed" it would be
              wrong. */}
          {isStaff && filter.status === "awaiting" && shown.length > 0 && (
            <button
              type="button"
              className="btn btn-secondary"
              disabled={bulkPending}
              onClick={approveShown}
              style={{ justifyContent: "center", fontSize: 13 }}
            >
              <i className="ph ph-check-circle" />{" "}
              {bulkPending
                ? "Approving…"
                : `Approve ${shown.length} shown result${shown.length === 1 ? "" : "s"}`}
            </button>
          )}
          {bulkNotice && (
            <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
              {bulkNotice}
            </p>
          )}

          {shown.length === 0 && (
            <p className="text-muted" style={{ fontSize: 12, margin: "4px 0" }}>
              No matches for that.
            </p>
          )}

          {visible.rows.map((m) => {
            const st = statusOf(holesById[m.id] ?? m.holes, statusById[m.id] ?? m.status);
            const selected = m.id === selectedId;
            return (
              <button
                key={m.id}
                type="button"
                className="match-row"
                aria-current={selected}
                onClick={() => openMatch(m.id)}
              >
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span className="match-row-name">
                    {m.aName} v {m.bName}
                  </span>
                  <span className="match-row-meta">
                    {m.groupName} · Round {m.round}
                  </span>
                </span>
                <span className={`tag ${st.tagClass}`}>{st.tag}</span>
              </button>
            );
          })}

          {visible.hidden > 0 && (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setShowAll(true)}
              style={{ justifyContent: "center", fontSize: 13 }}
            >
              Show {visible.hidden} more
            </button>
          )}
        </div>

        {openCourse && active.venueNeeded ? (
          <div ref={entryRef} style={{ scrollMarginTop: 60 }}>
            <VenuePrompt
              key={active.id}
              matchId={active.id}
              holes={holes.length || 18}
              library={courseLibrary}
              aName={active.aName}
              bName={active.bName}
            />
          </div>
        ) : (
        <div className="card elev-sm" ref={entryRef} style={{ scrollMarginTop: 60 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
            <div>
              <div className="text-muted" style={{ fontSize: 12 }}>
                {active.groupName} · Round {active.round}
              </div>
              <div style={{ fontFamily: "var(--font-heading)", fontSize: 18, marginTop: 2 }}>
                {active.aName} <span className="text-muted" style={{ fontSize: 13 }}>vs</span> {active.bName}
              </div>
              {/* Where, which nine, and when it was written down. This is the
                  first thing anyone checks when a card is queried, and in a
                  league with no fixed venue it is the only way to tell two
                  otherwise identical cards apart. */}
              <div className="text-muted" style={{ fontSize: 12, marginTop: 3, display: "flex", gap: 10, flexWrap: "wrap" }}>
                {active.courseName && (
                  <span><i className="ph ph-map-pin" style={{ marginRight: 3 }} />{active.courseName}</span>
                )}
                {totalHoles === 9 && nineByMatch[active.id] && (
                  <span>{nineByMatch[active.id] === "back" ? "Back 9 (10–18)" : "Front 9 (1–9)"}</span>
                )}
                {(active.aTee || active.bTee) && (
                  <span title="Tees, course rating and slope — what the shots given are calculated from">
                    <i className="ph ph-flag-pennant" style={{ marginRight: 3 }} />
                    {active.aTee === active.bTee
                      ? active.aTee
                      : `${firstName(active.aName)} ${active.aTee ?? "—"} · ${firstName(active.bName)} ${active.bTee ?? "—"}`}
                  </span>
                )}
                {(active.scoredAt || active.enteredBy) && (
                  <span title="Who last wrote a score for this match, and when the card was completed">
                    <i className="ph ph-clock-counter-clockwise" style={{ marginRight: 3 }} />
                    {active.enteredBy ? `Entered by ${active.enteredBy}` : "Entered"}
                    {active.scoredAt
                      ? ` · ${new Date(active.scoredAt).toLocaleDateString(undefined, {
                          month: "short", day: "numeric", year: "numeric",
                        })}`
                      : ""}
                  </span>
                )}
                {active.confirmedBy && (
                  <span><i className="ph ph-seal-check" style={{ marginRight: 3 }} />Signed off by {active.confirmedBy}</span>
                )}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontFamily: "var(--font-heading)", fontSize: 22, color: "var(--color-accent-200)" }}>
                {statusBig}
              </div>
              <div className="text-muted" style={{ fontSize: 12 }}>
                {resolution.played} played · {resolution.remaining} to play
              </div>
              {/* Sits under the score the eye is already on. A failure has to
                  be loud: the number is on screen but not in the database,
                  and the person entering it has no other way to tell. */}
              {saveState !== "idle" && (
                <div
                  role="status"
                  aria-live="polite"
                  style={{
                    fontSize: 12,
                    marginTop: 4,
                    fontWeight: saveState === "failed" ? 600 : 400,
                    color:
                      saveState === "failed"
                        ? "var(--color-danger)"
                        : saveState === "saved"
                          ? "var(--color-accent-2)"
                          : "var(--color-neutral-500)",
                  }}
                >
                  {saveState === "saving" && (<><i className="ph ph-circle-notch" /> Saving…</>)}
                  {saveState === "saved" && (<><i className="ph ph-check" /> Saved</>)}
                  {saveState === "failed" && (
                    <>
                      <i className="ph ph-warning-circle" />{" "}
                      {saveNote || "Not saved — check your connection and re-enter."}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "12px 0", flexWrap: "wrap" }}>
            {/* Shown, not hidden behind a link. The format decides which of
                these exist at all; the round decides which one is already
                selected. Both of those are the app's job — but the choice
                between the shapes that remain is the organizer's, and it
                belongs in front of them. */}
            {availableModes.length > 1 ? (
              <div className="mode-pick">
                {availableModes.map((m) => {
                  const off = m.key === "handicap" && !courseKnown;
                  return (
                    <button
                      key={m.key}
                      type="button"
                      className="mode-opt"
                      aria-pressed={effectiveMode === m.key}
                      disabled={off}
                      onClick={() => setMode(m.key)}
                    >
                      <span className="mode-opt-head">
                        <i className={m.icon} /> {m.label}
                      </span>
                      <span className="mode-opt-blurb">{m.blurb}</span>
                      {off && (
                        <span className="mode-opt-why">
                          Set the course for this match first — strokes need its par and stroke index.
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="text-muted" style={{ fontSize: 12, margin: 0, maxWidth: "64ch", lineHeight: 1.5 }}>
                <i className={activeMode?.icon ?? "ph ph-cards"} />{" "}
                <strong style={{ color: "var(--color-text)" }}>{activeMode?.label}</strong> — {format} is scored
                on strokes, so there is no hole winner to record and no match margin to report.
              </p>
            )}

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
            {totalHoles === 9 && (
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                <span className="text-muted">Nine</span>
                <select
                  className="input"
                  style={{ width: "auto", fontSize: 12, padding: "3px 8px" }}
                  value={nineByMatch[active.id] ?? ""}
                  onChange={(e) => {
                    const nine = e.target.value;
                    setNineByMatch((prev) => ({ ...prev, [active.id]: nine }));
                    startTransition(() =>
                      void setMatchCourse(active.id, courseByMatch[active.id] || null, nine),
                    );
                  }}
                >
                  <option value="">— which nine? —</option>
                  <option value="front">Front (1–9)</option>
                  <option value="back">Back (10–18)</option>
                </select>
              </label>
            )}
            {/* Said plainly rather than left to the empty dropdown: the card
                below is already scoreable, and a player would have no reason
                to look at a select they have not been asked about. */}
            {totalHoles === 9 && !nineByMatch[active.id] && (
              <span style={{ fontSize: 12, color: "var(--color-danger)", fontWeight: 500 }}>
                <i className="ph ph-warning-circle" /> Say which nine before scoring — front and
                back have different stroke indexes, so this decides where shots fall.
              </span>
            )}
          </div>

          {effectiveMode === "holes" && (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "12px 0", fontSize: 13, flexWrap: "wrap" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span className="sc-key-dot" style={{ background: "var(--color-accent)" }} />
                  {firstName(active.aName)}
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span className="sc-key-dot" style={{ background: "var(--color-text)" }} />
                  Halved
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span className="sc-key-dot" style={{ background: "var(--color-accent-2)" }} />
                  {firstName(active.bName)}
                </span>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={toggleListenHoles}
                  style={listening === "holes" ? { color: "var(--color-accent)", borderColor: "var(--color-accent)" } : undefined}
                >
                  <i className={listening === "holes" ? "ph-fill ph-microphone" : "ph ph-microphone"} />{" "}
                  {listening === "holes" ? "Listening…" : "Voice entry"}
                </button>
                <span className="text-muted" style={{ fontSize: 12 }}>{listening === "holes" ? "Listening…" : "Say each hole's winner in order, e.g. “Alex, half, Sam”."}</span>
              </div>

              <div className="sc-wrap">
                <table className="sc" style={{ minWidth: hasCourseData ? (isEighteen ? 900 : 520) : undefined }}>
                  {hasCourseData && (
                    <thead>
                      <tr>
                        <th>Hole</th>
                        {front.map((i) => (<th key={i}>{i + 1}</th>))}
                        {isEighteen && <th className="sc-tot">Out</th>}
                        {back.map((i) => (<th key={i}>{i + 1}</th>))}
                        {isEighteen && <th className="sc-tot">In</th>}
                      </tr>
                    </thead>
                  )}
                  <tbody>
                    {hasCourseData && (
                      <>
                        <tr className="sc-ref">
                          <td>Yards</td>
                          {front.map((i) => (<td key={i}>{yards[i] ?? "-"}</td>))}
                          {isEighteen && <td className="sc-tot">{sum(yards, 0, 9)}</td>}
                          {back.map((i) => (<td key={i}>{yards[i] ?? "-"}</td>))}
                          {isEighteen && <td className="sc-tot">{sum(yards, 9, totalHoles)}</td>}
                        </tr>
                        <tr className="sc-ref sc-par">
                          <td>Par</td>
                          {front.map((i) => (<td key={i}>{pars[i] ?? "-"}</td>))}
                          {isEighteen && <td className="sc-tot">{sum(pars, 0, 9)}</td>}
                          {back.map((i) => (<td key={i}>{pars[i] ?? "-"}</td>))}
                          {isEighteen && <td className="sc-tot">{sum(pars, 9, totalHoles)}</td>}
                        </tr>
                        <tr className="sc-ref">
                          <td>S.I.</td>
                          {front.map((i) => (<td key={i}>{strokeIndex[i] ?? "-"}</td>))}
                          {isEighteen && <td className="sc-tot" />}
                          {back.map((i) => (<td key={i}>{strokeIndex[i] ?? "-"}</td>))}
                          {isEighteen && <td className="sc-tot" />}
                        </tr>
                      </>
                    )}
                    <tr>
                      <td>Result</td>
                      {/* Front and back are emitted separately with the total
                          columns between them. Mapping all eighteen in one go
                          skipped the Out and In cells, so every back-nine
                          picker sat one column left of its hole number — the
                          card looked right and pointed at the wrong hole. */}
                      {front.map((i) => (
                        <td key={i} style={{ padding: 2 }}>{pick(i)}</td>
                      ))}
                      {isEighteen && <td className="sc-tot" />}
                      {back.map((i) => (
                        <td key={i} style={{ padding: 2 }}>{pick(i)}</td>
                      ))}
                      {isEighteen && <td className="sc-tot" />}
                    </tr>
                  </tbody>
                </table>
              </div>
            </>
          )}

          {effectiveMode === "result" && (
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

          {effectiveMode === "handicap" && (
            <div style={{ margin: "12px 0" }}>
              <p className="text-muted" style={{ fontSize: 12, margin: "0 0 10px" }}>
                {netMode
                  ? "Enter each player's gross strokes per hole — the net winner (after handicap strokes, marked •) is worked out automatically."
                  : "Enter each player's gross strokes per hole — the lower score wins each hole, straight up."}
              </p>
              <div className="sc-wrap">
                <table className="sc" style={{ minWidth: isEighteen ? 940 : 540 }}>
                  <thead>
                    <tr>
                      <th>Hole</th>
                      {front.map((i) => (<th key={i}>{i + 1}</th>))}
                      {isEighteen && <th className="sc-tot">Out</th>}
                      {back.map((i) => (<th key={i}>{i + 1}</th>))}
                      {isEighteen && <th className="sc-tot">In</th>}
                      {/* The player rows have always emitted a gross total.
                          The header never declared it, so every column in the
                          body sat one place left of its label. */}
                      <th className="sc-tot">Tot</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="sc-ref sc-par">
                      <td>Par</td>
                      {front.map((i) => (<td key={i}>{pars[i] ?? "-"}</td>))}
                      {isEighteen && <td className="sc-tot">{sum(pars, 0, 9)}</td>}
                      {back.map((i) => (<td key={i}>{pars[i] ?? "-"}</td>))}
                      {isEighteen && <td className="sc-tot">{sum(pars, 9, totalHoles)}</td>}
                      <td className="sc-tot">{sum(pars, 0, totalHoles)}</td>
                    </tr>
                    <tr className="sc-ref">
                      <td>S.I.</td>
                      {front.map((i) => (<td key={i}>{strokeIndex[i] ?? "-"}</td>))}
                      {isEighteen && <td className="sc-tot" />}
                      {back.map((i) => (<td key={i}>{strokeIndex[i] ?? "-"}</td>))}
                      {isEighteen && <td className="sc-tot" />}
                      <td className="sc-tot" />
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
                              className="btn btn-secondary"
                              onClick={() => toggleListenStrokes(slot)}
                              title={`Dictate ${firstName(name)}'s scores`}
                              style={{ fontSize: 11, padding: "2px 7px", whiteSpace: "nowrap", ...(listening === `hcp-${slot}` ? { color: "var(--color-accent)", borderColor: "var(--color-accent)" } : {}) }}
                            >
                              <i className={listening === `hcp-${slot}` ? "ph-fill ph-microphone" : "ph ph-microphone"} style={{ fontSize: 11 }} />{" "}
                              {listening === `hcp-${slot}` ? "Listening…" : "Voice"}
                            </button>
                          </td>
                          {front.map((i) => (
                            <td key={i} style={{ padding: 2, position: "relative" }}>
                              <input
                                className={`input sc-score${scoreMark(strokes[i], pars[i])}`}
                                inputMode="numeric"
                                value={strokes[i] ?? ""}
                                onChange={(e) => setStroke(slot, i, e.target.value)}
                                aria-label={`${name}, hole ${i + 1}${pars[i] ? `, par ${pars[i]}` : ""}`}
                              />
                              {given[i] > 0 && (
                                <span
                                  title={`${firstName(name)} receives a shot here`}
                                  style={{ position: "absolute", top: 1, right: 3, color: "var(--color-accent)", fontSize: 11, lineHeight: 1 }}
                                >
                                  •
                                </span>
                              )}
                            </td>
                          ))}
                          {isEighteen && <td className="sc-tot">{sum(strokes.slice(0, 9).map((s) => s ?? 0), 0, 9) || "—"}</td>}
                          {back.map((i) => (
                            <td key={i} style={{ padding: 2, position: "relative" }}>
                              <input
                                className={`input sc-score${scoreMark(strokes[i], pars[i])}`}
                                inputMode="numeric"
                                value={strokes[i] ?? ""}
                                onChange={(e) => setStroke(slot, i, e.target.value)}
                                aria-label={`${name}, hole ${i + 1}${pars[i] ? `, par ${pars[i]}` : ""}`}
                              />
                              {given[i] > 0 && (
                                <span
                                  title={`${firstName(name)} receives a shot here`}
                                  style={{ position: "absolute", top: 1, right: 3, color: "var(--color-accent)", fontSize: 11, lineHeight: 1 }}
                                >
                                  •
                                </span>
                              )}
                            </td>
                          ))}
                          {isEighteen && <td className="sc-tot">{sum(strokes.slice(9, totalHoles).map((s) => s ?? 0), 0, totalHoles - 9) || "—"}</td>}
                          <td className="sc-tot">{gross || "—"}</td>
                        </tr>
                      );
                    })}
                    {/* Same trap as the row above: mapping all eighteen in
                        one pass and pushing the totals to the end put every
                        back-nine result under the wrong hole number. */}
                    <tr>
                      <td>Net result</td>
                      {front.map((i) => (
                        <td key={i}>{holeMark(holes[i])}</td>
                      ))}
                      {isEighteen && <td className="sc-tot" />}
                      {back.map((i) => (
                        <td key={i}>{holeMark(holes[i])}</td>
                      ))}
                      {isEighteen && <td className="sc-tot" />}
                      <td className="sc-tot" />
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
        )}
      </div>
    </>
  );
}
