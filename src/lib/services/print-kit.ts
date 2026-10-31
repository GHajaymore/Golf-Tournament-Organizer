import "server-only";
import { prisma } from "@/lib/db";
import { roundLabel } from "@/lib/domain/round-label";
import { teeNamesForRound, teesForEvent, teeForPlay, roundCourseHandicaps, flightTeeByPlayer } from "@/lib/services/handicaps";
import { roundHandicapRows, type RoundHandicapRows } from "@/lib/services/round-handicap";
import { roundHandicapExactOf, roundParStrokesOf } from "@/lib/domain/round-handicap";
import { parStrokesApply, playingHandicapPartsInRound } from "@/lib/round-allowance";
import { effectiveAllowance, effectiveCountBest, teamsForStage, type TeamView } from "@/lib/services/teams";
import { findFormat, needsTeams, sharesOneCard } from "@/lib/formats";
import { isHeadToHead } from "@/lib/stage-types";
import { allocatedStrokes, matchStrokesCount, matchStrokesPerHole } from "@/lib/domain/team";
import { NO_PAR_STROKES, holesPlayed } from "@/lib/domain/handicap";
import { loadEventState, playingStages, settingsOf, type EventState } from "@/lib/services/tournament";
import { parseTeeSheet, startStyleOf, type TeeSheetGroup } from "@/lib/domain/tee-sheet";
import { roundCard } from "@/lib/services/course-resolution";
import { brandForEvent, formattingForEvent } from "@/lib/services/organization";
import { parsePinSheet, pinShort } from "@/lib/domain/pin-sheet";
import { firstHoleOf, holeNumber, startHoleNumber } from "@/lib/domain/hole-number";
import { formatDay, formatClock, formatDayAt } from "@/lib/domain/locale";
import { formatAccessCode, roundCodeLink } from "@/lib/code-format";
import { qrModules, qrPath, type QrEncoder } from "@/lib/qr";
import { indexFigure } from "@/lib/domain/handicap-label";
import { isLeaderboardPublic, usesAccessCodes } from "@/lib/tournament-settings";
import { TEAM_SESSION } from "@/lib/services/cup";
import type { PrintGroup, PrintSide, PrintTeamRound } from "@/components/TeeSheetPrint";
import { GOLF_TERMS, golfRegister, golfTermsFor, type GolfWords } from "@/lib/domain/golf-terms";
import {
  DOC_ORDER,
  cardFormat,
  sideMembersLine,
  defaultPaper,
  type CardFormat,
  type CardsBy,
  type SignsBy,
  fingerprintOf,
  goneSheets,
  paperRefusals,
  parsePrintLog,
  sheetStatuses,
  strokeCount,
  strokesByNine,
  type DocKind,
  type KitSheet,
  type NineStrokes,
  type PaperSize,
  type PrintLog,
  type SheetStatus,
} from "@/lib/domain/print-kit";

/**
 * THE PRINT KIT FOR ONE ROUND: every document the app can make, built from
 * the same readers the screens use, each with a fingerprint of what it says.
 *
 * ONE PLACE FOR WHAT GOES ON PAPER. The Tee sheet built its printed cards in
 * its own page — the course handicap off the tee being played, the round's
 * allowance taken of the UNROUNDED figure and rounded once (Rule 6.2a), the
 * strokes for tees of a higher par (6.2b), the frozen figure once a round is
 * locked, and in a match the strokes off the lowest handicap in it. That
 * chain moved here whole, unchanged, so the Tee sheet's cards, the named
 * cards, the cart signs and the starting sheet all print one answer.
 *
 * AND IT IS PINNED TO THE SCORE-ENTRY SCREEN, not merged with it:
 * `print-kit-paper-equals-screen.audit.test.ts` holds the strokes printed on
 * every hole to the dots the entry screen draws, for every format the kit
 * prints. Two readers that agree on purpose can be compared; one reader can
 * only be trusted.
 */

export interface KitPlayer {
  id: string;
  name: string;
  tee: string;
  /** False where nobody has claimed an index (`handicapSource: "none"`): paper says "to be confirmed". */
  confirmed: boolean;
  courseHandicap: number;
  playingHandicap: number;
  /** Strokes received per hole of the round's card — what the dots are drawn from. */
  shots: number[];
  /** In a match, the strokes they receive in it; null otherwise. */
  matchStrokes: number | null;
  sideName: string;
}

export interface KitCode {
  label: string;
  code: string;
  link: string;
  qr: { d: string; size: number };
}

/**
 * WHAT A CARD IS ON PAPER (ruling of 30 Oct): the normal scorecard, or — only
 * where it genuinely cannot hold the content (`cardFormat`) — a fold-out that
 * folds to it. A starting sheet is a page of its own.
 */
interface Paper {
  format: CardFormat | "page";
  /** Why a fold-out, in the hub's words; empty otherwise. */
  formatWhy: string;
}

export interface ScorecardPage extends Paper {
  doc: "cards";
  key: string;
  label: string;
  fp: string;
  group: PrintGroup;
  /** One card per player or side, or the group's card with every name on it. */
  unit: "player" | "side" | "group";
  /** Signature words under the grid, which differ by format (Rule 3.3b, 23.6, 22.1). */
  signNote: string;
}

export interface SlipPage extends Paper {
  doc: "slips";
  key: string;
  label: string;
  fp: string;
  slip: {
    matchLabel: string;
    time: string;
    start: string;
    sides: Array<{ name: string; players: string[]; strokes: string }>;
    format: string;
  };
}

export interface CupRow {
  name: string;
  /** "receives 3", "" for a row that is not a player's. */
  note: string;
  /** Strokes per COLUMN (hole number → count); a hole outside the section is null — not played on this card. */
  shots: Record<number, number>;
  kind: "player" | "side" | "match";
}

export interface CupSection {
  title: string;
  holes: number[];
  matches: Array<{ label: string; rows: CupRow[] }>;
}

export interface CupPage extends Paper {
  doc: "cup";
  key: string;
  label: string;
  fp: string;
  cup: {
    matchLabel: string;
    time: string;
    start: string;
    columns: number[];
    pars: Record<number, number>;
    strokeIndex: Record<number, number>;
    yards: Record<number, number>;
    sections: CupSection[];
    sideNames: [string, string];
  };
}

