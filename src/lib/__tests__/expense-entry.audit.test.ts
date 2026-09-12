import "dotenv/config";
import { describe, it, expect, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { moneyFor } from "@/lib/services/expenses";

/**
 * WHO THE LEDGER OFFERS AN "ADD" TO, against real rows.
 *
 * The pure rule lives in `domain/expense-entry.ts` and is tested there. What
 * cannot be checked in the pure layer is the part that decides what a person
 * actually sees: `moneyFor` reads the tournament's stored answer and resolves
 * it against the viewer, and BOTH screens render off that one field. A rule
 * computed correctly and then read from the wrong column is a rule that does
 * nothing.
 *
 * Fixtures are `zz-` prefixed with `@example.invalid` addresses and torn down
 * in a `finally`, as the house rules require — and the tournament is created
 * here rather than borrowed, because this test WRITES a setting and doing
 * that to somebody's event is the one thing that cannot be undone from here.
 */

const prisma = new PrismaClient();
const MARK = "zz-expense-entry";

let nth = 0;

async function fixture() {
  const tag = `${MARK}-${(nth += 1)}`;
  const org = await prisma.organization.create({
    data: { name: `${tag}-org`, kind: "community", moneyMode: "split" },
  });
  const event = await prisma.event.create({
    data: {
      name: `${tag}-outing`,
      organizationId: org.id,
      moneyMode: "split",
      // Event's required scalars. Blank is a real value for all of them and
      // none is what this file is about.
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${tag}-share`,
    },
  });
  const player = await prisma.player.create({
    data: {
      eventId: event.id,
      name: `${tag}-player`,
      email: `${tag}-player@example.invalid`,
      status: "confirmed",
      seed: 1,
    },
  });
  return { org, event, player };
}

async function teardown(orgId: string, eventId: string) {
  await prisma.expense.deleteMany({ where: { eventId } });
  await prisma.player.deleteMany({ where: { eventId } });
  await prisma.event.deleteMany({ where: { id: eventId } });
  await prisma.organization.deleteMany({ where: { id: orgId } });
}

afterAll(async () => {
  // Anything an interrupted run left behind, so a fixture is never mistaken
  // for real data later.
  await prisma.event.deleteMany({ where: { name: { startsWith: MARK } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: MARK } } });
  await prisma.$disconnect();
});

describe("the ledger a player is handed", () => {
  it("offers the add by default — which is what every tournament does today", async () => {
    const { org, event, player } = await fixture();
    try {
      const view = await moneyFor(event.id, player.email, { name: player.name });
      expect(event.expenseEntry, "a fresh tournament stores nothing").toBe("");
      expect(view.canAddExpense, "a player lost a capability they had").toBe(true);
    } finally {
      await teardown(org.id, event.id);
    }
  });

  it("withdraws it from a player once the organizers keep the book", async () => {
    const { org, event, player } = await fixture();
    try {
      await prisma.event.update({ where: { id: event.id }, data: { expenseEntry: "staff" } });
      const asPlayer = await moneyFor(event.id, player.email, { name: player.name });
      expect(asPlayer.canAddExpense).toBe(false);

      /**
       * AND STILL OFFERS IT TO STAFF, read from the same row in the same
       * state. Without this the test passes against a change that switched
       * the ledger off for everybody — including the treasurer the setting
       * exists for, who would then have no way to enter a line at all.
       */
      const asStaff = await moneyFor(event.id, player.email, {
        name: player.name,
        isStaff: true,
      });
      expect(asStaff.canAddExpense, "the setting locked out the person who set it").toBe(true);
    } finally {
      await teardown(org.id, event.id);
    }
  });

  it("reads the tournament's own column, not the club's money mode", async () => {
    /**
     * The failure this is shaped to catch: resolving the answer off
     * `moneyMode` — which is right there in the same card and the same
     * service — would pass every pure test and make the switch inert.
     *
     * Same club, same split mode, one column different, opposite answers.
     */
    const a = await fixture();
    const b = await fixture();
    try {
      await prisma.event.update({ where: { id: b.event.id }, data: { expenseEntry: "staff" } });
      const one = await moneyFor(a.event.id, a.player.email, { name: a.player.name });
      const two = await moneyFor(b.event.id, b.player.email, { name: b.player.name });
      expect(one.canAddExpense).toBe(true);
      expect(two.canAddExpense).toBe(false);
    } finally {
      await teardown(a.org.id, a.event.id);
      await teardown(b.org.id, b.event.id);
    }
  });
});
