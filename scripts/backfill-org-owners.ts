/**
 * Give every ownerless organization an owner.
 *
 * S1 of the 2026-08-12 audit. Organization administration used to fall back to
 * "is an admin of some event here and holds no membership row", which handed a
 * guest organizer of ONE event the whole club. That fallback is now narrowed to
 * organizations with no members at all (see services/org-access.ts), which is
 * safe but leaves those tenants administered by a weaker rule than everyone
 * else. This closes the gap: after it runs, every organization has a real
 * owner and the narrowed fallback stops applying to anything.
 *
 * Who becomes the owner: the earliest event admin the club has. Their Account
 * row already grants them organizer rights over that event, and on an
 * ownerless club they are the person who has been administering it — the
 * backfill records that rather than inventing it. A User is created if that
 * email has never signed in, exactly as inviting staff does; they claim it
 * with a password on first login.
 *
 * Reports and changes NOTHING by default. Read the report, then re-run with
 * --apply. Idempotent: an organization that gains an owner is skipped on every
 * later run.
 *
 *   npx tsx scripts/backfill-org-owners.ts
 *   npx tsx scripts/backfill-org-owners.ts --apply
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

interface Plan {
  organizationId: string;
  organizationName: string;
  events: number;
  /** The email that will own it, or "" when the club has no admin to promote. */
  ownerEmail: string;
  ownerName: string;
  userExists: boolean;
}

async function planFor(org: { id: string; name: string }): Promise<Plan> {
  // Oldest event first: the club's first tournament is the one whose organizer
  // has the strongest claim to having set the club up.
  const events = await prisma.event.findMany({
    where: { organizationId: org.id },
    select: { id: true },
    orderBy: [{ createdAt: "asc" }],
  });

  // Account has no createdAt, so "earliest" is taken from the event and then
  // settled by email — arbitrary, but STABLE, which is what matters: a dry run
  // and the apply that follows it must name the same person.
  let admin: { email: string; name: string } | null = null;
  for (const e of events) {
    admin = await prisma.account.findFirst({
      where: { eventId: e.id, role: "admin" },
      orderBy: [{ email: "asc" }],
      select: { email: true, name: true },
    });
    if (admin) break;
  }

  const user = admin ? await prisma.user.findUnique({ where: { email: admin.email } }) : null;

  return {
    organizationId: org.id,
    organizationName: org.name,
    events: events.length,
    ownerEmail: admin?.email ?? "",
    ownerName: user?.name || admin?.name || "",
    userExists: !!user,
  };
}

async function main() {
  const ownerless = await prisma.organization.findMany({
    where: { members: { none: {} } },
    select: { id: true, name: true },
    orderBy: [{ createdAt: "asc" }],
  });

  if (ownerless.length === 0) {
    console.log("Every organization already has at least one member. Nothing to do.");
    return;
  }

  const plans: Plan[] = [];
  for (const org of ownerless) plans.push(await planFor(org));

  const actionable = plans.filter((p) => p.ownerEmail);
  const stuck = plans.filter((p) => !p.ownerEmail);

  console.log(`${ownerless.length} organization(s) with no members.\n`);
  for (const p of actionable) {
    console.log(
      `  ${p.organizationName}  (${p.events} event${p.events === 1 ? "" : "s"})\n` +
        `    owner -> ${p.ownerEmail}${p.userExists ? "" : "  [user will be created]"}`,
    );
  }
  if (stuck.length) {
    // Deliberately not invented. An organization with no admin on any of its
    // events has nobody with a claim to it, and picking someone would be
    // handing a club to a person the data never named.
    console.log(`\n  ${stuck.length} with no event admin to promote — left alone, needs a human:`);
    for (const p of stuck) console.log(`    ${p.organizationName} (${p.events} events)`);
  }

  if (!APPLY) {
    console.log(`\nDry run. Nothing was written. Re-run with --apply to make these changes.`);
    return;
  }

  let created = 0;
  for (const p of actionable) {
    const user = await prisma.user.upsert({
      where: { email: p.ownerEmail },
      update: {},
      create: { email: p.ownerEmail, name: p.ownerName || p.ownerEmail },
    });
    // Guarded rather than blind: another run, or someone signing up in the
    // meantime, must not turn this into a duplicate or an error.
    await prisma.organizationMember.upsert({
      where: { organizationId_userId: { organizationId: p.organizationId, userId: user.id } },
      update: {},
      create: { organizationId: p.organizationId, userId: user.id, role: "owner" },
    });
    created += 1;
    console.log(`  owned: ${p.organizationName} -> ${p.ownerEmail}`);
  }

  const remaining = await prisma.organization.count({ where: { members: { none: {} } } });
  console.log(`\n${created} organization(s) given an owner. ${remaining} still ownerless.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