export interface SignPage extends Paper {
  doc: "signs";
  key: string;
  label: string;
  fp: string;
  sign: {
    groupName: string;
    /** "Cart 7A" in the club's words; empty on a walking group's sign. */
    cartName: string;
    /** This cart's riders, in bold among the group; empty when the sign is the whole group's. */
    riders: string[];
    time: string;
    start: string;
    startLarge: boolean;
    players: Array<{ name: string; playing: string; tee: string; strokes: NineStrokes[]; count: number; note: string }>;
    scorerJob: string;
    codes: KitCode[];
    liveLine: string;
    host: string;
  };
}

export interface SparePage extends Paper {
  doc: "spare";
  key: string;
  label: string;
  fp: string;
  spare: { roundName: string; code: KitCode; liveLine: string; host: string };
}

export interface StartPage extends Paper {
  doc: "start";
  key: string;
  label: string;
  fp: string;
  start: {
    part: number;
    parts: number;
    rows: Array<{ time: string; start: string; group: string; name: string; playing: string; tee: string; first: boolean }>;
  };
}

export type KitPage = ScorecardPage | SlipPage | CupPage | SignPage | SparePage | StartPage;

export interface KitDoc {
  kind: DocKind;
  /** Why it cannot be printed for this round, in a sentence; empty when it can. */
  unavailable: string;
  /** What one sheet of it is, for the checklist: "one per player". */
  what: string;
  pages: KitPage[];
}

/** What every scorecard of the round shares — the header, the holes. */
export interface KitCard {
  eventName: string;
  clubName: string;
  clubLogoUrl: string;
  courseName: string;
  dates: string;
  roundLabel: string;
  pars: number[];
  strokeIndex: number[];
  yards: number[];
  holes: number;
  firstHole: number;
  teamRound: PrintTeamRound | null;
  sides: PrintSide[];
  pins: string[];
  points: boolean;
  startStyle: "tee" | "split" | "shotgun";
}

export interface PrintKit {
  eventId: string;
  eventName: string;
  club: { name: string; logoUrl: string };
  paper: PaperSize;
  host: string;
  rounds: Array<{ id: string; label: string }>;
  round: { id: string; label: string; format: string } | null;
  sheet: "none" | "draft" | "published";
  /** When the groups were last saved, on the club's clock — "groups as of …". */
  groupsAsOf: string;
  card: KitCard | null;
  docs: KitDoc[];
  sheets: KitSheet[];
  statuses: SheetStatus[];
  gone: Array<{ key: string; label: string }>;
  /** "08:12, 23 Oct 2026" — now, on the club's clock: what a page says until it is printed. */
  nowWords: string;
  /** Anything on these pages that paper must never carry (`paperRefusals`), quoted. */
  refusals: string[];
  /** The club's golf words the hub and the pages say: a {cart} is a buggy in Britain. */
  words: { cart: string; carts: string };
  cardsBy: CardsBy;
  signsBy: SignsBy;
}

/**
 * Store what was printed for a round. Scoped to the event, as every write is.
 *
 * NOT A STANDING: the log changes nothing any board reads, so it does not
 * retire the public board (`board-invalidation.test.ts` is about writes that
 * move a score). It lives here, beside the reader that compares against it.
 */
export async function savePrintLog(eventId: string, stageId: string, log: PrintLog): Promise<void> {
  await prisma.stage.updateMany({ where: { id: stageId, eventId }, data: { printLog: JSON.stringify(log) } });
}

/** The moment, in the club's words on the club's clock: "8:12 AM, 23 Oct 2026". */
export function stampWords(at: Date, locale: string, timeZone: string): string {
  const zone = timeZone || undefined;
  return `${formatClock(at, locale, { hour: "numeric", minute: "2-digit", ...(zone ? { timeZone: zone } : {}) })}, ${formatDayAt(at, locale, zone)}`;
}

const NO_KIT = (eventId: string): PrintKit => ({
  eventId,
  eventName: "",
  club: { name: "", logoUrl: "" },
  paper: "a4",
  host: "",
  rounds: [],
  round: null,
  sheet: "none",
  groupsAsOf: "",
  card: null,
  docs: [],
  sheets: [],
  statuses: [],
  gone: [],
  nowWords: "",
  refusals: [],
  words: { cart: GOLF_TERMS.cart.us, carts: GOLF_TERMS.carts.us },
  cardsBy: "player",
  signsBy: "cart",
});

/** Pages are sealed with a fingerprint of everything drawn on them, the round's header included. */
function seal<P extends Omit<KitPage, "fp">>(common: string, page: P): P & { fp: string } {
  const { key: _key, label: _label, ...drawn } = page as P & { key: string; label: string };
  return { ...page, fp: fingerprintOf([common, drawn]) };
}

/** Rows a portrait starting sheet holds, measured on US Letter — the shorter of the two — so either prints the same pages. */
export const START_ROWS_PER_PAGE = 30;

