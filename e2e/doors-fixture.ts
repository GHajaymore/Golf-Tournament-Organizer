import type { PrismaClient } from "@prisma/client";

/**
 * A CLUB FOR THE DOORS INTO A GROUP (2026-11-05): its own organization, a team
 * cup of up to three four-ball sessions, five invented players, a round code
 * for each session. Marked `zz-…` and deleted by `removeDoorsClub`, never the
 * shared fixture's.
 *
 *   round 1 and round 2   the same two pairs: Ann & Bea v Cal & Dot
 *   round 3               Dot is replaced by Eve: Ann & Bea v Cal & Eve
 *
 * So a phone that kept round 1's match meets, in round 2, the same four people
 * (the group it remembers) and, in round 3, a match that is not that group.
 */

const ALPHABET = "ABCDEFGHJKMNPQRTWXYZ2346789";
export const randomCode = () => "ZZ" + Array.from({ length: 6 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join("");

export const SIDE_A = "Zz Ann Ash & Zz Bea Birch";
export const SIDE_B = "Zz Cal Cedar & Zz Dot Dale";
export const SIDE_B3 = "Zz Cal Cedar & Zz Eve Elm";

export interface DoorsClub {
  org: string;
  event: string;
  eventName: string;
  token: string;
  /** In round order. */
  rounds: Array<{ stage: string; code: string; match: string }>;
  players: { ann: string };
}

export async function seedDoorsClub(
  prisma: PrismaClient,
  mark: string,
  opts: { visibility: "public" | "participants" | "staff"; rounds: 1 | 3; withholdAnn?: boolean },
): Promise<DoorsClub> {
  const org = await prisma.organization.create({ data: { name: `${mark} society`, kind: "society" } });
  const token = `${mark}-${Math.random().toString(36).slice(2, 10)}`;
  const eventName = `${mark} Autumn Cup`;
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: eventName,
      status: "live",
      shape: "single",
      format: "match",
      dates: "",
      course: "Home",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: token,
      customPars: JSON.stringify(new Array(18).fill(4)),
      customYards: JSON.stringify(new Array(18).fill(380)),
      customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
      playerAccess: "code",
      scoreEntryBy: "players",
      scoreEntryWindow: "during",
      leaderboardVisibility: opts.visibility,
    },
  });
  const [reds, golds] = await Promise.all(
    ["Zz Reds", "Zz Golds"].map((name, position) => prisma.group.create({ data: { eventId: event.id, name, position } })),
  );
  const person = (name: string, groupId: string, i: number, extra: { publicNameWithheld?: boolean } = {}) =>
    prisma.player.create({
      data: { eventId: event.id, groupId, name, email: `${mark}-${i}@example.invalid`, status: "confirmed", seed: i + 1, handicap: 0, ...extra },
    });
  const ann = await person("Zz Ann Ash", reds.id, 0, { publicNameWithheld: !!opts.withholdAnn });
  const bea = await person("Zz Bea Birch", reds.id, 1);
  const cal = await person("Zz Cal Cedar", golds.id, 2);
  const dot = await person("Zz Dot Dale", golds.id, 3);
  const eve = await person("Zz Eve Elm", golds.id, 4);

  const rounds: DoorsClub["rounds"] = [];
  for (let r = 0; r < opts.rounds; r++) {
    const code = randomCode();
    const stage = await prisma.stage.create({
      data: {
        eventId: event.id,
        position: r,
        type: "Team Session",
        format: "Four-Ball",
        description: "Front nine four-balls",
        scoringBasis: "gross",
        holes: 9,
        nine: "front",
        accessCode: code,
        lineupPublished: true,
        matchKeptBy: "holes",
      },
    });
    const carrier = await prisma.group.create({
      data: { eventId: event.id, name: "Four-Ball — cup session", position: 10 + r, stageId: stage.id, isCarrier: true },
    });
    const side = (name: string, flight: string, members: string[]) =>
      prisma.team.create({
        data: { eventId: event.id, stageId: stage.id, name, clubGroupId: flight, members: { create: members.map((playerId, position) => ({ playerId, position })) } },
      });
    const sa = await side(SIDE_A, reds.id, [ann.id, bea.id]);
    const third = r === 2;
    const sb = await side(third ? SIDE_B3 : SIDE_B, golds.id, third ? [cal.id, eve.id] : [cal.id, dot.id]);
    const match = await prisma.match.create({
      data: {
        eventId: event.id,
        stageId: stage.id,
        groupId: carrier.id,
        round: 1,
        playerAId: "",
        playerBId: "",
        teamAId: sa.id,
        teamBId: sb.id,
        holes: JSON.stringify(new Array(9).fill(null)),
      },
    });
    rounds.push({ stage: stage.id, code, match: match.id });
  }
  return { org: org.id, event: event.id, eventName, token, rounds, players: { ann: ann.id } };
}

export async function removeDoorsClub(prisma: PrismaClient, club: Pick<DoorsClub, "org" | "event"> | null): Promise<void> {
  if (!club) return;
  if (club.event) await prisma.event.deleteMany({ where: { id: club.event } });
  if (club.org) await prisma.organization.deleteMany({ where: { id: club.org } });
}

/** `ABCDEFGH` as the sign prints it, with a group: `/play#ABCD-EFGH.m<match id>`. */
export const groupLink = (code: string, matchId?: string) => `/play#${code.slice(0, 4)}-${code.slice(4)}${matchId ? `.m${matchId}` : ""}`;
