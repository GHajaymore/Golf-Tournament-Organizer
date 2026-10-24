import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// The board is `unstable_cache`d, which throws outside a Next request; the
// identity runs the real builder, which is the code the report reads.
vi.mock("next/cache", () => ({
  unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
  revalidateTag: () => {},
  revalidatePath: () => {},
}));
import { createElement } from "react";
import { PrismaClient } from "@prisma/client";
import { renderToStaticMarkup } from "react-dom/server";
import { eventReport, reportAudienceFor, type EventReport as Report } from "@/lib/services/event-report";
import { liveBoard } from "@/lib/services/live-board";
import { loadEventState } from "@/lib/services/tournament";
import { skinsPotFor } from "@/lib/services/skins-pot";
import { moneyFor, sidePotResults } from "@/lib/services/expenses";
import { formattingForEvent } from "@/lib/services/organization";
import { formatMoney } from "@/lib/domain/locale";
import { EventReport } from "@/components/EventReport";
// A plain .mjs fixture, shared with the browser spec so the two walk the same tournament.
import { seedReport, teardownReport } from "../../../e2e/report-fixture.mjs";

/**
 * THE FINAL REPORT SAYS WHAT THE APP'S OWN READERS SAY (2026-10-21).
 *
 * Every figure in the conclusion is supposed to be READ from the screen that
 * already holds it — the board (and the board ranked through each round, as the
 * cut reads it), the skins pot, the side-game pass that pays the players, the
 * money screen's settle-up. This holds each
 * section against that reader, on a real two-round medal with money in it
 * (`e2e/report-fixture.mjs`, worked out by hand in its header), so the report
 * cannot drift into a second opinion about any of them.
 *
 * And the other half of the ruling: the PUBLIC copy names the winners and
 * carries no amount at all — no prize money, no skins, no side-game figure, no
 * costs, no settle-up — which is asserted on the rendered page as well as on
 * the data, because a figure can be printed by the component as easily as by
 * the service.
 *
 *   npx vitest run --config vitest.audit.config.ts final-report-reads-the-readers
 */

const MARK = "zz-audit-report";
type Seeded = {
  eventId: string;
  stageIds: string[];
  players: Record<string, { id: string; name: string; email: string }>;
  organizerEmail: string;
};
let seeded: Seeded;
let staff: Report;
let pub: Report;
let cat: Report;
let money: (cents: number) => string;

beforeAll(async () => {
  seeded = (await seedReport(MARK)) as Seeded;
  const f = await formattingForEvent(seeded.eventId);
  money = (cents) => formatMoney(cents, f);
  staff = (await eventReport(seeded.eventId, { kind: "staff", email: seeded.organizerEmail }))!;
  pub = (await eventReport(seeded.eventId, { kind: "public" }))!;
  cat = (await eventReport(seeded.eventId, { kind: "player", email: seeded.players.Cat.email }))!;
});

afterAll(async () => {
  await teardownReport(MARK);
});

