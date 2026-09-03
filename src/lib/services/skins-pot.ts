import "server-only";
import { COURSE_REF, courseForRound, cardForStage } from "./course-resolution";
import { roundHandicapRows } from "./round-handicap";
import { roundHandicapOf } from "../domain/round-handicap";
import { teeSetupFor, flightTeeByPlayer } from "./handicaps";
import { prisma } from "../db";
import { playSkins } from "../domain/skins";
import { rankStrokeIndex, holeStrokesReceived } from "../domain/stroke";
import { courseHandicapMap, holesPlayed } from "../domain/handicap";
import {
  skinsPot,
  settle,
  scopeRange,
  isSkinsScope,
  type PotResult,
  type Transfer,
  type SkinsScope,
} from "../domain/skins-pot";
import { resolveCourse } from "../courses";
import { parseTeeSheet } from "../domain/tee-sheet";

/**
 * A week's skins pot, resolved into money.
 *
 * The arithmetic lives in domain/skins-pot.ts and the golf in domain/skins.ts;
 * this only fetches, slices the right nine, and hands the two together.
 *
 * TourneyHQ calculates and records this money. It never moves it.
 */

export interface SkinsPotView {
  potId: string | null;
  buyInCents: number;
  net: boolean;
  scope: SkinsScope;
  /**
   * Players whose STAKE is in the pot — confirmed entries only.
   *
   * A name put down in the app is an intention, not money. Since a player in
   * another fourball can now ask to join, an entry row is no longer proof of
   * cash, and paying the pot out across people who have not put anything in
   * leaves whoever holds it personally short the difference.
   */
  entrantIds: string[];
  /**
   * Asked to join and not yet paid. Listed so somebody in the bet can see the
   * request and take the money — an ask nobody is shown is an ask that was
   * never made.
   */
  pendingIds: string[];
  /** Everyone who could be entered, for the picker. */
  field: Array<{ id: string; name: string; playing: boolean }>;
  /** Null until at least one player is entered — there is no pot before that. */
  result: PotResult | null;
  transfers: Transfer[];
  nameById: Record<string, string>;
  /** Per-hole detail, so the working is visible rather than asserted. */
  holes: Array<{ hole: number; playerId: string | null; value: number; carried: boolean }>;
}

/**
 * Everything the skins screen needs for one round.
 *
 * Returns a view even when no pot exists yet, so the screen can offer to
 * start one without a separate "does it exist" round-trip.
 */
