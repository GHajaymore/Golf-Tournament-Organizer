/**
 * J41. SWEEP THE FIELDS IMPORTED BEFORE #296 FOR THE SAME PLAYER TWICE.
 *
 * `importCsvSignups` (src/app/actions/tournament.ts) learned to skip a row it
 * had already seen. Nothing ever went back for the fields imported before it
 * did, and those may hold one person twice. This is the going-back.
 *
 *   npx tsx scripts/sweep-duplicate-players.ts                       (= --report)
 *   npx tsx scripts/sweep-duplicate-players.ts --report
 *   npx tsx scripts/sweep-duplicate-players.ts --apply --event <eventId>
 *   npx tsx scripts/sweep-duplicate-players.ts --apply --event <eventId> --i-am-ops
 *
 * `--report` (the default) READS ONLY. It prints counts and row ids, never a
 * name, an email or a phone number: this repository is public and logs get
 * pasted. It runs against any database, because it cannot change one; it says
 * "local" or "REMOTE" so a pasted log says where it was taken.
 *
 * `--apply --event <id>` merges the duplicates of ONE event inside ONE
 * transaction. It refuses any database whose host is not localhost or
 * 127.0.0.1 (both DATABASE_URL and PRISMA_DATABASE_URL are read) unless
 * `--i-am-ops` is given, and it never touches the demo club. A production run
 * is an Ops step the main session arranges; nothing here runs by itself.
 *
 * THE RULE FOR "SAME PLAYER" is the importer's, and the importer's is written
 * inline in a "use server" file, which may export only async functions, so it
 * cannot be imported (and this change may not touch app code). `sameKey` below
 * is therefore a transcription, and the audit test pins it to the importer's
 * source (`sweep-duplicate-players.audit.test.ts` reads the importer through
 * `readSource` and refuses to go green if its key shape moves). The rule, as
 * the importer states it: the lower-cased, trimmed EMAIL where a row has one;
 * the lower-cased, trimmed NAME only for a row with NO email. A row with
 * neither is nobody. Every status counts, as it does there (`existing` is
 * every row of the event).
 *
 * WHAT IS KEPT. Within a cluster of rows sharing a key:
 *   - exactly one row has ties (scores, cards, stakes, a team, a tee or a
 *     flight, see LINKS)  -> that row is kept, the others are deleted;
 *   - no row has ties     -> the row in the field is kept (confirmed before
 *     any other status), then the lowest seed, then the lowest id;
 *   - two or more rows have ties, or two carry DIFFERENT roster members
 *     -> the cluster is REFUSED, reported, and left exactly as it was.
 * A refused cluster does not stop the other clusters of the event.
 * Merging never moves a tie from one row to the other: a row with ties is
 * never deleted, so nothing is re-pointed except the two soft references the
 * schema holds as arrays or optional ids (`playWith` on other players, and a
 * kept row with no roster member adopting the dropped row's).
 *
 * LIMIT, honestly: ties are the columns in LINKS. An id held inside a JSON
 * setting (a stored draw, a pairing request in a message body) is not seen. A
 * test sweeps the schema for any column named like a player id that LINKS does
 * not list, so a NEW column cannot go unseen quietly.
 */
import "dotenv/config";
import { PrismaClient, type Prisma } from "@prisma/client";

/* ------------------------------------------------------------------ rule */

export interface SweepPlayer {
  id: string;
  name: string;
  email: string;
  status: string;
  seed: number;
  memberId: string | null;
  teeId: string | null;
  groupId: string | null;
  playWith: string[];
  phone: string;
  ghin: string;
  homeClub: string;
  preferredTee: string;
  handicap: number;
  handicapSource: string;
  handicapType: string;
  publicNameWithheld: boolean;
}

/** The importer's key: email where there is one, name only where there is not. Null = nobody. */
export function sameKey(p: Pick<SweepPlayer, "name" | "email">): string | null {
  const email = p.email.trim().toLowerCase();
  if (email) return `email:${email}`;
  const name = p.name.trim().toLowerCase();
  if (name) return `name:${name}`;
  return null;
}

