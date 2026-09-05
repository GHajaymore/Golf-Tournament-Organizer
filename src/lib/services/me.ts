import { prisma } from "@/lib/db";
import { cardRevision } from "@/lib/domain/pending-card";
import { needsTeams, ranksIndividuals } from "@/lib/formats";
import { generatesPairings } from "@/lib/stage-types";
import { parseTeeSheet } from "@/lib/domain/tee-sheet";
import { standingRows, settingsOf, type EventState } from "@/lib/services/tournament";
import { canEnterScores } from "@/lib/tournament-settings";
import { filledHoles } from "@/lib/domain/card-approval";
import { positionLabel } from "@/lib/domain/shared-position";
import { roundLabel } from "@/lib/domain/round-label";

/**
 * Everything the player-facing screens need about *this* person, in one place.
 *
 * The player shell asks a different question from the console. The console
 * asks "what is the state of the tournament"; a player asks "where am I, who
 * am I with, and what do I owe". Those are answerable from data the app
 * already holds, but they were scattered — and `ownPlayerIds`, the bit that
 * decides which rows are yours at all, existed privately in two action files
 * with no shared definition.
 *
 * Gathering it here is a correctness decision as much as a tidiness one: if
 * the screen resolves "me" differently from the action that writes my card,
 * the app will show one person's round and save another's.
 */

/**
 * The Player rows this signed-in person is, in this event — matched by email.
 *
 * CONFIRMED only, which is the same set `state.confirmed` and `domainPlayers`
 * are built from. Without that filter a waitlisted entrant — an over-capacity
 * row that `syncPlayerAccount` still gives an account to — resolved to a live
 * playerId here, and got a fully working card headed "My card" that the
 * tournament never reads. They filled it, certified it, and it scored nothing;
 * on the organizer's side it appeared in the round's cards and rendered as
 * "Unknown player", because the name is looked up in `confirmed` and they are
 * not there.
 *
 * The neighbouring case was already closed — a withdrawn player loses their
 * Account and cannot sign in — which is what makes the waitlist one look like
 * an oversight rather than a decision.
 *
 * "Yours to play" is the question every caller is asking: which card may I
 * open, may I write to this one, may I set my own availability, should the
 * play shell be offered at all. A row the engines do not score is not yours to
 * play, whatever the roster says.
 */
export async function myPlayerIds(eventId: string, email: string): Promise<Set<string>> {
  const rows = await prisma.player.findMany({
    // Case-insensitive: an address typed into a roster import is not
    // necessarily cased the way the same person typed it when signing up.
    where: { eventId, email: { equals: email, mode: "insensitive" }, status: "confirmed" },
    select: { id: true },
  });
  return new Set(rows.map((r) => r.id));
}

/**
 * "Round 3", or empty when a number would not help.
 *
 * The COUNT is `roundLabel`'s, not this file's. This grew its own — an index
 * into `playRounds` — and `round-number-source.test.ts` refused it the moment
 * the two arrived on the same branch, which is the guard doing exactly its
 * job: a second counter is how the app came to call one round by two numbers.
 *
 * What stays here is the one rule that belongs to this screen: a tournament of
 * a single round has nothing to tell apart, and "Stroke Play" says more to a
 * player than "Round 1" does. Empty then, and empty for a stage that is not a
 * playing round, which leaves the caller's own fallback in place.
 */
function roundNumberLabel(state: EventState, stageId: string): string {
  if (state.playRounds.length < 2) return "";
  return roundLabel(state.stages, stageId);
}

/** The course a round names, by id. Empty when it names none. */
async function venueNameFor(courseId: string): Promise<string> {
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: { name: true },
  });
  return course?.name ?? "";
}

