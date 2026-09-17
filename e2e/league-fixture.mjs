/**
 * AN INTERCLUB LEAGUE, AT THE SIZE ONE ACTUALLY IS.
 *
 * Twelve clubs nominating six pairs a week — Ajay's league, stated as "12
 * teams, 6 paires each" — which is thirty-six four-balls across six meetings
 * on a Thursday night.
 *
 * WHY IT IS HERE AT ALL. The league shipped across five pull requests and not
 * one of its screens had ever been RENDERED by a browser test. `layout.spec`
 * sweeps every route at three viewports and visits `/teams` and `/week` on
 * every run — but the tournament it visits them with is a stroke-play medal
 * with no clubs, so `LeagueSection` returns null and the sweep measures an
 * empty page. Twelve-row table, six meetings, a play-off bracket: none of it
 * had a width anybody had checked.
 *
 * That is the same gap `verify-lifecycle.mjs` exists for one layer down — a
 * green sweep over the seeded demo says nothing about the states the demo is
 * not in — and it is not hypothetical. The fourth role on `/organization`
 * pushed a 320px phone sideways on 2026-09-17 and only CI saw it, because a
 * control is exactly as wide as the data it is given.
 *
 * SHAPE. Week one is played with real cards, so the table has numbers and an
 * order that is not the alphabet. Week two is drawn and unplayed, which is
 * what a Thursday afternoon looks like. Two more four-ball rounds sit behind
 * them with `leaguePlayoffClubs: 4`, so `splitSeason` reads them as the semis
 * and the final and the bracket renders off the season's top four.
 *
 * Marked and invented like every other fixture here, and it cascades off the
 * event, so `teardown()` takes all of it with the event row.
 */

/**
 * ONE LONG NAME, NOT TWELVE. The fixture's own note above `CLUB_NAME` says why:
 * a field where every string is long tests the wide case and quietly stops
 * testing the ordinary one. So eleven clubs are named the way clubs are named
 * and one carries the em dash, the curly apostrophe and the ampersand that
 * this repo has been bitten by — in a table where the club column is the one
 * that has to give way.
 */
const CLUBS = [
  "Ravenswood — Men’s & Ladies’ Artisan Golf Club",
  "Ravensworth",
  "Kingsmoor",
  "Ashbourne",
  "Deer Park",
  "Whitfield",
  "Ellerslie",
  "Longmead",
  "Farnworth",
  "Calderbrook",
  "Hazelmere",
  "Stonyhurst",
];

const PAIRS_PER_CLUB = 6;

/** A flat card of `n` at every hole — a par-4 course, so `n` is the score. */
const flat = (n) => JSON.stringify(new Array(18).fill(n));

/**
 * Seed the league into an existing organization.
 *
 * Returns the ids and signed cookies the league spec needs; everything else it
 * reads off the screen, which is the point of the spec.
 */