export async function printKit(
  eventId: string,
  opts: { stageId?: string; origin: string; now?: Date; cardsBy?: CardsBy; signsBy?: SignsBy },
): Promise<PrintKit> {
  const state = await loadEventState(eventId);
  if (!state) return NO_KIT(eventId);
  const now = opts.now ?? new Date();
  const host = opts.origin.replace(/^https?:\/\//, "");
  const settings = settingsOf(state.event);
  const brand = await brandForEvent(eventId);
  const { locale } = await formattingForEvent(eventId);
  const org = state.event.organizationId
    ? await prisma.organization.findUnique({ where: { id: state.event.organizationId }, select: { country: true, golfTerms: true } })
    : null;
  const golf = golfTermsFor(golfRegister(org?.country, org?.golfTerms));
  const cardsBy: CardsBy = opts.cardsBy ?? "player";
  const signsBy: SignsBy = opts.signsBy ?? "cart";
  const zone = state.timeZone;
  const words = (at: Date) => stampWords(at, locale, zone);

  const rounds = playingStages(state.stages);
  const roundName = (s: { id: string; description?: string | null; type?: string | null }) =>
    s.type === TEAM_SESSION && s.description?.trim() ? s.description.trim() : roundLabel(rounds, s.id) || "Round";
  const stage =
    rounds.find((s) => s.id === opts.stageId) ?? state.nextUnplayedRound ?? state.boardStage ?? rounds[0] ?? null;

  const kit: PrintKit = {
    ...NO_KIT(eventId),
    eventName: state.event.name,
    club: { name: brand?.name ?? "", logoUrl: brand?.logoUrl ?? "" },
    paper: defaultPaper(org?.country),
    host,
    rounds: rounds.map((r) => ({ id: r.id, label: roundName(r) })),
    nowWords: words(now),
    words: { cart: golf.cart, carts: golf.carts },
    cardsBy,
    signsBy,
  };
  if (!stage) return kit;

  const built = await roundKit(state, stage, {
    locale,
    words,
    host,
    origin: opts.origin,
    roundName,
    codesOn: usesAccessCodes(settings),
    publicBoard: isLeaderboardPublic(settings),
    golf,
    cardsBy,
    signsBy,
  });
  kit.round = { id: stage.id, label: roundName(stage), format: stage.format };
  kit.sheet = built.sheet;
  kit.groupsAsOf = built.groupsAsOf;
  kit.card = built.card;
  kit.docs = built.docs;
  kit.sheets = built.docs.flatMap((d) => d.pages.map((p) => ({ key: p.key, doc: p.doc, label: p.label, fp: p.fp })));
  const log = parsePrintLog(stage.printLog);
  kit.statuses = sheetStatuses(log, kit.sheets);
  /**
   * WHAT IS TYPED INTO THE APP CAN STILL PUT AN ADDRESS ON PAPER: a member
   * entered with their email for a name, a tee called by its green fee. The
   * pages carry no field of that kind, but they carry what people typed, so
   * every word on them is read by the same sweep the tests use, before the
   * press of Print, and the hub says what it found.
   */
  kit.refusals = [...new Set(paperRefusals(printedWords(built.card, built.docs)))].slice(0, 20);
  kit.gone = goneSheets(
    log,
    kit.sheets,
    built.docs.filter((d) => !d.unavailable).map((d) => d.kind),
  );
  return kit;
}

/**
 * Every piece of text a page is drawn from, one string each — the round codes,
 * the QR's address and the drawing itself left out, since a code is letters and
 * figures by design.
 */
export function printedWords(card: KitCard, docs: KitDoc[]): string[] {
  const out: string[] = [];
  const walk = (v: unknown, key = ""): void => {
    if (["qr", "code", "codes", "link", "fp", "key", "shots", "liveLine", "host"].includes(key)) return;
    if (typeof v === "string") out.push(v);
    else if (Array.isArray(v)) v.forEach((x) => walk(x));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, k);
  };
  walk({ eventName: card.eventName, clubName: card.clubName, courseName: card.courseName, roundLabel: card.roundLabel, sides: card.sides.map((s) => s.name) });
  for (const d of docs) for (const p of d.pages) walk(p);
  return out;
}

type Stage = EventState["stages"][number];

