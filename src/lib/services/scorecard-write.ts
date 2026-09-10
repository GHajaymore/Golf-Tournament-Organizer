import "server-only";
import { prisma } from "@/lib/db";
import { cardRevision, staleAgainst, NO_CARD_REVISION } from "@/lib/domain/pending-card";
import { cleanStrokes } from "@/lib/domain/score-payload";
import { isCardLocked, statusAfterEdit, LOCKED_CARD_REFUSAL } from "@/lib/domain/card-approval";
import { mayReportPartialCard, type TournamentSettings } from "@/lib/tournament-settings";
import { freezeRoundHandicaps } from "@/lib/services/round-handicap";
import { isReturnedCard } from "@/lib/domain/round-handicap";

/**
 * Writing one player's stroke card — everything except who is allowed to.
 *
 * Lifted out of `saveScorecard` unchanged. That action holds a hundred lines
 * of rules that are nothing to do with authorization: what counts as a valid
 * card, whether a partial one may be reported, the revision conflict that
 * stops one phone overwriting another, when a save retracts a certification,
 * and the moment a round's handicaps stop moving. Every one of those has a
 * reason recorded beside it and several were bugs.
 *
 * A SECOND WAY IN NEEDED ALL OF IT. The Round Code surface can score a match
 * and cannot score a card, so a medal round with code access — which is what
 * the charity-day template sets up — hands the field a code that leads to
 * "no match for you". Giving that surface its own copy of these rules is how
 * two writers of one card come to disagree about which of them de-certifies
 * it; this file is the alternative.
 *
 * WHAT STAYS WITH THE CALLER is the authorization, deliberately. The console
 * asks `requireScoreEntry` and three `assert*` scoping checks; the play
 * surface asks its own session and `canEnterScores`. Those questions have
 * genuinely different answers and must not be answered here, where a single
 * permissive default would open both doors at once.
 *
 * It still THROWS on a bad payload, a partial card that is not allowed and a
 * locked card, exactly as it did inside the action — this is a lift, not a
 * redesign, and the console's behaviour is asserted by tests that predate it.
 * A caller that would rather report than throw catches.
 */

/**
 * The card as saved, or the conflict that stopped it.
 *
 * A save that would land on top of somebody else's comes back as a CONFLICT
 * carrying both sides. Choosing between them is a person's job — this app does
 * not get to decide whose scorecard was right.
 */
export type SaveCardResult =
  | {
      ok: true;
      revision: string;
      /**
       * The status the card now holds — REPORTED, not left to the caller to
       * work out.
       *
       * A save retracts a certification only when the numbers changed, which
       * is a rule with real subtlety in it (see `changed` below) and used to
       * have a second, cruder copy on the phone: the player's card assumed
       * every successful save de-certified. So a queued replay landing after
       * the player had signed — the ordinary end of a round entered with
       * patchy signal — turned the badge back to "entered" while the card on
       * the server stayed certified, and the screen contradicted the record it
       * was reporting.
       */
      status: string;
    }
  | { ok: false; conflict: { strokes: (number | null)[]; revision: string } };

