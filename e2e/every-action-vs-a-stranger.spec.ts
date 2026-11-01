import { test, expect } from "./coverage";
import { createHmac } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";
import { actionShapes, type ActionShape, type Shape } from "./action-shapes";
import { DbWatch, columnsChanged, type RowChange } from "./db-watch";
import { seed, teardown } from "../scripts/seed-club.mjs";
import { signedInNow } from "../scripts/session-cookie.mjs";

/**
 * EVERY SERVER ACTION, CALLED BY SOMEBODY WHO HAS NO BUSINESS CALLING IT.
 *
 * A `"use server"` export is a public HTTP endpoint (CLAUDE.md): the browser
 * is one caller, and anybody with a cookie and the action's id is another.
 * `audit-idor.test.ts` proves from the source that each action ASKS who is
 * calling. This proves at runtime that the answer is acted on — for every
 * action the build exports, not the ones somebody remembered:
 *
 *   signed out       no cookie at all
 *   a stranger       the Commissioner of ANOTHER club, properly signed in to
 *                    their own tournament — so every role check passes, and
 *                    what is left is the question that matters: are these
 *                    ids yours? — carrying the seeded club's real ids in
 *                    every argument that could be one
 *   a member         a player in the club's live medal, carrying the ids of
 *                    OTHER members' rows in that same tournament — so being
 *                    in the right tournament is not what stops them either
 *
 * and after every single call it asks the DATABASE, not the caller: was any
 * row of the seeded club changed or deleted, or any new row made that points
 * at one? The club's rows are known exactly — they are the rows the seed made.
 * For the member, a row that names them is theirs, and even then only the
 * columns `MAY_CHANGE_OWN` lists are theirs to change.
 *
 * The response is read too: nothing of the club's (its mark, a member's name,
 * one of its ids) may come back to somebody outside it, no member is told
 * another's email address, and no call may hand the caller a session or a
 * tournament that is not theirs.
 *
 * After any call that moved something, the club is PUT BACK to what the seed
 * made, row for row, and checked — so call 900 meets the club call 1 did.
 *
 * A refusal that never ran proves nothing, so the controls are the other half:
 * the same harness, signed in as the club's own secretary, DOES change the
 * club's row; and the stranger's own call DOES change the stranger's own.
 *
 * What it does not do: hold an ASSISTANT to an assistant's limits (that needs
 * the list of what staff who are not the organizer may do), or call the
 * handful of actions that spend the course directory's daily quota, which are
 * named below and counted.
 */

const sign = (v: string) =>
  `${v}.${createHmac("sha256", process.env.AUTH_SECRET ?? "dev-secret").update(v).digest("base64url")}`;

/** Tables every caller writes to, which say nothing about whose data moved. */
const IGNORED_TABLES = new Set([
  // One row per rate-limited call, keyed on the caller's address.
  "RateLimitHit",
]);

/**
 * Actions never called live, with the reason. Each reaches the outside course
 * directory, which allows 500 requests a day (CLAUDE.md, "Course cards") —
 * a sweep that spent it would leave a club unable to import a course.
 */
const SPENDS_THE_DIRECTORY = ["searchDirectory(", "fetchDirectoryCourse(", "fetchLiveDirectoryCourse("];

/**
 * DOORS THAT ARE MEANT TO BE OPEN, each with the reason. A finding is matched
 * on who called, the action and what happened; anything not listed here fails
 * the run.
 */