describe("the final report reads the app's own readers", () => {
  it("the champion and the table are the board's: Bob on 141, then Cat, Ann, Dan", async () => {
    const board = (await liveBoard(seeded.eventId))!;
    expect(staff.first?.names).toEqual([seeded.players.Bob.name]);
    expect(staff.first?.figure).toBe("gross 141");
    expect(staff.rows.map((r) => r.name)).toEqual(board.rows.map((r) => r.name));
    expect(staff.rows.map((r) => r.name)).toEqual(["Bob", "Cat", "Ann", "Dan"].map((n) => seeded.players[n].name));
    // Gross AND net wherever strokes are counted.
    expect(staff.columns).toEqual(["Gross", "Net", "To par"]);
  });

  it("the place after each round is the board's own, ranked through that round (the cut's reading)", async () => {
    const r1 = (await loadEventState(seeded.eventId, seeded.stageIds[0]))!;
    expect(staff.movement).not.toBeNull();
    const m = staff.movement!;
    expect(m.columns).toEqual(["R1", "Final"]);
    for (const row of m.rows) {
      const s = r1.strokeStandings.find((x) => x.player.name === row.name)!;
      const shared = r1.strokeStandings.filter((x) => x.ranked && x.rank === s.rank).length > 1;
      expect(row.places[0], row.name).toBe(`${shared ? "T" : ""}${s.rank}`);
    }
    // Worked by hand: after round 1 Ann led (70), Bob 2nd (72), Cat 3rd (73).
    expect(m.rows.map((r) => [r.name, ...r.places])).toEqual([
      [seeded.players.Bob.name, "2", "1"],
      [seeded.players.Cat.name, "3", "2"],
      [seeded.players.Ann.name, "1", "3"],
    ]);
    expect(m.story[0].text).toBe(`${seeded.players.Ann.name} led after Round 1 on gross 70. ${seeded.players.Bob.name} was next on gross 72.`);
    expect(m.story[1].text).toBe(`${seeded.players.Bob.name} went top after Round 2 on gross 141, up from 2nd.`);
  });

  it("a player with no card in a closed round is in nobody's table after it — never 'top' on one round's total", async () => {
    // Walked on the seeded club before this shipped: a championship with a cut
    // read "… were level at the top after Round 2, on gross 89" — eighteen-hole
    // totals ranked above thirty-six-hole ones. Here Dan's round-2 card is
    // taken away: on 74 for one round he would lead a table that adds up
    // whatever cards exist.
    const prisma = new PrismaClient();
    const dan = await prisma.scorecard.findFirstOrThrow({ where: { stageId: seeded.stageIds[1], playerId: seeded.players.Dan.id } });
    try {
      await prisma.scorecard.delete({ where: { id: dan.id } });
      const r = (await eventReport(seeded.eventId, { kind: "staff", email: seeded.organizerEmail }))!;
      expect(r.movement?.story[1].text).toBe(`${seeded.players.Bob.name} went top after Round 2 on gross 141, up from 2nd.`);
    } finally {
      await prisma.scorecard.create({
        data: { eventId: seeded.eventId, stageId: dan.stageId, playerId: dan.playerId, strokes: dan.strokes, status: dan.status },
      });
      await prisma.$disconnect();
    }
  });

  it("each round's winner is the board's round result", () => {
    expect(staff.rounds.map((r) => [r.label, r.result])).toEqual([
      ["Round 1", `${seeded.players.Ann.name} · 70 gross`],
      ["Round 2", `${seeded.players.Bob.name} · 69 gross`],
    ]);
  });

  it("the highlights are off the cards: Bob's eagle at the top, Bob's 69 the best round", () => {
    expect(staff.highlights[0]).toEqual({ label: "Eagle", who: seeded.players.Bob.name, what: "2 on the par-4 hole 5, Round 2" });
    expect(staff.highlights).toContainEqual({ label: "Best round", who: `${seeded.players.Bob.name} · gross 69`, what: "Round 2" });
    // On a gross board the best round IS the lowest gross, so it is said once.
    expect(staff.highlights.some((h) => h.label === "Lowest gross")).toBe(false);
    // Birdies: Ann 2 (round 1), Bob 1 and Cat 1 (round 2) — the eagle is not a birdie.
    expect(staff.numbers).toContainEqual({ figure: "4", label: "birdies" });
    expect(staff.numbers).toContainEqual({ figure: "8", label: "cards returned" });
    expect(staff.numbers).toContainEqual({ figure: "4", label: "played every round" });
  });

  it("the skins are the pot's own: Ann takes holes 1 and 2, and what she takes is the pot's figure", async () => {
    const view = (await skinsPotFor(seeded.eventId, seeded.stageIds[0], false, "full", ""))!;
    const ann = view.result!.shares.find((s) => s.playerId === seeded.players.Ann.id)!;
    expect(staff.skins).toHaveLength(1);
    expect(staff.skins[0].winners).toEqual([{ name: seeded.players.Ann.name, detail: "holes 1 and 2", amount: money(ann.wonCents) }]);
    expect(staff.skins[0].line).toContain(`${money(500)} each, 4 in: a ${money(view.result!.potCents)} pot.`);
  });

  it("the birdie pot is what the side-game pass paid the players", async () => {
    const nets = (await sidePotResults(seeded.eventId, seeded.stageIds[1])).values().next().value!;
    const up = nets.filter((n) => n.netCents > 0).sort((a, b) => b.netCents - a.netCents);
    const name = (id: string) => Object.values(seeded.players).find((p) => p.id === id)!.name;
    const pot = staff.sideGames.find((g) => g.title.startsWith("Birdie pot"))!;
    expect(pot.winners).toEqual(up.map((n) => ({ name: name(n.playerId), detail: "", amount: `up ${money(n.netCents)}` })));
    // Bob's eagle counts as a birdie in the POT (one under or better), so he
    // takes two shares to Cat's one — and Ann and Dan are not in it.
    expect(pot.winners.map((w) => w.name)).toEqual([seeded.players.Bob.name, seeded.players.Cat.name]);
  });

  it("the birdie pot's line counts who was IN it, not whose money moved", async () => {
    // $2 a head, all four in: an $8 pot — whatever the birdies did to it.
    const pot = staff.sideGames.find((g) => g.title.startsWith("Birdie pot"))!;
    expect(pot.line).toBe(`${money(200)} each, 4 in: a ${money(800)} pot.`);
  });

  it("a player who takes back exactly their stake is still in the pot (2026-10-23)", async () => {
    // Give Ann a birdie on the 4th in round 2. Shares are then Bob 2 (eagle and
    // birdie), Cat 1, Ann 1, Dan 0: $8 over four shares is $4, $2, $2, $0 — so
    // Cat and Ann each take back exactly their $2 and their nets are nought.
    // The report read the pot's size off the players with a net, and printed
    // "2 in: a $4.00 pot" for this.
    const prisma = new PrismaClient();
    const ann = await prisma.scorecard.findFirstOrThrow({ where: { stageId: seeded.stageIds[1], playerId: seeded.players.Ann.id } });
    try {
      const card = (JSON.parse(ann.strokes) as (number | null)[]).map((s, i) => (i === 3 ? 3 : s));
      await prisma.scorecard.update({ where: { id: ann.id }, data: { strokes: JSON.stringify(card) } });
      const nets = (await sidePotResults(seeded.eventId, seeded.stageIds[1])).values().next().value!;
      // CONTROL: the fixture really did leave two players at nought.
      expect(nets.length, "the fixture did not leave anybody at their stake").toBe(2);
      const r = (await eventReport(seeded.eventId, { kind: "staff", email: seeded.organizerEmail }))!;
      const pot = r.sideGames.find((g) => g.title.startsWith("Birdie pot"))!;
      expect(pot.line).toBe(`${money(200)} each, 4 in: a ${money(800)} pot.`);
      expect(pot.winners.map((w) => [w.name, w.amount])).toEqual([[seeded.players.Bob.name, `up ${money(200)}`]]);
    } finally {
      await prisma.scorecard.update({ where: { id: ann.id }, data: { strokes: ann.strokes } });
      await prisma.$disconnect();
    }
  });

  it("a pot nobody won is reported, stakes back — not left out (2026-10-23)", async () => {
    // Take the three round-2 birdies off (Bob's eagle and birdie, Cat's birdie).
    const prisma = new PrismaClient();
    const rows = await prisma.scorecard.findMany({
      where: { stageId: seeded.stageIds[1], playerId: { in: [seeded.players.Bob.id, seeded.players.Cat.id] } },
    });
    try {
      for (const row of rows) {
        await prisma.scorecard.update({ where: { id: row.id }, data: { strokes: JSON.stringify(Array(18).fill(4)) } });
      }
      const nets = (await sidePotResults(seeded.eventId, seeded.stageIds[1])).values().next().value;
      // CONTROL: the pot is final and nobody's money moved — an empty result, not an absent one.
      expect(nets, "the pot did not settle").toEqual([]);
      const r = (await eventReport(seeded.eventId, { kind: "staff", email: seeded.organizerEmail }))!;
      const pot = r.sideGames.find((g) => g.title.startsWith("Birdie pot"));
      expect(pot?.line).toBe(`${money(200)} each, 4 in: a ${money(800)} pot. Nobody won it; the stakes went back.`);
      expect(pot?.winners).toEqual([]);
    } finally {
      for (const row of rows) await prisma.scorecard.update({ where: { id: row.id }, data: { strokes: row.strokes } });
      await prisma.$disconnect();
    }
  });

  it("the settle-up is the money screen's own list, payment for payment", async () => {
    const view = await moneyFor(seeded.eventId, "");
    expect(staff.settleUp?.lines).toEqual(view.transfers.map((t) => ({ from: t.fromName, to: t.toName, amount: money(t.cents) })));
    expect(staff.settleUp!.lines.length).toBeGreaterThan(0);
    expect(staff.settleUp?.yours).toBe("");
    expect(staff.costs?.lines).toEqual([{ what: "Course fee", amount: money(4000) }]);
  });

  it("a player in the field is shown their own line first, from the same list", async () => {
    const view = await moneyFor(seeded.eventId, seeded.players.Cat.email);
    const pays = view.transfers.filter((t) => t.fromPlayerId === seeded.players.Cat.id);
    expect(pays.length).toBeGreaterThan(0);
    expect(cat.settleUp?.yours).toBe(`You pay ${pays.map((t) => `${money(t.cents)} to ${t.toName}`).join(" and ")}.`);
    expect(cat.amounts).toBe(true);
  });

  it("prizes and contests carry their amounts on the organizer's copy", () => {
    expect(staff.prizes).toContainEqual({ what: "Winner", winners: [seeded.players.Bob.name], amount: money(5000) });
    expect(staff.prizes).toContainEqual({ what: "Closest to the pin (hole 3)", winners: [seeded.players.Ann.name], amount: money(400) });
  });

  it("coming up: the club's next tournament taking entries, and the pinned notice for the field only", () => {
    // One line: the day entries close, and the day it is played (12 days out, after the deadline at 5).
    expect(staff.comingUp.some((c) => c.text.startsWith(`Entries close for ${MARK} Autumn Foursomes; it is played on `))).toBe(true);
    expect(staff.comingUp.some((c) => c.when === "Notice" && c.text.startsWith("Prize giving in the clubhouse"))).toBe(true);
    expect(pub.comingUp.some((c) => c.text.startsWith(`Entries close for ${MARK} Autumn Foursomes`))).toBe(true);
    expect(pub.comingUp.some((c) => c.when === "Notice")).toBe(false);
  });
});

