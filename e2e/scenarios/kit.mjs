import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { createHmac } from "node:crypto";
import { signedInNow } from "../../scripts/session-cookie.mjs";

// THE SCENARIO TOURNAMENTS' SHARED KIT — the club, the course, the invented
// members and their cards, for the eleven tournaments beside this file.
//
// These began as five throwaway probes copied into e2e/ for the length of a run
// (hence the mark, and "five" in a few names). They are the suite's proof that
// the app does its job with a full field, so since 2026-10-13 they live here,
// are listed in scripts/qa/layers.mjs, and run as a layer of every round.
// Every row is marked zz-five, every name invented, every address
// @example.invalid. A database the suite may write to only — never production.
// FIVE_MARK is for a trial against a club that does not exist yet: a second mark, so a scenario can be
// started from nothing on a machine whose zz-five club is kept. It must not begin "zz-five".
export const MARK = process.env.FIVE_MARK || "zz-five";
/** The secretary every tournament but the society's is run by. */
export const CLUB_EMAIL = `${MARK}-club@example.invalid`;
export const COURSE = `${MARK} Royal Oakridge`;
export const COURSE_CITY = "Larchmont";
export const CATALOGUE_ID = `${MARK}-catalogue`;
// A par-72 parkland: odd stroke indexes out, even home, as a card is made.
export const PARS = [4, 4, 3, 5, 4, 4, 3, 4, 5, 4, 4, 3, 5, 4, 4, 3, 4, 5];
export const SI = [9, 5, 15, 1, 11, 3, 17, 7, 13, 10, 4, 16, 2, 12, 6, 18, 8, 14];
const YARDS = PARS.map((p, i) => (p === 3 ? 150 + i * 3 : p === 4 ? 360 + i * 4 : 500 + i * 2));

export const sign = (v) =>
  `${v}.${createHmac("sha256", process.env.AUTH_SECRET ?? "dev-secret").update(v).digest("base64url")}`;

const FIRST = [
  "Alder", "Brook", "Corrin", "Delphine", "Ewan", "Faye", "Gideon", "Hollis", "Imogen", "Jasper",
  "Kerensa", "Lorcan", "Marisol", "Niall", "Odile", "Percy", "Quilla", "Rowan", "Saoirse", "Tamsin",
  "Ulric", "Verity", "Wystan", "Xanthe", "Yorick", "Zinnia", "Anselm", "Bryony", "Cosmo", "Dervla",
  "Esmond", "Fenella", "Gwilym", "Honora", "Ivo", "Jessamy", "Kit", "Lettice", "Magnus", "Nerys",
];
const LAST = [
  "Ashgrove", "Brackenbury", "Coldwell", "Dunmore", "Elmhirst", "Fernleigh", "Greywell", "Hartsel",
  "Ivybridge", "Juniper", "Kestrelton", "Larkspur", "Merriweather", "Nettlefold", "Oakhurst",
];

/** `n` invented, distinct names. Deterministic, so a run can be repeated. */
export function names(n, offset = 0) {
  const out = [];
  for (let i = 0; out.length < n; i++) {
    const k = i + offset;
    out.push(`${FIRST[k % FIRST.length]} ${LAST[Math.floor(k / FIRST.length) % LAST.length]}`);
  }
  return out;
}

/** A seeded generator, so the same field plays the same golf each run. */
export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** Handicap indexes for a club field: most in the teens, a few scratch, a few 30+. */
export function indexes(n, seed) {
  const r = rng(seed);
  return Array.from({ length: n }, () => {
    const v = Math.round(((r() + r() + r()) / 3) * 36 * 10) / 10;
    return Math.max(0, Math.min(36, v));
  });
}

/**
 * An 18-hole gross card for a player of course handicap `ch`: their strokes
 * spread over the hardest holes, plus noise — a birdie here, a double there.
 */
export function card(ch, r) {
  return PARS.map((par, i) => {
    const shots = Math.floor(ch / 18) + (SI[i] <= ch % 18 ? 1 : 0);
    const x = r();
    const noise = x < 0.08 ? -1 : x < 0.62 ? 0 : x < 0.9 ? 1 : 2;
    return Math.max(1, par + shots + noise - (x < 0.5 && shots > 0 ? 1 : 0));
  });
}

/**
 * KEPT, NOT PURGED (Ajay, 2026-10-09): "keep your test tournaments and its
 * results. dont delete/purge it." Refuses unless FIVE_PURGE=yes is set on
 * purpose — nothing in a normal run sets it.
 */