const OPEN_DOORS: { who: RegExp; action: RegExp; what: RegExp; why: string }[] = [
  {
    who: /./,
    action: /^requestPasswordReset$/,
    what: /^made a PasswordResetToken row pointing at the club/,
    why:
      "Anybody may ask for a reset link for any address — that is what 'forgot password' is. The link goes " +
      "only to that address, only its hash is stored, it lasts fifteen minutes, and asking is limited to five an hour.",
  },
  {
    who: /./,
    action: /^claimPassword$/,
    what: /^made a EmailCode row pointing at the club \(userId\)$/,
    why:
      "Choosing a first password for an invited address is open to whoever types the address, and since 2026-10-21 it " +
      "changes nothing until the address is PROVED: the row holds a code sent only to that address (its hash, bound to " +
      "the person and to the browser that asked), lasting fifteen minutes and five tries, sends limited per address. " +
      "The password typed waits on the row and is applied only when the code comes back in that same browser, so a " +
      "stranger's request can neither sign the stranger in nor set the member's password (services/email-code.ts).",
  },
  {
    who: /^a member/,
    action: /^addExpense$/,
    what: /^made a Expense(Share|Payment) row pointing at the club \(playerId\)$/,
    why:
      "A shared cost names who paid and who shares it — other players, necessarily. Members may add one only where the " +
      "tournament's setting says so; it is on the record under their name, and either party or staff can take it off.",
  },
  {
    who: /^a member/,
    action: /./,
    what: /^made a AuditLog row pointing at the club \(eventId/,
    why:
      "Whatever a member properly does is written in the tournament's record. The line is the trail, not the act: " +
      "what it records is judged on the other rows it moved, which are held to MAY_CHANGE_OWN.",
  },
  {
    who: /^a stranger/,
    action: /^addOrganizationMember$/,
    what: /^was told a club member's name/,
    why:
      "KNOWN, AND FOR AJAY — not a ruling that this is right. An invitation takes effect at once: the person is on the " +
      "inviting club's staff list, which names the people on it, so the inviter now sees the name on an account whose " +
      "address they already held. It stopped being hidden when the invitation stopped RENAMING the account (the worse " +
      "of the two). Closing it properly means an invitation the person accepts before it shows anything; that is a " +
      "product decision, recorded in docs/sweeps-2026-10-10.md.",
  },
  {
    who: /^a stranger/,
    action: /^addOrganizationMember$/,
    what: /^made a OrganizationMember row pointing at the club \(userId\)$/,
    why:
      "Inviting somebody who already has an account onto ANOTHER club's staff is how a person comes to help at two " +
      "clubs. The row is in the inviting club; nothing of the first club's is touched, and the person's name is not " +
      "(what-the-every-action-sweep-found.audit.test.ts).",
  },
];

/**
 * WHAT A MEMBER MAY CHANGE ON A ROW THAT IS THEIR OWN, column by column, each
 * with the reason. "It is their own row" is not enough: a player's entry holds
 * their handicap and whether they have paid, and those are the committee's.
 * Anything a member changes on their own rows that is not listed fails the run.
 */
const MAY_CHANGE_OWN: { what: RegExp; why: string }[] = [
  {
    what: /^Member\.(messagesOptOut|smsOptIn|smsOptInAt|smsOptOutAt|updatedAt)$/,
    why: "Whether somebody is messaged or texted is theirs to say, and nobody else's — the two switches on their own Messages screen.",
  },
  { what: /^ThreadRead \(new\)$/, why: "What they have read, in a conversation they can see." },
  { what: /^Thread \(new\)$/, why: "A conversation they started with somebody in the field." },
  {
    what: /^Player\.playWith$/,
    why: "Who they would like to be drawn with: a request on their own entry, which the organizer's draw may or may not honour.",
  },
  {
    what: /^(Expense|ExpenseShare|ExpensePayment) \(new\)$/,
    why:
      "A shared cost they added, where the tournament's own setting lets members add them (`expenseEntry`); the action refuses when it does not.",
  },
  {
    what: /^Settlement \(deleted\)$/,
    why: "Undoing a settlement they are a party to — staff, whoever recorded it, or either of the two people (`canUndoSettlement`).",
  },
  { what: /^PushSubscription \(new\)$/, why: "Their own device asking for their own notifications." },
  {
    what: /^User\.sessionsValidFrom$/,
    why:
      "Ending their own sign-ins on every other device (`signOutEverywhereAction`, 2026-10-11): the moment before which their own " +
      "cookies stop counting. It is on their own row and ends nobody else's sign-in — a stranger moving it on somebody else's row is " +
      "still a finding, because only a caller's OWN rows are judged against this list.",
  },
];

type Club = Awaited<ReturnType<typeof seed>>;

interface World {
  /** One of the seeded club's row ids, per model that has any. */
  ids: Map<string, string>;
  models: string[];
  email: string;
  freshEmail: string;
  token: string;
  smark: string;
}

interface Pick<T> {
  label: string;
  value: T;
}
type Choose = <T>(slot: string, options: Pick<T>[]) => T;

const SYNONYMS: Record<string, string[]> = {
  round: ["Stage"],
  winner: ["Player"],
  paidby: ["Player"],
  reporter: ["Player", "Account", "User"],
  pot: ["Contest", "SideGame", "SkinsPot"],
  club: ["Organization", "LeagueClub"],
  cluba: ["Organization", "LeagueClub"],
  clubb: ["Organization", "LeagueClub"],
};

/** Which of the club's rows a parameter of this name could be naming. */
function modelsFor(name: string, models: string[]): string[] {
  const base = name.replace(/Input$/, "").replace(/Ids?$/i, "").toLowerCase();
  const named = SYNONYMS[base]?.filter((m) => models.includes(m));
  if (named?.length) return named;
  const exact = models.filter((m) => m.toLowerCase() === base);
  if (exact.length) return exact;
  const part = base ? models.filter((m) => m.toLowerCase().includes(base) || base.includes(m.toLowerCase())) : [];
  // Nobody can tell from the name: try the club's row of every kind.
  return part.length ? part : models;
}

const IS_ID = /(^id$|^ids$|Id$|Ids$|^paidBy$)/;

function plainString(name: string, choose: Choose, w: World): string {
  const n = name.toLowerCase();
  if (/email/.test(n)) {
    return choose("email", [
      { label: "the club member's", value: w.email },
      { label: "a new one", value: w.freshEmail },
    ]);
  }
  if (/token/.test(n)) return w.token;
  if (/password/.test(n)) return "zz-Sweep-pass-91!";
  if (/dataurl/.test(n)) return "data:image/png;base64,iVBORw0KGgo=";
  if (/url|endpoint/.test(n)) return "https://example.invalid/zz";
  if (/^dates$/.test(n)) return "11 Oct 2026";
  if (/date|deadline|opens|(start|end)s?on|occurredon|spenton|expiresat|savedat/.test(n)) return "2026-10-11";
  if (/time/.test(n)) return "09:00";
  if (/csv/.test(n)) return "Name,Handicap\nZz Sweep,12";
  if (/^(pars|yards|strokeindex|holes)$/.test(n)) return "[4,4,4,4,4,4,4,4,4]";
  if (/phone/.test(n)) return "";
  if (/currency/.test(n)) return "USD";
  if (/locale/.test(n)) return "en-US";
  if (/country/.test(n)) return "US";
  if (/handicap/.test(n)) return "12";
  // Named after the argument it fills, so two arguments never get the same
  // words: `renameBet(from, to)` given one name twice answers "ok" before it
  // has asked who is calling, and proves nothing.
  return `${w.smark} ${name}`.slice(0, 38);
}

function numberFor(name: string): number {
  const n = name.toLowerCase();
  if (/cents|amount|stake|fee/.test(n)) return 500;
  if (/strokes|pars/.test(n)) return 4;
  if (/yards/.test(n)) return 400;
  if (/handicap/.test(n)) return 12;
  if (/holes|holecount/.test(n)) return 18;
  if (/slope/.test(n)) return 113;
  if (/rating|^par$/.test(n)) return 72;
  if (/percent|pct/.test(n)) return 50;
  if (/minutes|days/.test(n)) return 7;
  if (/count|capacity|target|bestof|min|max|^n$/.test(n)) return 2;
  return 1;
}

function valueFor(shape: Shape, path: string, choose: Choose, w: World, optionals: boolean): unknown {
  switch (shape.kind) {
    case "string": {
      if (shape.literals) return choose(`one-of:${path}`, shape.literals.map((l) => ({ label: l, value: l })));
      if (IS_ID.test(shape.name)) {
        const options = modelsFor(shape.name, w.models).map((m) => ({ label: m, value: w.ids.get(m)! }));
        return choose(`id:${shape.name}`, options);
      }
      return plainString(shape.name, choose, w);
    }
    case "number":
      return numberFor(shape.name);
    case "boolean":
      return choose(`flag:${path}`, [
        { label: "true", value: true },
        { label: "false", value: false },
      ]);
    case "array":
      return [valueFor(shape.of, path, choose, w, optionals)];
    case "record":
      return { [w.ids.get("Player") ?? "zz"]: valueFor(shape.of, path, choose, w, optionals) };
    case "object":
      return Object.fromEntries(
        shape.props
          .filter((p) => optionals || !p.optional)
          .map((p) => [p.name, valueFor(p.shape, `${path}.${p.name}`, choose, w, optionals)]),
      );
    case "unknown":
      return /typed/i.test(shape.name) ? `${w.smark} sweep` : null;
  }
}

/** The base arguments, then one variant for every other choice there was. */
function argSets(action: ActionShape, w: World, all: boolean): { label: string; args: unknown[] }[] {
  const slots = new Map<string, string[]>();
  const make = (picked: Map<string, number>) => {
    const choose: Choose = (slot, options) => {
      if (!slots.has(slot)) slots.set(slot, options.map((o) => o.label));
      return options[(picked.get(slot) ?? 0) % options.length].value;
    };
    const optionals = choose("optional arguments", [
      { label: "sent", value: true },
      { label: "left out", value: false },
    ]);
    let params = action.params;
    if (!optionals) {
      params = [...params];
      while (params.length && params[params.length - 1].optional) params.pop();
    }
    return params.map((p) => valueFor(p.shape, p.name, choose, w, optionals));
  };
  const sets = [{ label: "", args: make(new Map()) }];
  if (all) {
    for (const [slot, labels] of [...slots]) {
      for (let i = 1; i < labels.length; i++) sets.push({ label: `${slot} = ${labels[i]}`, args: make(new Map([[slot, i]])) });
    }
  }
  const seen = new Set<string>();
  return sets
    .filter((s) => {
      const k = JSON.stringify(s.args);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, 60);
}

interface Answer {
  status: number;
  executed: boolean;
  outcome: "threw" | "refused" | "redirected" | "said ok" | "returned";
  detail: string;
  body: string;
  cookies: string[];
}

async function callAction(base: string, action: ActionShape, args: unknown[], cookie: string): Promise<Answer> {
  let res: Response;
  try {
    res = await fetch(base + action.path, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(45_000),
      headers: {
        "next-action": action.id,
        "content-type": "text/plain;charset=UTF-8",
        accept: "text/x-component",
        origin: base,
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(args),
    });
  } catch (e) {
    return { status: 0, executed: false, outcome: "threw", detail: `no answer: ${String(e).slice(0, 80)}`, body: "", cookies: [] };
  }
  const body = await res.text();
  const redirect = res.headers.get("x-action-redirect");
  const executed = (res.headers.get("content-type") ?? "").includes("text/x-component") || redirect !== null;
  const error = /"error":"((?:[^"\\]|\\.)*)"/.exec(body)?.[1] ?? "";
  const outcome: Answer["outcome"] = redirect
    ? "redirected"
    : /^\d+:E\{/m.test(body)
      ? "threw"
      : /"ok":false/.test(body) || (error && !/"ok":true/.test(body))
        ? "refused"
        : /"ok":true/.test(body)
          ? "said ok"
          : "returned";
  return {
    status: res.status,
    executed,
    outcome,
    detail: redirect ? `to ${redirect.split(";")[0]}` : error.slice(0, 140),
    body,
    cookies: res.headers.getSetCookie?.() ?? [],
  };
}

