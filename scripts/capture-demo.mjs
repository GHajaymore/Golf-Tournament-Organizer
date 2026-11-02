/**
 * UNEDITED CAPTURES OF THE APP RUNNING AN INVENTED CLUB, FOR THE FRONT DOOR AND THE REELS.
 *
 *   PATH="/c/Program Files/nodejs:$PATH"
 *   node --env-file=.env scripts/capture-demo.mjs [output folder] [--only=name,name] [--keep-text]
 *
 * Against the dev server on http://localhost:3100 (CAPTURE_BASE_URL to change it), which must be
 * this worktree's. The output folder defaults to <tmp>/tourneyhq-demo-shots; it gets one PNG per
 * capture and a `text/` folder holding each screen's words, so a capture can be checked without
 * opening it. `node scripts/place-landing-shots.mjs <folder>` then puts the named ones on the page.
 *
 * WHAT IT DOES, IN ORDER — and the last two always run:
 *
 *   1. counts every table's rows, so the end can prove nothing outside the fixture moved;
 *   2. seeds the club (`scripts/seed-club.mjs`, dev database only), in the US unless E2E_CLUB says;
 *   3. DRESSES it: every display string carrying the fixture mark has the mark taken off, the club
 *      is renamed to a plain one, and a few things the captures need and the seed lacks are added
 *      (a long drive with a winner). Every value it overwrites is written first to a journal file
 *      in the output folder;
 *   4. captures each screen, signed in as the member or the secretary with `signedInNow`, at the
 *      landing's geometry: phones 393x852 at three device pixels to one, the laptop 1440x900 at two;
 *   5. puts every journalled value back, then tears the club down with seed-club's own `teardown()`
 *      and deletes by id whatever that misses;
 *   6. counts again, and says which tables differ.
 *
 * WHY THE MARK COMES OFF, AND WHY IT GOES BACK. The fixture marks every row `zz-club-…` so a
 * teardown can find it and nobody mistakes it for a real club — and a picture on the front door
 * must not carry it. So the captured club has clean, invented names for the length of the run.
 * Teardown finds rows BY that mark, so the mark is restored before it runs; and if a run is killed
 * between the two, the journal is still on disk and the next run restores it before doing anything.
 *
 * THE "WORLD" VARIANTS are the same club in another country: its name, currency and locale, the
 * amounts entered in that currency (the seed's figures scaled to what a round costs there, as a
 * club there would have typed them), and the members renamed from an invented list for that
 * country. Nothing on the screen is painted on afterwards; the app draws every figure.
 *
 * Invented people only, `@example.invalid` addresses, and it refuses any database that is not on
 * this machine. Hard rules 1 and 2.
 */
import { PrismaClient } from "@prisma/client";
import { createHmac } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const require = createRequire(import.meta.url);

/* ------------------------------------------------------------------ guards */

function refuseNonLocal() {
  const url = process.env.DATABASE_URL ?? "";
  if (!url) throw new Error("No DATABASE_URL — run with --env-file=.env");
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    throw new Error("DATABASE_URL is not a URL this script can read the host from. Refusing.");
  }
  if (!(host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]")) {
    throw new Error(`Refusing to touch a database at "${host}" — development database only (hard rule 1).`);
  }
}
refuseNonLocal();

const BASE = process.env.CAPTURE_BASE_URL ?? "http://localhost:3100";
{
  const h = new URL(BASE).hostname;
  if (!(h === "localhost" || h === "127.0.0.1")) throw new Error(`Refusing to capture from ${BASE}: local dev server only.`);
}

const args = process.argv.slice(2);
const OUT = args.find((a) => !a.startsWith("--")) ?? join(tmpdir(), "tourneyhq-demo-shots");
const ONLY = (args.find((a) => a.startsWith("--only=")) ?? "").slice(7).split(",").filter(Boolean);
/**
 * --landing: shoot the FRONT DOOR's screens, as `src/lib/landing/screens.ts` lists them (the one
 * manifest), and the hero's live moment in its order — before, the press, after. Without it, the
 * reel shots below. `npm run landing:capture` runs this and then the placing script.
 */
const LANDING = args.includes("--landing");
const { SCREENS, LIVE_MOMENT, VIEWPORTS } = await import("../src/lib/landing/screens.ts");
const TEXT = join(OUT, "text");
const JOURNAL = join(OUT, ".capture-demo-journal.json");
mkdirSync(TEXT, { recursive: true });

// The country decides the seed's currency and date words, and is read when seed-club is imported.
process.env.E2E_CLUB ??= "us";
const { seed, teardown } = await import("./seed-club.mjs");
const { runMark } = await import("./run-mark.mjs");
const { signedInNow } = await import("./session-cookie.mjs");
const MARK = runMark("zz-club");

/** The app's own signing scheme (src/lib/auth.ts), with the secret the dev server holds. */
const sign = (v) => `${v}.${createHmac("sha256", process.env.AUTH_SECRET ?? "dev-secret").update(v).digest("base64url")}`;

const prisma = new PrismaClient();

/* ------------------------------------------------------------- the census */

/** Every table's row count — the before and after that prove the run left nothing behind. */
async function census() {
  const tables = await prisma.$queryRawUnsafe(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> '_prisma_migrations' ORDER BY table_name`,
  );
  const out = {};
  for (const { table_name } of tables) {
    const [{ n }] = await prisma.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "${table_name}"`);
    out[table_name] = n;
  }
  return out;
}