export async function teardown() {
  if (process.env.FIVE_PURGE !== "yes") return;
  const prisma = new PrismaClient();
  try {
    const users = await prisma.user.findMany({ where: { email: { startsWith: MARK } }, select: { id: true } });
    const orgIds = (
      await prisma.organizationMember.findMany({ where: { userId: { in: users.map((u) => u.id) } }, select: { organizationId: true } })
    ).map((m) => m.organizationId);
    await prisma.event.deleteMany({ where: { OR: [{ organizationId: { in: orgIds } }, { name: { startsWith: MARK } }] } });
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
    await prisma.user.deleteMany({ where: { email: { startsWith: MARK } } });
    await prisma.courseCatalog.deleteMany({ where: { id: CATALOGUE_ID } });
    await prisma.course.deleteMany({ where: { name: { startsWith: MARK } } });
  } finally {
    await prisma.$disconnect();
  }
}

/** Two organizers and the course; the clubs themselves are made in the app. */
export async function seed() {
  // Reuses what is there: the tournaments already played are kept.
  const prisma = new PrismaClient();
  try {
    const community = await prisma.user.upsert({
      where: { email: `${MARK}-community@example.invalid` },
      update: {},
      create: { email: `${MARK}-community@example.invalid`, name: "Petra Fairway", password: "x:unusable" },
    });
    const club = await prisma.user.upsert({
      where: { email: `${MARK}-club@example.invalid` },
      update: {},
      create: { email: `${MARK}-club@example.invalid`, name: "Graham Secretary", password: "x:unusable" },
    });
    if (await prisma.courseCatalog.findUnique({ where: { id: CATALOGUE_ID } })) {
      return { community: sign(signedInNow(community.id)), club: sign(signedInNow(club.id)) };
    }
    await prisma.courseCatalog.create({
      data: {
        id: CATALOGUE_ID,
        name: COURSE,
        city: COURSE_CITY,
        state: "NY",
        country: "US",
        par: PARS.reduce((a, b) => a + b, 0),
        pars: JSON.stringify(PARS),
        yards: JSON.stringify(YARDS),
        strokeIndex: JSON.stringify(SI),
        tees: JSON.stringify([
          { name: "White", gender: "any", courseRating: 71.8, slopeRating: 128, par: 72, yards: YARDS.reduce((a, b) => a + b, 0) },
        ]),
      },
    });
    return { community: sign(signedInNow(community.id)), club: sign(signedInNow(club.id)) };
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * CREATE A TOURNAMENT, WHETHER OR NOT THE CLUB HAS ONE YET — and put the club on
 * the plan a full field needs.
 *
 * Nine of the eleven scenarios went straight to the Tournaments screen and its
 * "Create a new tournament" box. That box is there for a club's SECOND
 * tournament. A club with none is asked for its first on /choose, by a
 * different form — and has no club at all until it answers. On the machine
 * these were written on, the club championship (scenario C) had always been
 * played first, so the club was always there, on the Eagle plan, and nobody
 * saw the assumption. The first round on GitHub gave every scenario a database
 * of its own (2026-10-13): seven stopped at their first step, waiting for a box
 * a new club is never shown.
 *
 * So each scenario stands on its own: this takes whichever form the club is
 * offered, and then sets the plan, which a field of over a hundred needs and a
 * new club (ten players, one tournament) does not have. Setting it again on a
 * club that already has it changes nothing.
 *
 * `shape` is the choice as both forms word it: "A single round" or "A series of rounds".
 */
export async function createTournament(page, name, shape, ownerEmail = CLUB_EMAIL, plan = "club") {
  await page.goto(`/choose?bust=${Date.now()}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  const first = page.getByLabel("Tournament name");
  if (await first.count()) {
    await first.fill(name);
    await page.getByRole("button", { name: new RegExp(`^${shape}`) }).click();
    await page.getByRole("button", { name: "Create tournament" }).click();
  } else {
    await page.goto(`/tournaments?bust=${Date.now()}`);
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.getByLabel("Create a new tournament").fill(name);
    const how = page.getByLabel("How is it played?");
    if (await how.count()) await how.selectOption({ label: shape });
    await page.getByRole("button", { name: /Create tournament/ }).click();
  }
  await page.waitForURL(/\/dashboard/, { timeout: 60_000 });
  await setPlanFor(ownerEmail, plan);
  if (ownerEmail === CLUB_EMAIL) await ensureClubRoster();
}

/**
 * WHETHER A SAVE BUTTON COMES ALIVE — asked for a few seconds, not once.
 *
 * Seven scenarios set a tournament's dates and course and then did
 * `if (await save.isEnabled()) … else note("already saved")`. A Save button
 * is enabled by the page noticing an edit, a moment AFTER the edit. Asked in
 * that moment it says no; the scenario wrote "already saved — nothing
 * changed" and went on with a tournament that had no course. On the machine
 * these were written on the answer usually came in time. On GitHub's it did
 * not, and six stopped ten steps later at a Launch button that — rightly —
 * would not launch a tournament without one (2026-10-13).
 *
 * The same shape as CLAUDE.md's "a spec types into a page that loaded long
 * ago": a check that asks a page a question before the page has had time to
 * know the answer. On a real resume, where nothing was changed, this costs
 * the few seconds and answers no.
 */
export async function becomesEnabled(button, ms = 6_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await button.isEnabled().catch(() => false)) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

/** How many members the club has; the club championship imports exactly this many. */
export const CLUB_ROSTER = 120;

/**
 * THE CLUB'S MEMBERS, WHERE NO SCENARIO HAS PUT THEM THERE YET.
 *
 * Nine scenarios draw their field from the club's roster — "Add from the club
 * roster", "Select all" — and the roster is made by the club championship
 * (scenario C), which imports 120 members through the screen. That is C's
 * subject. For the others it is where they START, and on a database of their
 * own there was nobody to select: the second thing the first round on GitHub
 * found, one step behind the first.
 *
 * So a club with fewer than the 120 is given them here, as rows — the same
 * people C would import, name for name and address for address, so a member
 * who signs in (`memberSession`) is the same person whichever scenario met the
 * club first. A club that already has them is left exactly as it is. C still
 * imports through the screen, and is still the proof that the import works.
 */
export async function ensureClubRoster(ownerEmail = CLUB_EMAIL) {
  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUnique({ where: { email: ownerEmail }, select: { id: true } });
    const m = await prisma.organizationMember.findFirst({ where: { userId: user.id, role: "owner" }, select: { organizationId: true } });
    const organizationId = m.organizationId;
    const have = new Set((await prisma.member.findMany({ where: { organizationId }, select: { email: true } })).map((x) => x.email));
    const field = names(CLUB_ROSTER);
    const idx = indexes(CLUB_ROSTER, 7);
    const missing = field
      .map((name, i) => ({
        organizationId,
        name,
        handicap: idx[i],
        handicapSource: "manual",
        email: `${MARK}-c-${String(i).padStart(3, "0")}@example.invalid`,
        phone: `55501${String(i).padStart(4, "0")}`,
      }))
      .filter((row) => !have.has(row.email));
    if (missing.length) await prisma.member.createMany({ data: missing });
    return missing.length;
  } finally {
    await prisma.$disconnect();
  }
}

/** What the owner console's setClubPlan does, for the organizer's own club. */
export async function setPlanFor(email, plan) {
  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    const m = await prisma.organizationMember.findFirst({ where: { userId: user.id, role: "owner" }, select: { organizationId: true } });
    await prisma.subscription.upsert({
      where: { organizationId: m.organizationId },
      update: { plan },
      create: { organizationId: m.organizationId, plan, planTermsApply: true },
    });
    return m.organizationId;
  } finally {
    await prisma.$disconnect();
  }
}

/** A member who signs in: a User whose email is a Player row's. */
export async function memberSession(email, name) {
  const prisma = new PrismaClient();
  try {
    const u = await prisma.user.upsert({ where: { email }, update: {}, create: { email, name, password: "x:unusable" } });
    return sign(signedInNow(u.id));
  } finally {
    await prisma.$disconnect();
  }
}

/** Read-only: the rows a screen should agree with. */
/** The cards held for one round: who, what status, how many holes scored. */
export async function roundCards(stageId) {
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.scorecard.findMany({ where: { stageId }, select: { playerId: true, status: true, strokes: true } });
    return rows.map((r) => ({ ...r, scored: JSON.parse(r.strokes).filter((v) => typeof v === "number").length }));
  } finally {
    await prisma.$disconnect();
  }
}

export async function eventFacts(eventName) {
  const prisma = new PrismaClient();
  try {
    const e = await prisma.event.findFirst({
      where: { name: eventName },
      select: { id: true, status: true, shareToken: true, registrationToken: true, stages: { select: { id: true, description: true, closedAt: true }, orderBy: { position: "asc" } } },
    });
    if (!e) return null;
    const players = await prisma.player.findMany({ where: { eventId: e.id }, select: { id: true, name: true, email: true, status: true, handicap: true } });
    return { ...e, players };
  } finally {
    await prisma.$disconnect();
  }
}