const prisma = new PrismaClient();
const watch = new DbWatch(prisma, IGNORED_TABLES);

let club: Club;
let clubMark = "";
let smark = "";
/** Every row the seed made, by table — the club, exactly. */
const clubRows = new Map<string, Set<string>>();
/** Every id of the club's, flat, for spotting one inside another row. */
const clubIds = new Set<string>();
/** The club's rows as the seed left them: what a change is measured against, and what it is put back to. */
const clubWas = new Map<string, Record<string, unknown>>();
let memberNames: string[] = [];
let memberEmails: string[] = [];
let world: World;
let shapes: ActionShape[] = [];
let skipped: string[] = [];
/** Every call, appended as it is made — a run is read from here, not from memory. */
const LEDGER = join(process.cwd(), ".e2e", "every-action", "ledger.tsv");
mkdirSync(join(process.cwd(), ".e2e", "every-action"), { recursive: true });

interface Stranger {
  cookie: string;
  userId: string;
  eventId: string;
  orgId: string;
}
let stranger: Stranger;

async function removeStranger() {
  await prisma.event.deleteMany({ where: { name: { startsWith: smark } } });
  await prisma.course.deleteMany({ where: { name: { startsWith: smark } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: smark } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: smark } } });
}

/** Another club, its Commissioner, and the tournament they are signed in to. */
async function makeStranger(): Promise<Stranger> {
  await removeStranger();
  const org = await prisma.organization.create({
    data: {
      name: `${smark}-Elsewhere Golf Society`,
      kind: "community",
      city: "Elsewhere",
      country: "GB",
      currency: "GBP",
      currencySymbol: "£",
      locale: "en-GB",
      themeAppearance: "auto",
      moneyMode: "none",
    },
  });
  const user = await prisma.user.create({
    data: { email: `${smark}-stranger@example.invalid`, name: "S. Tranger", password: "x:unusable" },
  });
  await prisma.organizationMember.create({ data: { organizationId: org.id, userId: user.id, role: "owner" } });
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${smark}-Elsewhere Open`,
      dates: "",
      course: "",
      city: "Elsewhere",
      address: "",
      regDeadline: "",
      shareToken: `${smark}-tok-open`,
    },
  });
  await prisma.account.create({ data: { eventId: event.id, name: user.name, email: user.email, role: "admin" } });
  return {
    cookie: `ng_session=${sign(signedInNow(user.id))}; ng_active_event=${sign(event.id)}`,
    userId: user.id,
    eventId: event.id,
    orgId: org.id,
  };
}

/** Who is calling, and what is theirs. */
interface Actor {
  name: string;
  cookie: () => string;
  /** Every variant of the arguments, or the base set only. */
  all: boolean;
  world: () => World;
  /**
   * Ids and addresses that are this caller's own. A club row carrying one is
   * theirs — and even then only the columns in `MAY_CHANGE_OWN` are theirs to
   * change. Empty for somebody outside the club, who owns none of it.
   */
  own: Set<string>;
  /** The session they hold, for noticing when an answer hands them another. */
  userId: () => string | null;
  /** May this caller be shown the club's names at all? A member may; a stranger may not. */
  inside: boolean;
}

interface Finding {
  who: string;
  action: string;
  args: string;
  what: string;
}

const hasOne = (row: Record<string, unknown> | undefined, ids: Set<string>) =>
  !!row && Object.values(row).some((v) => typeof v === "string" && ids.has(v));

/**
 * A MEMBER'S OWN NEW ENTRY PASSES ONLY AS THE ONE-TAP ENTER MAKES IT (2026-10-30).
 *
 * The sweep offers whichever club tournament comes first, in no fixed order, and when that one is
 * taking entries the member enters it (`enterThisTournament`): the app working. The first fix let
 * every "Player (new)" that named the member through, and the Security & Privacy Lead refused it:
 * that would also pass an entry into a tournament NOT taking entries, or one carrying a handicap
 * the member chose. So the row is held to what Enter writes: a tournament taking entries, the
 * member's own record copied (member, handicap, gender, handicap number), and a status intake
 * gives. Anything else is said, with what differed. Returns "" when it is the one-tap Enter.
 */
function notTheOneTapEntry(row: Record<string, unknown>, actor: Actor): string {
  const event = clubWas.get(`Event/${String(row.eventId)}`);
  if (!event) return "in a tournament the club did not have";
  if (event.registrationOpen !== true && event.registrationOverride !== true) return "in a tournament not taking entries";
  const member = [...clubWas].find(([k, r]) => k.startsWith("Member/") && r.organizationId === event.organizationId && hasOne(r, actor.own))?.[1];
  if (!member) return "with no membership record of theirs behind it";
  const differs: string[] = ["handicap", "gender", "ghin"].filter((c) => row[c] !== member[c]);
  if (row.memberId !== String(member.id ?? "")) differs.unshift("memberId");
  if (differs.length) return `its ${differs.join(", ")} not copied from their membership record`;
  if (!["confirmed", "waitlisted", "pending"].includes(String(row.status))) return `with the status "${String(row.status)}"`;
  return "";
}

/** Everything a call did to the club, read off the rows: what is wrong, and what was the caller's own to do. */
async function whatHappenedToTheClub(changes: RowChange[], actor: Actor): Promise<{ problems: string[]; own: string[] }> {
  const problems: string[] = [];
  const own: string[] = [];
  const say = (mine: boolean, what: string, ownLabel: string) => {
    if (!mine) problems.push(what);
    else if (MAY_CHANGE_OWN.some((m) => m.what.test(ownLabel))) own.push(ownLabel);
    else problems.push(`changed something of their own that is not theirs to change: ${ownLabel}`);
  };
  const byTable = new Map<string, RowChange[]>();
  for (const c of changes) byTable.set(c.table, [...(byTable.get(c.table) ?? []), c]);
  for (const [table, list] of byTable) {
    const mine = clubRows.get(table) ?? new Set<string>();
    const touched = list.filter((c) => c.change !== "added" && mine.has(c.key));
    if (touched.length) {
      const now = await watch.read(table, touched.filter((c) => c.change === "changed").map((c) => c.key));
      for (const c of touched) {
        const was = clubWas.get(`${table}/${c.key}`);
        const theirs = hasOne(was, actor.own) || hasOne(now.get(c.key), actor.own);
        if (c.change === "deleted") {
          say(theirs, `deleted the club's ${table} row`, `${table} (deleted)`);
          continue;
        }
        const columns = columnsChanged(was, now.get(c.key));
        if (theirs) for (const column of columns) say(true, "", `${table}.${column}`);
        else problems.push(`changed the club's ${table} row (${columns.join(", ")})`);
      }
    }
    const added = list.filter((c) => c.change === "added");
    if (added.length) {
      const rows = await watch.read(table, added.map((c) => c.key));
      for (const row of rows.values()) {
        const pointsAt = Object.entries(row).filter(([, v]) => typeof v === "string" && clubIds.has(v));
        if (!pointsAt.length) continue;
        if (table === "Player" && hasOne(row, actor.own)) {
          const why = notTheOneTapEntry(row, actor);
          if (why) problems.push(`made their own entry, but not the one the one-tap Enter makes: ${why}`);
          else own.push("Player (new), the one-tap Enter");
          continue;
        }
        say(hasOne(row, actor.own), `made a ${table} row pointing at the club (${pointsAt.map(([k]) => k).join(", ")})`, `${table} (new)`);
      }
    }
  }
  return { problems: [...new Set(problems)], own: [...new Set(own)] };
}