/* ----------------------------------------------------------------- ties */

export type TieKind = "scores" | "cards" | "stakes" | "team";

/**
 * Every column that holds a Player id, by the model that holds it. `delegate`
 * is the Prisma client's name for the model. A tie on one of these makes a row
 * undeletable.
 */
export const LINKS: ReadonlyArray<{ kind: TieKind; model: string; delegate: string; fields: string[]; containing?: string[] }> = [
  { kind: "scores", model: "Scorecard", delegate: "scorecard", fields: ["playerId"] },
  { kind: "scores", model: "TeamScorecard", delegate: "teamScorecard", fields: ["playerId"] },
  { kind: "scores", model: "RoundHandicap", delegate: "roundHandicap", fields: ["playerId"] },
  { kind: "scores", model: "HandicapPost", delegate: "handicapPost", fields: ["playerId"] },
  {
    kind: "scores", model: "Match", delegate: "match",
    fields: ["playerAId", "playerBId", "enteredById", "confirmedById", "forfeitedBy"],
    // attestedBy is a JSON array of player ids held in a String: found by contains.
    containing: ["attestedBy"],
  },
  { kind: "scores", model: "BracketWinner", delegate: "bracketWinner", fields: ["winnerId"] },
  { kind: "scores", model: "BracketReport", delegate: "bracketReport", fields: ["winnerId", "reportedById"] },
  { kind: "scores", model: "HonoursEntry", delegate: "honoursEntry", fields: ["playerId"] },
  { kind: "scores", model: "Prize", delegate: "prize", fields: ["winnerId"] },
  { kind: "cards", model: "RoundAttendance", delegate: "roundAttendance", fields: ["playerId"] },
  { kind: "cards", model: "ScoringKeeper", delegate: "scoringKeeper", fields: ["playerId"] },
  { kind: "stakes", model: "SkinsEntry", delegate: "skinsEntry", fields: ["playerId"] },
  { kind: "stakes", model: "Expense", delegate: "expense", fields: ["paidBy"] },
  { kind: "stakes", model: "ExpenseShare", delegate: "expenseShare", fields: ["playerId"] },
  { kind: "stakes", model: "ExpensePayment", delegate: "expensePayment", fields: ["playerId"] },
  { kind: "stakes", model: "Settlement", delegate: "settlement", fields: ["fromPlayerId", "toPlayerId"] },
  { kind: "stakes", model: "ContestEntry", delegate: "contestEntry", fields: ["playerId"] },
  { kind: "stakes", model: "SideGameEntry", delegate: "sideGameEntry", fields: ["playerId"] },
  { kind: "team", model: "TeamMember", delegate: "teamMember", fields: ["playerId"] },
  { kind: "team", model: "Group", delegate: "group", fields: ["captainId", "viceCaptainId"] },
];

