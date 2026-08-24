import { COURSE_REF } from "./course-resolution";
import { roundTeeId } from "./handicaps";
import "server-only";
import { prisma } from "../db";
import { formGroups, roundRobinSchedule } from "../domain";
import { survivors, isCutScope, nextRoundFlights } from "../domain/cut";
import type { FormationRule, FlightConfig, Player as DomainPlayer } from "../domain";
import { needsTeams } from "../formats";
import { generatesPairings, isPlayingRound } from "../stage-types";
import { courseHandicapMap } from "../domain";
import { resolveCourse } from "../courses";
import { chainRoundStandings, scoringFrom, parseMatchTiebreakers, roundRobinStages } from "./tournament";

/**
 * Re-form flights for an event from its confirmed players using the stored rule
 * and flight configuration, then regenerate the round-robin schedule (empty
 * matches) for every Round Robin stage that doesn't have a cut line — a
 * tournament can sequence more than one round, and each gets its own full
 * round-robin among the same flights. Stages with a cut line are left empty
 * here; they're built by generateNextRound once the previous round's results
 * decide who advances.
 *
 * This is the intended-destructive "Generate flights" action: it discards any
 * existing round-robin matches (and their scores), since roster/rule changes
 * invalidate the schedule. In production this would be guarded once live scores
 * exist (see handoff README); the UI previews the result before committing.
 */
/**
 * How many Round Robin matches already have a hole result recorded.
 *
 * Regenerating flights deletes and rebuilds every Round Robin match, so this
 * is the number that says whether doing so destroys real results. It counts
 * scored matches rather than reading `Event.status`, because status is a label
 * an organizer sets by hand — a tournament can be 83% played and still say
 * "draft" if nobody pressed Launch. Actual scores can't be forgotten about.
 */
export async function scoredMatchCount(eventId: string): Promise<number> {
  const rrStages = await prisma.stage.findMany({
    where: { eventId, type: "Round Robin" },
    select: { id: true },
  });
  if (!rrStages.length) return 0;

  const matches = await prisma.match.findMany({
    where: { eventId, stageId: { in: rrStages.map((s) => s.id) } },
    select: { holes: true },
  });

  return matches.filter((m) => {
    try {
      const holes = JSON.parse(m.holes) as unknown[];
      return Array.isArray(holes) && holes.some((h) => h !== null);
    } catch {
      return false;
    }
  }).length;
}

/**
 * Repair one player's pairings after they have been moved between flights.
 *
 * Moving a player used to change nothing but a foreign key. The round-robin
 * matches drawn for the old flight stayed exactly where they were, so the
 * player still had a full card of matches against a flight they were no longer
 * in — and none at all against the flight they had joined. The flight standings
 * then showed them in one flight with results earned in another, and the
 * players who *were* in their new flight were a match short each, for good.
 * Nothing warned about any of it; the counts still added up.
 *
 * Surgical on purpose. Only matches involving this player are touched, so
 * every other pairing in both flights keeps its result. The moved player's own
 * results are discarded, because they were played against opponents this
 * player is no longer scheduled to meet — that is the one thing a move cannot
 * preserve, and the caller confirms it first.
 *
 * Round numbers are chosen per stage as the first round in which neither side
 * is already playing, so nobody ends up in two matches at once.
 */
export async function repairPlayerPairings(eventId: string, playerId: string): Promise<void> {
  const player = await prisma.player.findFirst({
    where: { id: playerId, eventId },
    select: { id: true, groupId: true, status: true },
  });
  if (!player) return;

  const stages = await prisma.stage.findMany({
    where: { eventId, type: "Round Robin" },
    orderBy: { position: "asc" },
  });
  // The same three exclusions regenerateGroupsAndSchedule applies: a cut-gated
  // round is drawn from results it doesn't have yet, a team round is played
  // side against side, and a medal round has no opponents at all.
  const drawable = stages.filter(
    (s) => !s.cutEnabled && !needsTeams(s.format) && generatesPairings(s.type),
  );
  if (drawable.length === 0) return;

  const flightMates =
    player.groupId && player.status === "confirmed"
      ? await prisma.player.findMany({
          where: { eventId, groupId: player.groupId, status: "confirmed", id: { not: playerId } },
          orderBy: { seed: "asc" },
          select: { id: true },
        })
      : [];

  await prisma.$transaction(async (tx) => {
    for (const stage of drawable) {
      await tx.match.deleteMany({
        where: {
          eventId,
          stageId: stage.id,
          OR: [{ playerAId: playerId }, { playerBId: playerId }],
        },
      });

      if (!player.groupId || flightMates.length === 0) continue;

      // Rounds already spoken for, per opponent, so a repaired match never
      // double-books either side.
      const rest = await tx.match.findMany({
        where: { eventId, stageId: stage.id },
        select: { round: true, playerAId: true, playerBId: true },
      });
      const busy = new Map<string, Set<number>>();
      const mark = (id: string, r: number) => {
        const set = busy.get(id) ?? new Set<number>();
        set.add(r);
        busy.set(id, set);
      };
      for (const m of rest) {
        mark(m.playerAId, m.round);
        mark(m.playerBId, m.round);
      }

      const emptyHoles = JSON.stringify(new Array(stage.holes === 9 ? 9 : 18).fill(null));
      for (const mate of flightMates) {
        let round = 1;
        while (busy.get(playerId)?.has(round) || busy.get(mate.id)?.has(round)) round += 1;
        mark(playerId, round);
        mark(mate.id, round);
        await tx.match.create({
          data: {
            eventId,
            stageId: stage.id,
            groupId: player.groupId,
            round,
            playerAId: playerId,
            playerBId: mate.id,
            holes: emptyHoles,
          },
        });
      }
    }
  });
}