/** Text columns of every table that has an `id`, for finding the mark wherever a display string holds it. */
async function textColumns() {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT c.table_name, c.column_name FROM information_schema.columns c
     WHERE c.table_schema = 'public' AND c.data_type IN ('text', 'character varying')
       AND EXISTS (SELECT 1 FROM information_schema.columns k WHERE k.table_schema = 'public' AND k.table_name = c.table_name AND k.column_name = 'id')`,
  );
  return rows.filter((r) => r.table_name !== "_prisma_migrations");
}

/** Rows (in any table) still carrying the mark — zero after a clean teardown. */
async function markedRows() {
  let total = 0;
  const where = {};
  for (const { table_name, column_name } of await textColumns()) {
    const [{ n }] = await prisma.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM "${table_name}" WHERE "${column_name}" LIKE $1`,
      `%${MARK}%`,
    );
    if (n) {
      total += n;
      where[`${table_name}.${column_name}`] = n;
    }
  }
  return { total, where };
}

/* ------------------------------------------------------------- the journal */

/**
 * Every value this script overwrites, keyed table/id/column, holding the value as SEEDED.
 * Only the first overwrite of a cell is recorded, so a second costume never journals the first.
 */
let journal = {};
const key = (t, id, c) => `${t}\u0000${id}\u0000${c}`;
const saveJournal = () => writeFileSync(JOURNAL, JSON.stringify(journal));

async function setCell(table, id, column, value) {
  const k = key(table, id, column);
  if (!(k in journal)) {
    const [row] = await prisma.$queryRawUnsafe(`SELECT "${column}" AS v FROM "${table}" WHERE id = $1`, id);
    if (!row) return;
    journal[k] = row.v;
    saveJournal();
  }
  await prisma.$executeRawUnsafe(`UPDATE "${table}" SET "${column}" = $1 WHERE id = $2`, value, id);
}

/** The value a cell was seeded with, whether or not it has been overwritten since. */
async function seededValue(table, id, column) {
  const k = key(table, id, column);
  if (k in journal) return journal[k];
  const [row] = await prisma.$queryRawUnsafe(`SELECT "${column}" AS v FROM "${table}" WHERE id = $1`, id);
  return row?.v;
}

async function restoreJournal(from = journal) {
  let n = 0;
  for (const [k, v] of Object.entries(from)) {
    const [table, id, column] = k.split("\u0000");
    n += await prisma.$executeRawUnsafe(`UPDATE "${table}" SET "${column}" = $1 WHERE id = $2`, v, id);
  }
  return n;
}

/* ----------------------------------------------------------- the dressing */

/** Columns that are addresses or keys rather than words on a screen: the mark stays on these. */
const KEEP_MARK = /email|token|password|secret|^id$|Id$/i;

/** Take the mark off every display string of the club's rows. Teardown needs it back: see the journal. */
async function stripMarks() {
  let n = 0;
  for (const { table_name, column_name } of await textColumns()) {
    if (KEEP_MARK.test(column_name)) continue;
    const rows = await prisma.$queryRawUnsafe(
      `SELECT id, "${column_name}" AS v FROM "${table_name}" WHERE "${column_name}" LIKE $1`,
      `%${MARK}%`,
    );
    for (const { id, v } of rows) {
      let clean = v.split(`${MARK}-`).join("").split(`${MARK} `).join("").split(MARK).join("");
      // "zz-club-… halfway house" was a sentence once the mark is read as its first word.
      if (v.startsWith(`${MARK} `)) clean = clean.charAt(0).toUpperCase() + clean.slice(1);
      await setCell(table_name, id, column_name, clean);
      n += 1;
    }
  }
  return n;
}

/**
 * The country costumes. `scale` is what a figure the seed entered in its own currency becomes when
 * a club there enters the same thing — a buggy, a dinner, a stake — rounded to a whole unit, as
 * people type it. `names` replaces the roster in order; index 0 is the member signed in.
 */