export interface MyRound {
  stageId: string;
  label: string;
  holes: number;
  /**
   * Whether this round is scored on a card that is mine alone.
   *
   * False for match play (scored against an opponent) and for team formats
   * (scored on the side's card). Decided here rather than on each screen so
   * Today cannot offer a card that My card then refuses to show — the two
   * would be reading the same round and disagreeing about it.
   */
  ownCard: boolean;
  /**
   * Where this round is played, when the round names its own venue.
   *
   * Empty for a tournament at one course, which is most of them and needs no
   * telling. A multi-venue outing is the case that does: "Round 2" says
   * nothing about which car park to drive to, and the round's own course is
   * also the card the player's strokes are allocated from.
   */
  venue: string;
  /** The tee group I am in, if a sheet has been drawn. */
  group: { name: string; time: string; startHole: number; partners: string[] } | null;
  /** My card for this round: the strokes themselves, how far round I am, and
   *  where it has got to. The strokes are returned, not just the count,
   *  because the entry screen has to open on what is already there — a card
   *  that opens blank and then saves is a card that erases a round. */
  card: {
    strokes: (number | null)[];
    filled: number;
    status: string;
    /**
     * Which version of this card the screen is looking at.
     *
     * Sent back with a save so the server can refuse one that would land on
     * top of somebody else’s change — a queued card from a phone that was
     * out of signal is written WHOLE, and would otherwise replace a
     * correction made in the meantime with nobody noticing.
     */
    revision: string;
  } | null;
}

export interface Me {
  playerId: string | null;
  name: string;
  /** My row in the standings — position and score, from the same engine the
   *  leaderboard uses rather than a second calculation. */
  standing: {
    rank: number;
    /** The rank as it should be SHOWN — "T2" when shared. Empty when there is
     *  no position to report: nothing returned, or a card that stopped short. */
    position: string;
    toPar: number;
    thru: number;
    /** Holes the counted cards cover. `thru` against this is "50 of 54". */
    holesOwed: number;
    points: number;
  } | null;
  round: MyRound | null;
}

/**
 * Resolve the signed-in player's own view of the current round.
 *
 * Returns `playerId: null` for someone with no Player row in this event — an
 * organizer who does not play, most often. The caller decides what to show;
 * this does not invent a player.
 */