/**
 * PUT THE CLUB BACK. Each call must meet the club as the seed left it: a
 * member who has just withdrawn is refused everything after for being out of
 * the field, and a sweep that drifts like that tests less with every call
 * while reporting the same count.
 *
 * Only ever the club's own rows — the ones the seed made — and new rows that
 * point at them. Nothing else in the database is touched.
 */
async function restoreClub(changes: RowChange[]): Promise<void> {
  const quoted = (table: string) => `"${table}"`;
  const lost: { table: string; key: string }[] = [];
  const altered: { table: string; key: string }[] = [];
  for (const c of changes) {
    const mine = clubRows.get(c.table)?.has(c.key) ?? false;
    if (c.change === "added") {
      const row = (await watch.read(c.table, [c.key])).get(c.key);
      if (row && hasOne(row, clubIds) && typeof row.id === "string") {
        await prisma.$executeRawUnsafe(`delete from ${quoted(c.table)} where id = $1`, row.id).catch(() => {});
      }
    } else if (mine && c.change === "deleted") lost.push(c);
    else if (mine) altered.push(c);
  }
  // A row comes back only after the row it hangs from, so go round until
  // every one is in or a whole pass adds nothing.
  let waiting = lost;
  for (let pass = 0; pass < 8 && waiting.length; pass++) {
    const still: typeof lost = [];
    for (const c of waiting) {
      const was = clubWas.get(`${c.table}/${c.key}`);
      const ok = await prisma
        .$executeRawUnsafe(
          `insert into ${quoted(c.table)} select * from jsonb_populate_record(null::${quoted(c.table)}, $1::jsonb)`,
          JSON.stringify(was),
        )
        .then(() => true)
        .catch(() => false);
      if (!ok) still.push(c);
    }
    if (still.length === waiting.length) break;
    waiting = still;
  }
  for (const c of altered) {
    const was = clubWas.get(`${c.table}/${c.key}`);
    if (!was) continue;
    const columns = Object.keys(was).filter((k) => k !== "id");
    await prisma.$executeRawUnsafe(
      `update ${quoted(c.table)} t set ${columns.map((k) => `"${k}" = r."${k}"`).join(", ")}
         from jsonb_populate_record(null::${quoted(c.table)}, $1::jsonb) r where t.id = $2`,
      JSON.stringify(was),
      c.key,
    );
  }
  // And look: a restore that did not restore would let every later call run
  // against a club nobody chose.
  await watch.absorb();
  const tables = new Map<string, string[]>();
  for (const c of [...lost, ...altered]) tables.set(c.table, [...(tables.get(c.table) ?? []), c.key]);
  for (const [table, keys] of tables) {
    const now = await watch.read(table, keys);
    for (const key of keys) {
      if (JSON.stringify(now.get(key)) !== JSON.stringify(clubWas.get(`${table}/${key}`))) {
        throw new Error(`could not put the club's ${table} row back as it was — the sweep stops rather than run on a changed club`);
      }
    }
  }
}