async function roundKit(
  state: EventState,
  stage: Stage,
  ctx: {
    locale: string;
    words: (at: Date) => string;
    host: string;
    origin: string;
    roundName: (s: Stage) => string;
    codesOn: boolean;
    publicBoard: boolean;
    golf: GolfWords;
    cardsBy: CardsBy;
    signsBy: SignsBy;
  },
) {
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const Cart = cap(ctx.golf.cart);
  const eventId = state.event.id;
  const holes = holesPlayed(stage.holes);
  const savedSheet = parseTeeSheet(stage.teeSheet);
  const published = !!savedSheet && stage.teeSheetPublished;
  const sheet: PrintKit["sheet"] = !savedSheet ? "none" : published ? "published" : "draft";
  const groupsAsOf = savedSheet?.savedAt ? ctx.words(new Date(savedSheet.savedAt)) : "";
  const brand = await brandForEvent(eventId);

  const priced = await pricedRound(state, stage);
  const { course, fullCard, firstHole, teamRound, sides, playerOf, kitPlayers } = priced;

  const isCup = stage.type === TEAM_SESSION;
  const startStyle = startStyleOf(savedSheet?.startType);
  const pinSheet = parsePinSheet(stage.pinSheet, holes);
  const engine = findFormat(stage.format).engine;
  const points = engine === "stableford" || engine === "modified-stableford" || stage.scoringBasis.trim().toLowerCase() === "stableford";

  const card: KitCard = {
    eventName: state.event.name,
    clubName: brand?.name ?? "",
    clubLogoUrl: brand?.logoUrl ?? "",
    courseName: course.name || state.event.course,
    dates: stage.playedOn ? formatDay(stage.playedOn, ctx.locale) : state.event.dates,
    roundLabel: ctx.roundName(stage),
    pars: course.pars,
    // The CLUB's stroke index, as on the card in the pro shop: the dots carry
    // the allocation, and on a nine the allocation re-ranks 1..9 (`applyNine`).
    strokeIndex: clubStrokeIndex(fullCard, course, firstHole, holes),
    yards: course.yards,
    holes,
    firstHole,
    teamRound,
    sides,
    pins: pinSheet.map(pinShort),
    points,
    startStyle,
  };
  const common = fingerprintOf(card);

  const startOf = (g: TeeSheetGroup) => {
    const n = startHoleNumber(g.startHole, firstHole);
    return startStyle === "tee" ? (n === firstHole ? `${ordinal(n)} tee` : `${ordinal(n)} tee`) : `Hole ${n}${g.half ?? ""}`;
  };

  const groupFrom = (g: TeeSheetGroup, ids: string[]): PrintGroup => ({
    name: g.name,
    startHole: g.startHole,
    half: g.half,
    time: g.time,
    players: ids.map((id) => playerOf(id)).filter((p): p is NonNullable<typeof p> => !!p),
  });

  const fieldGroups = (savedSheet?.groups ?? []).map((g) => ({
    g,
    players: g.playerIds.map((id) => kitPlayers.get(id)).filter((p): p is KitPlayer => !!p),
  }));
  const publishedGroups = published ? fieldGroups : [];

  const docs: KitDoc[] = [];
  const teams = teamRound?.teams ?? false;
  const matchRound = !!teamRound?.matchPlay;
  const noSheet = "Save the round's groups on the Tee sheet first — these are printed from it.";
  const notPublished = "Publish the Tee sheet first — these go to the players, so they are printed from the published groups.";

  /* ── Scorecards: one per player or side, or one per group ─────────── */
  {
    const pages: KitPage[] = [];
    let unavailable = "";
    let what = "one per player";
    if (matchRound) unavailable = "A match needs no scorecard — print the result slips instead.";
    else if (!savedSheet) unavailable = noSheet;
    else {
      const signOf = teamRound?.sharedBall
        ? "Either partner may sign for the side (Rule 22.1)."
        : teams
          ? "One partner's signature is enough for the side (Rule 23.6)."
          : "The marker certifies the hole scores; the player signs the card (Rule 3.3b).";
      /** The tees in play on one card, and — for a shared ball — how long its line of names is. */
      const formatOf = (ids: string[], rows: number) => {
        const tees = new Set(ids.map((id) => kitPlayers.get(id)?.tee ?? "").filter(Boolean)).size;
        // The line the card prints under the side, as the renderer prints it (`sideMembersLine`), and its tees.
        const teeNames = [...new Set(ids.map((id) => kitPlayers.get(id)?.tee ?? "").filter(Boolean))];
        const names = teamRound?.sharedBall
          ? `${sideMembersLine(ids.map((id) => kitPlayers.get(id)?.name ?? ""))} · PH 99${teeNames.length >= 3 ? ` · ${teeNames.join(", ")}` : ""}`.length
          : 0;
        return cardFormat({ kind: "scorecard", rows, tees, sharedBallNames: names });
      };
      // ONE PER GROUP is an outing's group card, and only an individual format has one:
      // a team round's card is the side's (Rule 23.2b), however the groups are drawn.
      const byGroup = ctx.cardsBy === "group" && !teams;
      for (const { g } of fieldGroups) {
        if (byGroup) {
          const ids = g.playerIds.filter((id) => kitPlayers.has(id));
          if (ids.length === 0) continue;
          const f = formatOf(ids, ids.length);
          pages.push(
            seal(common, {
              doc: "cards" as const,
              key: `cards:group:${g.name}`,
              label: `${g.name} — group card`,
              group: groupFrom(g, ids),
              unit: "group" as const,
              signNote: "",
              format: f.format,
              formatWhy: f.reason,
            }),
          );
          continue;
        }
        // One card per player; on a team round one per SIDE, its partners on the one card.
        const units: Array<{ key: string; label: string; ids: string[]; unit: "player" | "side" }> = [];
        const seen = new Set<string>();
        for (const id of g.playerIds) {
          const p = kitPlayers.get(id);
          if (!p || seen.has(id)) continue;
          if (teams && p.sideName) {
            const mates = g.playerIds.filter((x) => kitPlayers.get(x)?.sideName === p.sideName);
            mates.forEach((x) => seen.add(x));
            units.push({ key: `cards:side:${p.sideName}`, label: `${p.sideName} — scorecard`, ids: mates, unit: "side" });
          } else {
            seen.add(id);
            units.push({ key: `cards:${id}`, label: `${p.name} — scorecard`, ids: [id], unit: "player" });
          }
        }
        for (const u of units) {
          // A shared ball is one row; a four-ball side is each partner's row (Rule 23.2b) and the side's.
          const rows = u.unit === "side" ? (teamRound?.sharedBall ? 1 : u.ids.length + 1) : 1;
          const f = formatOf(u.ids, rows);
          pages.push(
            seal(common, {
              doc: "cards" as const,
              key: u.key,
              label: u.label,
              group: groupFrom(g, u.ids),
              unit: u.unit,
              signNote: signOf,
              format: f.format,
              formatWhy: f.reason,
            }),
          );
        }
      }
      if (teams) what = "one per side";
      else if (byGroup) what = "one per group, every name on it";
    }
    docs.push({ kind: "cards", unavailable, what, pages });
  }

  /* ── Match result slips ───────────────────────────────────────────── */
  const stageMatches = state.matches.filter((m) => m.stageId === stage.id);
  const sideById = new Map(priced.teams.map((t) => [t.id, t]));
  const matchSides = (m: (typeof stageMatches)[number]) => {
    if (m.teamAId && m.teamBId) {
      const a = sideById.get(m.teamAId);
      const b = sideById.get(m.teamBId);
      if (!a || !b) return null;
      return [a, b].map((t) => ({ name: t.name, ids: t.members.map((x) => x.playerId) }));
    }
    if (m.playerAId && m.playerBId) {
      return [m.playerAId, m.playerBId].map((id) => ({ name: kitPlayers.get(id)?.name ?? "", ids: [id] }));
    }
    return null;
  };
  const groupOfPlayer = new Map<string, TeeSheetGroup>();
  for (const { g } of fieldGroups) for (const id of g.playerIds) groupOfPlayer.set(id, g);
  {
    const pages: KitPage[] = [];
    let unavailable = "";
    if (!matchRound) unavailable = "This round is not match play.";
    else if (stageMatches.length === 0) unavailable = "No matches are drawn for this round yet.";
    else {
      for (const m of stageMatches) {
        const s = matchSides(m);
        if (!s || s.some((x) => x.ids.length === 0 || !x.name)) continue;
        const g = groupOfPlayer.get(s[0].ids[0]);
        const strokesFor = (ids: string[]) => {
          if (teamRound?.sharedBall) {
            const side = sides.find((x) => x.name === s.find((y) => y.ids === ids)?.name);
            return side?.matchStrokes ? `receives ${side.matchStrokes}` : "receives none";
          }
          return ids
            .map((id) => {
              const p = kitPlayers.get(id);
              if (!p) return "";
              return ids.length === 1 ? `receives ${p.matchStrokes ?? 0}` : `${p.name} receives ${p.matchStrokes ?? 0}`;
            })
            .filter(Boolean)
            .join(" · ");
        };
        const label = `${s[0].name} v ${s[1].name}`;
        pages.push(
          seal(common, {
            doc: "slips" as const,
            format: "card" as const,
            formatWhy: "",
            key: `slips:${m.id}`,
            label: `${label} — result slip`,
            slip: {
              matchLabel: label,
              time: g?.time ?? "",
              start: g ? startOf(g) : "",
              format: stage.format,
              sides: s.map((x) => ({
                name: x.name,
                players: x.ids.map((id) => kitPlayers.get(id)?.name ?? "").filter(Boolean),
                strokes: strokesFor(x.ids),
              })),
            },
          }),
        );
      }
    }
    docs.push({ kind: "slips", unavailable, what: "one per match", pages });
  }

  /* ── Cup match cards ──────────────────────────────────────────────── */
  const cupDoc = isCup ? await cupCards(state, stage, priced, ctx, common, groupOfPlayer, startOf) : null;
  docs.push(
    cupDoc ?? { kind: "cup", unavailable: "This round is not a team cup session.", what: "one per match", pages: [] },
  );

  /* ── Codes ────────────────────────────────────────────────────────── */
  const encode = (await import("qrcode-generator")).default as unknown as QrEncoder;
  const codeOf = (s: Stage, label: string): KitCode | null => {
    if (!ctx.codesOn || !s.accessCode) return null;
    const link = roundCodeLink(ctx.origin, s.accessCode);
    return { label, code: formatAccessCode(s.accessCode), link, qr: qrPath(qrModules(encode, link)) };
  };
  const shareToken = state.event.shareToken;
  const liveLine = ctx.publicBoard && shareToken ? `${ctx.host}/live/${shareToken}` : "";
  const thisCode = codeOf(stage, ctx.roundName(stage));

  /* ── {Cart} signs: one per {cart}, or one per group for a walking field ── */
  {
    const pages: KitPage[] = [];
    let unavailable = "";
    const cupGroups = cupDoc?.signGroups ?? null;
    const scorerJob = matchRound
      ? "Keeping the match: one of you opens the round with the code and taps who won each hole. The board has the result as soon as the last hole is in."
      : "Keeping the score: one of you opens the round with the code, taps your own name and enters everybody's score in this group after each hole. At the end each player checks their own card.";
    /**
     * ONE SIGN PER {CART} (the ruling's B; Ajay's original ask): the group split in
     * pairs in tee-sheet order — a three gives a two and a one — each sign naming
     * every player in the group with its own riders in bold. A walking field takes
     * one per group instead.
     */
    const carts = (n: number, players: SignPage["sign"]["players"]) => {
      if (ctx.signsBy === "group") return [{ suffix: "", cartName: "", riders: [] as string[] }];
      const pairs: string[][] = [];
      for (let i = 0; i < players.length; i += 2) pairs.push(players.slice(i, i + 2).map((p) => p.name));
      return pairs.map((riders, i) => ({
        suffix: pairs.length > 1 ? String.fromCharCode(65 + i) : "",
        cartName: `${Cart} ${n}${pairs.length > 1 ? String.fromCharCode(65 + i) : ""}`,
        riders,
      }));
    };
    const push = (n: number, keyBase: string, labelBase: string, sign: Omit<SignPage["sign"], "cartName" | "riders">) => {
      for (const c of carts(n, sign.players)) {
        pages.push(
          seal(common, {
            doc: "signs" as const,
            key: `signs:${keyBase}${c.suffix ? `:${c.suffix}` : ""}`,
            label: c.cartName ? `${labelBase} — ${c.cartName} sign` : `${labelBase} — ${ctx.golf.cart} sign`,
            sign: { ...sign, cartName: c.cartName, riders: c.riders },
            format: "card" as const,
            formatWhy: "",
          }),
        );
      }
    };
    // A cup session that shares its card with another prints its signs with that one too.
    if (cupDoc?.unavailable.startsWith("Printed with")) unavailable = cupDoc.unavailable;
    else if (cupGroups && cupGroups.length > 0) {
      cupGroups.forEach((cg, i) => push(i + 1, cg.key, cg.name, { ...cg.sign, scorerJob, liveLine, host: ctx.host }));
    } else if (!savedSheet) unavailable = noSheet;
    else if (!published) unavailable = notPublished;
    else {
      let n = 0;
      for (const { g, players } of publishedGroups) {
        if (players.length === 0) continue;
        n += 1;
        push(n, g.name, g.name, {
          groupName: g.name,
          time: g.time,
          start: startOf(g),
          startLarge: startStyle !== "tee",
          players: players.map((p) => ({
            name: p.name,
            playing: p.confirmed ? indexFigure(p.playingHandicap) : "to be confirmed",
            tee: p.tee,
            strokes: p.confirmed ? strokesByNine(p.shots, firstHole) : [],
            count: p.confirmed ? strokeCount(p.shots) : 0,
            note: matchRound && p.matchStrokes !== null ? "in the match" : "",
          })),
          scorerJob,
          codes: thisCode ? [thisCode] : [],
          liveLine,
          host: ctx.host,
        });
      }
    }
    docs.push({ kind: "signs", unavailable, what: ctx.signsBy === "group" ? "one per group" : `one per ${ctx.golf.cart}`, pages });
  }

  /* ── The spare sign: no names, one per round ──────────────────────── */
  docs.push({
    kind: "spare",
    unavailable: !ctx.codesOn
      ? "Players do not use round codes in this tournament (Tournament details → Players & scoring)."
      : !thisCode
        ? "This round has no code yet."
        : "",
    what: "one for the first tee, one for the clubhouse, no names",
    pages: thisCode
      ? (["tee", "clubhouse"] as const).map((where) =>
          seal(common, {
            doc: "spare" as const,
            key: `spare:${where}`,
            label: `${ctx.roundName(stage)} — spare sign (${where === "tee" ? "first tee" : "clubhouse"})`,
            spare: { roundName: ctx.roundName(stage), code: thisCode, liveLine, host: ctx.host },
            format: "card" as const,
            formatWhy: "",
          }),
        )
      : [],
  });

  /* ── The starting sheet: one copy, with an "On the tee" tick column ─ */
  {
    const pages: KitPage[] = [];
    let unavailable = "";
    if (!savedSheet) unavailable = noSheet;
    else if (!published) unavailable = notPublished;
    else {
      // Whole groups to a page: nothing split across a page break.
      const chunks: Array<StartPage["start"]["rows"]> = [];
      let cur: StartPage["start"]["rows"] = [];
      for (const { g, players } of publishedGroups) {
        if (players.length === 0) continue;
        if (cur.length > 0 && cur.length + players.length > START_ROWS_PER_PAGE) {
          chunks.push(cur);
          cur = [];
        }
        players.forEach((p, i) =>
          cur.push({
            time: g.time,
            start: startOf(g),
            group: g.name,
            name: p.name,
            playing: p.confirmed ? indexFigure(p.playingHandicap) : "to be confirmed",
            tee: p.tee,
            first: i === 0,
          }),
        );
      }
      if (cur.length) chunks.push(cur);
      chunks.forEach((rows, i) =>
        pages.push(
          seal(common, {
            doc: "start" as const,
            key: `start:${i + 1}`,
            label: `Starting sheet${chunks.length > 1 ? `, page ${i + 1} of ${chunks.length}` : ""}`,
            start: { part: i + 1, parts: chunks.length, rows },
            format: "page" as const,
            formatWhy: "",
          }),
        ),
      );
    }
    docs.push({ kind: "start", unavailable, what: "for the starter and the noticeboard — print as many as you need", pages });
  }

  docs.sort((a, b) => DOC_ORDER.indexOf(a.kind) - DOC_ORDER.indexOf(b.kind));
  return { sheet, groupsAsOf, card, docs };
}