export async function seedLeague(prisma, { org, mark, sign, dayOffset, randomBytes }) {
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${mark}-Thursday Interclub — Men’s & Ladies’ League`,
      status: "live",
      shape: "series",
      format: "stroke",
      formationRule: "balanced",
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      capacity: 0,
      // The switch. Without a points system the section is an invitation to
      // turn one on, and none of the league renders at all.
      leaguePoints: "holes-and-match",
      leagueMatchBonus: 2,
      leaguePairs: PAIRS_PER_CLUB,
      leaguePlayoffClubs: 4,
      customPars: flat(4),
      customYards: JSON.stringify(new Array(18).fill(400)),
      customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
      shareToken: randomBytes(12).toString("hex"),
      registrationToken: randomBytes(8).toString("hex"),
    },
  });

  const week = [];
  for (const [i, spec] of [
    { label: "Week 1", offset: -7 },
    { label: "Week 2", offset: 0 },
    { label: "Semi-finals", offset: 7 },
    { label: "Final", offset: 14 },
  ].entries()) {
    week.push(
      await prisma.stage.create({
        data: {
          eventId: event.id,
          position: i,
          description: spec.label,
          type: "Round Robin",
          format: "Four-Ball",
          holes: 18,
          scoringBasis: "gross",
          handicapAllowance: 100,
          playedOn: dayOffset(spec.offset),
        },
      }),
    );
  }

  // Clubs are flights: no stage, not carriers. `flightsIn` is that query.
  const clubs = [];
  for (const [i, name] of CLUBS.entries()) {
    clubs.push(await prisma.group.create({ data: { eventId: event.id, name, position: i } }));
  }

  /**
   * Twelve players a club — six pairs of two — created once and nominated in
   * both weeks, which is what a club's roster is.
   */
  const roster = [];
  let memberEmail = "";
  for (const [c, club] of clubs.entries()) {
    const own = [];
    for (let k = 0; k < PAIRS_PER_CLUB * 2; k += 1) {
      const email = `${mark}-league-${c}-${k}@example.invalid`;
      if (!memberEmail) memberEmail = email;
      own.push(
        await prisma.player.create({
          data: {
            eventId: event.id,
            // Short, so the CLUB column is the one under pressure in the table
            // and a wide row cannot be blamed on a name.
            name: `${club.name.split(" ")[0].slice(0, 9)} ${k + 1}`,
            email,
            handicap: 0,
            seed: k + 1,
            status: "confirmed",
            groupId: club.id,
          },
        }),
      );
    }
    roster.push(own);
  }

  /**
   * A week: every club nominates its six pairs, the clubs are drawn in order
   * (1 v 2, 3 v 4, …) and each meeting plays its six four-balls.
   *
   * `scoreOf` decides the cards. Club 0 shoots 3s, club 11 shoots 6s, so the
   * table has a REAL ORDER rather than a pile of halved matches — the trap
   * `matrix.test.ts` records, where a fixture in which nobody wins anything
   * cannot tell a correct leaderboard from an inverted one.
   */
  async function playWeek(stage, scored) {
    const carrier = await prisma.group.create({
      data: { eventId: event.id, stageId: stage.id, isCarrier: true, name: "fixtures", position: 99 },
    });
    const sides = [];
    for (const [c, club] of clubs.entries()) {
      const own = [];
      for (let p = 0; p < PAIRS_PER_CLUB; p += 1) {
        const a = roster[c][p * 2];
        const b = roster[c][p * 2 + 1];
        const side = await prisma.team.create({
          data: {
            eventId: event.id,
            stageId: stage.id,
            clubGroupId: club.id,
            name: `${a.name} / ${b.name}`,
            seed: p + 1,
          },
        });
        await prisma.teamMember.createMany({
          data: [
            { teamId: side.id, playerId: a.id, position: 0 },
            { teamId: side.id, playerId: b.id, position: 1 },
          ],
        });
        if (scored) {
          // Three at every hole for the first club, six for the last.
          const strokes = flat(3 + Math.round((c / (CLUBS.length - 1)) * 3));
          await prisma.teamScorecard.createMany({
            data: [
              { eventId: event.id, stageId: stage.id, teamId: side.id, playerId: a.id, strokes },
              { eventId: event.id, stageId: stage.id, teamId: side.id, playerId: b.id, strokes },
            ],
          });
        }
        own.push(side);
      }
      sides.push(own);
    }

    // Six meetings, six four-balls in each: seed against seed, which is how a
    // team sheet is read across.
    const matches = [];
    for (let m = 0; m < clubs.length; m += 2) {
      for (let p = 0; p < PAIRS_PER_CLUB; p += 1) {
        matches.push({
          eventId: event.id,
          stageId: stage.id,
          groupId: carrier.id,
          round: 1,
          playerAId: "",
          playerBId: "",
          teamAId: sides[m][p].id,
          teamBId: sides[m + 1][p].id,
          holes: JSON.stringify(new Array(18).fill(null)),
        });
      }
    }
    await prisma.match.createMany({ data: matches });
  }

  await playWeek(week[0], true);
  await playWeek(week[1], false);

  /**
   * The two accounts the spec signs in as. The member is a player of the club
   * that finishes top, so their `/week` has a meeting and a table on it —
   * a read-only league with nothing on it would pass a layout assertion by
   * having no layout.
   */
  const organizer = await prisma.user.create({
    data: {
      email: `${mark}-league-organizer@example.invalid`,
      name: "L. Secretary",
      password: "x:unusable",
    },
  });
  await prisma.account.create({
    data: { eventId: event.id, name: "L. Secretary", email: organizer.email, role: "admin" },
  });
  const member = await prisma.user.create({
    data: { email: memberEmail, name: "Ravenswood One", password: "x:unusable" },
  });
  await prisma.account.create({
    data: { eventId: event.id, name: "Ravenswood One", email: memberEmail, role: "player" },
  });

  return {
    eventId: event.id,
    /** The club that finishes top — the one whose name the spec looks for. */
    topClub: CLUBS[0],
    clubCount: CLUBS.length,
    pairsPerClub: PAIRS_PER_CLUB,
    thisWeekStageId: week[1].id,
    organizer: { session: sign(organizer.id), event: sign(event.id) },
    member: { session: sign(member.id), event: sign(event.id) },
  };
}