/** Anything in an answer the caller should not have been given, once what they sent is taken out. */
function whatTheAnswerGaveAway(answer: Answer, args: unknown[], actor: Actor): string[] {
  const found: string[] = [];
  let body = answer.body;
  const sent: string[] = [];
  const collect = (v: unknown) => {
    if (typeof v === "string" && v.length > 3) sent.push(v);
    else if (Array.isArray(v)) v.forEach(collect);
    else if (v && typeof v === "object") Object.entries(v).forEach(([k, x]) => (collect(k), collect(x)));
  };
  collect(args);
  for (const s of sent.sort((a, b) => b.length - a.length)) body = body.split(s).join("");
  if (!actor.inside) {
    if (body.includes(clubMark)) {
      const at = body.indexOf(clubMark);
      found.push(`was told something of the club's: …${body.slice(Math.max(0, at - 40), at + 80).replace(/\s+/g, " ")}…`);
    }
    const named = memberNames.find((n) => body.includes(n));
    if (named) found.push(`was told a club member's name (${named})`);
    const id = [...(body.match(/[A-Za-z0-9_-]{20,}/g) ?? [])].find((t) => clubIds.has(t));
    if (id) found.push("was given one of the club's ids");
  } else {
    // A member sees the club. What one member is not shown is another's address.
    const address = memberEmails.find((e) => !actor.own.has(e) && body.includes(e));
    if (address) found.push("was told another member's email address");
  }
  for (const c of answer.cookies) {
    const m = /^(ng_session|ng_active_event|ng_play)=([^.;]+)/.exec(c);
    if (!m || !m[2]) continue;
    // A session value is "<user id>~<when>"; the other two cookies are an id alone.
    const value = decodeURIComponent(m[2]).split("~")[0];
    if (!actor.inside && clubIds.has(value)) found.push(`was handed a ${m[1]} cookie for the club`);
    else if (m[1] === "ng_session" && actor.userId() && value !== actor.userId()) found.push("was handed somebody else's session");
  }
  return found;
}

