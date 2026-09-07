"use server";

import { prisma } from "@/lib/db";
import { getSession, setActiveEvent } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { organizationForNewEvent, settingsForNewEvent } from "@/lib/services/organization";
import { upsertMember } from "@/lib/services/roster";
import { syncPlayerAccount } from "@/lib/services/player-access";
import { refusalFor } from "@/lib/services/limits";
import { boardChanged } from "@/lib/services/board-refresh";
import { planMatch, type MatchSetupInput } from "@/lib/domain/quick-match";

/**
 * Create a match between two people, whole, in one call.
 *
 * The tournament path asks the same questions across six screens because a
 * tournament genuinely has six screens' worth of decisions in it. A match has
 * about four, and every one of the others has an answer that is right every
 * time: one flight, one round, match play, the field is the two of them.
 *
 * So this makes none of those decisions itself — `planMatch` does, and it is a
 * pure function with a test. What lives here is the writing, in the order the
 * schema requires it: organization, event, roster members, entries, the one
 * flight, the round, and the match itself.
 *
 * WHY THE MATCH ROW IS WRITTEN HERE rather than left to the flight generator:
 * generating flights is what draws a round-robin schedule, and sending someone
 * to a second screen to press "Generate" for a fixture whose two players were
 * known before the event existed is exactly the step this screen removes. The
 * pairing is not a draw. It is the thing they asked for.
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

  const organizationId = await organizationForNewEvent(session.email, session.name);
  const refusal = await refusalFor(organizationId, "activeEvents");
  if (refusal) return { ok: false, error: refusal };

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
      // The club's house defaults still apply — a club that scores everything
      // itself should not find its own match set to player entry — but two
      // people playing each other are the only two who can score it, so the
      // settings that exist to police a field are set to the answer a field of
      // two makes true anyway.
      ...(await settingsForNewEvent(organizationId)),
      scoreEntryBy: "players",
      scoreEntryWindow: "during",
      // Nobody else is watching, and there is no committee to approve a card
      // that both players just agreed on standing on the 18th green.
      scoreApproval: "players",
      attestBy: "opponent",
      attendanceMode: "everyone",
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
      type: "Round Robin",
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
  const playerIds: string[] = [];
  for (const p of plan.players) {
    const memberId = await upsertMember(
      organizationId,
      { name: p.name, email: p.email, handicap: p.handicap, handicapType: "18", handicapSource: "manual" },
      "staff",
    );
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
   * One null per hole — NOT the column's `"[]"` default.
   *
   * `resolveMatch` reads an empty array as nought holes played out of nought
   * remaining, which is a finished match that was halved. So a match created
   * with the default arrived on the dashboard already "Halved", already
   * "Awaiting review", and already counted as a result in — before either
   * player had left the first tee. Every other path that creates a match
   * writes the null array for exactly this reason; this one relied on a schema
   * default that means something else.
   */
  const emptyHoles = JSON.stringify(new Array(plan.holes).fill(null));

  await prisma.match.create({
    data: {
      eventId: event.id,
      stageId: stage.id,
      groupId: group.id,
      round: 1,
      playerAId: playerIds[0],
      playerBId: playerIds[1],
      holes: emptyHoles,
      nine: plan.nine,
      courseId: plan.courseId,
    },
  });

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
