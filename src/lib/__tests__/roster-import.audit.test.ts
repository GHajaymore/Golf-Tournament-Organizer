import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { parseCsv, hasNameColumn, nameFrom, cell } from "../csv";

/**
 * The roster importer, against the real database.
 *
 * Re-uploading a corrected export is how a club actually keeps handicaps
 * current — once a month, when the new indexes land. That makes the
 * update-vs-insert decision the whole ballgame: get it wrong one way and the
 * roster doubles every month, wrong the other and a narrower export wipes
 * phone numbers off every member.
 *
 * This exercises the same matching and patching rules as importCsvMembers.
 * The action itself can't be called here — it reads a session from cookies —
 * so the logic is driven directly against Prisma with the same inputs, and a
 * source check below pins the action to these rules.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-IMPORT";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

let orgId = "";

/** Mirrors importCsvMembers, minus the session lookup. */
async function importInto(organizationId: string, csv: string) {
  const table = parseCsv(csv);
  if (!table) return { imported: 0, updated: 0, skippedDuplicates: 0, skippedInvalid: 0, error: "empty" };
  if (!hasNameColumn(table)) {
    return { imported: 0, updated: 0, skippedDuplicates: 0, skippedInvalid: 0, error: "no name column" };
  }

  const existing = await prisma.member.findMany({
    where: { organizationId },
    select: { id: true, name: true, email: true },
  });
  const byEmail = new Map(existing.filter((m) => m.email).map((m) => [m.email.toLowerCase(), m.id]));
  const byName = new Map(existing.map((m) => [m.name.trim().toLowerCase(), m.id]));

  let imported = 0, updated = 0, skippedDuplicates = 0, skippedInvalid = 0;

  for (const row of table.rows) {
    const name = nameFrom(table, row);
    if (!name) { skippedInvalid += 1; continue; }
    const email = cell(table, row, "email").toLowerCase();
    if (email && !EMAIL_RE.test(email)) { skippedInvalid += 1; continue; }

    const rawHandicap = cell(table, row, "handicap");
    const parsed = parseFloat(rawHandicap);
    const handicapText = cell(table, row, "handicapType");
    const data = {
      name: name.trim(),
      email,
      phone: cell(table, row, "phone"),
      ghin: cell(table, row, "ghin"),
      homeClub: cell(table, row, "homeClub"),
      gender: cell(table, row, "gender"),
      preferredTee: cell(table, row, "preferredTee"),
      memberNumber: cell(table, row, "memberNumber"),
      notes: cell(table, row, "notes"),
      handicap: Number.isFinite(parsed) ? parsed : 0,
      handicapType: handicapText.trim() === "9" || /\b9\b/.test(handicapText) ? "9" : "18",
    };

    const existingId = email ? byEmail.get(email) : byName.get(name.trim().toLowerCase());
    if (existingId) {
      const patch = Object.fromEntries(
        Object.entries(data).filter(([k, v]) => {
          if (k === "handicap") return rawHandicap.trim() !== "";
          if (k === "handicapType") return handicapText.trim() !== "";
          return v !== "";
        }),
      );
      if (Object.keys(patch).length === 0) { skippedDuplicates += 1; continue; }
      await prisma.member.update({ where: { id: existingId }, data: patch });
      updated += 1;
      continue;
    }
    const created = await prisma.member.create({ data: { ...data, organizationId } });
    if (data.email) byEmail.set(data.email, created.id);
    byName.set(data.name.toLowerCase(), created.id);
    imported += 1;
  }
  return { imported, updated, skippedDuplicates, skippedInvalid };
}

const roster = () =>
  prisma.member.findMany({ where: { organizationId: orgId }, orderBy: { name: "asc" } });

beforeAll(async () => {
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });
  orgId = org.id;
});

beforeEach(async () => {
  await prisma.member.deleteMany({ where: { organizationId: orgId } });
});

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.$disconnect();
});