function summary(args: unknown[]): string {
  return JSON.stringify(args)
    .replace(/[a-z0-9]{24,}/g, (id) => (clubIds.has(id) ? "<club id>" : "<id>"))
    .slice(0, 160);
}

async function sweep(base: string, actor: Actor, findings: Finding[]) {
  const outcomes: Record<string, number> = {};
  const ownChanges = new Map<string, Set<string>>();
  let calls = 0;
  let notExecuted = 0;
  for (const action of shapes) {
    for (const set of argSets(action, actor.world(), actor.all)) {
      const answer = await callAction(base, action, set.args, actor.cookie());
      calls += 1;
      if (!answer.executed) notExecuted += 1;
      outcomes[answer.outcome] = (outcomes[answer.outcome] ?? 0) + 1;
      const changes = await watch.absorb();
      const did = await whatHappenedToTheClub(changes, actor);
      const problems = [...did.problems, ...whatTheAnswerGaveAway(answer, set.args, actor)];
      for (const o of did.own) ownChanges.set(o, (ownChanges.get(o) ?? new Set()).add(action.name));
      // One line a call, written as it happens: who, the action, which variant
      // of its arguments, the status, what it answered, how many rows moved
      // anywhere, what was wrong, what was the caller's own, and the arguments.
      appendFileSync(
        LEDGER,
        [actor.name, action.name, set.label, answer.status, answer.executed ? answer.outcome : "NOT RUN", answer.detail, changes.length, problems.join("; "), did.own.join("; "), summary(set.args)].join("\t") + "\n",
      );
      for (const what of problems) {
        const open = OPEN_DOORS.some((d) => d.who.test(actor.name) && d.action.test(action.name) && d.what.test(what));
        if (!open) findings.push({ who: actor.name, action: action.name, args: `${set.label ? `[${set.label}] ` : ""}${summary(set.args)}`, what });
      }
      if (changes.length) {
        await restoreClub(changes);
        // The stranger's own tournament may properly have changed too —
        // launched, deleted, filled — and each call must meet the same one.
        stranger = await makeStranger();
        await watch.absorb();
      }
    }
  }
  return { calls, notExecuted, outcomes, ownChanges };
}

// Not `serial`: every caller is swept even when an earlier one found something.
// A failure starts a fresh worker, so `beforeAll` seeds the club again for the
// next caller — which is what the next caller should meet anyway.
test.beforeAll(async () => {
  if (!process.env.E2E_EVERYTHING) return;
  await watch.start();
  const before = watch.keys();
  club = await seed();
  await watch.absorb();
  for (const [table, keys] of watch.keys()) {
    const was = before.get(table) ?? new Set<string>();
    const mine = new Set([...keys].filter((k) => !was.has(k)));
    if (mine.size) clubRows.set(table, mine);
    for (const k of mine) clubIds.add(k);
  }
  for (const [table, keys] of clubRows) {
    for (const [k, row] of await watch.read(table, [...keys])) clubWas.set(`${table}/${k}`, row);
  }
  clubMark = club.shareTokens.medal.replace(/-tok-.*$/, "");
  smark = clubMark.replace(/^zz-club/, "zz-sec");
  const members = await prisma.member.findMany({ where: { organizationId: club.org.id }, select: { name: true, email: true } });
  // A name the public landing page prints itself is not a secret of the club's:
  // its product pictures are captioned with the demo club's own people.
  const landing = await (await fetch(`http://localhost:${process.env.E2E_PORT ?? 3101}/`)).text();
  memberNames = members
    .map((m) => m.name)
    .filter((n) => n.trim().split(/\s+/).length >= 2)
    .filter((n) => !landing.includes(n));
  memberEmails = members.map((m) => m.email).filter(Boolean);

  const models = Prisma.dmmf.datamodel.models.map((m) => m.name).filter((m) => clubRows.has(m));
  world = {
    ids: new Map(models.map((m) => [m, [...clubRows.get(m)!][0]])),
    models,
    email: club.player.email,
    freshEmail: `${smark}-new@example.invalid`,
    token: club.shareTokens.medal,
    smark,
  };

  const all = actionShapes();
  const courses = readFileSync(join(process.cwd(), "src", "app", "actions", "courses.ts"), "utf8");
  const spends = new Set(
    courses
      .split(/^export async function /m)
      .slice(1)
      .filter((body) => SPENDS_THE_DIRECTORY.some((call) => body.includes(call)))
      .map((body) => /^\w+/.exec(body)![0]),
  );
  skipped = all.filter((a) => a.file.endsWith("actions/courses.ts") && spends.has(a.name)).map((a) => a.name);
  shapes = all.filter((a) => !skipped.includes(a.name));

  stranger = await makeStranger();
  await watch.absorb();
});