export async function meFor(state: EventState, email: string): Promise<Me> {
  const ids = await myPlayerIds(state.event.id, email);
  const playerId = [...ids][0] ?? null;
  const player = playerId ? state.confirmed.find((p) => p.id === playerId) ?? null : null;

  const stage = state.activeStage ?? state.stages[0] ?? null;
  if (!playerId || !stage) {
    return { playerId, name: player?.name ?? "", standing: null, round: null };
  }

  const holes = stage.holes === 9 ? 9 : 18;

  /**
   * Who I am playing with — from the PUBLISHED sheet only.
   *
   * P4 of the 2026-08-12 audit. This read the stored draw without asking
   * whether it had been published, so a draft reached a player's phone the
   * moment an organizer saved it. The whole point of the publish step is that
   * a committee can shuffle a draw, sleep on it and redraw — and a player
   * ringing up about a tee time they were never meant to see takes that away.
   * The dashboard already got this right; these two callers did not.
   *
   * Names come from the field rather than the sheet, so a player withdrawn
   * after the draw simply drops out instead of appearing.
   */
  const sheet = stage.teeSheetPublished ? parseTeeSheet(stage.teeSheet) : null;
  const mine = sheet?.groups.find((g) => g.playerIds.includes(playerId)) ?? null;
  const group = mine
    ? {
        name: mine.name,
        time: mine.time,
        startHole: mine.startHole,
        partners: mine.playerIds
          .filter((id) => id !== playerId)
          .map((id) => state.confirmed.find((p) => p.id === id)?.name)
          .filter((n): n is string => !!n),
      }
    : null;

  const row = await prisma.scorecard.findFirst({
    where: { eventId: state.event.id, stageId: stage.id, playerId },
    select: { strokes: true, status: true },
  });
  let card: MyRound["card"] = null;
  if (row) {
    let strokes: (number | null)[] = [];
    try {
      strokes = JSON.parse(row.strokes) as (number | null)[];
    } catch {
      // Unreadable strokes are treated as an empty card rather than throwing:
      // a player should still be able to open the screen and re-enter the
      // round. The count below then honestly reports 0 of 18.
      strokes = [];
    }
    // Normalised to the round's length so the entry grid and the saved array
    // always agree — a 9-hole round must not be handed an 18-slot card.
    const sized: (number | null)[] = Array.from({ length: holes }, (_, i) => strokes[i] ?? null);
    card = {
      strokes: sized,
      filled: filledHoles(sized, holes),
      status: row.status,
      // From the STORED strokes, sized the same way the client holds them, so
      // the two sides hash the same array rather than two shapes of it.
      revision: cardRevision(sized),
    };
  }

  /**
   * Position from the same standingRows the leaderboard renders — never a
   * second calculation, which is how two screens come to disagree about who is
   * winning.
   *
   * And only for a round that HAS individual positions. `standingRows` refuses
   * a hand-scored round and nothing else, deliberately — its own note says
   * refusing team and engine rounds there would be "a behaviour change dressed
   * as a guard", because every other caller returns early for those. This one
   * did not. So a skins player was handed a stroke-play "Position T1" in
   * forty-point type, beside a leaderboard that will not print one at all, and
   * a Nassau player the same. A skins round pays holes and a Nassau is three
   * bets; neither has a finishing order to be first in.
   */
  const ranked = ranksIndividuals(stage.format);
  const rows = ranked ? standingRows(state) : [];
  const standing = rows.find((r) => r.id === playerId) ?? null;
  // "T2" when the position is shared. Whether it IS shared is a fact about the
  // field, so it cannot be read off one row — which is exactly how the screen
  // came to tell a player they were second while two others were equally
  // second. This function had the whole list in hand and passed on one row.
  const position = positionLabel(rows, playerId);

  return {
    playerId,
    name: player?.name ?? "",
    standing: standing
      ? {
          rank: standing.rank,
          position,
          toPar: standing.toPar,
          thru: standing.thru,
          // What the counted cards add up to, so "Final" is a fact about this
          // player's own card rather than a guess from the round's hole count.
          // A round robin gives one player three matches inside one round, so
          // "eighteen holes returned" is not the end of their round.
          holesOwed: standing.holesOwed,
          points: standing.points,
        }
      : null,
    round: {
      stageId: stage.id,
      // A player has to be able to tell WHICH round this is. The fallback was
      // the stage type, so an undescribed round read "Stroke Play" — true of
      // every round in the tournament and therefore useless for telling them
      // apart, and worse than useless while this screen was showing the wrong
      // one. The number is what the play shell and the score-entry picker
      // already call it.
      label: stage.description?.trim() || roundNumberLabel(state, stage.id) || stage.type || "This round",
      holes,
      /**
       * A match is scored against an opponent and a team round on the side's
       * card; neither is a card this player owns or can return alone.
       *
       * AND the tournament has to let players report at all. This asked only
       * about the format and the stage type, so in a committee-scored
       * tournament Today rendered the primary "Start my card" link and
       * `/me/card` answered "Scores for this tournament are entered by the
       * organizer" — which is exactly what the comment on this field says
       * cannot happen: "Today cannot offer a card that My card then refuses to
       * show". The contract was violated on its own terms.
       *
       * Asked as a PLAYER deliberately, not with the viewer's own role. This
       * is the player app, its audience is players, and the honest question is
       * whether a player may return this card. An organizer previewing /me
       * therefore sees the same thing their field sees, which is the point of
       * a preview — and if they navigate to `/me/card` anyway it still works
       * for them, so the failure is toward showing less rather than promising
       * more.
       */
      ownCard:
        !needsTeams(stage.format) &&
        !generatesPairings(stage.type) &&
        canEnterScores(settingsOf(state.event), "player"),
      venue: stage.courseId ? (await venueNameFor(stage.courseId)) : "",
      group,
      card,
    },
  };
}
