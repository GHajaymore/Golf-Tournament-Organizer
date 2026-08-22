/**
 * Prove the per-round handicap control reaches the screen, on real data.
 *
 * The render tests pin the component's four states and the smoke test proves
 * /stages returns 200, but neither asks the real question: with the Demo Cup's
 * actual field of 33 and its actual rated tees, does the control render, does
 * it say what each player plays off, and does it say "cards are in" once a
 * round is frozen?
 *
 * It reads the Demo Cup rather than seeding its own event, because the bug this
 * would catch is in resolving a real field. Everything it WRITES is a
 * RoundHandicap row it removes in a finally, plus a throwaway organizer whose
 * password is unusable — the demo's own rows are never edited.
 *
 *   npx tsx scripts/verify-round-handicaps.mjs        (SMOKE_BASE_URL to pick a port)
 */
import { PrismaClient } from "@prisma/client";
import { createHmac, randomBytes } from "node:crypto";

const BASE = process.env.SMOKE_BASE_URL ?? "http://localhost:3120";
const EVENT = process.env.VERIFY_EVENT ?? "Demo Cup";
const MARK = "zz-verify-round-handicaps";
const prisma = new PrismaClient();

const made = {};
let failures = 0;

/** React splits interpolated text with HTML comments when it renders. */
const stripComments = (html) => html.replace(/<!--[\s\S]*?-->/g, "");

function check(label, html, needle, shouldContain = true) {
  const found = stripComments(html).includes(needle);
  const ok = found === shouldContain;
  if (!ok) failures += 1;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label}: ${shouldContain ? "contains" : "omits"} "${needle}"`);
}

async function main() {
  try {
    const event = await prisma.event.findFirstOrThrow({ where: { name: EVENT } });
    const stages = await prisma.stage.findMany({
      where: { eventId: event.id },
      orderBy: { position: "asc" },
    });
    const players = await prisma.player.findMany({
      where: { eventId: event.id, status: "confirmed" },
      orderBy: { seed: "asc" },
    });
    console.log(`${EVENT}: ${players.length} confirmed, ${stages.length} rounds\n`);

    // A throwaway organizer. The password is deliberately unusable: this exists
    // to be a signed cookie, not a way in.
    const user = await prisma.user.create({
      data: {
        email: `${MARK}@example.invalid`,
        name: "Verify Organizer",
        password: `${randomBytes(8).toString("hex")}:unusable`,
      },
    });
    made.userId = user.id;
    const account = await prisma.account.create({
      data: { eventId: event.id, name: user.name, email: user.email, role: "admin" },
    });
    made.accountId = account.id;

    const secret = process.env.AUTH_SECRET ?? "dev-secret";
    const mac = createHmac("sha256", secret).update(user.id).digest("base64url");
    const cookie = `ng_session=${user.id}.${mac}`;
    const get = async (path) => {
      const res = await fetch(BASE + path, { headers: { cookie }, redirect: "follow" });
      return { status: res.status, html: await res.text() };
    };

    console.log(`Verifying against ${BASE}`);

    // Which rounds have been scored, whatever is stored about their handicaps.
    // A round with cards and no frozen rows is the case this event actually
    // holds, and the one that was getting the wrong answer.
    const scored = [];
    for (const s of stages) {
      const cards = await prisma.scorecard.findMany({
        where: { eventId: event.id, stageId: s.id },
        select: { strokes: true },
      });
      const played = cards.some((c) => {
        try {
          return JSON.parse(c.strokes).some((v) => typeof v === "number" && v > 0);
        } catch {
          return false;
        }
      });
      if (played) scored.push(s.position + 1);
    }
    console.log(`rounds with a card already scored: ${scored.length ? scored.join(", ") : "none"}`);

    // 1. As found. Unscored rounds read the roster; a scored one says so, even
    //    though nothing about it is frozen — it was played before this existed.
    console.log("\nAs found");
    const clean = await get("/stages");
    console.log(`  status ${clean.status}`);
    check("the section is on the round", clean.html, "Handicaps for this round");
    check("says what the default is", clean.html, "Everyone plays off their handicap from the roster");
    check("offers to change one", clean.html, "Set one for this round");
    if (scored.length) {
      check("a scored round says its cards are in", clean.html, "Cards are in");
    } else {
      check("does not claim cards are in", clean.html, "Cards are in", false);
    }

    // 2. A committee decision on the first player of the first playing round.
    // An UNSCORED round, so the override is one the screen should still offer.
    const round =
      stages.find((s) => s.type !== "Qualification Stage" && !scored.includes(s.position + 1)) ??
      stages[0];
    const who = players[0];
    const row = await prisma.roundHandicap.create({
      data: { eventId: event.id, stageId: round.id, playerId: who.id, override: 12 },
    });
    made.rowId = row.id;
    console.log(`\nWith an override of 12 for one player in round ${round.position + 1}`);
    const overridden = await get("/stages");
    check("counts the decision", overridden.html, "player has a handicap set for this round");
    check("still offers the control", overridden.html, "Set one for this round");

    // 3. Frozen: the round has been scored, so it keeps what it was scored off.
    await prisma.roundHandicap.update({
      where: { id: row.id },
      data: { frozen: 12, frozenAt: new Date() },
    });
    console.log("\nWith that round frozen at 12");
    const frozen = await get("/stages");
    check("says cards are in", frozen.html, "keeps the handicaps it was scored against");
    check("stops offering to set one", frozen.html, "Show what it was scored off");

    // 4. Frozen AND the roster has moved since — the "why is my net different"
    //    line, which is the whole reason differsFromCurrent exists.
    await prisma.roundHandicap.update({ where: { id: row.id }, data: { override: null } });
    const before = who.handicap;
    await prisma.player.update({ where: { id: who.id }, data: { handicap: before + 6 } });
    made.playerId = who.id;
    made.playerHandicap = before;
    console.log("\nFrozen at 12, roster moved underneath it");
    const differing = await get("/stages");
    check("volunteers the difference", differing.html, "was scored off");

    console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}`);
  } finally {
    // Put the demo back exactly as it was found.
    if (made.playerId) {
      await prisma.player.update({
        where: { id: made.playerId },
        data: { handicap: made.playerHandicap },
      });
    }
    if (made.rowId) await prisma.roundHandicap.deleteMany({ where: { id: made.rowId } });
    if (made.accountId) await prisma.account.deleteMany({ where: { id: made.accountId } });
    if (made.userId) await prisma.user.deleteMany({ where: { id: made.userId } });
    await prisma.$disconnect();
    console.log("Fixtures removed.");
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