/** Columns named like a player id that are deliberately NOT ties, and why. */
export const NOT_TIES: Readonly<Record<string, string>> = {
  "Member.memberNumber": "a club's number for a member, not a player id",
  "LeaguePlayoffHole.winnerId": "a club's id, not a player's",
  "Player.memberId": "the roster link, handled as a conflict between two rows",
  // A guest's player link (J39/J40) is ONE entry's and unique to it: a merge drops the removed
  // row's link with the row (cascade), never moves it onto another entry; the organizer makes a new one.
  "PlayerPass.playerId": "a guest's link belongs to that one entry; it goes with the row, never to another",
  "PlayerPass.createdBy": "the staff member's display name, not an id",
  "PlayerPass.revokedBy": "the staff member's display name, not an id",
  "PlayerPass.mutedBy": "the staff member's display name, not an id",
  // `...By` columns that hold a display name or a setting, read from the schema's own comments:
  "Organization.defaultScoreEntryBy": "a setting (staff | players)",
  "Organization.defaultAttestBy": "a setting (marker | opponent | all)",
  "Event.scoreEntryBy": "a setting (staff | players)",
  "Event.attestBy": "a setting (marker | opponent | all)",
  "Stage.knockoutPlayBy": "a setting",
  "Stage.matchKeptBy": "a setting",
  "Course.verifiedBy": "a name",
  "Event.correctionBy": "the session's display name of whoever opened the committee correction (PR 5b), not an id",
  "JoinRequest.decidedBy": "a name, 'by name' per the schema",
  "NamesakeNotice.dismissedBy": "the name of the staff member who dismissed it",
  "RoundAttendance.decidedBy": "the player themself or a staff NAME, per the schema",
  "LeaguePlayoffHole.decidedBy": "a name",
  "Match.enteredBy": "a display name beside enteredById",
  "Match.confirmedBy": "a display name beside confirmedById",
  "BracketReport.reportedBy": "a display name beside reportedById",
  "Scorecard.certifiedBy": "a name",
  "Scorecard.approvedBy": "a name",
  "Expense.createdBy": "a name",
  "Settlement.recordedBy": "a name",
  "Contest.createdBy": "a name",
  "SideGame.createdBy": "a name",
  "TournamentFund.createdBy": "a name",
  "HonoursEntry.confirmedBy": "a name",
};

export interface RowTies {
  /** Tie counts by kind. */
  scores: number;
  cards: number;
  stakes: number;
  team: number;
  /** Placed on a tee (`teeId`) or in a flight/tee-sheet group (`groupId`). */
  placed: boolean;
}

const NO_TIES: RowTies = { scores: 0, cards: 0, stakes: 0, team: 0, placed: false };

export const hasTies =(t: RowTies): boolean => t.scores + t.cards + t.stakes + t.team > 0 || t.placed;

export type Cluster =
  | { key: string; keep: string; drop: string[]; adoptMemberId: string | null; fill: Record<string, string | number | boolean>; refused: null }
  | { key: string; keep: null; drop: string[]; adoptMemberId: null; fill: Record<string, never>; refused: string };

const TEXT_FIELDS = ["phone", "ghin", "homeClub", "preferredTee"] as const;
const handicapSet = (p: SweepPlayer): boolean => p.handicap !== 0;

/**
 * What the kept row must take from the dropped ones so nothing a person typed is lost, or the
 * reason it cannot be decided: two rows holding DIFFERENT non-empty values for one field.
 * A handicap is "held" when it is not 0 (the default); `publicNameWithheld` is a privacy choice,
 * so true on any row stays true.
 */
export function mergeFill(keep: SweepPlayer, others: SweepPlayer[]): { fill: Record<string, string | number | boolean> } | { conflict: string } {
  const fill: Record<string, string | number | boolean> = {};
  for (const f of TEXT_FIELDS) {
    const vals = new Set([keep, ...others].map((p) => p[f].trim()).filter(Boolean));
    if (vals.size > 1) return { conflict: `rows hold different values for ${f}` };
    if (!keep[f].trim() && vals.size === 1) fill[f] = [...vals][0];
  }
  const hcps = [keep, ...others].filter(handicapSet);
  if (new Set(hcps.map((p) => p.handicap)).size > 1) return { conflict: "rows hold different handicaps" };
  if (!handicapSet(keep) && hcps.length) {
    fill.handicap = hcps[0].handicap;
    fill.handicapSource = hcps[0].handicapSource;
    fill.handicapType = hcps[0].handicapType;
  }
  if (!keep.publicNameWithheld && others.some((p) => p.publicNameWithheld)) fill.publicNameWithheld = true;
  return { fill };
}