export async function skinsPotFor(
  eventId: string,
  stageId: string,
  /** Which game: gross for the low handicaps, net so everybody has a chance.
   *  A club commonly runs both on the same night, so they are separate pots
   *  with separate entrants and separate money. */
  net: boolean,
  /**
   * And over which holes: the front nine, the back nine, or all of them.
   *
   * Required rather than defaulted, because a default would read the wrong
   * game's money without complaining. A league night has four pots on one
   * round and only the pair (net, scope) tells them apart.
   */
  scope: SkinsScope,
  /**
   * And whose: "" for the field's pot, or a group / side-bet name.
   *
   * REQUIRED, and the default it replaces is the whole reason this argument
   * has to be. `scope` above is required for exactly this stated reason —
   * "a default would read the wrong game's money without complaining" — and
   * `groupKey` was added with a default anyway.
   *
   * Every one of the four callers then forgot it. Each enumerated the pots on
   * a round, including group ones, and re-read each row without a groupKey,
   * so all of them resolved to the FIELD's pot: the club's money counted once
   * per group pot, and every fourball's and side bet's money silently gone.
   * The settle-up, the season table, the week sheet and Prizes were all wrong
   * in the same way, and the ledger's own zero-sum check could not see it
   * because a doubled figure still sums to zero.
   *
   * A guard you must remember to pass is a guard that will be forgotten. This
   * one is now the compiler's to remember.
   */
  groupKey: string,
): Promise<SkinsPotView | null> {
  const [pot, stage, event] = await Promise.all([
    prisma.skinsPot.findUnique({
      where: { stageId_net_scope_groupKey: { stageId, net, scope, groupKey } },
      include: { entrants: true },
    }),
    prisma.stage.findUnique({
      where: { id: stageId },
      // `courseId`, because a league rotates venues. Without it the pot was
      // always scored against the EVENT's card — see the resolution below.
      select: { id: true, eventId: true, holes: true, teeSheet: true, courseId: true, nine: true },
    }),
    prisma.event.findUnique({ where: { id: eventId }, include: COURSE_REF }),
  ]);
  if (!stage || stage.eventId !== eventId || !event) return null;

  const [players, cards, tees] = await Promise.all([
    prisma.player.findMany({
      /**
       * EVERY entry, not only the confirmed ones.
       *
       * This filtered to `status: "confirmed"`, so a player who paid into the
       * pot and was later withdrawn disappeared from it entirely — their
       * stake with them. The pot shrank by £20 after the money had been
       * handed over: the Prizes screen printed "2 × £20.00 = £20.00", listed
       * the withdrawn entrant as "—" because no name could be found for them,
       * and the player who won every skin took nothing, because the pot they
       * won was one stake short. The player's own money card still said £40,
       * so the app disagreed with itself about a sum of cash.
       *
       * A stake is paid or it is not. Withdrawing from a tournament is not a
       * refund — CLAUDE.md rule 7 says this app records money rather than
       * moving it, which makes the record the only thing there is, and a
       * record that quietly drops a payment is worse than no record.
       *
       * `status` comes back so the two questions stay separate below: whose
       * money is in the pot, and who is still in the field to be offered one.
       */
      where: { eventId },
      /**
       * `teeId`, NOT `preferredTee`.
       *
       * They are different columns: `teeId` is the set this entry plays from,
       * a relation; `preferredTee` is free text a golfer typed at
       * registration ("white", "the blues"). This selected the text and
       * passed it where an id was wanted, into a map keyed by id — so it
       * never matched, every entrant silently fell back to the round's tees,
       * and net skins paid out on the wrong Course Handicap for anyone
       * assigned a different set. The same name-for-an-id fault that had a
       * tournament scoring against another course's stroke index.
       */
      select: { id: true, name: true, handicap: true, handicapType: true, teeId: true, status: true },
      orderBy: { seed: "asc" },
    }),
    prisma.scorecard.findMany({ where: { eventId, stageId } }),
    prisma.tee.findMany({
      where: { course: { events: { some: { eventId } } } },
      orderBy: [{ position: "asc" }],
    }),
  ]);

  // The scope now comes from the CALLER, because it is part of which pot was
  // asked for rather than something read back off whichever row turned up.
  // Deriving it from the row was safe only while one row could exist per
  // (stage, net); with four games on a round it would answer about the wrong
  // one. The stored value is still checked, so a bad row cannot widen a nine
  // into an eighteen.
  const stored = pot && isSkinsScope(pot.scope) ? pot.scope : scope;
  const { from, to } = scopeRange(stored, stage.holes);

  /**
   * The card THIS ROUND was played on, not the event's.
   *
   * `Stage.courseId` is what the venue library exists for, and this file never
   * read it: a summer league playing week one at home and week three at
   * another course settled week three's pot against the home card. Course A's
   * stroke index 1 may be course B's 12, so the shot lands on the wrong hole
   * and somebody is paid for a skin they did not win — while the leaderboard
   * beside it, which DOES read `Stage.courseId`, shows the right answer.
   *
   * `loadEventState` records this exact bug class as already found once:
   * "`courseForRound` had zero callers — so every round of a two-course
   * tournament was scored against round one's par and stroke index." That fix
   * landed on the board and not on the money.
   */
  const roundCourse = stage.courseId
    ? await prisma.course.findUnique({ where: { id: stage.courseId } })
    : null;
  const course = courseForRound(roundCourse, event) ?? resolveCourse(event);

  /**
   * The card the ROUND was played on, before the pot's scope narrows it again.
   *
   * `Stage.nine` was selected in the query above and never read. On a nine-hole
   * round `scopeRange` returns holes 0..9 whatever the scope, so a round played
   * on the BACK nine was priced off the FRONT nine's stroke index: the strokes
   * landed on the wrong holes, a different player won the skin, and the money
   * moved to them. `/live` shows the correct winner the whole time, because the
   * board resolves the card properly — so the two disagreed and only the pot
   * paid out.
   *
   * `cardForStage` is the one sanctioned way to narrow a card to the holes a
   * round was played on, and this file was not among those calling it.
   */
  const roundCard = cardForStage(course, stage);

  /**
   * Ranked 1..N for the holes actually being played.
   *
   * A slice of an eighteen-hole index still carries 1..18 values — the front
   * nine of a normal card is 1,3,5,…,17 — while the allocation compares them
   * against 1..9. See rankStrokeIndex for what that did to the pot.
   */
  const roundStrokeIndex = roundCard.strokeIndex;
  const strokeIndex = rankStrokeIndex(roundStrokeIndex.slice(from, to));

  const parse = (s: string): (number | null)[] => {
    try {
      return JSON.parse(s) as (number | null)[];
    } catch {
      return [];
    }
  };
  const strokesBy = new Map(cards.map((c) => [c.playerId, parse(c.strokes)]));
  const returned = (id: string) => (strokesBy.get(id) ?? []).some((s) => s != null);

  /**
   * WHO THIS POT CAN EVEN CONTAIN.
   *
   * The field for the club's pot; just the fourball for a group's. A group
   * pot offering all forty names is forty names to scroll past to find your
   * own three playing partners, and the wrong tick is somebody in a game they
   * never agreed to.
   *
   * Taken from the published tee sheet, which is the only record of who is
   * playing with whom. A groupKey that matches no current group falls back to
   * the whole field rather than to nobody — a redrawn sheet must not make an
   * existing pot unmanageable.
   */
  const groupIds = (() => {
    if (!groupKey) return null;
    const sheet = parseTeeSheet(stage.teeSheet ?? "");
    const g = sheet?.groups.find((x) => x.name === groupKey);
    return g && g.playerIds.length > 0 ? new Set(g.playerIds) : null;
  })();
  /**
   * Who may still be OFFERED the pot — the field, as it stands.
   *
   * Separate from whose stake is in it. A withdrawn player is not asked to
   * join anything; a withdrawn player who already paid keeps their money in.
   */
  const inField = players.filter((p) => p.status === "confirmed");
  const offered = groupIds ? inField.filter((p) => groupIds.has(p.id)) : inField;

  // Confirmed only. `pendingIds` is the asked-but-not-paid half, and the two
  // must not be added together anywhere: one is money and one is an intention.
  const entrantIds = (pot?.entrants ?? []).filter((e) => e.confirmed).map((e) => e.playerId);
  const pendingIds = (pot?.entrants ?? []).filter((e) => !e.confirmed).map((e) => e.playerId);
  const nameById = Object.fromEntries(players.map((p) => [p.id, p.name]));

  /**
   * Whose money is in. Someone can play the round and stay out of the pot,
   * which is exactly why entrants are stored rather than inferred — and
   * someone can pay in and then not play, which is why this reads the whole
   * field rather than only the players still in it.
   *
   * A withdrawn entrant wins nothing: `playSkins` works from returned scores
   * and they have no card. What they keep is their stake in the prize.
   */
  const inPot = players.filter((p) => entrantIds.includes(p.id));
  const holeCount = to - from;
  /** 9 or 18, never anything else — the round's own length, not the pot's. */
  const roundHoles = holesPlayed(stage.holes);

  /**
   * A real Course Handicap, not the Index off the player row.
   *
   * `Player.handicap` is a Handicap Index — a portable number that means
   * nothing until it is put against a set of tees. Passing it straight in
   * charged everyone the same strokes whatever they played off, and got the
   * nine-hole case wrong twice over: an eighteen-hole Index allocated across
   * nine holes gives roughly double the strokes a nine-hole competition
   * should. `courseHandicapMap` is the conversion the stroke-play board,
   * the team scoring and the regrouper already share — it converts the Index
   * AND the tee to the holes being played, once each.
   */
  const teeSetup = await teeSetupFor(eventId, tees);
  const teeRatings = new Map(
    tees.map((t) => [t.id, { courseRating: t.courseRating, slopeRating: t.slopeRating, par: t.par }]),
  );
  // Net skins are paid on these strokes, so a flight playing off a different
  // set has to be priced off that set.
  const flightTee = await flightTeeByPlayer(eventId);
  const courseHcp = courseHandicapMap(
    inPot.map((p) => ({
      id: p.id,
      handicap: p.handicap,
      handicapType: p.handicapType,
      teeId: p.teeId,
      flightTeeId: flightTee.get(p.id) ?? null,
    })),
    teeRatings,
    teeSetup.defaultTeeId,
    /**
     * The ROUND's hole count, not the pot's.
     *
     * This passed the pot's, so a front-nine pot on an eighteen-hole round
     * computed a nine-hole Course Handicap here — while the FROZEN round
     * handicap, which overrides it a few lines below, is an eighteen-hole
     * number (see `freezeRoundHandicaps`, which converts on `stage.holes`).
     * Two different bases feeding one comparison, and whichever won decided
     * how much money moved.
     *
     * Both are now the round's basis, and the conversion to the pot's holes
     * happens once, below, where it can be reasoned about.
     */
    roundHoles,
    // Net skins are priced off the same tees the round is scored from. A
    // single-tee competition that allocated skins strokes off a player's
    // stored preference would pay money on a handicap nobody played to.
    teeSetup.policy,
  );

  /**
   * What this ROUND says each player plays off.
   *
   * `round-handicap.ts` names the requirement this file missed: "Net match
   * play, the team engines and the net importer each convert their own
   * handicaps, so each of them needs this too — otherwise an organizer sets an
   * override and one round type quietly ignores it, which is worse than not
   * offering the control at all." Skins is the fourth such path, and it was
   * the one that did not comply.
   *
   * Two failures, both with money on them. An organizer giving a visitor a
   * round override saw the leaderboard price his card off it and the pot price
   * the identical card off the roster — he lost skins on holes he had a stroke
   * on. And because the FROZEN value was equally unread, editing a roster
   * index a week later re-computed a settled pot: different winners, a
   * different transfers list, for money already handed over in the bar. That
   * is verbatim what the freeze exists to prevent.
   */
  const round = await roundHandicapRows(eventId, stageId);

  /**
   * The strokes a player actually receives on THIS POT'S holes.
   *
   * A round handicap describes the whole round. A front- or back-nine pot
   * covers half of it, and the stroke index handed to `playSkins` has been
   * re-ranked 1..9 for those holes — so passing the round's number unchanged
   * allocated an eighteen-hole handicap across nine holes. A 14 received
   * fourteen strokes over nine, roughly double what he was owed, and the pot
   * paid out on it.
   *
   * Counted rather than halved. Halving looks right and is wrong on one of the
   * two nines whenever the handicap is odd: a 15 receives strokes on stroke
   * indexes 1..15, which on a standard card is eight holes out on the front
   * and seven on the back, and `Math.round(15 / 2)` is eight for both. Asking
   * the app's own allocator how many strokes land on each of these specific
   * holes is exact for any handicap and any stroke-index layout, including a
   * course whose odd indexes are on the back nine.
   *
   * The count is then correct to hand back as a handicap, because allocating
   * `k` strokes over the re-ranked 1..9 lands them on the `k` lowest original
   * indexes among those holes — the same set the full round would have given.
   */
  const potHoleIndexes = roundStrokeIndex.slice(from, to);
  const strokesForPot = (roundHandicap: number): number => {
    if (holeCount === roundHoles) return roundHandicap;
    return potHoleIndexes.reduce(
      (sum, si) => sum + holeStrokesReceived(roundHandicap, si, roundHoles),
      0,
    );
  };

  const outcome = playSkins(
    inPot.map((p) => ({
      playerId: p.id,
      strokes: (strokesBy.get(p.id) ?? []).slice(from, to),
      // Falls back to the Index only when the course has no tees on file at
      // all, which is the old behaviour and the best available guess.
      courseHandicap: strokesForPot(
        roundHandicapOf(round.get(p.id), courseHcp.get(p.id) ?? p.handicap),
      ),
    })),
    holeCount,
    { net, strokeIndex },
  );

  // A hole nobody has returned a score for hasn't been played yet, and a
  // settlement built on it would be a guess.
  const unplayed = Array.from({ length: holeCount }, (_, h) =>
    inPot.some((p) => (strokesBy.get(p.id) ?? []).slice(from, to)[h] != null) ? 0 : 1,
  ).reduce((a: number, b: number) => a + b, 0);

  const result =
    inPot.length > 0
      ? skinsPot(outcome, pot?.buyInCents ?? 0, inPot.map((p) => p.id), unplayed)
      : null;

  return {
    potId: pot?.id ?? null,
    buyInCents: pot?.buyInCents ?? 0,
    net,
    scope,
    entrantIds,
    pendingIds,
    field: offered.map((p) => ({ id: p.id, name: p.name, playing: returned(p.id) })),
    result,
    transfers: result ? settle(result.shares.map((s) => ({ playerId: s.playerId, netCents: s.netCents }))) : [],
    nameById,
    holes: outcome.holes.map((h) => ({
      hole: h.hole + from,
      playerId: h.playerId,
      value: h.value,
      carried: h.carried,
    })),
  };
}