const COSTUMES = {
  us: {
    club: "Braid Hollow Golf Club",
    place: { country: "US", currency: "USD", currencySymbol: "$", locale: "en-US", city: "Carmel" },
    scale: 1,
    events: { medal: "October Stroke Play", team: "Members’ Four-Ball Weekend" },
    names: [
      "Ben Carter", "Luca Rossi", "Mei Tanaka", "Tom Reid", "Luis Ortiz", "Grace Kim",
      "Sam Whitaker", "Nina Patel", "Jack Morrow", "Ava Lindgren", "Owen Brooks", "Chloe Diaz",
      "Eli Novak", "Maya Fischer", "Ryan Doyle", "Zoe Hart", "Marcus Bell", "Hana Sato",
      "Caleb Ford", "Ruby Lang", "Theo Grant", "Ivy Chen", "Noah Walsh", "Lily Moreno",
      "Dylan Price", "Emma Stroud", "Kai Turner", "Sofia Reyes", "Max Keller", "Isla Ward",
      "Leo Hayes", "Nora Quinn", "Finn Adler", "Jade Russo", "Cole Mercer", "Tess Nolan",
    ],
  },
  gbp: {
    club: "Ashcombe Heath Golf Club",
    place: { country: "GB", currency: "GBP", currencySymbol: "£", locale: "en-GB", city: "Ashcombe" },
    scale: 0.8,
    events: { medal: "October Medal", team: "Members’ Four-Ball Weekend" },
    names: [
      "Oliver Hartley", "Emma Clarke", "James Whitfield", "Sophie Marsh", "Harry Pembroke", "Wilf Marsh",
      "Charlotte Ainsley", "George Fenwick", "Amelia Thorne", "Paolo Greco", "Isla Fairbairn", "Jack Rowntree",
      "Marek Nowak", "Lucy Brampton", "Thomas Kerridge", "Grace Holloway", "Alfie Dunmore", "Poppy Lindley",
      "Ewan McCrae", "Hannah Stroud", "Callum Byrne", "Ruby Ashworth", "Fraser Lyle", "Molly Treharne",
      "Samuel Oakes", "Freya Collingwood", "Rory Gilchrist", "Evie Sandford", "Hugh Penrose", "Daisy Wetherall",
      "Angus Bell", "Imogen Royle", "Dominic Haig", "Phoebe Larch", "Toby Rendell", "Maisie Corbett",
    ],
  },
  eur: {
    club: "Glenmore Abbey Golf Club",
    place: { country: "IE", currency: "EUR", currencySymbol: "€", locale: "en-IE", city: "Kilkenny" },
    scale: 1,
    events: { medal: "October Medal", team: "Members’ Four-Ball Weekend" },
    names: [
      "Ciarán Doyle", "Aoife Brennan", "Lukas Becker", "Niamh Gallagher", "Matteo Conti", "Sinéad Walsh",
      "Pierre Lefèvre", "Clara Jansen", "Eoin Fitzgerald", "Lena Hoffmann", "Dara Kinsella", "Sofia Marino",
      "Tomás Ryan", "Elise Dubois", "Cathal Moran", "Anja Vogel", "Fionn Daly", "Marta Ruiz",
      "Declan Furlong", "Inès Moreau", "Oisín Kehoe", "Greta Bauer", "Seán Lynch", "Chiara Ricci",
      "Rónán Hayes", "Maud Peeters", "Colm Nolan", "Ingrid Larsen", "Padraic Byrne", "Leonie Weber",
      "Cian Murphy", "Eva Novak", "Brendan Kiely", "Saoirse Quinn", "Hugo Martens", "Orla Phelan",
    ],
  },
  zar: {
    club: "Simonsberg Golf Club",
    place: { country: "ZA", currency: "ZAR", currencySymbol: "R", locale: "en-ZA", city: "Stellenbosch" },
    scale: 12,
    events: { medal: "October Medal", team: "Members’ Four-Ball Weekend" },
    names: [
      "Pieter van Wyk", "Thandi Nkosi", "Johan Botha", "Lerato Mokoena", "Sipho Dlamini", "Anika du Plessis",
      "Kagiso Molefe", "Marike Joubert", "Themba Khumalo", "Ruan Pretorius", "Naledi Sithole", "Jaco Steyn",
      "Zanele Ndlovu", "Francois Venter", "Bongani Zulu", "Liezel Nel", "Tshepo Mahlangu", "Carla Fourie",
      "Mandla Cele", "Elmarie Kruger", "Lwazi Mthembu", "Henk Coetzee", "Palesa Radebe", "Dirk Marais",
      "Ayanda Shabalala", "Wilna Swart", "Sizwe Ngcobo", "Riaan Visser", "Nomsa Mabaso", "Chris Olivier",
      "Busisiwe Hadebe", "Gert Erasmus", "Kabelo Tau", "Annelie Smit", "Vusi Mkhize", "Tanya Roux",
    ],
  },
  inr: {
    club: "Deccan Hills Golf Club",
    place: { country: "IN", currency: "INR", currencySymbol: "₹", locale: "en-IN", city: "Pune" },
    scale: 40,
    events: { medal: "October Medal", team: "Members’ Four-Ball Weekend" },
    names: [
      "Vikram Rao", "Aditya Jain", "Rohan Kapoor", "Shreya Sen", "Sara Thomas", "Kenji Ito",
      "Deepak Sood", "Arjun Mehta", "Ananya Iyer", "Karan Malhotra", "Priya Nair", "Siddharth Bose",
      "Meera Pillai", "Rahul Desai", "Kavya Reddy", "Nikhil Joshi", "Ishita Ghosh", "Varun Chopra",
      "Tara Menon", "Aman Bhatia", "Nisha Kulkarni", "Harsh Agarwal", "Pooja Shetty", "Manish Gupta",
      "Riya Banerjee", "Sameer Khan", "Divya Krishnan", "Abhay Saxena", "Neha Verma", "Yash Patil",
      "Lakshmi Rao", "Kunal Shah", "Aditi Mishra", "Rajiv Bhat", "Sneha Kaur", "Omar Siddiqui",
    ],
  },
};

/** Money columns the seed fills in its own currency, scaled per costume from the SEEDED value. */
const MONEY_COLUMNS = [
  ["Expense", "amountCents"],
  ["ExpensePayment", "amountCents"],
  ["Settlement", "cents"],
  ["Settlement", "owedCents"],
  ["SkinsPot", "buyInCents"],
  ["SideGame", "buyInCents"],
  ["Contest", "buyInCents"],
];