export async function regenerateGroupsAndSchedule(eventId: string): Promise<void> {
  const event = await prisma.event.findUnique({ where: { id: eventId }, include: COURSE_REF });
  if (!event) return;

  const formationRule = event.formationRule as FormationRule;
  const config: FlightConfig = {
    mode: (["auto", "count", "perFlight"].includes(event.flightMode)
      ? event.flightMode
      : "auto") as FlightConfig["mode"],
    value: event.flightValue > 0 ? event.flightValue : undefined,
  };

  const confirmed = await prisma.player.findMany({
    where: { eventId, status: "confirmed" },
    orderBy: { seed: "asc" },
  });

  // Flights must be balanced on the same number the round is scored on.
  // This built its players from the raw stored handicap while scoring used a
  // Course Handicap — so a handicap-balanced draw was balanced on indexes,
  // and over nine holes it was balanced on doubled ones. Both are the same
  // mistake as using an index where a Course Handicap belongs, and neither
  // shows a symptom: the flights just come out subtly uneven.
  const [allStages, tees] = await Promise.all([
    prisma.stage.findMany({ where: { eventId }, orderBy: { position: "asc" } }),
    prisma.tee.findMany({
      where: { course: { events: { some: { eventId } } } },
      orderBy: [{ position: "asc" }],
    }),
  ]);
  const activeHoles = allStages.filter((s) => isPlayingRound(s.type))[0]?.holes === 9 ? 9 : 18;
  const teeRatings = new Map(
    tees.map((t) => [t.id, { courseRating: t.courseRating, slopeRating: t.slopeRating, par: t.par }]),
  );
  const courseHcp = courseHandicapMap(
    confirmed,
    teeRatings,
    roundTeeId(tees, event?.defaultTeeId),
    activeHoles,
    event?.teePolicy ?? "own",
  );

  const domainPlayers: DomainPlayer[] = confirmed.map((p) => ({
    id: p.id,
    name: p.name,
    handicap: courseHcp.get(p.id) ?? p.handicap,
    seed: p.seed,
  }));
  const groups = formGroups(domainPlayers, formationRule, config);

  const rrStages = await prisma.stage.findMany({
    where: { eventId, type: "Round Robin" },
    orderBy: { position: "asc" },
  });

  await prisma.$transaction(async (tx) => {
    if (rrStages.length) {
      await tx.match.deleteMany({ where: { eventId, stageId: { in: rrStages.map((s) => s.id) } } });
    }
    await tx.player.updateMany({ where: { eventId }, data: { groupId: null } });
    await tx.group.deleteMany({ where: { eventId } });

    const groupIdByEngineId = new Map<string, string>();
    for (let i = 0; i < groups.length; i += 1) {
      const g = groups[i];
      const created = await tx.group.create({
        data: { eventId, name: g.name, position: i },
      });
      groupIdByEngineId.set(g.id, created.id);
      if (g.playerIds.length) {
        await tx.player.updateMany({
          where: { id: { in: g.playerIds } },
          data: { groupId: created.id },
        });
      }
    }

    for (const rrStage of rrStages) {
      // Cut-gated stages are built separately (generateCutRound), once the
      // preceding round's real results decide who's still in the field.
      if (rrStage.cutEnabled) continue;
      // A team round is played side against side, so pairing its players
      // individually would fill it with matches nobody plays — and they would
      // count toward the standings. Its matches come from generateTeamMatches
      // on the Teams screen, once the sides are drawn.
      if (needsTeams(rrStage.format)) continue;
      // A medal round has no opponents. Drawing pairings for it produced
      // matches nobody played, which could still be scored and would then
      // count toward the standings — the same failure the team skip above
      // exists to prevent.
      if (!generatesPairings(rrStage.type)) continue;
      const emptyHoles = JSON.stringify(new Array(rrStage.holes === 9 ? 9 : 18).fill(null));
      for (const g of groups) {
        const dbGroupId = groupIdByEngineId.get(g.id)!;
        const schedule = roundRobinSchedule(g.playerIds);
        for (const pairing of schedule) {
          await tx.match.create({
            data: {
              eventId,
              stageId: rrStage.id,
              groupId: dbGroupId,
              round: pairing.round,
              playerAId: pairing.aId,
              playerBId: pairing.bId,
              holes: emptyHoles,
            },
          });
        }
      }
    }
  });
}

