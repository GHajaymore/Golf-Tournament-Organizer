/**
 * Seed the Demo Cup pilot: 32 players, 8 snake-drafted groups, a four-stage
 * sequence, and a round-robin match pool that is mostly played so the dashboard
 * and leaderboard show live standings. Uses the real domain engine for grouping
 * and scheduling so the seed matches production behavior.
 */
import { PrismaClient } from "@prisma/client";
import { formGroups } from "../src/lib/domain/grouping";
import { roundRobinSchedule } from "../src/lib/domain/schedule";
import { marginToHoles } from "../src/lib/domain/match";
import type { Player as DomainPlayer } from "../src/lib/domain/types";

const prisma = new PrismaClient();

const ROSTER: Array<[string, number]> = [
  ["Aj More", 2.1], ["Diego Alvarez", 3.4], ["Priya Nair", 4.0], ["Tom Halloran", 4.6],
  ["Sang-woo Kim", 5.2], ["Elena Petrova", 5.8], ["Jack Mercer", 6.1], ["Aisha Rahman", 6.7],
  ["Ben Carter", 7.3], ["Noah Fischer", 7.9], ["Grace Okafor", 8.4], ["Liam Doyle", 8.9],
  ["Sofia Marchetti", 9.5], ["Owen Barnes", 10.1], ["Yuki Tanaka", 10.6], ["Hannah Voss", 11.2],
  ["Ravi Menon", 11.8], ["Chloe Dubois", 12.3], ["Marcus Lindqvist", 12.9], ["Ivy Chen", 13.5],
  ["Sam Whitfield", 14.0], ["Nadia Haddad", 14.6], ["Peter Novak", 15.2], ["Zoe Sullivan", 15.8],
  ["Andre Costa", 16.3], ["Mei Lin", 16.9], ["George Ellis", 17.5], ["Fatima Zahra", 18.1],
  ["Caleb Ross", 18.7], ["Lucia Romano", 19.2], ["Derek Kwan", 19.8], ["Anya Sokolova", 20.4],
];

// Deterministic pseudo-result for a match: the lower-handicap player usually
// wins, with periodic upsets and halves, so standings look realistic.
function seededResult(
  aHcp: number,
  bHcp: number,
  n: number,
): { winner: "A" | "B" | "H"; margin: string } {
  const margins = ["1 UP", "2 UP", "3&2", "2&1", "4&3", "5&4"];
  if (n % 7 === 0) return { winner: "H", margin: "AS" };
  const favouriteIsA = aHcp <= bHcp;
  const upset = n % 5 === 0; // periodic upset
  const winner: "A" | "B" = favouriteIsA === !upset ? "A" : "B";
  const margin = margins[n % margins.length];
  return { winner, margin };
}

async function main() {
  console.log("Resetting Demo Cup seed data…");
  // Clean any prior seed of this event (cascade handles children).
  await prisma.event.deleteMany({ where: { name: "Demo Cup" } });

  // Every tournament belongs to an organization (the billing tenant), so the
  // seed creates one to own this event.
  const org = await prisma.organization.upsert({
    where: { id: "seed-org-demo" },
    update: {},
    create: {
      id: "seed-org-demo",
      name: "Demo Golf Club",
      kind: "club",
      subscription: { create: { plan: "free", status: "active" } },
    },
  });

  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: "Demo Cup",
      dates: "May 14–16, 2026",
      format: "match",
      course: "Ridgeline National",
      city: "Aspen Falls",
      address: "1 Ridgeline Drive, Aspen Falls",
      regDeadline: "May 7, 2026",
      capacity: 32,
      playerCountMode: "registration",
      manualPlayerCount: 32,
      formationRule: "balanced",
      qualifyPerGroup: 2,
      inviteMessage:
        "You're invited to the Demo Cup — May 14–16, 2026 at Ridgeline National, Aspen Falls. " +
        "Match-play, round-robin groups into brackets. 32 spots, reply to claim yours.",
      // Fixed rather than random so reseeding is deterministic; real
      // tournaments get one from generateShareToken().
      shareToken: "SEEDDEMOCUPSHARETOKEN",
    },
  });

  // Accounts (roles). Alex Rourke is the head organizer.
  await prisma.account.createMany({
    data: [
      { eventId: event.id, name: "Alex Rourke", email: "alex@demogolf.test", role: "admin" },
      { eventId: event.id, name: "Aj More", email: "aj@demogolf.test", role: "player" },
      { eventId: event.id, name: "Priya Nair", email: "priya@demogolf.test", role: "player" },
      { eventId: event.id, name: "Jordan Blake", email: "jordan@demogolf.test", role: "admin" },
    ],
  });

  // Players, seeded 1..32 by ranking (roster order = seed order here).
  const createdPlayers = [];
  for (let i = 0; i < ROSTER.length; i += 1) {
    const [name, handicap] = ROSTER[i];
    const p = await prisma.player.create({
      data: { eventId: event.id, name, handicap, seed: i + 1, status: "confirmed" },
    });
    createdPlayers.push(p);
  }

  // Form 8 balanced groups via the real engine, persist, assign players.
  const domainPlayers: DomainPlayer[] = createdPlayers.map((p) => ({
    id: p.id,
    name: p.name,
    handicap: p.handicap,
    seed: p.seed,
  }));
  const groups = formGroups(domainPlayers, "balanced");
  const groupIdByEngineId = new Map<string, string>();
  for (let i = 0; i < groups.length; i += 1) {
    const g = groups[i];
    const created = await prisma.group.create({
      data: { eventId: event.id, name: g.name, position: i },
    });
    groupIdByEngineId.set(g.id, created.id);
    await prisma.player.updateMany({
      where: { id: { in: g.playerIds } },
      data: { groupId: created.id },
    });
  }

  // Start with a single Round Robin stage; the organizer adds further stages
  // (single match, qualification, bracket…) in the stage builder as needed.
  const rrStage = await prisma.stage.create({
    data: {
      eventId: event.id,
      position: 0,
      type: "Round Robin",
      description: "Every player meets every other in their group over 3 rounds.",
      deadline: "May 14, 6:00 PM",
      scoringBasis: "gross",
    },
  });

  // Round-robin matches per group, most of them played.
  let counter = 0;
  let played = 0;
  const dbGroups = await prisma.group.findMany({ where: { eventId: event.id }, include: { players: true } });
  for (const g of dbGroups) {
    const ids = g.players.sort((a, b) => a.seed - b.seed).map((p) => p.id);
    const hcpById = new Map(g.players.map((p) => [p.id, p.handicap]));
    const schedule = roundRobinSchedule(ids);
    for (const pairing of schedule) {
      counter += 1;
      // Leave roughly 1 in 6 matches pending so progress < 100%.
      const isPending = counter % 6 === 0;
      let holes = JSON.stringify(new Array(18).fill(null));
      if (!isPending) {
        const res = seededResult(hcpById.get(pairing.aId)!, hcpById.get(pairing.bId)!, counter);
        holes = JSON.stringify(marginToHoles(res.winner, res.margin, 18));
        played += 1;
      }
      await prisma.match.create({
        data: {
          eventId: event.id,
          stageId: rrStage.id,
          groupId: g.id,
          round: pairing.round,
          playerAId: pairing.aId,
          playerBId: pairing.bId,
          holes,
        },
      });
    }
  }

  console.log(`Seeded event ${event.name}: ${createdPlayers.length} players, ${dbGroups.length} groups, ${counter} matches (${played} played).`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
