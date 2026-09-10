"use server";

import { prisma } from "@/lib/db";
import { getSession, setActiveEvent } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { organizationForNewEvent, settingsForNewEvent } from "@/lib/services/organization";
import { syncPlayerAccount } from "@/lib/services/player-access";
import { boardChanged } from "@/lib/services/board-refresh";
import { planMatch, type MatchSetupInput } from "@/lib/domain/quick-match";
import { expiryFrom } from "@/lib/domain/round-expiry";

/**
 * Create ONE casual round, whole, in one call.
 *
 * The tournament path asks the same questions across six screens because a
 * tournament genuinely has six screens' worth of decisions in it. A casual
 * round has about four, and every one of the others has an answer that is
 * right every time: one flight, one round, the field is whoever is playing.
 *
 * So this makes none of those decisions itself — `planMatch` does, and it is a
 * pure function with a test. What lives here is the writing, in the order the
 * schema requires it: organization, event, roster members, entries, the one
 * flight, the round, and — only for a head-to-head — the match itself.
 *
 * ONE round, and no way to ask for a second. Not a limitation: a sequence of
 * rounds carrying a standing between them is a competition, and a competition
 * is what the tournament builder is for. This screen ends when the round does.
 *
 * WHY THE MATCH ROW IS WRITTEN HERE rather than left to the flight generator:
 * generating flights is what draws a round-robin schedule, and sending someone
 * to a second screen to press "Generate" for a fixture whose two players were
 * known before the event existed is exactly the step this screen removes. The
 * pairing is not a draw. It is the thing they asked for.
 *
 * And it is written ONLY when there is one to write. A four-person medal has
 * no head-to-head in it, and a `Match` row on such a round is a fixture nobody
 * played — sitting in the schedule, counted as a result, and halved on arrival
 * because nobody will ever put a hole on it.
 */
export interface CreateMatchResult {
  ok: boolean;
  error?: string;
  eventId?: string;
}