/**
 * Build a single cut-gated round from the previous round's results.
 *
 * Separate from the global "Generate flights" reset (regenerateGroupsAndSchedule)
 * because it depends on real scores that only exist once the prior round is
 * played, and it touches only this stage's own data — every other round's is
 * left alone.
 *
 * The cut chains across a format boundary. The field entering the round is the
 * standings after the last Round Robin played before it, so a stroke-play final
 * can be cut from match-play qualifying. What the round is *built as* then
 * follows its own type:
 *
 *   - a round that draws pairings (Round Robin) gets a schedule. A per-flight
 *     cut keeps its flights; an overall cut ranked everyone against everyone and
 *     its survivors land unevenly across the old flights — a flight can be left
 *     with one player, whose round robin is silently no matches — so it reforms
 *     the field into fresh balanced flights (see nextRoundFlights). Reforming
 *     reuses the existing flight rows rather than recreating them, because a
 *     Group's matches cascade-delete with it (schema onDelete: Cascade) and the
 *     played rounds must survive; everyone the cut removed is detached so a
 *     reused row never carries a cut player into the reformed field.
 *
 *   - a round that draws no pairings (Stroke Play / medal) gets an empty,
 *     playable card for each survivor, and none for anyone cut — so the field
 *     of the round is exactly who advanced. Points are not carried across the
 *     boundary (see carryUnitsCompatible); the advancement is what chains.
 */