/** Rows of a table belonging to the club's events. */
async function clubRows(table, orgId) {
  const joins = {
    Expense: `SELECT x.id FROM "Expense" x JOIN "Event" e ON e.id = x."eventId" WHERE e."organizationId" = $1`,
    ExpensePayment: `SELECT p.id FROM "ExpensePayment" p JOIN "Expense" x ON x.id = p."expenseId" JOIN "Event" e ON e.id = x."eventId" WHERE e."organizationId" = $1`,
    Settlement: `SELECT s.id FROM "Settlement" s JOIN "Event" e ON e.id = s."eventId" WHERE e."organizationId" = $1`,
    SkinsPot: `SELECT s.id FROM "SkinsPot" s JOIN "Event" e ON e.id = s."eventId" WHERE e."organizationId" = $1`,
    SideGame: `SELECT s.id FROM "SideGame" s JOIN "Event" e ON e.id = s."eventId" WHERE e."organizationId" = $1`,
    Contest: `SELECT s.id FROM "Contest" s JOIN "Event" e ON e.id = s."eventId" WHERE e."organizationId" = $1`,
  };
  return (await prisma.$queryRawUnsafe(joins[table], orgId)).map((r) => r.id);
}

/** Round a scaled figure to a whole unit, as somebody types a price — but never a split share. */
const wholeUnits = (cents, scale) => (scale === 1 ? cents : Math.round((cents * scale) / 100) * 100);