/** "1st", "10th". */
function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${s}`;
}

/**
 * The club's own stroke index for the holes on this card. A nine of an
 * eighteen-hole card carries the eighteen-hole numbers there (the dots carry
 * the nine's allocation); anything else is the card as it stands.
 */
function clubStrokeIndex(
  full: { strokeIndex: number[] },
  card: { strokeIndex: number[] },
  firstHole: number,
  holes: number,
): number[] {
  if (holes === 9 && full.strokeIndex.length >= 18) {
    return Array.from({ length: 9 }, (_, i) => full.strokeIndex[holeNumber(i, firstHole) - 1] ?? card.strokeIndex[i]);
  }
  return card.strokeIndex;
}

/**
 * THE ROUND, PRICED: every player's figures and strokes, the sides, and the
 * match lows — the chain the Tee sheet's cards were built by (see the file's
 * note), moved here so every document prints it.
 */
async function pricedRound(state: EventState, stage: Stage) {
  const eventId = state.event.id;
  const holes = holesPlayed(stage.holes);
  const roundCourse = stage.courseId ? await prisma.course.findUnique({ where: { id: stage.courseId } }) : null;
  const course = roundCard(stage, state.event, roundCourse);
  // The whole card the round's nine is cut from — for the club's own stroke index and a cup card's eighteen columns.
  const fullCard = roundCard({ holes: 18, nine: "full" }, state.event, roundCourse);
  const firstHole = firstHoleOf(course);

  const eventTees = await teesForEvent(eventId);
  const teeNames = await teeNamesForRound(
    eventId,
    holes,
    teeForPlay(eventTees, { stageTeeId: stage.teeId, eventDefaultTeeId: state.event.defaultTeeId }, stage.courseId ?? state.event.courseId ?? null),
  );
  const allowance = effectiveAllowance(stage.format, stage.handicapAllowance, stage.type);
  const courseHandicaps = roundCourseHandicaps({
    tees: eventTees,
    players: state.confirmed,
    field: state.confirmed,
    flightTeeOf: await flightTeeByPlayer(eventId),
    stage,
    event: state.event,
  });
  const roundHcpRows: RoundHandicapRows = await roundHandicapRows(eventId, stage.id);
  /** Before rounding: the allowance is taken of the unrounded course handicap and rounded once (Rule 6.2a). */
  const frozenExactOf = (id: string): number =>
    roundHandicapExactOf(roundHcpRows.get(id), courseHandicaps.get(id) ?? 0, courseHandicaps.exact(id) ?? 0);
  /** The strokes for tees of a higher par (Rule 6.2b): what the round froze, or the field's answer today. */
  const givesParStrokes = parStrokesApply(stage.format, stage.scoringBasis);
  const parStrokesOf = (id: string): number =>
    givesParStrokes ? roundParStrokesOf(roundHcpRows.get(id), courseHandicaps.parStrokes(id)) : NO_PAR_STROKES;
  const partsOf = (id: string) =>
    playingHandicapPartsInRound(stage, roundHcpRows.get(id), {
      whole: courseHandicaps.get(id) ?? 0,
      exact: courseHandicaps.exact(id) ?? 0,
      parStrokes: courseHandicaps.parStrokes(id),
    });
  /** What one player's own ball plays off in this round: allowance, rounded once, then those strokes. */
  const playsOff = (id: string): number => partsOf(id).playing;
  const cardStrokeIndex = course.strokeIndex;

  const roundIsMatch = isHeadToHead(stage.type);
  const teamRound: PrintTeamRound | null =
    needsTeams(stage.format) || roundIsMatch
      ? {
          format: stage.format,
          allowance,
          teams: needsTeams(stage.format),
          sharedBall: needsTeams(stage.format) && sharesOneCard(stage.format),
          countBest: effectiveCountBest(stage.format, stage.countBest),
          matchPlay: roundIsMatch,
        }
      : null;
  const teams: TeamView[] = teamRound?.teams
    ? await teamsForStage(eventId, stage.id, stage.format, stage.handicapAllowance, holes, stage.allowanceWeights)
    : [];
  const sideOf = new Map<string, string>();
  for (const t of teams) for (const m of t.members) sideOf.set(m.playerId, t.name);

  /**
   * A MATCH IS PLAYED OFF THE LOWEST HANDICAP IN IT — read off the `Match`
   * rows, the pairing, not off who shares a tee time.
   */
  const matchPlay = !!teamRound?.matchPlay;
  const matches = matchPlay
    ? await prisma.match.findMany({
        where: { stageId: stage.id },
        select: { id: true, teamAId: true, teamBId: true, playerAId: true, playerBId: true },
      })
    : [];
  const lowOf = new Map<string, number>();
  const teamById = new Map(teams.map((t) => [t.id, t]));
  for (const m of matches) {
    const a = teamById.get(m.teamAId);
    const b = teamById.get(m.teamBId);
    if (!a || !b) continue;
    const figures = teamRound!.sharedBall
      ? [a.playingHandicap, b.playingHandicap]
      : [...a.members, ...b.members].map((x) => playsOff(x.playerId));
    const low = Math.min(...figures.map((n) => Math.round(n)));
    lowOf.set(a.id, low);
    lowOf.set(b.id, low);
  }
  const lowForPlayer = new Map<string, number>();
  for (const t of teams) {
    const low = lowOf.get(t.id);
    if (low === undefined) continue;
    for (const m of t.members) lowForPlayer.set(m.playerId, low);
  }
  /** Singles: the same rule with a field of two, and each match is its own block on a card. */
  const blockOf = new Map<string, string>();
  if (matchPlay && teamRound && !teamRound.teams) {
    for (const m of matches) {
      if (!m.playerAId || !m.playerBId) continue;
      const low = Math.min(Math.round(playsOff(m.playerAId)), Math.round(playsOff(m.playerBId)));
      lowForPlayer.set(m.playerAId, low);
      lowForPlayer.set(m.playerBId, low);
      blockOf.set(m.playerAId, m.id);
      blockOf.set(m.playerBId, m.id);
    }
  }

  const sides: PrintSide[] = teams.map((t) => {
    const low = lowOf.get(t.id);
    return {
      name: t.name,
      playingHandicap: t.playingHandicap,
      matchStrokes: low === undefined ? null : matchStrokesCount(t.playingHandicap, low),
      shots: matchStrokesPerHole(t.playingHandicap, low ?? 0, cardStrokeIndex),
    };
  });

  const byId = new Map(state.confirmed.map((p) => [p.id, p]));
  /** The strokes on each hole, as the dots on a card. A figure nobody has claimed gives none. */
  const shotsOf = (id: string, confirmed: boolean): number[] => {
    if (!confirmed) return new Array(cardStrokeIndex.length).fill(0);
    const low = lowForPlayer.get(id);
    return low === undefined
      ? allocatedStrokes(frozenExactOf(id), allowance, cardStrokeIndex, parStrokesOf(id))
      : matchStrokesPerHole(playsOff(id), low, cardStrokeIndex);
  };
  const kitPlayers = new Map<string, KitPlayer>();
  for (const p of state.confirmed) {
    const confirmed = (p.handicapSource ?? "") !== "none";
    const low = lowForPlayer.get(p.id);
    kitPlayers.set(p.id, {
      id: p.id,
      name: p.name,
      tee: teeNames.get(p.id) ?? "",
      confirmed,
      courseHandicap: partsOf(p.id).resolved.handicap,
      playingHandicap: playsOff(p.id),
      shots: shotsOf(p.id, confirmed),
      matchStrokes: low === undefined ? null : matchStrokesCount(playsOff(p.id), low),
      sideName: sideOf.get(p.id) ?? blockOf.get(p.id) ?? "",
    });
  }
  const playerOf = (id: string): PrintGroup["players"][number] | null => {
    const pl = byId.get(id);
    const k = kitPlayers.get(id);
    if (!pl || !k) return null;
    return {
      name: pl.name,
      handicap: pl.handicap,
      handicapType: pl.handicapType,
      handicapSource: pl.handicapSource,
      tee: k.tee,
      sideName: k.sideName,
      playingHandicap: k.playingHandicap,
      courseHandicap: k.courseHandicap,
      unconfirmed: !k.confirmed,
      matchStrokes: k.matchStrokes,
      shots: k.shots,
    };
  };

  return { course, fullCard, firstHole, teamRound, sides, teams, playerOf, kitPlayers, playsOff, allowance, holes, cardStrokeIndex };
}

/**
 * THE CUP MATCH CARD — the shape the owner kept from his own cup: landscape,
 * one per match, and where the day plays two sessions on the two nines (a
 * four-ball on one, singles on the other) BOTH on the one card, each section
 * on its own holes with its own strokes off the low.
 *
 * Anchored on the session with sides: printed from the singles session, the
 * hub says to print it from the four-ball, so a match is never on two cards.
 */
async function cupCards(
  state: EventState,
  stage: Stage,
  priced: Awaited<ReturnType<typeof pricedRound>>,
  ctx: { roundName: (s: Stage) => string; codesOn: boolean; origin: string },
  common: string,
  groupOfPlayer: Map<string, TeeSheetGroup>,
  startOf: (g: TeeSheetGroup) => string,
): Promise<(KitDoc & { signGroups: Array<{ key: string; name: string; sign: Omit<SignPage["sign"], "scorerJob" | "liveLine" | "host" | "cartName" | "riders"> }> }) | null> {
  const sessions = playingStages(state.stages).filter((s) => s.type === TEAM_SESSION);
  const companion =
    holesPlayed(stage.holes) === 9
      ? sessions.find(
          (s) =>
            s.id !== stage.id &&
            holesPlayed(s.holes) === 9 &&
            (s.nine || "front") !== (stage.nine || "front") &&
            (s.playedOn ?? "") === (stage.playedOn ?? ""),
        ) ?? null
      : null;
  const thisTeams = needsTeams(stage.format);
  if (companion && !thisTeams && needsTeams(companion.format)) {
    return {
      kind: "cup",
      unavailable: `Printed with ${ctx.roundName(companion)}, which shares its card — choose that round above.`,
      what: "one per match",
      pages: [],
      signGroups: [],
    };
  }
  const other = companion ? await pricedRound(state, companion) : null;

  const fullPars = priced.fullCard.pars;
  const fullSi = priced.fullCard.strokeIndex;
  const fullYards = priced.fullCard.yards;
  const sectionHoles = (p: typeof priced) => Array.from({ length: p.holes }, (_, i) => holeNumber(i, p.firstHole));

  type SectionMatch = { id: string; ids: string[]; label: string; rows: CupRow[]; sideNames: [string, string]; shotsByPlayer: Map<string, Record<number, number>> };
  const sectionMatches = (s: Stage, p: typeof priced): SectionMatch[] => {
    const holes = sectionHoles(p);
    const toCols = (shots: number[]) => Object.fromEntries(holes.map((h, i) => [h, shots[i] ?? 0]));
    const teamById = new Map(p.teams.map((t) => [t.id, t]));
    const out: SectionMatch[] = [];
    for (const m of state.matches.filter((x) => x.stageId === s.id)) {
      const rows: CupRow[] = [];
      const shotsByPlayer = new Map<string, Record<number, number>>();
      let ids: string[] = [];
      let names: [string, string] = ["", ""];
      if (m.teamAId && m.teamBId) {
        const a = teamById.get(m.teamAId);
        const b = teamById.get(m.teamBId);
        if (!a || !b) continue;
        names = [a.name, b.name];
        const side = p.sides.find((x) => x.name === a.name);
        const sideB = p.sides.find((x) => x.name === b.name);
        for (const [t, ps] of [
          [a, side],
          [b, sideB],
        ] as const) {
          if (sharesOneCard(s.format)) {
            rows.push({ name: `${t.name} (${t.members.map((x) => x.name).join(" & ")})`, note: `receives ${ps?.matchStrokes ?? 0}`, shots: toCols(ps?.shots ?? []), kind: "player" });
          } else {
            for (const mem of t.members) {
              const k = p.kitPlayers.get(mem.playerId);
              const cols = toCols(k?.shots ?? []);
              shotsByPlayer.set(mem.playerId, cols);
              rows.push({ name: mem.name, note: `receives ${k?.matchStrokes ?? 0}`, shots: cols, kind: "player" });
            }
            rows.push({ name: `${t.name} — better ball`, note: "", shots: {}, kind: "side" });
          }
          ids = ids.concat(t.members.map((x) => x.playerId));
        }
        rows.push({ name: `Match — ${a.name}`, note: "up / down / AS", shots: {}, kind: "match" });
      } else if (m.playerAId && m.playerBId) {
        const a = p.kitPlayers.get(m.playerAId);
        const b = p.kitPlayers.get(m.playerBId);
        if (!a || !b) continue;
        names = [a.name, b.name];
        for (const k of [a, b]) {
          const cols = toCols(k.shots);
          shotsByPlayer.set(k.id, cols);
          rows.push({ name: k.name, note: `receives ${k.matchStrokes ?? 0}`, shots: cols, kind: "player" });
        }
        rows.push({ name: `Match — ${a.name}`, note: "up / down / AS", shots: {}, kind: "match" });
        ids = [a.id, b.id];
      } else continue;
      out.push({ id: m.id, ids, label: `${names[0]} v ${names[1]}`, rows, sideNames: names, shotsByPlayer });
    }
    return out;
  };

  const mine = sectionMatches(stage, priced);
  const theirs = companion && other ? sectionMatches(companion, other) : [];
  if (mine.length === 0) {
    return { kind: "cup", unavailable: "No matches are lined up for this session yet (Team cup → Lineups).", what: "one per match", pages: [], signGroups: [] };
  }
  const titleOf = (s: Stage, p: typeof priced) => {
    const hs = sectionHoles(p);
    return `${ctx.roundName(s)} · ${s.format} · holes ${hs[0]}–${hs[hs.length - 1]}`;
  };
  const columnsOf = (...ps: Array<typeof priced>) => [...new Set(ps.flatMap(sectionHoles))].sort((a, b) => a - b);
  const pick = (arr: number[], holes: number[]) => Object.fromEntries(holes.map((h) => [h, arr[h - 1] ?? 0]));

  const encode = (await import("qrcode-generator")).default as unknown as QrEncoder;
  const codeOf = (s: Stage, label: string): KitCode | null => {
    if (!ctx.codesOn || !s.accessCode) return null;
    const link = roundCodeLink(ctx.origin, s.accessCode);
    return { label, code: formatAccessCode(s.accessCode), link, qr: qrPath(qrModules(encode, link)) };
  };
  // In the order the holes are played: the front nine's code first.
  const codes = [
    { first: priced.firstHole, code: codeOf(stage, titleOf(stage, priced)) },
    { first: other?.firstHole ?? 99, code: companion && other ? codeOf(companion, titleOf(companion, other)) : null },
  ]
    .sort((a, b) => a.first - b.first)
    .map((c) => c.code)
    .filter((c): c is KitCode => !!c);

  const pages: KitPage[] = [];
  const signGroups: Array<{ key: string; name: string; sign: Omit<SignPage["sign"], "scorerJob" | "liveLine" | "host" | "cartName" | "riders"> }> = [];
  for (const [i, m] of mine.entries()) {
    const inMatch = new Set(m.ids);
    const companions = theirs.filter((t) => t.ids.every((id) => inMatch.has(id)));
    const sections: CupSection[] = [{ title: titleOf(stage, priced), holes: sectionHoles(priced), matches: [{ label: m.label, rows: m.rows }] }];
    if (companion && other && companions.length) {
      sections.push({ title: titleOf(companion, other), holes: sectionHoles(other), matches: companions.map((c) => ({ label: c.label, rows: c.rows })) });
    }
    const columns = companion && other && companions.length ? columnsOf(priced, other) : columnsOf(priced);
    const g = groupOfPlayer.get(m.ids[0]);
    /** Where the group goes off: on a two-nine card, the first of the holes it plays that day. */
    const cupStart = (grp: TeeSheetGroup) =>
      columns.length > priced.holes ? `${ordinal(columns[0] + grp.startHole - 1)} tee` : startOf(grp);
    // A four-ball's match row is written in its Result column, so it is not a row of its own.
    const rowsOn = Math.max(...sections.map((s) => s.matches.reduce((n, x) => n + x.rows.filter((r) => r.kind !== "match").length, 0)));
    const f = cardFormat({ kind: "cup", sections: sections.length, rows: rowsOn });
    pages.push(
      seal(common, {
        doc: "cup" as const,
        format: f.format,
        formatWhy: f.reason,
        key: `cup:${m.id}`,
        label: `${m.label} — cup card`,
        cup: {
          matchLabel: m.label,
          time: g?.time ?? "",
          start: g ? cupStart(g) : "",
          columns,
          pars: pick(fullPars, columns),
          strokeIndex: pick(fullSi, columns),
          yards: pick(fullYards, columns),
          sections,
          sideNames: m.sideNames,
        },
      }),
    );
    // The cart sign for the same four: their strokes on each nine, from each section.
    const players = m.ids.map((id) => {
      const k = priced.kitPlayers.get(id)!;
      const cols: Record<number, number> = { ...(m.shotsByPlayer.get(id) ?? {}) };
      for (const c of companions) Object.assign(cols, c.shotsByPlayer.get(id) ?? {});
      const arr = Array.from({ length: 18 }, (_, h) => cols[h + 1] ?? 0);
      const played = columns;
      const shown = played.length === 18 ? arr : played.map((h) => arr[h - 1]);
      const first = played[0] ?? 1;
      return {
        name: k.name,
        playing: k.confirmed ? indexFigure(k.playingHandicap) : "to be confirmed",
        tee: k.tee,
        strokes: k.confirmed ? strokesByNine(shown, played.length === 18 ? 1 : first) : [],
        count: k.confirmed ? strokeCount(shown) : 0,
        note: "in the matches",
      };
    });
    signGroups.push({
      key: m.id,
      name: g?.name ?? `Match ${i + 1}`,
      sign: { groupName: `${g?.name ? `${g.name} · ` : ""}${m.label}`, time: g?.time ?? "", start: g ? cupStart(g) : "", startLarge: false, players, codes },
    });
  }
  return { kind: "cup", unavailable: "", what: "one per match", pages, signGroups };
}