export async function writeScorecard(input: {
  eventId: string;
  stageId: string;
  playerId: string;
  /** Unvalidated on purpose — see `cleanStrokes` below. */
  strokes: (number | null)[];
  settings: TournamentSettings;
  /** The caller's role, for `mayReportPartialCard` and nothing else. */
  role: "admin" | "assistant" | "player";
  /** The revision this caller last read. Omitted is an unconditional write. */
  expectedRevision?: string;
}): Promise<SaveCardResult> {
  const { eventId, stageId, playerId, strokes, settings, role, expectedRevision } = input;
  // The card itself. The guards above answer "may this person write here";
  // this answers "is this a scorecard at all". The (number | null)[] on the
  // signature is erased at runtime, and these strokes are summed straight into
  // gross, net and Stableford totals — so an out-of-range value does not sit
  // in a column, it lands on the leaderboard.
  const stage = await prisma.stage.findUnique({ where: { id: stageId }, select: { holes: true } });
  const roundHoles = stage?.holes === 9 ? 9 : 18;
  const clean = cleanStrokes(strokes, roundHoles);
  if (!clean) throw new Error("Those scores aren't valid. Reload the round and try again.");

  if (!mayReportPartialCard(settings, role)) {
    const filled = clean.filter((s) => typeof s === "number" && s > 0).length;
    if (filled < clean.length) throw new Error("Enter the full round, then submit it.");
  }

  // The card as already stored, which decides whether this write is allowed at
  // all. Scoped on eventId as well as the pair for the same reason the upsert
  // below needed assertEventStage/assertEventPlayer: the (stageId, playerId)
  // key is caller-supplied.
  //
  // Without this an approved card could be rewritten by the very person it
  // belongs to — a player in a self-scoring event overwriting an approved 82
  // with a 76, the row still reading `approvedBy: committee@club`, so the
  // approval vouched for numbers the committee never saw. Staff could do it
  // for anyone, `assertOwnCard` being a no-op for them. Correcting an approved
  // card goes back through `reopenScorecard`, which is organizer-only.
  const existing = await prisma.scorecard.findFirst({
    where: { eventId, stageId, playerId },
    select: { id: true, status: true, strokes: true },
  });

  /**
   * HAS SOMEBODY ELSE WRITTEN THIS CARD SINCE THE CALLER READ IT?
   *
   * Only asked when the caller says what it was working from. A queued card
   * from a phone that was out of signal is the case this exists for; the
   * console's entry screen has the card in front of it and passes nothing.
   *
   * Refused rather than merged. Two people can disagree about a hole and
   * only one of them was standing there — picking a winner by timestamp is
   * how a scorer's correction disappears without anybody noticing.
   */
  /**
   * The stored card, fitted to the round before it is hashed.
   *
   * Every other producer of a revision hashes a ROUND-SIZED array — `me.ts`
   * says so explicitly ("sized the same way the client holds them, so the two
   * sides hash the same array rather than two shapes of it"), and the revision
   * returned below is computed from `clean`, which is fitted. This one read the
   * raw stored array, so any card written short — `importScores` slices to 18
   * without padding, so an organizer uploading the front nine at the turn
   * leaves nine elements — hashed a different shape from the one the phone
   * hashed. The next save from that phone came back as a conflict on a card
   * nobody had touched, naming a hole the committee never edited.
   */
  const storedStrokes = existing
    ? Array.from({ length: roundHoles }, (_, i) => {
        const raw = JSON.parse(existing.strokes) as (number | null)[];
        return raw[i] ?? null;
      })
    : null;
  const stored = storedStrokes ? cardRevision(storedStrokes) : "";

  /**
   * An empty revision is "there was no card when I loaded", NOT "no opinion".
   *
   * Normalised HERE rather than trusted from the caller, because the two
   * meanings are opposite and the falsy one silently selected the dangerous
   * behaviour. Omitting the argument gives `undefined` and still means an
   * unconditional write — that is the console, which has the card on screen.
   * An empty STRING can only come from a screen that loaded without one, and
   * that screen has everything to lose from an unconditional write.
   *
   * The player's card page now sends `NO_CARD_REVISION` explicitly, so this
   * covers a client that has not reloaded and any caller written later. A rule
   * enforced where the write happens cannot be forgotten by a caller.
   */
  const expected = expectedRevision === "" ? NO_CARD_REVISION : expectedRevision;

  if (expected && existing && storedStrokes) {
    if (staleAgainst(expected, stored)) {
      return { ok: false, conflict: { strokes: storedStrokes, revision: stored } };
    }
  }
  if (existing && isCardLocked(existing.status)) throw new Error(LOCKED_CARD_REFUSAL);

  /**
   * Only a card whose NUMBERS changed retracts its certification.
   *
   * This applied `statusAfterEdit` to every write, so rewriting a card with
   * the identical eighteen numbers set it back from certified to entered and
   * blanked the signature. Two ways that happened for real: the console's
   * group save loops over every player in the tee group with any score and
   * re-saves each unchanged card, silently de-certifying somebody who signed
   * on their phone twenty minutes earlier; and the retry queue could replay a
   * card up to fifteen seconds after `certifyScorecard` had already signed it,
   * while the screen still read "Certified. It's with the committee now."
   *
   * The rest of the file already treats an identical write as no change —
   * `cardRevision` is content-derived precisely so that "saving the SAME
   * strokes twice is not a conflict". The two mechanisms disagreed about
   * whether an identical write was a change; now they do not.
   */
  const changed = !existing || cardRevision(clean) !== stored;
  const reset = existing && changed ? statusAfterEdit(existing.status) : null;

  const saved = await prisma.scorecard.upsert({
    where: { stageId_playerId: { stageId, playerId } },
    // New strokes retract a certification given for the old ones — the same
    // rule the match path applies, where any score edit drops the result back
    // to pending. certifyScorecard re-signs it a moment later on the one
    // screen that saves and certifies together, so the marker's own flow is
    // unaffected.
    update: {
      strokes: JSON.stringify(clean),
      ...(reset ? { status: reset, certifiedBy: "", certifiedAt: null } : {}),
    },
    create: { eventId, stageId, playerId, strokes: JSON.stringify(clean) },
  });
  // The round is now being scored, so what it is scored against stops moving.
  // After the write, never before: a card that failed validation above did not
  // start a round. An empty save does not either — see isReturnedCard.
  if (isReturnedCard(clean)) await freezeRoundHandicaps(eventId, stageId);

  // The revision this write produced, so the caller can keep working from
  // it rather than having to re-read the card to save again.
  // Derived from what was just written, so the caller can keep saving from it
  // without re-reading the card.
  //
  // The status comes off the ROW the upsert returned, not from re-applying
  // `reset` here. Re-deriving it would be a third copy of the same rule, and
  // the second copy is what this is fixing.
  return { ok: true, revision: cardRevision(clean), status: saved.status };
}