/** Pure: which rows of one event are duplicates of which, and what is kept. */
export function planCluster(key: string, rows: SweepPlayer[], ties: Map<string, RowTies>): Cluster {
  const tied = rows.filter((r) => hasTies(ties.get(r.id) ?? NO_TIES));
  const members = new Set(rows.map((r) => r.memberId).filter(Boolean) as string[]);
  if (tied.length > 1) {
    return { key, keep: null, drop: [], adoptMemberId: null, fill: {}, refused: `${tied.length} of ${rows.length} rows carry ties` };
  }
  if (members.size > 1) {
    return { key, keep: null, drop: [], adoptMemberId: null, fill: {}, refused: "rows belong to different roster members" };
  }
  const order = [...rows].sort(
    (a, b) =>
      Number(b.status === "confirmed") - Number(a.status === "confirmed") || a.seed - b.seed || (a.id < b.id ? -1 : 1),
  );
  const keep = tied[0] ?? order[0];
  const drop = rows.filter((r) => r.id !== keep.id).map((r) => r.id);
  const adoptMemberId = !keep.memberId && members.size === 1 ? [...members][0] : null;
  const merged = mergeFill(keep, rows.filter((r) => r.id !== keep.id));
  if ("conflict" in merged) return { key, keep: null, drop: [], adoptMemberId: null, fill: {}, refused: merged.conflict };
  return { key, keep: keep.id, drop, adoptMemberId, fill: merged.fill, refused: null };
}

/** Pure: group an event's rows by the importer's key and keep only the keys held more than once. */
export function duplicateClusters(players: SweepPlayer[]): Map<string, SweepPlayer[]> {
  const byKey = new Map<string, SweepPlayer[]>();
  for (const p of players) {
    const k = sameKey(p);
    if (k === null) continue;
    byKey.set(k, [...(byKey.get(k) ?? []), p]);
  }
  return new Map([...byKey].filter(([, rows]) => rows.length > 1));
}

/* -------------------------------------------------------------- the guard */

export function databaseIsLocal(env: Record<string, string | undefined>): { local: boolean; why: string } {
  const urls = [env.DATABASE_URL, env.PRISMA_DATABASE_URL].filter((u): u is string => !!u);
  if (!env.DATABASE_URL) return { local: false, why: "DATABASE_URL is not set" };
  for (const u of urls) {
    let host = "";
    try {
      host = new URL(u).hostname.toLowerCase();
    } catch {
      return { local: false, why: "a database URL could not be read" };
    }
    // `?host=db.example/` makes libpq-style drivers connect elsewhere whatever the authority says.
    if (new URL(u).searchParams.get("host")) return { local: false, why: "a database URL carries a host= parameter" };
    if (host !== "localhost" && host !== "127.0.0.1") return { local: false, why: "a database host is not localhost or 127.0.0.1" };
  }
  return { local: true, why: "" };
}

/* ------------------------------------------------------------------- IO */

type Client = PrismaClient | Prisma.TransactionClient;
type Delegate = { findMany(args: unknown): Promise<Array<Record<string, string | null>>> };
const delegateOf = (c: Client, name: string) => (c as unknown as Record<string, Delegate>)[name];

const PLAYER_SELECT = {
  id: true, name: true, email: true, status: true, seed: true, memberId: true, teeId: true, groupId: true, playWith: true,
  phone: true, ghin: true, homeClub: true, preferredTee: true, handicap: true, handicapSource: true, handicapType: true,
  publicNameWithheld: true,
} as const;

export async function loadPlayers(c: Client, eventId: string): Promise<SweepPlayer[]> {
  return (await c.player.findMany({ where: { eventId }, select: PLAYER_SELECT, orderBy: { seed: "asc" } })) as SweepPlayer[];
}

