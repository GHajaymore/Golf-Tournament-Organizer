"use client";
import { figureOr, readWhole } from "@/lib/domain/decimal-text";
import { indexLabel } from "@/lib/domain/handicap-label";
import FieldInfo from "./FieldInfo";
import { useId, useMemo, useState } from "react";
import { formGroups, type FormationRule, type Player } from "@/lib/domain";
import { listNames } from "@/lib/format";
import { drawReadiness } from "@/lib/domain/draw-readiness";
import { useTransition } from "react";
import { moveInTeeSheet, saveTeeSheet, setTeeSheetPublished } from "@/app/actions/tee-sheet";
import { drawTimesFrom, sameSheet, sheetOnScreen, sheetStatusLine, startStyleOf, type TeeSheetGroup } from "@/lib/domain/tee-sheet";
import { applyMoves, emptiedGroups, groupStep, GROUPS_NOTE, moveKindsOf, playerMoveOptions, removalLines, shortGroupWarnings, SIDES_NOTE, type MoveMode, type MoveOption, type SheetMove } from "@/lib/domain/tee-sheet-moves";
import { Icon } from "./Icon";
import { ReplacePlayer } from "./ReplacePlayer";
import type { ReplaceCandidate, ReplaceWorld } from "@/lib/domain/tee-sheet-replace";
import { golfTermsFor, type GolfTerm } from "@/lib/domain/golf-terms";
import { useFormatting } from "./CurrencyProvider";
import { usesTwentyFourHourClock } from "@/lib/domain/locale";
import { honourRequests } from "@/lib/domain/pairing-requests";
import { startHoleNumber } from "@/lib/domain/hole-number";
import {
  DRAW_ORDERS,
  groupBySides,
  groupByStandings,
  orderGroups,
  positionLookup,
  sidesByStandings,
  startSlots,
  type DrawOrder,
  type Standing,
  type StartStyle,
} from "@/lib/domain/draw";

/** How the field is carved into groups. "standings" needs a round played. */
type Pairing = FormationRule | "standings";

const ALGORITHMS: Array<{ key: Pairing; label: string; icon: string; desc: string; needsStandings?: boolean }> = [
  { key: "random", label: "Random", icon: "ph ph-shuffle", desc: "Completely random groups — shuffle and deal." },
  { key: "handicap", label: "Balanced handicap", icon: "ph ph-chart-bar", desc: "Spread handicaps so each group has a comparable mix." },
  { key: "balanced", label: "Balanced skill", icon: "ph ph-scales", desc: "Combine handicap and ranking so group strengths are even." },
  { key: "seeding", label: "Seeded", icon: "ph ph-list-numbers", desc: "Pair by tournament seed/ranking." },
  {
    key: "standings",
    label: "By position",
    icon: "ph ph-trophy",
    desc: "Group by the leaderboard — you play with the players nearest you on the board. The standard re-pairing from round two on.",
    needsStandings: true,
  },
];

const avg = (nums: number[]) =>
  nums.length ? Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10 : 0;

/**
 * The tee sheet.
 *
 * Three separate decisions, and keeping them separate is the point: who plays
 * with whom, the order those groups go off, and whether it's one tee, two, or
 * a shotgun. They used to be one control, which meant a second round could be
 * grouped off the leaderboard but not *drawn* off it — the leaders came out
 * wherever the grouping happened to put them.
 */