/**
 * Signing a card — Rule 3.3b, and the same three lines wherever it is done.
 *
 * Lifted out of `certifyScorecard` for the reason that action already states:
 * "the three doors into this row cannot drift apart again". There is a fourth
 * now — the Round Code surface, which had no way to sign at all, so every card
 * a charity day's field submitted arrived at the committee reading "Not
 * certified yet" and had to be waved through with "Approve anyway". The screen
 * cited Rule 3.3b while the app gave the field no way to satisfy it.
 *
 * WHO may sign is NOT decided here, deliberately, for the same reason
 * `writeScorecard` leaves authorization to its callers: the console asks
 * `requireScoreEntry` and `assertOwnCard`, the play surface asks its own
 * session, and a single answer would let one of them through the other's door.
 *
 * `by` is whatever identifies the signer to a person reading the card later —
 * an email from the console, a player's name from a round code. It is a record
 * of who said the scores were right, not a credential.
 */
export async function certifyCard(input: {
  eventId: string;
  stageId: string;
  playerId: string;
  by: string;
}): Promise<void> {
  // Scoped on eventId as well as the pair: the (stageId, playerId) unique key
  // is caller-supplied, and without the event in the filter it would name a
  // row in any tournament. Same hole that saveScorecard had.
  const card = await prisma.scorecard.findFirst({
    where: { eventId: input.eventId, stageId: input.stageId, playerId: input.playerId },
    select: { id: true, status: true },
  });
  if (!card) throw new Error("There's no card to certify yet.");
  // An approved card is the committee's, not the marker's, to change. Shared
  // with the write above and with `disputeScorecard` so the doors into this
  // row cannot drift apart.
  if (isCardLocked(card.status)) throw new Error(LOCKED_CARD_REFUSAL);

  await prisma.scorecard.update({
    where: { id: card.id },
    data: { status: "certified", certifiedBy: input.by, certifiedAt: new Date() },
  });
}