export async function createMatch(input: MatchSetupInput): Promise<CreateMatchResult> {
  const session = await getSession();
  if (!session) throw new Error("Not authenticated");

  const planned = planMatch(input);
  if (!planned.ok) return { ok: false, error: planned.error };
  const plan = planned.plan;

  /**
   * An organization, because every event needs one — never a CLUB the player
   * has to think about.
   *
   * `organizationForNewEvent` returns the person's own personal organization,
   * creating it if this is the first thing they have ever made. That is a
   * billing boundary and a place to hang rows, and on this path it is
   * plumbing: somebody playing their mate on Sunday is not starting a club,
   * and the sidebar of a casual round no longer offers them one.
   */
  const organizationId = await organizationForNewEvent(session.email, session.name);

  /**
   * NO PLAN CHECK, and its absence is the feature.
   *
   * This asked `refusalFor(organizationId, "activeEvents")` — the allowance on
   * how many TOURNAMENTS an organization may have running — and got it wrong
   * in both directions at once. A Sunday fourball consumed a slot the club was
   * paying for, and a club sitting at its cap was refused a casual round
   * entirely: the app declining a free feature because a paid one was full.
   *
   * A casual round is the free thing anybody can do, club or no club. It is
   * capped by what it IS rather than by a plan — two to eight players, one
   * round, and it deletes itself after a day — and `activeEventCount` no
   * longer counts these, so the two halves of this agree.
   */

  const event = await prisma.event.create({
    data: {
      organizationId,
      name: plan.name,
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      capacity: 0,
      /**
       * Live from the moment it exists, and never config-locked.
       *
       * A tournament earns its draft phase: entries are still coming in, the
       * draw is not published, and launching is the deliberate act that shows
       * the field its own event. A match has none of that — both players are
       * in it, there is nothing to publish, and leaving it in draft produces a
       * dashboard warning the moment a hole is entered ("results are in, but
       * this tournament hasn't been launched") addressed to a field of two
       * standing on the fairway.
       *
       * `configUnlocked` is the other half and is not an oversight: live
       * normally locks configuration, because changing a format under a field
       * that has already been told what it is playing is a real harm. Two
       * people who decide on the 1st tee to play nine instead of eighteen are
       * not betraying anybody's expectations — they ARE the expectations.
       */
      status: "live",
      configUnlocked: true,
      shape: "match",
      /**
       * SET, not left to the column default — which is "match".
       *
       * `isStroke` is `event.format === "stroke"` and nothing else: the
       * STAGE's format does not set it, however plainly the stage says Stroke
       * Play. So a medal round created without this line has no ranked
       * standings at all — an empty leaderboard and an honours board reporting
       * "no ranked results" for a round three people have just finished. That
       * trap was walked into once while seeding a fixture on 2026-09-07, and
       * the only reason it was caught is that the fixture was being read
       * rather than assumed.
       */
      format: plan.eventFormat,
      /**
       * A casual round keeps itself for a day and then deletes itself.
       *
       * THE ONLY PLACE THIS COLUMN IS EVER WRITTEN, which is the whole safety
       * argument for the sweep: a tournament has no expiry, has never had one,
       * and there is no code path that could give it one. See
       * `domain/round-expiry.ts`.
       *
       * The player is told, on this round's own screen, with a button that
       * clears it. A default that destroys something needs an exit before it
       * ships, and `keepRound` is it.
       */
      expiresAt: expiryFrom(new Date()),
      // The club's house defaults still apply — a club that scores everything
      // itself should not find its own match set to player entry — but two
      // people playing each other are the only two who can score it, so the
      // settings that exist to police a field are set to the answer a field of
      // two makes true anyway.
      ...(await settingsForNewEvent(organizationId)),
      /**
       * NOT PUBLIC, whatever the club's default is.
       *
       * This was the one setting in this group left inherited, and it is the
       * one with a person on the other end of it. `leaderboardVisibility:
       * "public"` means, in the app's own words where it is declared, "a
       * read-only link anyone can open, no sign-in. Shows player names and
       * scores."
       *
       * A club choosing that for its tournaments is making a reasonable
       * decision about ITS competitions, where entrants signed up knowing
       * there is a leaderboard. A casual round's players did not sign up for
       * anything: a guest is somebody's mate, entered by a third party, who
       * needs no account and is deliberately not in the roster. Publishing
       * their name is a decision nobody made about them, taken by inheritance
       * from a setting they have never seen.
       *
       * Demonstrated rather than assumed on 2026-09-09: a casual round given
       * that visibility served both guests' names to an unauthenticated
       * request, with the round's title — built from those names — as the page
       * title. `noindex` keeps it out of search results and does nothing about
       * the link itself.
       *
       * "participants" rather than "staff": a member picked off the roster can
       * sign in and should see the round they are playing. What changes is
       * that sharing it becomes a DECISION — the round stays `configUnlocked`,
       * so anyone who does want a public link can turn one on.
       */
      leaderboardVisibility: "participants",
      scoreEntryBy: "players",
      scoreEntryWindow: "during",
      // Nobody else is watching, and there is no committee to approve a card
      // that both players just agreed on standing on the 18th green.
      scoreApproval: "players",
      /**
       * Who signs the card, and it is not the same question in the two games.
       *
       * In match play your opponent is standing next to you for every shot,
       * so "opponent" is both the strictest available answer and a free one.
       * In stroke play there IS no opponent — Rule 3.3b gives the job to a
       * MARKER, somebody else in the group who keeps your card — and asking a
       * four-person medal for an opponent's signature names a person the round
       * does not contain. `ruleFrom` would fall back to "marker" anyway, which
       * is the correct answer arrived at by accident; this is it arrived at on
       * purpose, so the stored setting says what the screen will do.
       */
      attestBy: plan.drawsMatch ? "opponent" : "marker",
      attendanceMode: "everyone",
      /**
       * THE GOLF BET, NEVER THE TRAVEL EXPENSES.
       *
       * These are two different kinds of money and only one of them belongs
       * to a casual round. The skins pot is what four friends agreed on the
       * first tee; the split LEDGER is "the minibus, the green fees, dinner"
       * — somebody fronted a cost and everybody owes a share of it, which is
       * a society trip, not a Sunday fourball.
       *
       * Left to resolve, a casual round inherited the ledger from whatever
       * kind of outfit its organization happened to be — and
       * `organizationForNewEvent` creates a PERSONAL organization, which
       * defaults to `ledger: true`. So every quick round set up by somebody
       * with no club at all — the free-tier case this whole path exists for —
       * arrived in "split shared costs" mode, offering to work out who owes
       * whom for a minibus nobody hired.
       *
       * "none" is precisely the right mode rather than a way of switching
       * money off, and `MONEY_MODE_LABEL` says so where it is declared: what
       * it turns off is the app handling FEES AND SHARED COSTS. "Skins, 2s
       * and side bets are still worked out and shown to the players." That is
       * the whole of a casual round's money and all of it still works.
       *
       * Set explicitly here rather than resolved, because a resolution reads
       * three levels of setting that all belong to a club, and this round
       * belongs to nobody's club.
       */
      moneyMode: "none",
    },
  });

  if (plan.courseId) {
    await prisma.eventCourse.create({ data: { eventId: event.id, courseId: plan.courseId } });
  }

  // One flight, because a match is played in one group. Created rather than
  // generated: the flight builder exists to divide a field, and there is
  // nothing here to divide.
  const group = await prisma.group.create({
    data: { eventId: event.id, name: "A", position: 0 },
  });

  const stage = await prisma.stage.create({
    data: {
      eventId: event.id,
      position: 0,
      /**
       * The type the plan chose, not "Round Robin, always".
       *
       * `stage-types.ts` is explicit about what the hard-coded version costs:
       * a round robin set to Stroke Play "generated a full set of pairings for
       * a round in which nobody plays anybody". A medal is a "Stroke Play
       * Round", which draws none.
       */
      type: plan.stageType,
      /**
       * What this round asks a scorer for.
       *
       * Set by the MONEY, and only by the money — see `MatchPlan.scoreInput`.
       * A skins pot settles off strokes, and match play's natural input is who
       * won the hole, so without this the commonest setup there is creates a
       * pot that can never be decided.
       */
      scoreInput: plan.scoreInput,
      description: "",
      format: plan.format,
      holes: plan.holes,
      nine: plan.nine,
      scoringBasis: plan.scoringBasis,
      courseId: plan.courseId,
    },
  });

  /**
   * The organizer's own access, granted BEFORE the entries.
   *
   * Order matters and the reason is easy to miss: an entry with an address
   * gets a sign-in through `syncPlayerAccount`, whose upsert writes role
   * "player" on create and only the name on update. The organizer is usually
   * one of the two players and usually enters under their own address, so
   * creating this row second would either collide on `(eventId, email)` or,
   * worse, leave the person who set the match up holding a player's access to
   * it. Admin first; the upsert below then finds it and touches nothing but
   * the name.
   */
  await prisma.account.create({
    data: { eventId: event.id, name: session.name, email: session.email, role: "admin" },
  });

  /**
   * The organizer's own entry carries their address; their opponent's may not.
   *
   * That asymmetry is the point rather than an oversight. An address is what
   * grants a sign-in, and the person who set the match up needs one so the
   * round appears under "My round". The other player needs one only if they
   * are going to score from their own phone — and the commonest Sunday match
   * has one phone out, held by whoever set it up. Demanding the second address
   * is what stopped a match being created at all.
   */
  /**
   * WHICH OF THESE NAMES IS ACTUALLY A MEMBER OF THIS CLUB.
   *
   * Re-read from the roster rather than believed. `memberId` arrives from a
   * form, and an id belonging to another club would otherwise attach a
   * stranger's handicap and history to this round — so the query is scoped to
   * this organization and anything it does not return is treated as a guest.
   * The failure direction is deliberate: an unrecognised id becomes a guest,
   * which creates nothing and links nothing, rather than a hard error on the
   * first tee.
   *
   * One query for the lot, not one per player.
   */
  const claimed = plan.players.map((p) => p.memberId).filter(Boolean);
  const members = claimed.length
    ? await prisma.member.findMany({
        where: { organizationId, id: { in: claimed } },
        select: { id: true },
      })
    : [];
  const realMembers = new Set(members.map((m) => m.id));

  const playerIds: string[] = [];
  for (const p of plan.players) {
    const memberId = realMembers.has(p.memberId) ? p.memberId : null;

    /**
     * A GUEST IS NOT ADDED TO THE CLUB.
     *
     * This called `upsertMember` for every name, so a Sunday fourball put
     * somebody's brother-in-law on the club's member list permanently. Wrong
     * twice: it fills a roster with people who are not members, and — because
     * a member with no email is matched BY NAME — a second, different Dave
     * entered months later lands on the first Dave's row and overwrites his
     * index. That second failure is silent and corrupts a real member's
     * handicap.
     *
     * So a guest becomes a `Player` on this event and nothing else. Named,
     * given a handicap, scored, and gone with the round. A member keeps their
     * id, which is what makes their handicap the club's own rather than a copy
     * that drifts from it.
     *
     * `Player.memberId` is nullable and always has been, so a guest is not a
     * new shape — it is the shape the column was for.
     */
    const player = await prisma.player.create({
      data: {
        eventId: event.id,
        memberId,
        groupId: group.id,
        name: p.name,
        email: p.email,
        handicap: p.handicap,
        handicapType: "18",
        handicapSource: "manual",
        seed: p.seed,
        status: "confirmed",
      },
    });
    playerIds.push(player.id);
    await syncPlayerAccount(event.id, p.name, p.email);
  }

  /**
   * The sides, for a pairs round.
   *
   * Written from the plan's own grouping rather than paired up again here —
   * `sidesFrom` decided it, the setup screen displayed that decision above the
   * name fields, and this writes the thing the players were shown.
   *
   * `position` is not cosmetic and is why the seeds are stored in order:
   * foursomes alternate who tees off on odd and even holes, so a side is a
   * sequence. The schema says so where it declares the column.
   */
  const teamIds: string[] = [];
  for (const [i, side] of plan.sides.entries()) {
    const team = await prisma.team.create({
      data: { eventId: event.id, stageId: stage.id, name: side.name, seed: i + 1 },
    });
    teamIds.push(team.id);
    await prisma.teamMember.createMany({
      data: side.seeds.map((seed, position) => ({
        teamId: team.id,
        playerId: playerIds[seed - 1],
        position,
      })),
    });
  }

  /**
   * The fixture, for the round types that have one.
   *
   * A medal falls straight past this: the cards ARE the round, and every
   * result comes off `Scorecard`. See the note at the top of the file for what
   * a `Match` row on a stroke round does instead of nothing.
   */
  if (plan.drawsMatch) {
    /**
     * One null per hole — NOT the column's `"[]"` default.
     *
     * `resolveMatch` reads an empty array as nought holes played out of nought
     * remaining, which is a finished match that was halved. So a match created
     * with the default arrived on the dashboard already "Halved", already
     * "Awaiting review", and already counted as a result in — before either
     * player had left the first tee. Every other path that creates a match
     * writes the null array for exactly this reason; this one relied on a
     * schema default that means something else.
     */
    const emptyHoles = JSON.stringify(new Array(plan.holes).fill(null));

    await prisma.match.create({
      data: {
        eventId: event.id,
        stageId: stage.id,
        groupId: group.id,
        round: 1,
        /**
         * ONE pair of columns, never both.
         *
         * The schema is explicit: in a team format the team columns hold the
         * sides and the player columns are empty, "deliberately not repurposed
         * to hold a team id, because a column whose meaning depends on the
         * round's format is the kind of thing that silently mis-joins a year
         * later". A four-ball match filling BOTH would name two of its four
         * players as the individual sides, and every reader that checks the
         * player columns first — `matchSidesOf` among them — would score a
         * pairs match as a singles between whoever was typed in first.
         */
        playerAId: plan.sides.length ? "" : playerIds[0],
        playerBId: plan.sides.length ? "" : playerIds[1],
        teamAId: plan.sides.length ? teamIds[0] : "",
        teamBId: plan.sides.length ? teamIds[1] : "",
        holes: emptyHoles,
        nine: plan.nine,
        courseId: plan.courseId,
      },
    });
  }

  /**
   * The money game, if they said they were playing for something.
   *
   * Created HERE rather than left to the money screen, because "we're in for a
   * fiver" is agreed on the first tee at the same moment as everything else,
   * and a second screen to go and say so afterwards is the step this whole
   * path exists to remove.
   *
   * `groupKey: ""` — the FIELD's game. On a casual round the whole field is
   * the group, which is the same coincidence `/group-games` relies on:
   * `potAudience` returns the field for the empty key, so everyone playing is
   * in it with no tee sheet and nobody ticking names.
   *
   * TourneyHQ works out who owes whom. It never moves the money.
   */
  if (plan.money) {
    if (plan.money.game.pot === "skins") {
      const pot = await prisma.skinsPot.create({
        data: {
          eventId: event.id,
          stageId: stage.id,
          buyInCents: plan.money.stakeCents,
          // Empty unless they are playing for something that is not money.
          stakeNote: plan.money.stakeNote,
          // Net follows the round: a level round's skins are gross, and a
          // net pot on a round played off scratch would allocate shots the
          // players agreed not to give.
          net: plan.scoringBasis === "net",
          scope: plan.nine,
          groupKey: "",
        },
      });

      /**
       * Everybody in, because everybody said so.
       *
       * A skins pot is opt-in and has no "everyone" mode, so the rows have to
       * be written. `confirmed` is true, and the schema is careful that this
       * means somebody HAS the cash rather than intends to — which is exactly
       * what it means here: this is not an organizer ticking forty names, it
       * is the person who set the round up recording what the group just
       * agreed standing on the tee.
       */
      await prisma.skinsEntry.createMany({
        data: playerIds.map((playerId) => ({ potId: pot.id, playerId })),
      });
    } else {
      await prisma.sideGame.create({
        data: {
          eventId: event.id,
          stageId: stage.id,
          kind: plan.money.game.kind ?? "",
          buyInCents: plan.money.stakeCents,
          // Empty unless they are playing for something that is not money.
          stakeNote: plan.money.stakeNote,
          /**
           * OPT-OUT, which skins cannot be and this can.
           *
           * Everyone in the round is in unless they say otherwise — the mode
           * `pot-entry.ts` describes as how a weekly league actually runs, and
           * a casual round is the purest case of it. No rows to write and none
           * to forget: a player is in because they are playing.
           */
          entryMode: "opt-out",
          groupKey: "",
          createdBy: session.name,
        },
      });

    }
  }

  await setActiveEvent(event.id);
  /**
   * Both, and they are not the same thing.
   *
   * `revalidatePath` clears the router cache. The public board is a separate
   * `unstable_cache` entry keyed per event, and it does not touch it — so a
   * match created without `boardChanged` would sit behind that cache until its
   * sixty-second backstop expired. `board-invalidation.test.ts` swept this
   * file the day it was added and failed it, which is the guard working: this
   * action creates players and a match, and both are read by the board.
   */
  revalidatePath("/", "layout");
  boardChanged(event.id);
  return { ok: true, eventId: event.id };
}