export interface SkinsSeasonRow {
  playerId: string;
  name: string;
  netCents: number;
  weeksPlayed: number;
}

/**
 * Where everybody stands across the season's skins.
 *
 * A league plays weekly and settles weekly, so this is a record of what
 * happened rather than a debt: the money has already changed hands each week.
 * It answers the question a league actually asks in the bar — who is up on
 * the year — and nothing more.
 *
 * Summed from each week's own result rather than recomputed from scratch, so
 * a week already settled cannot change because a later one was played.
 */
export async function skinsSeasonFor(eventId: string): Promise<SkinsSeasonRow[]> {
  const pots = await prisma.skinsPot.findMany({
    // THE CLUB'S POTS ONLY.
    //
    // A season table is the club's standing, so a private bet between four
    // friends does not belong in it — and the fourball that plays for £20 a
    // week would otherwise top the club's season table on money nobody else
    // was invited to play for.
    //
    // The filter is also what stops the arithmetic being wrong: this
    // enumerated EVERY pot on the round and then re-read the field's one for
    // each, so a round with two group pots counted the club's three times.
    where: { eventId, groupKey: "" },
    // The scope too: a league night runs four pots on one round, and reading
    // (stageId, net) alone asked for the same one twice and missed the rest —
    // which for a season total is money that never appears.
    select: { stageId: true, net: true, scope: true },
  });
  if (pots.length === 0) return [];

  const weeks = await Promise.all(
    pots.map((p) =>
      skinsPotFor(eventId, p.stageId, p.net, isSkinsScope(p.scope) ? p.scope : "full", ""),
    ),
  );
  const results = weeks.filter((w): w is SkinsPotView => !!w && !!w.result).map((w) => w.result!);
  const nameById = weeks.find((w) => w)?.nameById ?? {};

  const totals = new Map<string, { netCents: number; weeksPlayed: number }>();
  for (const week of results) {
    for (const s of week.shares) {
      const t = totals.get(s.playerId) ?? { netCents: 0, weeksPlayed: 0 };
      t.netCents += s.netCents;
      t.weeksPlayed += 1;
      totals.set(s.playerId, t);
    }
  }

  return [...totals.entries()]
    .map(([playerId, t]) => ({ playerId, name: nameById[playerId] ?? "—", ...t }))
    .sort((a, b) => b.netCents - a.netCents || a.name.localeCompare(b.name));
}