test.afterAll(async () => {
  if (process.env.E2E_EVERYTHING) {
    await removeStranger();
    await teardown();
  }
  await prisma.$disconnect();
});

function report(actor: Actor, findings: Finding[], ran: Awaited<ReturnType<typeof sweep>>) {
  console.log(
    `[every-action] ${actor.name}: ${shapes.length} of ${shapes.length + skipped.length} actions, ${ran.calls} calls, ` +
      `${ran.notExecuted} never reached the action, ${findings.length} findings — ${JSON.stringify(ran.outcomes)}`,
  );
  for (const [what, actions] of [...ran.ownChanges].sort()) {
    console.log(`[every-action]   ${actor.name} changed their own ${what} through: ${[...actions].sort().join(", ")}`);
  }
  expect(
    findings.map((f) => `${f.who} ${f.action} ${f.args} — ${f.what}`),
    `${findings.length} findings across ${ran.calls} calls`,
  ).toEqual([]);
  // CONTROL: a call that was turned away before it reached the action (a
  // sign-in redirect, a wrong address) proves nothing about the action.
  expect(ran.notExecuted, "calls that never reached their action").toBe(0);
}

const ON_REQUEST = "the every-action sweep runs on request, once";

test("the fixture is what the sweep thinks it is", async ({ baseURL }, testInfo) => {
  test.skip(!process.env.E2E_EVERYTHING || testInfo.project.name !== "desktop", ON_REQUEST);
  expect(baseURL, "no server to call").toBeTruthy();
  // CONTROLS on the instrument, before any of its verdicts are read.
  expect(shapes.length + skipped.length, "the build exports fewer actions than it did").toBeGreaterThanOrEqual(263);
  expect(shapes.filter((a) => !a.known).map((a) => a.name), "actions whose source could not be read").toEqual([]);
  expect(skipped.sort(), "the actions kept off the outside course directory").toEqual(
    expect.arrayContaining(["importCourseFromDirectory", "searchCourseDirectory"]),
  );
  expect(skipped.length, "more actions are being kept out of the sweep than reach the directory").toBeLessThanOrEqual(6);
  // The club is known row by row, and is the size of a club.
  expect(clubRows.get("Event")?.size ?? 0).toBeGreaterThanOrEqual(11);
  expect(clubRows.get("Player")?.size ?? 0).toBeGreaterThan(50);
  expect(clubIds.has(stranger.eventId), "the stranger was counted as part of the club").toBe(false);
  for (const model of ["Event", "Stage", "Player", "Scorecard", "Match", "Group", "Team", "Course", "Member", "Account", "Organization"]) {
    expect(world.ids.get(model), `no ${model} of the club's to offer as an argument`).toBeTruthy();
  }
  console.log(
    `[every-action] watching ${watch.rowCount} rows in ${watch.tableCount} tables; the club is ${clubIds.size} rows in ${clubRows.size} tables; ` +
      `kept out of the sweep: ${skipped.join(", ")}`,
  );
});

test("signed out, every action is refused and nothing of the club's moves", async ({ baseURL }, testInfo) => {
  test.skip(!process.env.E2E_EVERYTHING || testInfo.project.name !== "desktop", ON_REQUEST);
  test.setTimeout(1_800_000);
  const actor: Actor = { name: "signed out", cookie: () => "", all: false, world: () => world, own: new Set(), userId: () => null, inside: false };
  const findings: Finding[] = [];
  report(actor, findings, await sweep(baseURL!, actor, findings));
});

test("the Commissioner of another club, carrying this club's ids, changes nothing of this club's", async ({ baseURL }, testInfo) => {
  test.skip(!process.env.E2E_EVERYTHING || testInfo.project.name !== "desktop", ON_REQUEST);
  test.setTimeout(5_400_000);
  const actor: Actor = {
    name: "a stranger",
    cookie: () => stranger.cookie,
    all: true,
    world: () => world,
    own: new Set(),
    userId: () => stranger.userId,
    inside: false,
  };
  const findings: Finding[] = [];
  report(actor, findings, await sweep(baseURL!, actor, findings));
});

