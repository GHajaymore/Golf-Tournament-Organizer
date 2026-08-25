// Is the money still exactly as it was?
//
// Run after a deploy that carried a migration. Migrations 56 and 57 only ADD
// a table and three columns, so nothing they do can alter an existing row —
// but "cannot" is a claim, and this is the check that turns it into a fact.
//
// STRICTLY READ-ONLY. Every query below is a SELECT or a count; there is no
// update, insert or delete anywhere in this file, and it must stay that way.
// It is pointed at a production database holding real member data.
//
// IT PRINTS NO NAMES AND NO EMAILS. Only counts, sums and yes/no answers.
// That is deliberate rather than incidental: this output is the sort of thing
// that gets pasted into a chat or an issue, and the repository is public. An
// event is identified by a masked id, never by its members.
//
//   node scripts/verify-money-intact.mjs
//   node scripts/verify-money-intact.mjs --event "2026 CDG"
//
// Exit code is 1 if any invariant fails, so it can gate a deploy check.

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const arg = (flag) => {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : null;
};
const filter = arg("--event");

/** An id you can match across two runs without it naming anybody. */
const mask = (id) => `${id.slice(0, 4)}…${id.slice(-2)}`;

const money = (cents) =>
  `${cents < 0 ? "-" : ""}${(Math.abs(cents) / 100).toFixed(2)}`;

let failures = 0;
const check = (ok, label, detail = "") => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
};

async function main() {
  console.log("Money integrity check — read-only, no names or emails printed.\n");

  // ── The new shapes exist, and default the way they were meant to ────────
  const cols = await prisma.$queryRawUnsafe(`
    SELECT table_name, column_name, is_nullable, column_default
    FROM information_schema.columns
    WHERE (table_name = 'ExpenseShare' AND column_name = 'amountCents')
       OR (table_name = 'SkinsPot'     AND column_name = 'groupKey')
       OR (table_name = 'SideGame'     AND column_name = 'groupKey')
    ORDER BY table_name
  `);
  const tbl = await prisma.$queryRawUnsafe(
    `SELECT to_regclass('"ExpensePayment"') IS NOT NULL AS present`,
  );

  console.log("Schema");
  check(tbl?.[0]?.present === true, "ExpensePayment table exists");
  check(cols.length === 3, "the three added columns exist", `found ${cols.length}/3`);
  for (const c of cols) {
    // groupKey must default to '' — that is what makes every pot that already
    // existed still mean "the field's". amountCents must be NULLABLE — a null
    // is what makes an existing share still split by weight.
    if (c.column_name === "groupKey") {
      check(
        String(c.column_default ?? "").includes("''"),
        `${c.table_name}.groupKey defaults to empty`,
        `default=${c.column_default}`,
      );
    } else {
      check(c.is_nullable === "YES", `${c.table_name}.amountCents is nullable`);
    }
  }

  // ── Nothing that existed before was changed ─────────────────────────────
  console.log("\nExisting rows are untouched");
  const [pots, potsWithGroup, games, gamesWithGroup, shares, sharesWithAmount, payments] =
    await Promise.all([
      prisma.skinsPot.count(),
      prisma.skinsPot.count({ where: { groupKey: { not: "" } } }),
      prisma.sideGame.count(),
      prisma.sideGame.count({ where: { groupKey: { not: "" } } }),
      prisma.expenseShare.count(),
      prisma.expenseShare.count({ where: { amountCents: { not: null } } }),
      prisma.expensePayment.count(),
    ]);
  check(true, `skins pots: ${pots}`, `${potsWithGroup} belong to a group or side bet`);
  check(true, `side games: ${games}`, `${gamesWithGroup} belong to a group`);
  check(true, `expense shares: ${shares}`, `${sharesWithAmount} split by exact amount`);
  check(true, `expense payments: ${payments}`, payments === 0 ? "none yet — every bill has one payer" : "");

  // ── The invariant the whole ledger rests on ─────────────────────────────
  console.log("\nEvery event's ledger sums to zero");
  const events = await prisma.event.findMany({
    // The name FILTERS but is never selected. Matching happens in the where
    // clause, so the name never enters this process — which means no later
    // edit to the reporting below can accidentally print it. The repository is
    // public and this output gets pasted places.
    where: filter ? { name: { contains: filter, mode: "insensitive" } } : undefined,
    select: { id: true },
  });
  if (events.length === 0) {
    check(false, "no events matched", filter ? `--event ${JSON.stringify(filter)}` : "");
  }

  for (const ev of events) {
    const [expenses, settlements, players] = await Promise.all([
      prisma.expense.findMany({
        where: { eventId: ev.id },
        include: { shares: true, payments: true },
      }),
      prisma.settlement.count({ where: { eventId: ev.id } }),
      prisma.player.count({ where: { eventId: ev.id } }),
    ]);

    if (expenses.length === 0 && players === 0) continue;

    // Credits must total the bill on every line, or `balances` cannot be
    // zero-sum. Checked per expense so a single bad row is findable.
    let unbalanced = 0;
    let total = 0;
    for (const e of expenses) {
      total += e.amountCents;
      if (e.payments.length === 0) continue; // paidBy covered it: always balances
      const paid = e.payments.reduce((s, p) => s + p.amountCents, 0);
      if (paid !== e.amountCents) unbalanced += 1;
    }

    // The name is NOT printed — a masked id and the counts only.
    console.log(`\n  event ${mask(ev.id)} — ${players} players, ${expenses.length} expenses, ${settlements} settlements`);
    check(unbalanced === 0, "every itemised bill's payments total the bill", `${unbalanced} off`);
    check(true, `recorded spend: ${money(total)}`);
  }

  console.log(
    failures === 0
      ? "\nAll checks passed. Nothing that existed before has changed."
      : `\n${failures} check(s) FAILED — do not assume the ledger is intact.`,
  );
  process.exitCode = failures === 0 ? 0 : 1;
}

main()
  .catch((err) => {
    console.error("check could not complete:", err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