describe("the public copy names winners and carries no amount", () => {
  it("has the winners, and no amount, no costs and no settle-up in its data", () => {
    expect(pub.audience).toBe("public");
    expect(pub.amounts).toBe(false);
    expect(pub.skins[0].winners.map((w) => [w.name, w.detail, w.amount])).toEqual([[seeded.players.Ann.name, "holes 1 and 2", ""]]);
    expect(pub.sideGames.flatMap((g) => g.winners.map((w) => w.amount))).toEqual(["", ""]);
    expect(pub.prizes.map((p) => p.amount)).toEqual(["", ""]);
    expect(pub.costs).toBeNull();
    expect(pub.settleUp).toBeNull();
    // Every amount the organizer's copy prints, absent from the public one.
    const amounts = [
      ...staff.prizes.map((p) => p.amount),
      ...staff.skins.flatMap((s) => s.winners.map((w) => w.amount)),
      ...staff.sideGames.flatMap((g) => g.winners.map((w) => w.amount)),
      ...(staff.settleUp?.lines.map((l) => l.amount) ?? []),
    ].filter(Boolean);
    expect(amounts.length).toBeGreaterThan(4);
    const text = JSON.stringify(pub);
    for (const a of amounts) expect(text, a).not.toContain(a);
  });

  it("and the page drawn from it holds no money at all", () => {
    const html = renderToStaticMarkup(createElement(EventReport, { report: pub }));
    expect(html).toContain(seeded.players.Ann.name);
    expect(html).not.toContain("Settle-up");
    expect(html).not.toContain("Entry fees and costs");
    // The club's currency sign appears nowhere on the public page.
    const sign = money(100).replace(/[\d.,\s ]/g, "");
    expect(sign.length).toBeGreaterThan(0);
    expect(html).not.toContain(sign);
    // While the organizer's copy, drawn the same way, does carry it.
    expect(renderToStaticMarkup(createElement(EventReport, { report: staff }))).toContain(sign);
  });

  it("a pot still being played is absent — the skins as the settle-up leaves them out", async () => {
    // Reopen round 1 with Dan's card one hole short: the pot can still move.
    const prisma = new PrismaClient();
    try {
      await prisma.event.update({ where: { id: seeded.eventId }, data: { status: "live" } });
      await prisma.stage.update({ where: { id: seeded.stageIds[0] }, data: { closedAt: null } });
      const dan = await prisma.scorecard.findFirstOrThrow({ where: { stageId: seeded.stageIds[0], playerId: seeded.players.Dan.id } });
      const short = (JSON.parse(dan.strokes) as (number | null)[]).map((s, i) => (i === 17 ? null : s));
      await prisma.scorecard.update({ where: { id: dan.id }, data: { strokes: JSON.stringify(short) } });

      const view = (await skinsPotFor(seeded.eventId, seeded.stageIds[0], false, "full", ""))!;
      expect(view.result?.provisional, "the fixture did not reopen the pot").toBe(true);
      const live = (await eventReport(seeded.eventId, { kind: "staff", email: seeded.organizerEmail }))!;
      expect(live.skins).toEqual([]);
      expect(live.completed).toBe(false);
    } finally {
      await prisma.event.update({ where: { id: seeded.eventId }, data: { status: "completed" } });
      await prisma.stage.update({ where: { id: seeded.stageIds[0] }, data: { closedAt: new Date() } });
      await prisma.$disconnect();
    }
  });

  it("who gets which copy: staff, a player in the field, and everybody else", async () => {
    expect(await reportAudienceFor(seeded.eventId, { email: seeded.organizerEmail, staff: true })).toEqual({ kind: "staff", email: seeded.organizerEmail });
    expect(await reportAudienceFor(seeded.eventId, { email: seeded.players.Dan.email.toUpperCase(), staff: false })).toEqual({
      kind: "player",
      email: seeded.players.Dan.email.toUpperCase(),
    });
    expect(await reportAudienceFor(seeded.eventId, { email: `${MARK}-stranger@example.invalid`, staff: false })).toEqual({ kind: "public" });
    expect(await reportAudienceFor(seeded.eventId, { email: "", staff: false })).toEqual({ kind: "public" });
    expect(await reportAudienceFor(seeded.eventId, null)).toEqual({ kind: "public" });
  });
});