test("a member of the club, pointing at other members' rows, changes only what is theirs", async ({ baseURL }, testInfo) => {
  test.skip(!process.env.E2E_EVERYTHING || testInfo.project.name !== "desktop", ON_REQUEST);
  test.setTimeout(5_400_000);
  // A session is "<user id>~<when>.<signature>".
  const userId = club.player.session.split(".")[0].split("~")[0];
  const email = club.player.email;
  // Everything that is this member's: their login, and every row that names
  // them — an entry in a tournament, their line on the roster, their account.
  const own = new Set<string>([userId, email]);
  for (const [key, row] of clubWas) {
    if (row.email === email || row.userId === userId) own.add(key.split("/")[1]);
  }
  expect(own.size, "the member owns nothing in the club — the fixture changed").toBeGreaterThan(4);

  // TWO TOURNAMENTS, because a rule about matches cannot be broken in a
  // tournament that has none: the live medal, and the first tournament the
  // member is entered in that has matches — where "somebody else's match" is
  // a row of the tournament they are signed in to, and only whose it is stops
  // them. The first run was the medal alone and could not reach that at all.
  const enteredIn = new Set(
    [...clubWas].filter(([k, row]) => k.startsWith("Player/") && row.email === email).map(([, row]) => row.eventId as string),
  );
  const withMatches = new Set([...clubWas].filter(([k]) => k.startsWith("Match/")).map(([, row]) => row.eventId as string));
  const medal = club.events.find((e) => e.slug === "medal")!;
  const matchPlay = club.events.find((e) => enteredIn.has(e.id) && withMatches.has(e.id));
  expect(enteredIn.has(medal.id), "the member is not entered in the live medal").toBe(true);
  expect(matchPlay, "the member is in no tournament with matches — the fixture cannot reach a match they are not in").toBeTruthy();

  const findings: Finding[] = [];
  for (const event of [medal, matchPlay!]) {
    // Somebody else's rows, from the tournament this member is signed in to —
    // so that being in the right tournament is not what stops them.
    const others = new Map<string, string>();
    for (const model of world.models) {
      const rows = [...clubRows.get(model)!].map((k) => ({ k, row: clubWas.get(`${model}/${k}`) }));
      // A tournament the member is entered in is theirs to withdraw from, not somebody else's.
      // The row watcher reads Event with no order, so on a database refilled by earlier tests the
      // first "other" tournament was one the member had entered: round G391 (1 Nov) counted their
      // own withdrawal as a finding, while a local run picked a closed one and passed.
      const notMine = rows.filter((r) => !own.has(r.k) && !hasOne(r.row, own) && !(model === "Event" && enteredIn.has(r.k)));
      if (model === "Event") expect(notMine.length, "every club tournament is one the member is in — the fixture cannot offer somebody else's").toBeGreaterThan(0);
      const pick = notMine.find((r) => r.row?.eventId === event.id) ?? notMine[0] ?? rows[0];
      others.set(model, pick.k);
    }
    expect(own.has(others.get("Player")!), "the player offered as somebody else is the member").toBe(false);
    const inside: World = { ...world, ids: others, email: memberEmails.find((e) => e !== email) ?? email };
    const actor: Actor = {
      name: `a member (${event.slug})`,
      cookie: () => `ng_session=${club.player.session}; ng_active_event=${sign(event.id)}`,
      all: true,
      world: () => inside,
      own,
      userId: () => userId,
      inside: true,
    };
    const ran = await sweep(baseURL!, actor, findings);
    console.log(
      `[every-action] ${actor.name}: ${shapes.length} of ${shapes.length + skipped.length} actions, ${ran.calls} calls, ` +
        `${ran.notExecuted} never reached the action — ${JSON.stringify(ran.outcomes)}`,
    );
    for (const [what, actions] of [...ran.ownChanges].sort()) {
      console.log(`[every-action]   ${actor.name} changed their own ${what} through: ${[...actions].sort().join(", ")}`);
    }
    expect(ran.notExecuted, "calls that never reached their action").toBe(0);
  }
  expect(
    findings.map((f) => `${f.who} ${f.action} ${f.args} — ${f.what}`),
    `${findings.length} findings as a member`,
  ).toEqual([]);
});

test("CONTROL: the same calls DO land for somebody entitled to make them", async ({ baseURL }, testInfo) => {
  test.skip(!process.env.E2E_EVERYTHING || testInfo.project.name !== "desktop", ON_REQUEST);
  test.setTimeout(120_000);
  const invite = shapes.find((a) => a.name === "setInviteMessage");
  expect(invite, "the control's action is gone — pick another that writes one known column").toBeTruthy();
  const nobody: Actor = { name: "control", cookie: () => "", all: false, world: () => world, own: new Set(), userId: () => null, inside: false };

  // The stranger's own tournament, by the stranger: their row changes.
  stranger = await makeStranger();
  await watch.absorb();
  let answer = await callAction(baseURL!, invite!, [`${smark} control`], stranger.cookie);
  let changes = await watch.absorb();
  expect(answer.executed).toBe(true);
  expect(
    changes.filter((c) => c.table === "Event" && c.key === stranger.eventId && c.change === "changed"),
    "the stranger could not change their OWN tournament — every refusal above may be a dead session",
  ).toHaveLength(1);
  expect((await whatHappenedToTheClub(changes, nobody)).problems).toEqual([]);

  // The club's tournament, by the club's secretary: the club's row changes,
  // and the watcher says so in the words a finding would use.
  const medal = club.events.find((e) => e.slug === "medal")!;
  const secretary = `ng_session=${club.organizer.session}; ng_active_event=${sign(medal.id)}`;
  answer = await callAction(baseURL!, invite!, [`${smark} control`], secretary);
  changes = await watch.absorb();
  expect(answer.executed).toBe(true);
  const seen = (await whatHappenedToTheClub(changes, nobody)).problems;
  expect(seen, "the watcher cannot see a change to the club when one is made").toHaveLength(1);
  // The column, whatever else the save stamped beside it (an updated-at).
  expect(seen[0]).toContain("changed the club's Event row (inviteMessage");

  // And it can be put back, which every call above relied on.
  await restoreClub(changes);
  const back = await prisma.event.findUnique({ where: { id: medal.id }, select: { inviteMessage: true } });
  expect(back?.inviteMessage, "the club's row was not put back").toBe(clubWas.get(`Event/${medal.id}`)?.inviteMessage);
});