export async function loadTies(c: Client, ids: string[]): Promise<Map<string, RowTies>> {
  const ties = new Map<string, RowTies>(ids.map((id) => [id, { ...NO_TIES }]));
  if (!ids.length) return ties;
  for (const link of LINKS) {
    for (const field of link.fields) {
      const rows = await delegateOf(c, link.delegate).findMany({
        where: { [field]: { in: ids } },
        select: { [field]: true },
      });
      for (const r of rows) {
        const t = ties.get(r[field] as string);
        if (t) t[link.kind] += 1;
      }
    }
  }
  for (const link of LINKS) {
    for (const field of link.containing ?? []) {
      // A JSON array of ids in a String column: one contains-query per id (the ids are cuids, quoted in the JSON).
      for (const id of ids) {
        const n = await delegateOf(c, link.delegate).findMany({
          where: { [field]: { contains: `"${id}"` } },
          select: { id: true },
        });
        if (n.length) ties.get(id)![link.kind] += n.length;
      }
    }
  }
  const placed = await c.player.findMany({
    where: { id: { in: ids }, OR: [{ teeId: { not: null } }, { groupId: { not: null } }] },
    select: { id: true },
  });
  for (const p of placed) ties.get(p.id)!.placed = true;
  return ties;
}

export interface EventPlan {
  eventId: string;
  players: number;
  clusters: Cluster[];
}

export async function planEvent(c: Client, eventId: string): Promise<EventPlan> {
  const players = await loadPlayers(c, eventId);
  const groups = duplicateClusters(players);
  const ties = await loadTies(c, [...groups.values()].flat().map((p) => p.id));
  return {
    eventId,
    players: players.length,
    clusters: [...groups].map(([key, rows]) => planCluster(key, rows, ties)),
  };
}

export interface Report {
  events: number;
  skippedDemoEvents: number;
  eventsWithDuplicates: number;
  duplicateRows: number;
  refusedClusters: number;
  perEvent: Array<{ eventId: string; clusters: number; dropRows: number; refused: number; rowIds: string[] }>;
}

export async function report(c: PrismaClient): Promise<Report> {
  const events = await c.event.findMany({ select: { id: true, organization: { select: { isDemo: true } } } });
  const real = events.filter((e) => !e.organization.isDemo);
  const out: Report = {
    events: real.length,
    skippedDemoEvents: events.length - real.length,
    eventsWithDuplicates: 0,
    duplicateRows: 0,
    refusedClusters: 0,
    perEvent: [],
  };
  for (const e of real) {
    const plan = await planEvent(c, e.id);
    if (!plan.clusters.length) continue;
    const dropRows = plan.clusters.reduce((n, k) => n + k.drop.length, 0);
    const refused = plan.clusters.filter((k) => k.refused).length;
    out.eventsWithDuplicates += 1;
    out.duplicateRows += dropRows;
    out.refusedClusters += refused;
    out.perEvent.push({
      eventId: e.id,
      clusters: plan.clusters.length,
      dropRows,
      refused,
      rowIds: plan.clusters.flatMap((k) => k.drop),
    });
  }
  return out;
}

export interface ApplyResult {
  merged: number;
  deleted: number;
  refused: string[];
}

export class SweepRefusal extends Error {}

export async function applyEvent(
  c: PrismaClient,
  eventId: string,
  /** For the audit test only: runs after the plan and before the delete. */
  hooks: { beforeDelete?: () => Promise<void> } = {},
): Promise<ApplyResult> {
  const ev = await c.event.findUnique({ where: { id: eventId }, select: { id: true, organization: { select: { isDemo: true } } } });
  if (!ev) throw new SweepRefusal("No such event.");
  if (ev.organization.isDemo) throw new SweepRefusal("That event belongs to the demo club; it is never touched.");
  return c.$transaction(
    async (tx) => {
      // Lock this event's player rows first: anything that references one through a foreign key
      // (a skins entry, a team seat) waits, and a second sweep waits for this one.
      await tx.$queryRaw`SELECT id FROM "Player" WHERE "eventId" = ${eventId} FOR UPDATE`;
      // Planned INSIDE the transaction, from the rows as they are now.
      const plan = await planEvent(tx, eventId);
      const result: ApplyResult = { merged: 0, deleted: 0, refused: [] };
      for (const k of plan.clusters) {
        if (k.refused !== null || k.keep === null) {
          result.refused.push(k.refused ?? "no row to keep");
          continue;
        }
        const patch = { ...k.fill, ...(k.adoptMemberId ? { memberId: k.adoptMemberId } : {}) };
        if (Object.keys(patch).length) await tx.player.update({ where: { id: k.keep }, data: patch });
        // The only references to a player that are not ties: other players' `playWith`.
        const asked = await tx.player.findMany({
          where: { eventId, playWith: { hasSome: k.drop } },
          select: { id: true, playWith: true },
        });
        for (const a of asked) {
          const next = [...new Set(a.playWith.map((id) => (k.drop.includes(id) ? k.keep : id)))].filter((id) => id !== a.id);
          await tx.player.update({ where: { id: a.id }, data: { playWith: next } });
        }
        await hooks.beforeDelete?.();
        // A column with no foreign key (a match's entered-by, a settlement) takes no lock, so
        // look again at the very last moment. Any tie now rolls the WHOLE transaction back.
        const late = await loadTies(tx, k.drop);
        if ([...late.values()].some(hasTies)) {
          throw new SweepRefusal("A row to be deleted gained a tie while the sweep ran; nothing was changed. Run it again.");
        }
        const gone = await tx.player.deleteMany({ where: { id: { in: k.drop }, eventId } });
        result.merged += 1;
        result.deleted += gone.count;
      }
      return result;
    },
    { timeout: 60_000 },
  );
}