export async function generateCutRound(eventId: string, stageId: string): Promise<void> {
  const stage = await prisma.stage.findUnique({ where: { id: stageId } });
  // Any round the field plays can be cut into, not only a Round Robin. The cut
  // that qualifies a match-play field into a stroke-play final crosses a format
  // boundary, and keying this off "Round Robin" alone made that impossible.
  if (!stage || stage.eventId !== eventId || !isPlayingRound(stage.type)) return;

  const [event, allStages, confirmed, allMatches, groups] = await Promise.all([
    prisma.event.findUnique({ where: { id: eventId }, include: COURSE_REF }),
    prisma.stage.findMany({ where: { eventId }, orderBy: { position: "asc" } }),
    prisma.player.findMany({ where: { eventId, status: "confirmed" }, orderBy: { seed: "asc" } }),
    prisma.match.findMany({ where: { eventId } }),
    prisma.group.findMany({ where: { eventId }, orderBy: { position: "asc" } }),
  ]);
  if (!event) return;

  const rrStages = roundRobinStages(allStages);
  // groupId carried through so a per-flight cut can be taken flight by flight.
  const domainPlayers: DomainPlayer[] = confirmed.map((p) => ({
    id: p.id,
    name: p.name,
    handicap: p.handicap,
    seed: p.seed,
    groupId: p.groupId,
  }));
  const scoring = scoringFrom(event);
  const holeDifficulty = resolveCourse(event).strokeIndex;

  const scope = stage.cutEnabled
    ? isCutScope(stage.cutScope)
      ? stage.cutScope
      : "overall"
    : "perFlight";

  let survivorIds: Set<string>;
  if (stage.cutEnabled) {
    // The field entering this round is the standings after the last Round Robin
    // played before it — by position, not by adjacency, so a stroke-play final
    // still cuts from the match-play qualifying that fed it. (Cutting from a
    // stroke round is not supported here; the qualifying is a points ladder.)
    const priorRr = rrStages.filter((s) => s.position < stage.position);
    if (priorRr.length === 0) return; // nothing to cut from — use Generate flights instead

    /**
     * Only the players who actually contested the round being cut from.
     *
     * This was every confirmed player in the event, which broke a second cut
     * in two ways at once. A 28-player field cut to 24 still produced 28
     * standings rows, so:
     *
     *   - a percent cut sized itself against 28 rather than the 24 still in —
     *     "top 66%" of a 24-player round let 19 through;
     *   - the four already eliminated sat at 0 points with a hole differential
     *     of 0, which RANKS ABOVE a survivor who played and lost (negative
     *     differential). They were advanced again, and real survivors were cut
     *     in their place.
     *
     * Membership of a match in the last qualifying round is the honest test of
     * who was still in it. Falling back to the whole field when no matches
     * exist keeps a first cut — where nobody has been eliminated yet — working
     * exactly as before.
     */
    const lastPrior = priorRr[priorRr.length - 1];
    const contestedIds = new Set(
      allMatches
        .filter((m) => m.stageId === lastPrior.id)
        .flatMap((m) => [m.playerAId, m.playerBId])
        .filter((id): id is string => !!id),
    );
    const contenders = contestedIds.size
      ? domainPlayers.filter((p) => contestedIds.has(p.id))
      : domainPlayers;

    const chain = chainRoundStandings(
      priorRr,
      allMatches,
      contenders,
      scoring,
      holeDifficulty,
      parseMatchTiebreakers(event.matchTiebreakers),
    );
    const priorStanding = chain[chain.length - 1];
    // The rule covers both axes — how many, and out of what. A per-flight cut
    // takes N from every flight rather than N from the tournament, which is the
    // difference between a bracket of eight and a bracket of two.
    survivorIds = survivors(
      priorStanding.map((rp) => ({ id: rp.player.id, groupId: rp.player.groupId })),
      {
        scope,
        mode: stage.cutMode === "percent" ? "percent" : "count",
        count: stage.cutCount,
        percent: stage.cutPercent,
      },
    );
  } else {
    survivorIds = new Set(confirmed.map((p) => p.id));
  }

  const survivorPlayers = domainPlayers.filter((p) => survivorIds.has(p.id));
  const holeCount = stage.holes === 9 ? 9 : 18;

  // A stroke or medal round draws no pairings — the survivors advance into it
  // by each being given an empty, playable card. Non-survivors get none, so the
  // field of the round is exactly who the cut let through. Match points are not
  // carried here (see carryUnitsCompatible): the advancement is what chains.
  if (!generatesPairings(stage.type)) {
    const emptyStrokes = JSON.stringify(new Array(holeCount).fill(null));
    await prisma.$transaction(async (tx) => {
      await tx.scorecard.deleteMany({ where: { eventId, stageId: stage.id } });
      for (const p of survivorPlayers) {
        await tx.scorecard.create({
          data: { eventId, stageId: stage.id, playerId: p.id, strokes: emptyStrokes },
        });
      }
    });
    return;
  }

  // Reformed against the original players-per-flight, so a rebuilt flight comes
  // out a familiar size rather than one giant round robin.
  const origSizes = groups.map((g) => confirmed.filter((p) => p.groupId === g.id).length);
  const targetPerFlight = origSizes.length ? Math.max(...origSizes) : survivorIds.size;
  const reformed = scope === "overall" && stage.cutEnabled;
  // Seed order in, so a kept flight's pairings match a plain regeneration's; a
  // reform re-sorts by strength internally and ignores the order.
  const flights = nextRoundFlights(survivorPlayers, scope, targetPerFlight).filter(
    (f) => f.playerIds.length >= 2,
  );

  const emptyHoles = JSON.stringify(new Array(holeCount).fill(null));

  await prisma.$transaction(async (tx) => {
    await tx.match.deleteMany({ where: { eventId, stageId: stage.id } });

    if (reformed && flights.length) {
      const placed = flights.flatMap((f) => f.playerIds);
      await tx.player.updateMany({
        where: { eventId, status: "confirmed", id: { notIn: placed } },
        data: { groupId: null },
      });
    }

    for (let i = 0; i < flights.length; i += 1) {
      const flight = flights[i];
      let groupId = flight.keepGroupId ?? groups[i]?.id ?? null;
      if (!groupId) {
        const created = await tx.group.create({
          data: { eventId, name: flight.name || `Flight ${i + 1}`, position: i },
        });
        groupId = created.id;
      }
      if (reformed) {
        await tx.player.updateMany({ where: { id: { in: flight.playerIds } }, data: { groupId } });
      }
      for (const pairing of roundRobinSchedule(flight.playerIds)) {
        await tx.match.create({
          data: {
            eventId,
            stageId: stage.id,
            groupId,
            round: pairing.round,
            playerAId: pairing.aId,
            playerBId: pairing.bId,
            holes: emptyHoles,
          },
        });
      }
    }
  });
}