async function wear(costumeName, ctx) {
  const c = COSTUMES[costumeName];
  await setCell("Organization", ctx.orgId, "name", c.club);
  for (const [col, v] of Object.entries(c.place)) await setCell("Organization", ctx.orgId, col, v);
  // The seed's tournament names are long and say "April"; the pictures show a plain one.
  for (const [slug, name] of Object.entries(c.events)) await setCell("Event", ctx.events[slug], "name", name);
  // The seed writes every tournament's town and its dates label for a Scottish club. A club
  // elsewhere would have had its own town, and its dates worded in its own locale when it set them.
  const fmt = new Intl.DateTimeFormat(c.place.locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const events = await prisma.event.findMany({ where: { organizationId: ctx.orgId }, select: { id: true, startOn: true, endOn: true } });
  for (const e of events) {
    await setCell("Event", e.id, "city", c.place.city);
    if (!e.startOn) continue;
    const a = new Date(`${e.startOn}T00:00:00Z`);
    const b = new Date(`${e.endOn || e.startOn}T00:00:00Z`);
    const label = e.startOn === (e.endOn || e.startOn) ? fmt.format(a) : fmt.formatRange(a, b);
    await setCell("Event", e.id, "dates", label.replace(/[  ]/g, " "));
  }

  for (const [table, column] of MONEY_COLUMNS) {
    for (const id of await clubRows(table, ctx.orgId)) {
      const seeded = await seededValue(table, id, column);
      // A settlement's two figures are a part-payment of a split share, not a price: scale exactly,
      // so what is owed and what was handed over keep the relation the seed gave them.
      const exact = table === "Settlement";
      const v = exact ? Math.round(seeded * c.scale) : wholeUnits(seeded, c.scale);
      await setCell(table, id, column, v);
    }
  }
  // A bill paid by two cards must still add up to the bill (addExpense refuses one that does not):
  // give the rounding difference to the first payer.
  const bills = await prisma.$queryRawUnsafe(
    `SELECT x.id, x."amountCents" AS amount FROM "Expense" x JOIN "Event" e ON e.id = x."eventId" WHERE e."organizationId" = $1`,
    ctx.orgId,
  );
  for (const b of bills) {
    const pays = await prisma.$queryRawUnsafe(`SELECT id, "amountCents" AS a FROM "ExpensePayment" WHERE "expenseId" = $1 ORDER BY "amountCents" DESC`, b.id);
    if (!pays.length) continue;
    const gap = b.amount - pays.reduce((s, p) => s + p.a, 0);
    if (gap) await setCell("ExpensePayment", pays[0].id, "amountCents", pays[0].a + gap);
  }

  // The roster, renamed from the costume's list (or put back to the seed's names).
  for (const [i, m] of ctx.members.entries()) {
    const name = c.names ? c.names[i] : await seededValue("Member", m.id, "name");
    await setCell("Member", m.id, "name", name);
    for (const pid of ctx.playersByMember.get(m.id) ?? []) await setCell("Player", pid, "name", name);
    if (i === 0) {
      await setCell("User", ctx.playerUserId, "name", name);
      for (const aid of ctx.playerAccounts) await setCell("Account", aid, "name", name);
    }
  }
}

/* ------------------------------------------------------------ the extras */

/**
 * What the captures need and the seed does not have: a long drive with a winner on the medal,
 * beside its closest-to-the-pin. Created under the club's own event, so the event's cascade (and
 * seed-club's teardown) removes it; it carries no mark because nothing on the screen may.
 */
async function addExtras(ctx) {
  const medal = await prisma.event.findUnique({ where: { id: ctx.medalId }, select: { stages: { select: { id: true }, orderBy: { position: "asc" } } } });
  const stageId = medal.stages[0].id;
  const field = await prisma.player.findMany({ where: { eventId: ctx.medalId, status: "confirmed" }, orderBy: { seed: "asc" }, select: { id: true } });
  const ld = await prisma.contest.create({
    data: {
      eventId: ctx.medalId,
      stageId,
      kind: "long-drive",
      name: "Long drive — 14th",
      hole: 14,
      buyInCents: 300,
      entryMode: "opt-in",
      createdBy: "R. Ganizer",
    },
  });
  await prisma.contestEntry.createMany({
    data: field.slice(0, 12).map((p, i) => ({ contestId: ld.id, playerId: p.id, won: i === 2, confirmed: true })),
  });
  ctx.extras.push(["Contest", ld.id]);
}

/* ------------------------------------------------------------ the browser */

const PHONE = { viewport: { width: VIEWPORTS.phone.width, height: VIEWPORTS.phone.height }, deviceScaleFactor: VIEWPORTS.phone.scale, isMobile: true, hasTouch: true };
const LAPTOP = { viewport: { width: VIEWPORTS.laptop.width, height: VIEWPORTS.laptop.height }, deviceScaleFactor: VIEWPORTS.laptop.scale };

async function settle(page) {
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
  // The dev server's own badge (Next's "N" in the corner) is not the app: hidden, never painted over.
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" }).catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  // Nothing still loading: no busy region, no skeleton, no streamed section still waiting.
  await page
    .waitForFunction(
      () =>
        !document.querySelector('[aria-busy="true"], .skeleton, .spinner') &&
        !document.querySelector('template[id^="B:"]'),
      null,
      { timeout: 15_000 },
    )
    .catch(() => {});
  await page.waitForTimeout(600);
}

/** What a capture must not show, checked on the words of the screen. */
function faults(text, finalUrl) {
  const out = [];
  if (text.includes(MARK) || /zz-club/.test(text)) out.push("fixture mark on screen");
  if (/Side bets?/.test(text)) out.push('says "Side bets"');
  if (/Application error|server-side exception|Something went wrong|This page could not be found/i.test(text)) out.push("error screen");
  if (/\/(sign-in|login)\b/.test(new URL(finalUrl).pathname) || new URL(finalUrl).pathname === "/") out.push(`redirected to ${new URL(finalUrl).pathname}`);
  return out;
}

/* ------------------------------------------------------------ the captures */

/**
 * One entry per picture. `who` is "member" or "secretary"; `event` the tournament the session is on;
 * `costume` the country; `act` anything done on the screen before it is taken (an opened form, a
 * scroll to a section). Names: the landing's own (see place-landing-shots NAMES) where it has one.
 */
const CAPTURES = [
  // (A) the landing's money pictures
  { name: "p-money", who: "member", event: "medal", costume: "us", path: "/me/money" },
  { name: "world-gbp-money", who: "member", event: "medal", costume: "gbp", path: "/me/money" },
  { name: "world-eur-money", who: "member", event: "medal", costume: "eur", path: "/me/money" },
  { name: "world-zar-money", who: "member", event: "medal", costume: "zar", path: "/me/money" },
  { name: "world-inr-money", who: "member", event: "medal", costume: "inr", path: "/me/money" },
  { name: "world-gbp-board", who: "member", event: "medal", costume: "gbp", path: "/me/board" },
  { name: "world-inr-board", who: "member", event: "medal", costume: "inr", path: "/me/board" },

  // (B) the outings-and-money reel
  { name: "reel-costs-list", who: "member", event: "team", costume: "us", path: "/me/money", act: steps(openMore, scrollToText("Expenses \\(\\d+\\)")) },
  { name: "reel-costs-split", who: "member", event: "team", costume: "us", path: "/me/money", act: steps(openMore, scrollToBill("Lodging")) },
  { name: "reel-settle-up", who: "member", event: "team", costume: "us", path: "/me/money", act: scrollToText("Settle up") },
  { name: "reel-contests", who: "member", event: "medal", costume: "us", path: "/me/money", act: steps(openMore, scrollToText("Decided on the day")) },
  { name: "reel-start-side-game", who: "member", event: "medal", costume: "us", path: "/me/money", act: steps(openMore, openStartSideGame) },
  { name: "reel-side-game-settled", who: "member", event: "team", costume: "us", path: "/me/money", act: steps(openMore, scrollToText("Pots on the scores|The pots|Pots")) },
  // The organizer's console. Prizes on the finished championship (a prize list with winners);
  // the four-ball weekend's ledger (who stands where, what is left to change hands, and the
  // season's skins above it); and on the live medal, the games the
  // committee names a winner for.
  { name: "reel-console-prizes", who: "secretary", event: "champs", costume: "us", path: "/prizes", act: scrollToText("Prizes") },
  { name: "reel-console-ledger", who: "secretary", event: "team", costume: "us", path: "/prizes", act: scrollToText("The ledger") },
  { name: "reel-console-contests", who: "secretary", event: "medal", costume: "us", path: "/prizes", act: scrollToText("YOU NAME THE WINNER|You name the winner") },
];

/**
 * Open the Money screen's "More: …" extender, where the itemised money lives (the expenses, what
 * was decided on the day, the pots on the scores). Opened by a tap, as a member opens it.
 */
async function openMore(page) {
  const more = page.locator("summary", { hasText: /^More:/ }).first();
  if (!(await more.count())) return "NOT FOUND: the More extender";
  const open = await more.evaluate((el) => el.parentElement.open);
  if (!open) await more.click();
  await page.waitForTimeout(400);
  return null;
}

/** Run steps in order; the first that cannot be done is the note. */
function steps(...fns) {
  return async (page) => {
    for (const f of fns) {
      const note = await f(page);
      if (note) return note;
    }
    return null;
  };
}

/**
 * Bring the card holding a line of words to the top of the screen, just under the sticky header
 * (about 80px on a phone), as a thumb would scroll it.
 */
function scrollToText(pattern) {
  return async (page) => {
    const re = new RegExp(`^(${pattern})$`);
    const target = page.getByText(re).filter({ visible: true }).first();
    if (!(await target.count())) return `NOT FOUND: words matching /${pattern}/`;
    await target.evaluate((el) => {
      const box = el.closest(".card, section") ?? el;
      const top = box.getBoundingClientRect().top + window.scrollY - 96;
      window.scrollTo(0, Math.max(0, top));
    });
    await page.waitForTimeout(400);
    return null;
  };
}

/** Bring one bill to the top, its shares showing (a bill's row is open from the start). */
function scrollToBill(words) {
  return async (page) => {
    const row = page.locator("summary.expense-row", { hasText: words }).first();
    if (!(await row.count())) return `NOT FOUND: a bill saying "${words}"`;
    const open = await row.evaluate((el) => el.parentElement.open);
    if (!open) await row.click();
    await row.evaluate((el) => window.scrollTo(0, Math.max(0, el.getBoundingClientRect().top + window.scrollY - 100)));
    await page.waitForTimeout(400);
    return null;
  };
}

async function openStartSideGame(page) {
  const btn = page.getByRole("button", { name: /Start a side game/ }).first();
  if (!(await btn.count())) return "NOT FOUND: the Start a side game button";
  await btn.click();
  await page.waitForTimeout(500);
  const form = page.locator(".card-title", { hasText: /^Start a side game$/ }).first();
  if (await form.count()) {
    await form.evaluate((el) => window.scrollTo(0, Math.max(0, el.getBoundingClientRect().top + window.scrollY - 120)));
  }
  await page.waitForTimeout(400);
  return null;
}

/**
 * What the hero needs to know about a screen, measured on the screen as it was shot: where the
 * signed-in player's row is (`self-row`), where the button the member presses is (`press`), each as
 * a fraction of the capture so the page can lay a light over exactly that row at any size; and on
 * the organizer's leaderboard, every row's place, thru and to-par — the holes in are their sum.
 */
async function measureOn(page, what, selfName, pressPattern) {
  return page.evaluate(({ what, selfName, pressPattern }) => {
    const W = window.innerWidth, H = window.innerHeight;
    const frac = (b) => ({ x: +(b.left / W).toFixed(4), y: +(b.top / H).toFixed(4), w: +(b.width / W).toFixed(4), h: +(b.height / H).toFixed(4) });
    const out = {};
    if (what.includes("self-row")) {
      const leaf = Array.from(document.querySelectorAll("body *")).find(
        (e) => e.childElementCount === 0 && e.textContent.trim() === selfName && e.getBoundingClientRect().height > 0 && e.getBoundingClientRect().top < H,
      );
      if (leaf) {
        let row = leaf.closest("tr");
        if (!row) {
          row = leaf;
          while (row.parentElement && row.getBoundingClientRect().width < W * 0.8) row = row.parentElement;
        }
        out["self-row"] = frac(row.getBoundingClientRect());
      }
      const table = document.querySelector("table");
      if (table) {
        const head = Array.from(table.querySelectorAll("thead th")).map((th) => th.innerText.replace(/\s+/g, " ").trim().toLowerCase()); // "TO PAR" is written with a no-break space
        const col = (name) => head.findIndex((h) => h === name);
        const [iPlace, iName, iThru, iPar] = ["#", "player", "thru", "to par"].map(col);
        const rows = Array.from(table.querySelectorAll("tbody tr")).map((tr) => Array.from(tr.cells).map((c) => c.innerText.trim()));
        if (iThru >= 0) {
          const self = rows.find((r) => r[iName] === selfName);
          out.table = {
            rows: rows.length,
            holes: rows.reduce((s, r) => s + (/^\d+$/.test(r[iThru]) ? Number(r[iThru]) : r[iThru] === "F" ? 18 : 0), 0),
            self: self ? { place: self[iPlace], thru: self[iThru], toPar: self[iPar] } : null,
          };
        }
      }
    }
    if (what.includes("press")) {
      const re = new RegExp(pressPattern);
      const b = Array.from(document.querySelectorAll("button")).find((el) => re.test(el.innerText.replace(/\s+/g, " ").trim()));
      if (b) out.press = frac(b.getBoundingClientRect());
    }
    return out;
  }, { what, selfName, pressPattern });
}

/* ------------------------------------------------------------------ main */

async function main() {
  // A run killed between dressing and restoring left its journal: put those values back first, so
  // the teardown at the top of seed() can find every row by its mark.
  if (existsSync(JOURNAL)) {
    const left = JSON.parse(readFileSync(JOURNAL, "utf8"));
    const n = await restoreJournal(left);
    console.log(`Restored ${n} values left by an earlier run's journal.`);
    rmSync(JOURNAL);
  }

  // seed() opens by tearing down this worktree's club, so a club left from earlier is not "before".
  await teardown();
  const before = await census();
  const markedBefore = await markedRows();
  console.log(`Before: ${Object.values(before).reduce((a, b) => a + b, 0)} rows in ${Object.keys(before).length} tables; rows carrying ${MARK}: ${markedBefore.total}`);

  const ctx = { extras: [] };
  const report = [];
  let browser;
  try {
    const data = await seed();
    ctx.orgId = data.org.id;
    ctx.medalId = data.landing.id;
    const byslug = Object.fromEntries(data.events.map((e) => [e.slug, e.id]));
    ctx.events = { medal: byslug.medal, team: byslug.fourball, champs: byslug.champs };
    ctx.members = await prisma.member.findMany({ where: { organizationId: ctx.orgId }, orderBy: { memberNumber: "asc" }, select: { id: true } });
    const players = await prisma.player.findMany({ where: { event: { organizationId: ctx.orgId } }, select: { id: true, memberId: true } });
    ctx.playersByMember = new Map();
    for (const p of players) {
      if (!p.memberId) continue;
      if (!ctx.playersByMember.has(p.memberId)) ctx.playersByMember.set(p.memberId, []);
      ctx.playersByMember.get(p.memberId).push(p.id);
    }
    const playerUser = await prisma.user.findUnique({ where: { email: data.player.email }, select: { id: true } });
    ctx.playerUserId = playerUser.id;
    ctx.playerAccounts = (await prisma.account.findMany({ where: { email: data.player.email }, select: { id: true } })).map((a) => a.id);

    const stripped = await stripMarks();
    console.log(`Seeded ${data.counts.events} tournaments; took the mark off ${stripped} display strings.`);
    await addExtras(ctx);

    const { chromium } = require("playwright");
    browser = await chromium.launch();
    const cookieFor = { member: data.player.session, secretary: data.organizer.session };

    let wearing = null;
    const selfName = COSTUMES.us.names[0];
    const measured = {};

    /** Open a screen as `shot.who`, run `fn(page)` on it, close it. */
    const onScreen = async (shot, fn) => {
      if (wearing !== shot.costume) {
        await wear(shot.costume, ctx);
        wearing = shot.costume;
      }
      const context = await browser.newContext({
        ...(shot.laptop ? LAPTOP : PHONE),
        locale: COSTUMES[shot.costume].place.locale,
        colorScheme: "light",
        reducedMotion: "reduce",
        serviceWorkers: "block",
      });
      await context.addCookies([
        { name: "ng_session", value: cookieFor[shot.who], url: BASE, httpOnly: true, sameSite: "Lax" },
        { name: "ng_active_event", value: sign(ctx.events[shot.event]), url: BASE, httpOnly: true, sameSite: "Lax" },
      ]);
      const page = await context.newPage();
      try {
        const res = await page.goto(BASE + shot.path, { waitUntil: "domcontentloaded", timeout: 90_000 });
        await settle(page);
        return await fn(page, res?.status() ?? 0);
      } finally {
        await context.close();
      }
    };

    // THE FRONT DOOR: the manifest's screens, then the live moment in its order.
    const landingShot = (s) => ({ name: s.id, ...s.capture, laptop: s.viewport === "laptop", measure: s.measure ?? [] });
    const live = new Set([...LIVE_MOMENT.before, ...LIVE_MOMENT.after]);
    const wanted = (id) => !ONLY.length || ONLY.includes(id);
    const plain = LANDING ? SCREENS.filter((s) => s.capture && !live.has(s.id) && wanted(s.id)).map(landingShot) : CAPTURES;
    const sequence = LANDING && [...live].some(wanted)
      ? [
          ...LIVE_MOMENT.before.map((id) => landingShot(SCREENS.find((s) => s.id === id))),
          { press: true },
          ...LIVE_MOMENT.after.map((id) => landingShot(SCREENS.find((s) => s.id === id))),
        ]
      : [];
    if (LANDING) {
      for (const s of SCREENS.filter((x) => !x.capture && wanted(x.id))) console.log(`kept  ${s.id} — ${s.kept}`);
    }

    for (const shot of [...plain, ...sequence]) {
      if (shot.press) {
        // The member presses the score on their own card, as a member does. A real save, in the club's
        // own rows, which the teardown takes away with everything else.
        const on = SCREENS.find((s) => s.id === LIVE_MOMENT.press.on);
        const note = await onScreen(landingShot(on), async (page) => {
          const button = page.getByRole("button", { name: new RegExp(LIVE_MOMENT.press.button) }).first();
          if (!(await button.count())) return `NOT FOUND: the button /${LIVE_MOMENT.press.button}/`;
          await button.click();
          await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
          await page.waitForTimeout(1500);
          return null;
        });
        report.push({ name: "press", ok: !note, notes: note ? [note] : [] });
        console.log(`${note ? "FAIL " : "ok   "} the member presses /${LIVE_MOMENT.press.button}/${note ? "  — " + note : ""}`);
        if (note) throw new Error(note);
        continue;
      }
      if (ONLY.length && !ONLY.includes(shot.name) && !live.has(shot.name)) continue;
      if (wearing !== shot.costume) {
        await wear(shot.costume, ctx);
        wearing = shot.costume;
      }
      const geometry = shot.laptop ? LAPTOP : PHONE;
      const context = await browser.newContext({
        ...geometry,
        locale: COSTUMES[shot.costume].place.locale,
        colorScheme: "light",
        reducedMotion: "reduce",
        serviceWorkers: "block",
      });
      await context.addCookies([
        { name: "ng_session", value: cookieFor[shot.who], url: BASE, httpOnly: true, sameSite: "Lax" },
        { name: "ng_active_event", value: sign(ctx.events[shot.event]), url: BASE, httpOnly: true, sameSite: "Lax" },
      ]);
      const page = await context.newPage();
      const pageErrors = [];
      page.on("pageerror", (e) => pageErrors.push(String(e.message).slice(0, 160)));
      let status = 0;
      try {
        const res = await page.goto(BASE + shot.path, { waitUntil: "domcontentloaded", timeout: 90_000 });
        status = res?.status() ?? 0;
        await settle(page);
        const actNote = shot.act ? await shot.act(page) : null;
        await settle(page);
        const text = await page.evaluate(() => document.body.innerText);
        writeFileSync(join(TEXT, `${shot.name}.txt`), text);
        await page.screenshot({ path: join(OUT, `${shot.name}.png`) });
        const bad = faults(text, page.url());
        if (shot.measure?.length) {
          const m = await measureOn(page, shot.measure, selfName, LIVE_MOMENT.press.button);
          measured[shot.name] = m;
          for (const what of shot.measure) if (!m[what]) bad.push(`could not measure ${what}`);
        }
        if (status !== 200) bad.push(`status ${status}`);
        if (actNote) bad.push(actNote);
        if (pageErrors.length) bad.push(`page errors: ${pageErrors.join(" | ")}`);
        report.push({ name: shot.name, ok: bad.length === 0, notes: bad });
        console.log(`${bad.length ? "CHECK" : "ok   "} ${shot.name}${bad.length ? "  — " + bad.join("; ") : ""}`);
      } catch (e) {
        report.push({ name: shot.name, ok: false, notes: [String(e.message).split("\n")[0]] });
        console.log(`FAIL  ${shot.name} — ${String(e.message).split("\n")[0]}`);
      } finally {
        await context.close();
      }
    }

    // THE LIVE MOMENT'S FIGURES, read off its own captures — the hero says nothing typed by hand.
    if (sequence.length) {
      const field = await prisma.player.count({ where: { eventId: ctx.medalId, status: "confirmed" } });
      const deskBefore = measured["live-desk-before"]?.table;
      const deskAfter = measured["live-desk-after"]?.table;
      // The hole and the score pressed, as the card said them: "HOLE 10" above, "4 / Par" on the button.
      const cardText = readFileSync(join(TEXT, `${LIVE_MOMENT.press.on}.txt`), "utf8");
      const hole = Number((cardText.match(/HOLE\s+(\d+)/i) ?? [])[1]) || null;
      const score = Number((LIVE_MOMENT.press.button.match(/\d+/) ?? [])[0]) || null;
      const facts = {
        hole,
        score,
        capturedOn: new Date().toISOString().slice(0, 10),
        club: COSTUMES.us.club,
        event: COSTUMES.us.events.medal,
        player: selfName,
        field,
        holesBefore: deskBefore?.holes ?? null,
        holesAfter: deskAfter?.holes ?? null,
        placeBefore: deskBefore?.self?.place ?? null,
        placeAfter: deskAfter?.self?.place ?? null,
        toParAfter: deskAfter?.self?.toPar ?? null,
        rows: deskAfter?.rows ?? null,
        rects: Object.fromEntries(Object.entries(measured).map(([k, v]) => [k, { press: v.press ?? undefined, selfRow: v["self-row"] ?? undefined }])),
      };
      writeFileSync(join(OUT, "screen-facts.json"), JSON.stringify(facts, null, 1));
      console.log(`Live moment: ${facts.player} ${facts.placeBefore} -> ${facts.placeAfter} (${facts.toParAfter}); holes in ${facts.holesBefore} -> ${facts.holesAfter}; field ${field} (${facts.rows} on the leaderboard).`);
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    // Back to the seeded values, so teardown finds every row by its mark — then the teardown.
    const restored = await restoreJournal().catch((e) => {
      console.error("RESTORE FAILED — the journal is kept at", JOURNAL, e);
      return -1;
    });
    if (restored >= 0 && existsSync(JOURNAL)) rmSync(JOURNAL);
    journal = {};
    await teardown();
    // Anything teardown cannot find by name: the extras, then the club itself by id (cascades).
    for (const [table, id] of ctx.extras) await prisma.$executeRawUnsafe(`DELETE FROM "${table}" WHERE id = $1`, id).catch(() => {});
    if (ctx.orgId) await prisma.organization.deleteMany({ where: { id: ctx.orgId } });

    const after = await census();
    const markedAfter = await markedRows();
    const changed = Object.keys({ ...before, ...after }).filter((t) => before[t] !== after[t]).map((t) => `${t}: ${before[t]} -> ${after[t]}`);
    console.log(`Restored ${restored} values, tore the club down.`);
    console.log(`After: ${Object.values(after).reduce((a, b) => a + b, 0)} rows; rows carrying ${MARK}: ${markedAfter.total}`);
    console.log(changed.length ? `Tables whose counts moved:\n  ${changed.join("\n  ")}` : "Every table's row count is what it was before the run.");
    writeFileSync(join(OUT, "capture-report.json"), JSON.stringify({ report, before, after, changed, markedBefore, markedAfter }, null, 1));
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(String(e?.stack ?? e));
  process.exitCode = 1;
});