/* ------------------------------------------------------------------ CLI */

export interface Args { mode: "report" | "apply"; eventId?: string; ops: boolean; error?: string }

export function parseArgs(argv: string[]): Args {
  const apply = argv.includes("--apply");
  const rep = argv.includes("--report");
  const ops = argv.includes("--i-am-ops");
  const i = argv.indexOf("--event");
  const eventId = i > -1 ? argv[i + 1] : undefined;
  if (apply && rep) return { mode: "report", ops, error: "Choose --report or --apply, not both." };
  if (apply && (!eventId || eventId.startsWith("--"))) return { mode: "apply", ops, error: "--apply needs --event <eventId>." };
  return { mode: apply ? "apply" : "report", eventId, ops };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.error) {
    console.error(args.error);
    process.exitCode = 2;
    return;
  }
  const where = databaseIsLocal(process.env);
  if (args.mode === "apply" && !where.local && !args.ops) {
    console.error(`Refused: ${where.why}. Only the local development database may be written without --i-am-ops.`);
    process.exitCode = 2;
    return;
  }
  const c = new PrismaClient();
  try {
    console.log(`database: ${where.local ? "local" : "REMOTE"}`);
    if (args.mode === "report") {
      const r = await report(c);
      console.log(`events checked: ${r.events} (demo club events left out: ${r.skippedDemoEvents})`);
      console.log(`events with duplicates: ${r.eventsWithDuplicates}`);
      console.log(`duplicate rows that would be removed: ${r.duplicateRows}`);
      console.log(`clusters that would be refused (ties on more than one row): ${r.refusedClusters}`);
      for (const e of r.perEvent) {
        console.log(`  event ${e.eventId}: clusters ${e.clusters}, rows to remove ${e.dropRows}, refused ${e.refused}`);
        if (e.rowIds.length) console.log(`    rows: ${e.rowIds.join(" ")}`);
      }
      console.log(r.eventsWithDuplicates ? "Report only. Nothing was changed." : "Nothing to do.");
      return;
    }
    const done = await applyEvent(c, args.eventId!);
    console.log(`event ${args.eventId}: clusters merged ${done.merged}, rows deleted ${done.deleted}, clusters refused ${done.refused.length}`);
    for (const r of done.refused) console.log(`  refused: ${r}`);
  } catch (e) {
    if (e instanceof SweepRefusal) {
      console.error(`Refused: ${e.message}`);
      process.exitCode = 2;
    } else {
      throw e;
    }
  } finally {
    await c.$disconnect();
  }
}

if (/sweep-duplicate-players\.(ts|js|mjs|cjs)$/.test(process.argv[1] ?? "")) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : "failed");
    process.exitCode = 1;
  });
}