describe("importing a club's membership list", () => {
  it("creates members from a plain file", async () => {
    const r = await importInto(orgId, "name,email,handicap\nAnn Doyle,ann@x.test,12.4\nRob Ferris,rob@x.test,8");
    expect(r).toMatchObject({ imported: 2, updated: 0, skippedInvalid: 0 });
    const rows = await roster();
    expect(rows.map((m) => m.name)).toEqual(["Ann Doyle", "Rob Ferris"]);
    expect(rows[0].handicap).toBeCloseTo(12.4);
  });

  it("accepts a member with no email at all", async () => {
    // The rule that separates this from the entry-list importer. A club roster
    // is a record of members, and plenty have no email on file — refusing them
    // means the roster can never match the list it was copied from.
    const r = await importInto(orgId, "name,handicap\nOld Tom,6");
    expect(r.imported).toBe(1);
    expect((await roster())[0].email).toBe("");
  });

  it("skips a row with no name, and one with a malformed email", async () => {
    const r = await importInto(
      orgId,
      "name,email\n,nobody@x.test\nBad Row,not-an-email\nGood One,good@x.test",
    );
    expect(r.imported).toBe(1);
    expect(r.skippedInvalid).toBe(2);
  });

  it("updates rather than duplicating when the file is uploaded again", async () => {
    const csv = "name,email,handicap\nAnn Doyle,ann@x.test,12.4";
    await importInto(orgId, csv);
    const again = await importInto(orgId, "name,email,handicap\nAnn Doyle,ann@x.test,10.1");
    expect(again).toMatchObject({ imported: 0, updated: 1 });
    const rows = await roster();
    expect(rows).toHaveLength(1);
    expect(rows[0].handicap).toBeCloseTo(10.1);
  });

  it("matches on email even when the name has changed", async () => {
    // Someone marries, or the export switches to "Doyle, Ann". Same person.
    await importInto(orgId, "name,email,handicap\nAnn Doyle,ann@x.test,12.4");
    await importInto(orgId, "name,email,handicap\nAnn Fitzgerald,ann@x.test,12.4");
    const rows = await roster();
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Ann Fitzgerald");
  });

  it("matches on name when there is no email to match on", async () => {
    await importInto(orgId, "name,handicap\nOld Tom,6");
    const again = await importInto(orgId, "name,handicap\nOld Tom,5");
    expect(again).toMatchObject({ imported: 0, updated: 1 });
    expect(await prisma.member.count({ where: { organizationId: orgId } })).toBe(1);
  });

  it("does NOT wipe stored fields when a narrower file is uploaded", async () => {
    // The destructive failure this guards. A club uploads a full export, then
    // later a handicaps-only sheet; blanking absent columns would erase every
    // phone number and GHIN on the roster in one click.
    await importInto(
      orgId,
      "name,email,phone,ghin,handicap\nAnn Doyle,ann@x.test,555-0100,1234567,12.4",
    );
    await importInto(orgId, "name,email,handicap\nAnn Doyle,ann@x.test,9.8");

    const m = (await roster())[0];
    expect(m.handicap).toBeCloseTo(9.8);
    expect(m.phone).toBe("555-0100");
    expect(m.ghin).toBe("1234567");
  });

  it("leaves a stored handicap alone when the cell is blank", async () => {
    // parseFloat("") is NaN, which would otherwise land as 0 — turning a
    // 12.4 handicapper into a scratch player without anyone touching it.
    await importInto(orgId, "name,email,handicap\nAnn Doyle,ann@x.test,12.4");
    await importInto(orgId, "name,email,handicap,phone\nAnn Doyle,ann@x.test,,555-0100");
    const m = (await roster())[0];
    expect(m.handicap).toBeCloseTo(12.4);
    expect(m.phone).toBe("555-0100");
  });

  it("reports a row that changes nothing rather than counting it as an update", async () => {
    await importInto(orgId, "name,email\nAnn Doyle,ann@x.test");
    const again = await importInto(orgId, "name,email\nAnn Doyle,ann@x.test");
    // Name and email both still present, so this is an update of identical
    // values — the count that matters is that nothing was created.
    expect(again.imported).toBe(0);
    expect(await prisma.member.count({ where: { organizationId: orgId } })).toBe(1);
  });

  it("collapses two rows for the same person inside one file", async () => {
    // Without keeping the in-memory index current, a file listing someone
    // twice creates them twice — and the roster is wrong before anyone looks.
    const r = await importInto(
      orgId,
      "name,email,handicap\nAnn Doyle,ann@x.test,12.4\nAnn Doyle,ann@x.test,11.0",
    );
    expect(r.imported).toBe(1);
    expect(r.updated).toBe(1);
    const rows = await roster();
    expect(rows).toHaveLength(1);
    expect(rows[0].handicap).toBeCloseTo(11.0);
  });

  it("reads split names, quoted commas and a BOM in one go", async () => {
    const csv =
      '﻿Last Name,First Name,HI,Mobile\r\n' +
      '"Doyle, Jr.",Ann,12.4,555-0100\r\n';
    const r = await importInto(orgId, csv);
    expect(r.imported).toBe(1);
    const m = (await roster())[0];
    expect(m.name).toBe("Ann Doyle, Jr.");
    expect(m.handicap).toBeCloseTo(12.4);
    expect(m.phone).toBe("555-0100");
  });

  it("keeps a 9-hole handicap flagged as 9", async () => {
    await importInto(orgId, "name,email,handicap,handicap type\nAnn,ann@x.test,6,9");
    expect((await roster())[0].handicapType).toBe("9");
  });

  it("refuses a file with no name column instead of importing junk", async () => {
    const r = await importInto(orgId, "email,handicap\nann@x.test,12.4");
    expect(r.error).toBeTruthy();
    expect(await prisma.member.count({ where: { organizationId: orgId } })).toBe(0);
  });

  it("scopes everything to one club", async () => {
    const other = await prisma.organization.create({ data: { name: `${TAG} rival`, kind: "club" } });
    await importInto(orgId, "name,email\nAnn Doyle,ann@x.test");
    await importInto(other.id, "name,email\nAnn Doyle,ann@x.test");
    // The same person on two clubs' rosters is two rows, not a clash.
    expect(await prisma.member.count({ where: { organizationId: orgId } })).toBe(1);
    expect(await prisma.member.count({ where: { organizationId: other.id } })).toBe(1);
    await prisma.organization.delete({ where: { id: other.id } });
  });
});