export function FoursomeMaker({
  players,
  standings = [],
  holes = 18,
  stageId = "",
  savedAt = "",
  published = false,
  rounds = [],
  activeRoundId = "",
  rosterSize = 0,
  sides = [],
  savedGroups = [],
  savedStart = "",
  terms = golfTermsFor("us"),
  requests = [],
  firstHole = 1,
  locks = {},
  canMove = false,
  door = null,
  moveMode = "players",
  replace = null,
}: {
  /**
   * "Replace…" beside each player of a group that has not started (B43): what the panel chooses from and
   * the sentence it states. Null where nobody may be swapped (not staff, a round played as matches, a cup session).
   */
  replace?: { candidates: ReplaceCandidate[]; world: ReplaceWorld; inSides: boolean; weekly: boolean } | null;
  /** What may move in this round (`moveModeOf`, the answer the server refuses by): players, whole sides, or only whole groups. */
  moveMode?: MoveMode;
  /** Why nobody can move anyone now (`fieldRefusal(…, "place-in-group")`), or null. The controls are not drawn while it is set. */
  door?: string | null;
  /** Saved slots that have begun (teed off, or a card in), with why — `slotLocks`. Index to sentence. */
  locks?: Record<number, string>;
  /** Staff, on a saved sheet whose field rule allows a change: the move controls are drawn. */
  canMove?: boolean;
  /** The course's number for the first hole on the round's card — 10 on a back nine. */
  firstHole?: number;
  /**
   * Players who asked to be drawn together, as clusters of ids in this round's
   * field (`requestClusters`). Honoured after the draw where they can be.
   */
  requests?: string[][];
  /** The club's golf words — what a group of four, three and two is called. */
  terms?: Pick<Record<GolfTerm, string>, "group" | "groupOfThree" | "groupOfTwo">;
  /**
   * The SAVED sheet's groups — what the players were given. Shown whenever a
   * sheet exists and the organizer is not re-drawing; see `sheetOnScreen`.
   */
  savedGroups?: TeeSheetGroup[];
  /** How the saved sheet went off — tee, split or shotgun. Empty when there is none. */
  savedStart?: string;
  players: Player[];
  /**
   * The round's SIDES, player ids per side, when it is played in them.
   *
   * Partners play together — in a scramble they share one ball — so a team
   * round's groups are made from whole sides (`groupBySides`) rather than dealt
   * player by player, which split every side across two tee times. Empty for a
   * round with no sides, and the sheet is drawn exactly as before.
   */
  sides?: string[][];
  /** Current leaderboard, best first. Empty before anyone has posted a score. */
  standings?: Standing[];
  holes?: 9 | 18;
  /** The round this sheet belongs to; empty disables saving. */
  stageId?: string;
  /** When a sheet was last saved for this round, ISO. Empty = never. */
  savedAt?: string;
  published?: boolean;
  /** Every round the field plays, so a sheet can be drawn ahead or reopened. */
  rounds?: Array<{ id: string; label: string }>;
  activeRoundId?: string;
  /**
   * The whole confirmed field, when `players` has been narrowed to a week.
   *
   * Only for the refusal below, which otherwise cannot tell an empty
   * registration list from a league round nobody has signed up for. Zero
   * means not narrowed, and the two zeros are then the same zero.
   */
  rosterSize?: number;
}) {
  const fid = useId();
  const hasStandings = standings.length > 0;
  const [algo, setAlgo] = useState<Pairing>("random");
  const [order, setOrder] = useState<DrawOrder>("as-formed");
  const [size, setSize] = useState(4);
  const [seed, setSeed] = useState(1);
  // From the saved sheet, so a re-draw keeps how the field went off.
  const [startType, setStartType] = useState<StartStyle>(startStyleOf(savedStart));
  const [saveState, setSaveState] = useState<{ savedAt: string; published: boolean }>({ savedAt, published });
  /**
   * Whether this round has a sheet of record yet.
   *
   * The screen has two jobs and this is what tells them apart. With no sheet
   * the job is drawing one; with a sheet the job is reading it, on the morning,
   * on a phone. Read from the saved state rather than from how many groups the
   * preview happens to hold, so a field of eight behaves the same as a field of
   * eighty.
   */
  const savedDraw = !!saveState.savedAt;
  /**
   * Open while there is no sheet, because then the builder IS the screen.
   *
   * Initialised from the saved state and then owned by the organizer: pressing
   * "Re-draw this sheet" keeps the controls up for as long as they are
   * iterating, rather than snapping shut after each change.
   */
  const [showDrawControls, setShowDrawControls] = useState(!savedAt);
  const [saveError, setSaveError] = useState("");
  const [savePending, startSaveTransition] = useTransition();
  // Publishing shows the draw to every player, so it is a two-step, deliberate
  // act rather than one blue button next to Save. The confirm follows the app's
  // pattern (see ClearScores): a control that changes what it says has to be
  // read, where a dialog gets dismissed on reflex.
  const [confirmPublish, setConfirmPublish] = useState(false);
  // Publishing the SAVED draft as it stands — no re-draw, so nothing resets.
  const [confirmPublishSaved, setConfirmPublishSaved] = useState(false);
  // The sheet as last saved, so the status line can ask whether the draw on
  // screen IS it (`sameSheet`) rather than only whether the controls are open.
  const [savedSnapshot, setSavedSnapshot] = useState<readonly TeeSheetGroup[]>(savedGroups);
  // From the saved sheet, so a re-draw starts at its times — `drawTimesFrom`.
  const savedTimes = drawTimesFrom(savedGroups);
  const [firstTee, setFirstTee] = useState(savedTimes.firstTee ?? "08:00");
  const [interval, setInterval] = useState(savedTimes.interval ?? 10);

  // The DRAFT of moves on the saved sheet: kept here, written once on Save changes.
  const [moves, setMoves] = useState<SheetMove[]>([]);
  const [moveError, setMoveError] = useState("");
  // What a replacement said: the player replaced is off the sheet afterwards, so the screen holds it.
  const [replaceSaid, setReplaceSaid] = useState("");
  const [movePending, startMoveTransition] = useTransition();

  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const positionOf = useMemo(() => positionLookup(standings), [standings]);
  const rng = useMemo(() => {
    let s = seed || 1;
    return () => {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    };
  }, [seed]);

  /**
   * The sides that are playing THIS round — trimmed to the players on the
   * sheet, so a league week that narrowed `players` does not draw absentees.
   */
  const playingSides = useMemo(
    () => sides.map((s) => s.filter((id) => byId.has(id))).filter((s) => s.length > 0),
    [sides, byId],
  );
  const bySides = playingSides.length > 0;
  const requestsApply = !bySides && algo !== "standings" && requests.length > 0;

  const drawn = useMemo(() => {
    let formed;
    if (bySides) {
      // Whole sides, never split. The rule above only decides their ORDER:
      // shuffled for Random, the board's for By position (each pair stands
      // where it finished), as drawn on the Teams screen otherwise (the
      // automatic draw has already balanced the sides by handicap).
      const onASide = new Set(playingSides.flat());
      const sideOrder = algo === "standings" ? sidesByStandings(playingSides, positionOf) : [...playingSides];
      if (algo === "random") {
        // Fisher–Yates on the sheet's own seeded generator, so "Reshuffle"
        // deals a new order and the same seed deals the same one.
        for (let i = sideOrder.length - 1; i > 0; i--) {
          const j = Math.floor(rng() * (i + 1));
          [sideOrder[i], sideOrder[j]] = [sideOrder[j], sideOrder[i]];
        }
      }
      formed = groupBySides(sideOrder, players.filter((p) => !onASide.has(p.id)).map((p) => p.id), size, (i) => `fs-${i}`);
    } else {
      formed =
        algo === "standings"
          ? groupByStandings(players, positionOf, size, (i) => `fs-${i}`)
          : formGroups(players, algo, { mode: "perFlight", value: size }, (i) => `fs-${i}`, rng);
    }
    const ordered = orderGroups(formed, order, positionOf, rng);
    // PAIRING REQUESTS, after the draw has decided everything else — never on
    // a draw by position, which is competitive, and never over whole sides,
    // which already decide who plays together. See `honourRequests`.
    if (requestsApply) {
      const res = honourRequests(ordered, requests);
      return { groups: res.groups, kept: res.kept, split: res.split };
    }
    return { groups: ordered, kept: [] as string[][], split: [] as string[][] };
  }, [players, algo, order, size, rng, positionOf, bySides, playingSides, requests, requestsApply]);
  const groups = drawn.groups;

  // The club's clock — "08:10" for a club on the 24-hour clock, "8:10 AM" for
  // one on the 12-hour. The time is stored on the sheet as drawn here.
  const { locale } = useFormatting();
  const hour24 = usesTwentyFourHourClock(locale);
  const slots = useMemo(
    () => startSlots(groups, startType, { firstTee, interval, holes, hour24 }),
    [groups, startType, firstTee, interval, holes, hour24],
  );

  /** The draw being made, in the shape a saved sheet has. */
  const previewSheet: TeeSheetGroup[] = groups.map((g, i) => ({
    name: `Group ${i + 1}`,
    startHole: slots[i].startHole,
    half: slots[i].half,
    time: slots[i].time,
    playerIds: g.playerIds,
  }));
  const shown = sheetOnScreen(savedGroups, previewSheet, showDrawControls);

  /**
   * THE SAVED SHEET WITH THE DRAFT OF MOVES LAID OVER IT — the same function
   * the server replays (`applyMoves`). Times stay with the slots.
   */
  const fieldIds = useMemo(() => new Set(players.map((p) => p.id)), [players]);
  const moving = canMove && !door && !!savedAt && shown.source === "saved" && savedGroups.length > 0;
  const baseSheet = useMemo(() => ({ savedAt, startType: savedStart || "tee", groups: [...savedGroups] }), [savedAt, savedStart, savedGroups]);
  const draft = useMemo(() => {
    const r = applyMoves(baseSheet, moves, fieldIds, locks);
    return r.ok ? r.sheet : baseSheet;
  }, [baseSheet, moves, fieldIds, locks]);
  const draftGroups: readonly TeeSheetGroup[] = moving ? draft.groups : shown.groups;
  const addMove = (m: SheetMove) => {
    const r = applyMoves(draft, [m], fieldIds, locks);
    if (!r.ok) {
      setMoveError(r.says);
      return;
    }
    setMoveError("");
    setMoves((all) => [...all, m]);
  };
  const saveMoves = () => {
    setMoveError("");
    startMoveTransition(async () => {
      const res = await moveInTeeSheet(stageId, savedAt, moves);
      if (!res.ok) {
        setMoveError(res.error ?? "Couldn’t save the changes.");
        return;
      }
      setMoves([]);
    });
  };
  // A number read out of a select the screen itself filled, read the one way (`readWhole`).
  const slotOf = (v: string) => figureOr(readWhole(v), -1);
  const optionText = (o: MoveOption) =>
    `${o.name} · ${o.time ? `${o.time} · ` : ""}${o.players} ${o.players === 1 ? "player" : "players"}${o.disabled ? ` — ${o.disabled}` : ""}`;

  // Composition summary, e.g. "7 foursomes · 1 twosome".
  const sizes = groups.map((g) => g.playerIds.length);
  const counts = sizes.reduce<Record<number, number>>((acc, s) => ({ ...acc, [s]: (acc[s] ?? 0) + 1 }), {});
  // In the club's golf words: "7 foursomes · 1 twosome", or "7 fourballs ·
  // 1 two-ball" for a UK club (`golf-terms.ts`).
  const sizeName: Record<number, string> = { 2: terms.groupOfTwo, 3: terms.groupOfThree, 4: terms.group };
  const summary = Object.entries(counts)
    .sort((a, b) => Number(b[0]) - Number(a[0]))
    .map(([s, n]) => `${n} ${sizeName[Number(s)] ?? `${s}-ball`}${n > 1 ? "s" : ""}`)
    .join(" · ");

  const persist = (publish: boolean) => {
    setSaveError("");
    startSaveTransition(async () => {
      const sheet = {
        savedAt: "",
        startType,
        groups: groups.map((g, i) => {
          const slot = slots[i];
          return {
            name: `Group ${i + 1}`,
            startHole: slot.startHole,
            half: slot.half,
            time: slot.time,
            playerIds: g.playerIds,
          };
        }),
      };
      const res = await saveTeeSheet(stageId, sheet, publish);
      if (!res.ok) {
        setSaveError(res.error ?? "Couldn't save the sheet.");
        return;
      }
      setSavedSnapshot(sheet.groups);
      setSaveState({ savedAt: new Date().toISOString(), published: publish });
    });
  };

  /**
   * PUBLISH THE SHEET THAT IS SAVED, AS IT IS.
   *
   * Until 2026-10-17 the only way to publish was "Save & publish" inside the
   * draw controls, which publishes the draw ON SCREEN — and opening them resets
   * the draw to Random, 8:00 and ten minutes. So an organizer who had saved the
   * right sheet the night before had to rebuild it, by hand, to publish it: the
   * eve of the first real tournament nearly went out at 8 AM. This publishes
   * the stored sheet and sends the same tee-time notices (`setTeeSheetPublished`).
   */
  const publishSaved = () => {
    setSaveError("");
    startSaveTransition(async () => {
      const res = await setTeeSheetPublished(stageId, true);
      if (!res.ok) {
        setSaveError(res.error ?? "Couldn't publish the sheet.");
        return;
      }
      // Only offered over a saved sheet, so it already has its savedAt.
      setSaveState((s) => ({ ...s, published: true }));
    });
  };

  // Pull a published sheet back without touching the draw — the survivors' cards
  // and times stay saved, players just stop seeing it on their dashboard.
  const unpublish = () => {
    setSaveError("");
    startSaveTransition(async () => {
      const res = await setTeeSheetPublished(stageId, false);
      if (!res.ok) {
        setSaveError(res.error ?? "Couldn't unpublish the sheet.");
        return;
      }
      setSaveState((s) => ({ savedAt: s.savedAt || new Date().toISOString(), published: false }));
    });
  };

  const active = ALGORITHMS.find((a) => a.key === algo) ?? ALGORITHMS[0];
  const activeOrder = DRAW_ORDERS.find((d) => d.key === order) ?? DRAW_ORDERS[2];
  // Which options are greyed out, named from the arrays that grey them, so the
  // sentence explaining it cannot come to list the wrong ones.
  const standingsBlocked = hasStandings ? [] : ALGORITHMS.filter((a) => a.needsStandings).map((a) => a.label);
  const orderBlocked = hasStandings ? [] : DRAW_ORDERS.filter((d) => d.needsStandings).map((d) => d.label);
  // Why the sheet cannot be saved, or null. The same rule the Flights screen
  // uses, because a tee sheet is drawn from the field exactly as flights are.
  // `locked` is false here: this screen has no lock of its own, and claiming
  // one would be a refusal the app cannot back up.
  // `rosterSize` is what separates "nobody has entered" from "nobody is in
  // this week" — see drawReadiness. It is the season's confirmed field, which
  // this screen narrows to the round's attendees before handing it over.
  const saveBlock = drawReadiness({
    fieldSize: players.length,
    locked: false,
    rosterSize,
  });

  return (
    <>
      {/* Which round's sheet this is — the one thing this screen never said.
          It read the active round and nothing else, so next week's sheet could
          not be drawn ahead, last week's could not be reopened, and the page
          quietly changed subject as the tournament advanced. */}
      {rounds.length > 1 && (
        <div
          style={{
            display: "flex",
            gap: 6,
            overflowX: "auto",
            paddingBottom: 6,
            marginBottom: 14,
            WebkitOverflowScrolling: "touch",
          }}
        >
          {rounds.map((r) => (
            <a
              key={r.id}
              href={`/foursomes?round=${r.id}`}
              className={r.id === activeRoundId ? "btn btn-primary" : "btn btn-ghost"}
              style={{ whiteSpace: "nowrap", flexShrink: 0, fontSize: 13, textDecoration: "none" }}
              aria-current={r.id === activeRoundId ? "true" : undefined}
            >
              {r.label}
            </a>
          ))}
        </div>
      )}

      {/* Shut once this round HAS a sheet, and open while it does not.
          ────────────────────────────────────────────────────────────
          Two different jobs share this screen. Before a sheet exists the job
          is building one, and the controls are the whole point. Once one has
          been saved the job is reading it — on the morning, on a phone, to
          find out who is off when — and the draw controls stand between the
          organizer and the thing they came for.

          The rule is "does a sheet exist", not "are there many groups". A
          field of eight has the same problem as a field of eighty: whatever
          the size, the builder is either the task or in the way of it, and
          which one it is depends on whether the round has been drawn. */}
      {savedDraw && !showDrawControls && (
        <button
          type="button"
          onClick={() => setShowDrawControls(true)}
          className="card elev-sm"
          aria-expanded={false}
          style={{
            width: "100%",
            marginBottom: 16,
            textAlign: "left",
            display: "flex",
            // `.card` is a column, so without this the icon, the label and the
            // caret stack into three centred rows.
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            minHeight: 44,
            cursor: "pointer",
            color: "var(--color-text)",
            border: "1px dashed var(--color-divider)",
          }}
        >
          <Icon name="shuffle" style={{ fontSize: 16, color: "var(--color-accent-200)", flex: "none" }} />
          <span style={{ minWidth: 0 }}>
            <span style={{ display: "block", fontSize: 14, fontWeight: 600 }}>Re-draw this sheet</span>
            <span className="text-muted" style={{ display: "block", fontSize: 13, marginTop: 2, lineHeight: 1.45 }}>
              Change who plays together, the order off the tee, group size or start times.
            </span>
          </span>
          <Icon name="caret-down" style={{ fontSize: 13, color: "var(--color-neutral-500)", marginLeft: "auto", flex: "none" }} />
        </button>
      )}

      {showDrawControls && (
      <div className="card elev-sm" style={{ marginBottom: 16, gap: 16 }}>
        {/* No way to shut it while the round has no sheet: there would be
            nothing underneath to shut it over. */}
        {savedDraw && (
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={() => setShowDrawControls(false)}
              aria-expanded
              aria-label="Close the draw controls"
              className="btn btn-ghost"
              style={{ minHeight: 44, minWidth: 44 }}
            >
              <Icon name="caret-up" />
            </button>
          </div>
        )}
        {/* Nothing here works off a leaderboard until one exists, and an
            organizer setting up round one should be told that rather than
            wondering why half the options are greyed. */}
        {!hasStandings && (
          <p className="text-muted" style={{ fontSize: 13, margin: 0, lineHeight: 1.5 }}>
            <Icon name="info" /> No scores posted yet, so the leaderboard options are off. They
            switch on once a round has been played — that&apos;s when re-pairing by position and drawing
            the leaders out last start to mean something.
          </p>
        )}

        <div>
          <div className="text-muted" style={{ fontSize: 13, marginBottom: 6 }}>Who plays together</div>
          {bySides && (
            /* Said, because otherwise the rule buttons below look broken: in a
               team round they cannot break a side up, only order the sides. */
            <p style={{ fontSize: 13, margin: "0 0 8px", lineHeight: 1.5 }}>
              <Icon name="users-three" /> Partners play together, so each group is made from whole sides
              from Teams &amp; pairs — and where sides play a match, both sides of it go out together. The
              choice below only decides the order they go out in.
            </p>
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {ALGORITHMS.map((a) => {
              const on = a.key === algo;
              const off = a.needsStandings && !hasStandings;
              return (
                <button
                  key={a.key}
                  type="button"
                  disabled={off}
                  onClick={() => {
                    setAlgo(a.key);
                    // A draw by position goes out LEADERS LAST unless the
                    // organizer has chosen an order of their own (2026-10-09):
                    // walked on a 36-hole championship, "By position" put the
                    // leader in the 8:00 group, first off.
                    if (a.key === "standings" && order === "as-formed") setOrder("leaders-last");
                  }}
                  className="btn"
                  style={{
                    border: `1px solid ${on ? "var(--color-accent)" : "var(--color-divider)"}`,
                    color: on ? "var(--color-accent-200)" : "var(--color-text)",
                    opacity: off ? 0.45 : 1,
                  }}
                >
                  <Icon name={a.icon} /> {a.label}
                </button>
              );
            })}
          </div>
          <p className="text-muted" style={{ fontSize: 13, margin: "10px 0 0", maxWidth: "72ch", lineHeight: 1.5 }}>
            {active.desc}
          </p>
          {/* Why the greyed ones are greyed, on the page. Both groups here
              explained themselves with a `title` only — which never appears on
              a touch device, is not announced to a screen reader, and is the
              pattern this codebase has already rejected twice. The options are
              named from the array rather than described as "the greyed ones",
              so the sentence cannot drift from what is actually disabled. */}
          {standingsBlocked.length > 0 && (
            <p className="text-muted" style={{ fontSize: 13, margin: "6px 0 0", maxWidth: "72ch", lineHeight: 1.5 }}>
              <Icon name="info" /> {listNames(standingsBlocked)}{" "}
              {standingsBlocked.length === 1 ? "needs" : "need"} the leaderboard, so{" "}
              {standingsBlocked.length === 1 ? "it is" : "they are"} available only once a round has
              been played.
            </p>
          )}
        </div>

        <div>
          <div className="text-muted" style={{ fontSize: 13, marginBottom: 6 }}>Order off the tee</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {DRAW_ORDERS.map((d) => {
              const on = d.key === order;
              const off = d.needsStandings && !hasStandings;
              return (
                <button
                  key={d.key}
                  type="button"
                  disabled={off}
                  onClick={() => setOrder(d.key)}
                  className="btn"
                  style={{
                    border: `1px solid ${on ? "var(--color-accent)" : "var(--color-divider)"}`,
                    color: on ? "var(--color-accent-200)" : "var(--color-text)",
                    opacity: off ? 0.45 : 1,
                  }}
                >
                  {d.label}
                </button>
              );
            })}
          </div>
          <p className="text-muted" style={{ fontSize: 13, margin: "10px 0 0", maxWidth: "72ch", lineHeight: 1.5 }}>
            {activeOrder.blurb}
          </p>
          {orderBlocked.length > 0 && (
            <p className="text-muted" style={{ fontSize: 13, margin: "6px 0 0", maxWidth: "72ch", lineHeight: 1.5 }}>
              <Icon name="info" /> {listNames(orderBlocked)}{" "}
              {orderBlocked.length === 1 ? "needs" : "need"} the leaderboard, so{" "}
              {orderBlocked.length === 1 ? "it is" : "they are"} available only once a round has been
              played.
            </p>
          )}
        </div>

        <div style={{ display: "flex", gap: 16, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div className="field" style={{ width: 180 }}>
            <span className="field-caption" id={`${fid}-size`}>Group size</span>
            <div className="seg" role="group" aria-labelledby={`${fid}-size`} style={{ width: "100%" }}>
              {[2, 3, 4].map((n) => (
                <label className="seg-opt" key={n} style={{ flex: 1, justifyContent: "center" }}>
                  <input type="radio" name="fssize" checked={size === n} onChange={() => setSize(n)} />{n}
                </label>
              ))}
            </div>
          </div>
          <div className="field" style={{ width: 260 }}>
            <span className="field-caption">
              Start{" "}
              <FieldInfo label="how the field goes off">
                <p>
                  <b>One tee</b> sends every group off the 1st, {interval} minutes apart. The last
                  group starts long after the first, so it suits a small field and it is what a club
                  medal normally does.
                </p>
                <p>
                  <b>Split</b> uses two tees at once — the {holes === 9 ? "1st and the 5th" : "1st and the 10th"} —
                  so the field takes half as long to get away. Everyone still plays the same holes in
                  the same order; they just begin at different points of it.
                </p>
                <p>
                  <b>Shotgun</b> puts a group on every hole and starts them together, so the whole
                  field finishes within minutes of each other. It needs roughly as many groups as
                  the course has holes, and there is no interval to set because nobody is waiting.
                </p>
                <p>
                  Only one tee makes &ldquo;leaders out last&rdquo; mean anything: with a shotgun
                  everybody is already out.
                </p>
              </FieldInfo>
            </span>
            <div className="seg" style={{ width: "100%" }}>
              <label className="seg-opt" style={{ flex: 1, justifyContent: "center" }}>
                <input type="radio" name="fsstart" checked={startType === "tee"} onChange={() => setStartType("tee")} /> One tee
              </label>
              <label className="seg-opt" style={{ flex: 1, justifyContent: "center" }}>
                <input type="radio" name="fsstart" checked={startType === "split"} onChange={() => setStartType("split")} /> Split
              </label>
              <label className="seg-opt" style={{ flex: 1, justifyContent: "center" }}>
                <input type="radio" name="fsstart" checked={startType === "shotgun"} onChange={() => setStartType("shotgun")} /> Shotgun
              </label>
            </div>
          </div>
          <div className="field" style={{ width: 120 }}>
            <label htmlFor="tee-sheet-first-tee">First tee</label>
            <input id="tee-sheet-first-tee" className="input" type="time" value={firstTee} onChange={(e) => setFirstTee(e.target.value)} />
          </div>
          {startType !== "shotgun" && (
            <div className="field" style={{ width: 130 }}>
              <label htmlFor="tee-sheet-interval">Interval (min)</label>
              <input
                id="tee-sheet-interval"
                className="input"
                type="number"
                min={1}
                max={30}
                value={interval}
                onChange={(e) => setInterval(Math.max(1, figureOr(readWhole(e.target.value), 10) || 10))}
              />
            </div>
          )}
          <div style={{ flex: 1 }} />
          {/* "1 groups · 1 foursome" — the count was hard-plural, and a
              four-player league week is exactly one group. The summary beside
              it already pluralises itself. */}
          <span className="text-muted" style={{ fontSize: 13 }}>
            {groups.length} {groups.length === 1 ? "group" : "groups"}
            {summary ? ` · ${summary}` : ""}
          </span>
          {(algo === "random" || order === "random") && (
            // Outline, not filled (console sweep, J51): Save sheet is this card's one primary; another draw is a try, not the finish.
            <button type="button" className="btn btn-secondary" onClick={() => setSeed((s) => s + 1)}>
              <Icon name="shuffle" /> Reshuffle
            </button>
          )}
          {/* Saving turns the draw on screen into the round's sheet of
              record; publishing is the separate, outward-facing act of telling
              the field. Saving a draft is the safe primary action — publishing
              is deliberate and confirmed, because a work-in-progress draw saved
              by reflex must not land on every player's dashboard. Until saved,
              this screen is a sketch that vanishes on refresh. */}
          {stageId && (
            <>
              <button
                type="button"
                className="btn btn-primary"
                disabled={savePending || groups.length === 0}
                onClick={() => { setConfirmPublish(false); persist(false); }}
              >
                <Icon name="floppy-disk" /> {savePending ? "Saving…" : "Save sheet"}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={savePending || groups.length === 0}
                onClick={() => setConfirmPublish(true)}
              >
                <Icon name="megaphone" /> Save &amp; publish
              </button>
              {saveState.published && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={savePending}
                  onClick={() => { setConfirmPublish(false); unpublish(); }}
                >
                  <Icon name="eye-slash" /> Unpublish
                </button>
              )}
            </>
          )}
        </div>

        {/* What the draw did with the pairing requests — kept, not kept, or
            deliberately not applied — so nobody has to check the groups by
            eye to find out whether Ann got her game with Bea. */}
        {requests.length > 0 && (
          <p role="status" className="text-muted" style={{ fontSize: 13, margin: "10px 0 0", lineHeight: 1.5 }}>
            <Icon name="users-three" />{" "}
            {!requestsApply
              ? bySides
                ? "Pairing requests don't apply here: partners already play together, side by side."
                : "Pairing requests aren't applied to a draw by position — it's a competitive re-pairing."
              : drawn.split.length === 0
                ? `${drawn.kept.length} pairing ${drawn.kept.length === 1 ? "request" : "requests"} kept together.`
                : `${drawn.kept.length} kept together. Could not fit in one group: ${drawn.split
                    .map((c) => listNames(c.map((id) => byId.get(id)?.name ?? ""), 6))
                    .join("; ")}.`}
          </p>
        )}

        {/* Why "Save sheet" is dead, when it is.
            Both save buttons carried `groups.length === 0` and said nothing, so
            on the ordinary first-day state — a round with no field yet — an
            organizer got two grey buttons and no way to tell whether the app
            was broken, they lacked permission, or something was missing.

            `drawReadiness` rather than a second rule: a tee sheet is drawn from
            the FIELD exactly as the flights are, so this is the same refusal
            GroupingControls already renders, with the same link to the same
            screen. A second copy would eventually disagree about what an empty
            field means. */}
        {stageId && saveBlock && (
          <p
            style={{
              fontSize: 13,
              margin: "10px 0 0",
              lineHeight: 1.5,
              display: "flex",
              gap: 8,
              alignItems: "flex-start",
              padding: "9px 11px",
              borderRadius: 9,
              background: "color-mix(in srgb, var(--color-text) 5%, transparent)",
            }}
          >
            <Icon name="info" style={{ fontSize: 14, marginTop: 1, flex: "none" }} />
            <span>
              {saveBlock.problem}
              {/* No link when the remedy is the panel above this screen's
                  heading — pointing somewhere else would be sending an
                  organizer away from the control that fixes it. */}
              {saveBlock.href && (
                <>
                  {" "}
                  <a href={saveBlock.href} style={{ color: "var(--color-accent-200)" }}>
                    {saveBlock.linkLabel}
                  </a>
                </>
              )}
            </span>
          </p>
        )}

        {/* The confirmation lives here, below the toolbar, so the sentence and
            the button that acts on it are read together. */}
        {confirmPublish && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexWrap: "wrap",
              fontSize: 13,
              padding: "10px 12px",
              borderRadius: 8,
              background: "color-mix(in srgb, var(--color-accent) 10%, transparent)",
              border: "1px solid color-mix(in srgb, var(--color-accent) 35%, transparent)",
            }}
          >
            <span style={{ flex: 1, minWidth: 220 }}>
              <Icon name="megaphone" style={{ marginRight: 6 }} />
              This shows the draw to every player. Publish the tee sheet?
            </span>
            <button
              type="button"
              className="btn btn-primary"
              disabled={savePending || groups.length === 0}
              onClick={() => { setConfirmPublish(false); persist(true); }}
            >
              {savePending ? "Publishing…" : "Publish the tee sheet"}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={savePending}
              onClick={() => setConfirmPublish(false)}
            >
              Cancel
            </button>
          </div>
        )}
      </div>
      )}

      {(saveState.savedAt || saveError) && (
        <p style={{ fontSize: 13, margin: "0 0 10px", color: saveError ? "var(--color-danger)" : "var(--color-neutral-500)" }}>
          {saveError ? (
            <><Icon name="warning-circle" /> {saveError}</>
          ) : (
            <>
              <Icon name={saveState.published ? "ph ph-megaphone" : "ph ph-floppy-disk"} />{" "}
              {sheetStatusLine({
                published: saveState.published,
                onScreenIsSaved: shown.source === "saved" || sameSheet(previewSheet, savedSnapshot),
              })}
              {shown.source === "saved" ? " Re-draw it to change it." : ""}
            </>
          )}
        </p>
      )}

      {/* A saved draft is published as it stands — see `publishSaved`. Only
          while the saved sheet is what is on screen, so what is published is
          what the organizer is reading. */}
      {stageId && savedDraw && !saveState.published && shown.source === "saved" && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", margin: "0 0 14px" }}>
          {!confirmPublishSaved ? (
            <button type="button" className="btn btn-primary" disabled={savePending} onClick={() => setConfirmPublishSaved(true)}>
              <Icon name="megaphone" /> Publish this sheet
            </button>
          ) : (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                flexWrap: "wrap",
                fontSize: 13,
                padding: "10px 12px",
                borderRadius: 8,
                background: "color-mix(in srgb, var(--color-accent) 10%, transparent)",
                border: "1px solid color-mix(in srgb, var(--color-accent) 35%, transparent)",
              }}
            >
              <span style={{ flex: 1, minWidth: 220 }}>
                <Icon name="megaphone" style={{ marginRight: 6 }} />
                This shows the sheet below to every player, as it is. Publish it?
              </span>
              <button
                type="button"
                className="btn btn-primary"
                disabled={savePending}
                onClick={() => { setConfirmPublishSaved(false); publishSaved(); }}
              >
                {savePending ? "Publishing…" : "Publish the tee sheet"}
              </button>
              <button type="button" className="btn btn-secondary" disabled={savePending} onClick={() => setConfirmPublishSaved(false)}>
                Cancel
              </button>
            </div>
          )}
        </div>
      )}

      {canMove && door && shown.source === "saved" && (
        <p className="text-muted" style={{ margin: "0 0 12px", fontSize: 13 }}>{door}</p>
      )}
      {moving && (
        <div role="region" aria-label="Move players and groups" style={{ display: "flex", flexDirection: "column", gap: 8, margin: "0 0 12px" }}>
          <p className="text-muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>
            {moveMode === "sides" ? SIDES_NOTE : moveMode === "groups" ? GROUPS_NOTE : "Move a player to another group, or a group earlier or later. The times stay with the slots."} Nothing is saved until you press Save changes.
          </p>
          {moves.length > 0 && (
            <div className="card elev-sm" style={{ display: "flex", flexDirection: "column", gap: 8, borderLeft: "3px solid var(--color-accent)" }}>
              <span role="status" style={{ fontSize: 14, fontWeight: 600 }}>
                {moves.length} {moves.length === 1 ? "change" : "changes"} not saved yet.
              </span>
              {[...removalLines(draft, fieldIds, locks), ...shortGroupWarnings(draft, fieldIds, terms)].map((w) => (
                <p key={w} className="text-muted" role="note" style={{ margin: 0, fontSize: 13 }}>
                  <Icon name="warning-circle" /> {w}
                </p>
              ))}
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button type="button" className="btn btn-primary" style={{ minHeight: 44 }} disabled={movePending} onClick={saveMoves}>
                  <Icon name="floppy-disk" /> {movePending ? "Saving…" : "Save changes"}
                </button>
                <button type="button" className="btn btn-secondary" style={{ minHeight: 44 }} disabled={movePending} onClick={() => { setMoves([]); setMoveError(""); }}>
                  Cancel
                </button>
              </div>
              {saveState.published && (
                <p className="text-muted" style={{ margin: 0, fontSize: 13 }}>
                  The sheet stays published. Only the players whose time changes are told.
                </p>
              )}
            </div>
          )}
          {moveError && (
            <p className="form-error" role="alert" style={{ margin: 0 }}>
              {moveError}
            </p>
          )}
        </div>
      )}

      {replaceSaid && (
        <p role="status" className="card elev-sm" style={{ margin: "0 0 12px", fontSize: 14 }}>
          {replaceSaid}
        </p>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 12 }}>
        {draftGroups.map((g, i) => {
          // A player who has left the field since the sheet was saved has no
          // row to show; the drift banner above says who and what to do.
          const gp = g.playerIds.map((id) => byId.get(id)!).filter(Boolean);
          return (
            <div key={`${shown.source}-${i}`} className="card elev-sm" style={{ gap: 6 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontWeight: 600, fontSize: 14 }}>{g.name || `Group ${i + 1}`}</span>
                <span className="text-muted" style={{ fontSize: 13 }}>avg {avg(gp.map((p) => p.handicap))}</span>
              </div>
              <div className="tag tag-accent" style={{ alignSelf: "flex-start", fontSize: 13 }}>
                <Icon name="clock" style={{ marginRight: 4 }} />
                {`Hole ${startHoleNumber(g.startHole, firstHole)}${g.half ?? ""} · ${g.time}`}
              </div>
              {moving && (
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", minWidth: 0 }}>
                  {(() => {
                    const earlier = groupStep(draft, locks, i, -1);
                    const later = groupStep(draft, locks, i, 1);
                    const label = g.name || `Group ${i + 1}`;
                    return (
                      <>
                        <button type="button" className="btn btn-secondary" style={{ minWidth: 44, minHeight: 44 }} aria-label={`Move ${label} earlier`} disabled={movePending || earlier === null} onClick={() => earlier !== null && addMove({ kind: "group", from: i, to: earlier })}>
                          <Icon name="arrow-up" />
                        </button>
                        <button type="button" className="btn btn-secondary" style={{ minWidth: 44, minHeight: 44 }} aria-label={`Move ${label} later`} disabled={movePending || later === null} onClick={() => later !== null && addMove({ kind: "group", from: i, to: later })}>
                          <Icon name="arrow-down" />
                        </button>
                        <select
                          aria-label={`Move ${label} to position`}
                          className="input"
                          style={{ flex: "1 1 120px", minWidth: 0, minHeight: 44 }}
                          value=""
                          disabled={movePending || !!locks[i]}
                          onChange={(e) => e.target.value !== "" && addMove({ kind: "group", from: i, to: slotOf(e.target.value) })}
                        >
                          <option value="">Move to position…</option>
                          {draft.groups.map((_, k) =>
                            k === i ? null : (
                              <option key={k} value={String(k)} disabled={!!locks[k]}>
                                {k + 1}{locks[k] ? ` — ${locks[k]}` : ""}
                              </option>
                            ),
                          )}
                        </select>
                      </>
                    );
                  })()}
                </div>
              )}
              {moving && emptiedGroups(draft, fieldIds, locks).includes(i) && (
                <p role="note" className="text-muted" style={{ margin: 0, fontSize: 13 }}>
                  No players left. It is removed when you save changes; move a later group up into it to take its time.
                </p>
              )}
              {moving && locks[i] && (
                <p role="note" className="text-muted" style={{ margin: 0, fontSize: 13 }}>
                  <Icon name="lock-simple" /> {locks[i]} It cannot be changed here.
                </p>
              )}
              {gp.map((p) => {
                const pos = positionOf(p.id);
                const ranked = hasStandings && pos !== Number.MAX_SAFE_INTEGER;
                return (
                  <div key={p.id} style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13, padding: "3px 0", borderBottom: "1px solid var(--color-divider)" }}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {ranked && (
                        <span className="text-muted" style={{ fontVariantNumeric: "tabular-nums", marginRight: 6 }}>
                          {pos}
                        </span>
                      )}
                      {p.name}
                    </span>
                    <span className="text-muted" style={{ fontVariantNumeric: "tabular-nums" }}>{indexLabel(p)}</span>
                  </div>
                  {moving && moveKindsOf(moveMode).player && !locks[i] && (
                    <select
                      aria-label={`Move ${p.name} to`}
                      className="input"
                      style={{ minWidth: 0, minHeight: 44, margin: "4px 0" }}
                      value=""
                      disabled={movePending}
                      onChange={(e) => e.target.value !== "" && addMove({ kind: "player", playerId: p.id, toGroup: slotOf(e.target.value) })}
                    >
                      <option value="">{`Move ${p.name} to…`}</option>
                      {playerMoveOptions(draft, p.id, fieldIds, locks).map((o) => (
                        <option key={o.index} value={String(o.index)} disabled={!!o.disabled}>
                          {optionText(o)}
                        </option>
                      ))}
                    </select>
                  )}
                  {moving && replace && !locks[i] && (
                    // Not while a draft of moves is open: the slot numbers it shows are not yet the saved sheet's.
                    moves.length === 0 ? (
                      <ReplacePlayer
                        stageId={stageId}
                        savedAt={savedAt}
                        player={{ id: p.id, name: p.name }}
                        group={{ name: g.name || `Group ${i + 1}`, time: g.time }}
                        candidates={replace.candidates}
                        world={replace.world}
                        inSides={replace.inSides}
                        weekly={replace.weekly}
                        disabled={movePending}
                        door={door}
                        onSaid={setReplaceSaid}
                      />
                    ) : null
                  )}
                  </div>
                );
              })}
              {moving && moveKindsOf(moveMode).side && !locks[i] &&
                playingSides
                  .filter((side) => side.every((id) => g.playerIds.includes(id)))
                  .map((side) => {
                    const names = side.map((id) => byId.get(id)?.name ?? "").filter(Boolean);
                    const label = names.length > 1 ? `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}` : names[0] ?? "";
                    return (
                      <select
                        key={side.join("|")}
                        aria-label={`Move ${label} to`}
                        className="input"
                        style={{ minWidth: 0, minHeight: 44, margin: "4px 0" }}
                        value=""
                        disabled={movePending}
                        onChange={(e) => e.target.value !== "" && addMove({ kind: "side", playerIds: side, toGroup: slotOf(e.target.value) })}
                      >
                        <option value="">{`Move ${label} to…`}</option>
                        {draft.groups.map((dg, k) => {
                          if (k === i) return null;
                          const here = dg.playerIds.filter((id) => fieldIds.has(id)).length;
                          const name = dg.name || `Group ${k + 1}`;
                          const why = locks[k] ? locks[k] : here + side.length > 4 ? `${name} has no room for ${side.length}.` : "";
                          return (
                            <option key={k} value={String(k)} disabled={!!why}>
                              {optionText({ index: k, name, time: dg.time, players: here, ...(why ? { disabled: why } : {}) })}
                            </option>
                          );
                        })}
                      </select>
                    );
                  })}
            </div>
          );
        })}
      </div>
    </>
  );
}
