"use server";
import { byAddress } from "@/lib/domain/my-entry";
import { clearsConcession, deriveMatchFromItsCards, recomputeTeamMatch } from "@/lib/services/match-from-cards";
import { COURSE_REF, roundCard } from "@/lib/services/course-resolution";
import { playedOnBy } from "@/lib/services/courses";
import { parseDeadlineIso } from "@/lib/deadline";
import { CLONED_EVENT_FIELDS, CLONED_STAGE_FIELDS } from "@/lib/services/clone";
import { roundCourseHandicaps, flightTeeByPlayer, FIELD_PLAYER } from "@/lib/services/handicaps";
import { revalidatePath } from "next/cache";
import { boardChanged } from "@/lib/services/board-refresh";
import { cardRefusal } from "@/lib/domain/scorecard-parse";
import { prizeStructure, prizeStructureLines } from "@/lib/domain/prize-structures";
import { looksLikeSkillPrize, onePrizeRefusal, onePrizeTickRefusal, type PrizeHolding } from "@/lib/domain/one-prize";
import { enteredCardCount } from "@/lib/services/round-cards";
import { oneCardPerSide, teamEntryChoices, type TeamEntryMode } from "@/lib/domain/team-entry";
import { prisma } from "@/lib/db";
// No `createSession` or `destroySession` here on purpose: deleting a
// tournament moves the active event and must never re-sign or drop the
// session — see deleteEvent.
import { getSession, setActiveEvent } from "@/lib/auth";
import { redirect, unstable_rethrow } from "next/navigation";
import { regenerateGroupsAndSchedule, generateCutRound, repairPlayerPairings, scoredMatchCount } from "@/lib/services/regroup";
import { applyStrokeCut, strokeCutField, strokeCutRefusal } from "@/lib/services/stroke-cut";
import { settingsOf, effectiveScoreStatus, loadEventState, playingStages } from "@/lib/services/tournament";
import { myPlayerIds } from "@/lib/services/me";
import { attestMatch, matchSidesOf, ruleFrom } from "@/lib/services/attestation";
import { parseTeeSheet } from "@/lib/domain/tee-sheet";
import { publishedFoursomes, mayWriteCard } from "@/lib/domain/group-entry";

/**
 * The acting PLAYER's id, or "" when staff entered the score.
 *
 * Empty for staff is correct rather than a gap: an organizer is not in the
 * scoring group, so they were never a candidate to attest and excluding them
 * changes nothing. Resolved through `myPlayerIds`, the same reader the card
 * screen and the score-write guard use, so "which player am I" has one answer.
 */
async function authorPlayerId(eventId: string, session: Session | null): Promise<string> {
  if (!session || session.role !== "player") return "";
  // A Set, not an array — and normally of one. A person entered twice in the
  // same tournament is the rare case, and either id identifies the author well
  // enough for the only question asked of it: "was this you?".
  const [first] = await myPlayerIds(eventId, session.email);
  return first ?? "";
}
import {
  canEnterScores,
  mayReportPartialCard,
  allowsAutoConfirm,
  entryNeedsEmail,
  type TournamentSettings,
} from "@/lib/tournament-settings";
import type { Session } from "@/lib/auth";
import { clubNameClash, organizationForNewEvent, settingsForNewEvent } from "@/lib/services/organization";
import { clubExistsQuestion } from "@/lib/domain/org-name-match";
import { orgProfile } from "@/lib/domain/org-profile";
import { effectiveAccess } from "@/lib/services/access";
import { refusalFor, fieldCapFor, seatRefusalFor } from "@/lib/services/limits";
import { wipesOnCloseFor } from "@/lib/services/close-terms";
import { WIPE_ON_CLOSE, roundWindowRefusal, closesAtOnComplete, reopenRefusal } from "@/lib/domain/close-terms";
import { dayAtClubForEvent } from "@/lib/services/club-clock";
import { generateShareToken } from "@/lib/codes";
import { templateFor } from "@/lib/tournament-templates";
import { defaultFormatFor } from "@/lib/side-style";
import { formatFitsRound, naturalFormatFor, newRoundBasis, unscorableRoundLabels } from "@/lib/domain/round-choices";
import { roundShapeMismatch } from "@/lib/domain/round-shape";
import { cleanIsoDate, roundDates, planSeasonDates } from "@/lib/domain/round-dates";
import { reviewCards, isCardLocked, isPartnerCardSigned, filledHoles, LOCKED_CARD_REFUSAL, SIGNED_PARTNER_REFUSAL } from "@/lib/domain/card-approval";
import { cleanHoleResults, cleanStrokes, isStroke, strokeFault } from "@/lib/domain/score-payload";
import { writeScorecard, certifyCard, assertSignsCards, assertRoundOpen, type SaveCardResult } from "@/lib/services/scorecard-write";
import { flightLabel } from "@/lib/domain/flight-label";
import {
  freezeRoundHandicaps,
  roundHandicapRows,
  roundHasReturnedCard,
} from "@/lib/services/round-handicap";
import {
  acceptsHandicapChange,
  isReturnedCard,
  FROZEN_HANDICAP_REFUSAL,
} from "@/lib/domain/round-handicap";
import { overridesAfterFormatChange, playingHandicapInRound } from "@/lib/round-allowance";
import { isTournamentShape, isMatch } from "@/lib/tournament-shape";
import { QUICK_ROUND_MAX_PLAYERS } from "@/lib/domain/quick-match";
import { syncPlayerAccount, revokePlayerAccount } from "@/lib/services/player-access";
import { notifyFieldChange } from "@/lib/services/field-notify";
import { drainWaitlist, fieldLimitFor } from "@/lib/services/waitlist";
import { LEFT_THE_FIELD } from "@/lib/domain/left-the-field";
import { parseCsv, hasNameColumn, nameFrom, cell } from "@/lib/csv";
import { cloneSingleMatchRule, parseSingleMatchRule, singleMatchRuleRefusal } from "@/lib/domain/single-match";
import { singleMatchFor } from "@/lib/services/single-match";
import { resolveThirdPlace } from "@/lib/domain/third-place";
import { looksLikePhone } from "@/lib/domain/registration-intake";
import {
  EMAIL_RE,
  EMAIL_REFUSAL,
  isEmailAddress,
  nameRefusal,
  PERSON_NAME_MAX,
  PHONE_MAX,
  PLACE_MAX,
  TITLE_MAX,
} from "@/lib/domain/typed-limits";
import {
  PRIZE_CATEGORY_BLANK,
  PRIZE_CATEGORY_MAX,
  PRIZE_DETAIL_MAX,
  prizeAmountRefusal,
} from "@/lib/domain/prize-amount";
import { indexRefusal } from "@/lib/domain/handicap-label";
import { phoneRequiredFor, PLANS } from "@/lib/plans";
import { STAGE_DESCRIPTIONS, isStageType, isHeadToHead, isPlayingRound, isStraightKnockout, isKnockoutRound, KNOCKOUT_STAGE_TYPES, MAX_ROUNDS_AT_ONCE } from "@/lib/stage-types";
import { randomUUID } from "node:crypto";
import { lineupHidden, LINEUP_HIDDEN, keepsConcession } from "@/lib/domain/cup-lineup";
import { matchKeptBy, keptByScoreInput } from "@/lib/domain/match-kept-by";
import { keptByRefusal } from "@/lib/services/match-kept-by";
import { roundLabel, roundKicker } from "@/lib/domain/round-label";
import { hasPlayingHistory, keepDefaultStakes } from "@/lib/services/playing-history";
import { launchRefusal, finishRefusal, statusMove } from "@/lib/domain/phase-gate";
import { basisFor, isStablefordFormat } from "@/lib/domain/week-basis";
import { flightDefaultFor, followFlightDefault } from "@/lib/services/flight-default";
import { roundsMissingCards } from "@/lib/services/round-card-lines";
import { bracketDraws, tieByKey, tieReportRefusal } from "@/lib/domain/my-tie";
import {
  planWithPlayerAdded,
  isFlightCriterion,
  planWithPlayerMoved,
  parseFlightPlan,
  planFlights,
  planRenamed,
  planReseeded,
  serializeFlightPlan,
  type FlightEntrant,
  type FlightPlan,
  type FlightPlanResult,
} from "@/lib/domain/bracket-flights";
// The boundary's one margin rule — a player's report and the console's result
// box keep the same text.
import { cleanMargin } from "@/lib/domain/score-payload";
import { isPlayKind } from "@/lib/domain/play-kind";
import { orgSetupState } from "@/lib/domain/org-setup";
import { organizationWasNamed } from "@/lib/org-naming";
import { cleanMatchTiebreakers, OFFERED_MATCH_TIEBREAKS } from "@/lib/domain/match-tiebreak";
import { isCutScope } from "@/lib/domain/cut";
import { importShapesFor, isStrokeShape, type ScoreImportShape } from "@/lib/domain/score-import";
import { upsertMember, organizationIdForEvent } from "@/lib/services/roster";
import { placementOnApproval, parseHandicapInput, parseHandicapType } from "@/lib/domain/registration-intake";
import {
  marginRefusal,
  marginToHoles,
  matchIsOver,
  isTiebreakerKey,
  isBracketMode,
  holeStrokesReceived,
  allocationHoles,
  serializeBracketDraw,
  FORMATION_RULES,
} from "@/lib/domain";
import type { FormationRule, HoleResult } from "@/lib/domain";
import { FORMAT_NAMES } from "@/lib/formats";
import { findFormat, inputChoices, isPlayable, lookupFormat, needsTeams } from "@/lib/formats";
import type { MatchEntryMode } from "@/lib/domain/match-entry";
import { holesPlayed } from "@/lib/domain/handicap";
import { assertUnlocked, lockedRefusal, logAudit, playRefusalFor, roundWordsFor } from "@/lib/services/action-shared";
import { holesChanged } from "@/lib/domain/card-correction";
import { configurationLocked, isFinished } from "@/lib/domain/lifecycle-state";
import { matchCarrierGroup } from "@/lib/services/match-carrier";
import { playsInMatch } from "@/lib/services/match-access";
import { ensureRoundCodes } from "@/lib/services/round-codes";
import { isSupportedLocale } from "@/lib/domain/locale";
import { isCurrencyCode } from "@/lib/domain/money-format";

/** Primary Organizer only (admin) — critical config and access control. */
async function requireAdminEvent(): Promise<string> {
  const session = await getSession();
  if (!session) throw new Error("Not authenticated");
  if (session.role !== "admin") throw new Error("Organizer access required");
  return session.eventId;
}

/** Organizer or Assistant Organizer — operational tasks. */
async function requireStaffEvent(): Promise<string> {
  const session = await getSession();
  if (!session) throw new Error("Not authenticated");
  if (session.role !== "admin" && session.role !== "assistant") {
    throw new Error("Organizer access required");
  }
  return session.eventId;
}

/**
 * Score entry, gated on the tournament's own rules.
 *
 * Staff always pass. A player passes only where the organizer has allowed
 * self-reporting — and this is the check that matters, because hiding the
 * entry screen in the sidebar stops nobody from calling the action directly.
 */
async function requireScoreEntry(
  scoped?: Session,
): Promise<{ eventId: string; session: Session; settings: TournamentSettings }> {
  const session = scoped ?? (await getSession());
  if (!session) throw new Error("Not authenticated");
  const event = await prisma.event.findUnique({ where: { id: session.eventId } });
  if (!event) throw new Error("Event not found");
  const settings = settingsOf(event);
  if (!canEnterScores(settings, session.role)) {
    throw new Error("Scores for this tournament are entered by the organizer.");
  }
  /**
   * AND THE TOURNAMENT HAS TO HAVE STARTED.
   *
   * Launch is the transition from setting up to playing, and it gated nothing
   * — a tournament left in draft played a whole round with only a banner on
   * the dashboard to say its status was out of date.
   *
   * Here rather than in each of the nine callers, which is the same reasoning
   * `isManualFormat` earned its entry in CLAUDE.md for: a guard you must
   * remember to call is a guard that will be forgotten.
   *
   * It cannot strand the certify and dispute paths below, which need a card to
   * act on — a card existing is itself a result, so `playRefusal` returns null
   * for them. And staff hold the remedy: the refusal names it, and launching
   * is theirs to do.
   */
  const notStarted = await playRefusalFor(session.eventId);
  if (notStarted) throw new Error(notStarted);
  return { eventId: session.eventId, session, settings };
}

/**
 * SCORE ENTRY FOR THE TOURNAMENT A CARD BELONGS TO, not the one last opened.
 *
 * Found by the player-side audit of 2026-09-19. The session's tournament is
 * whichever the switcher chose most recently, and it is one cookie for every
 * tab. A player entered in two tournaments with the medal card open on their
 * home screen who looks at the league in a browser tab has moved that cookie —
 * and every save from the card, including the ones queued offline, was then
 * refused as "That round isn't in this tournament". The strokes stayed on the
 * phone and never arrived.
 *
 * So a card action names its round, and the round names its tournament. The
 * person's access to THAT tournament is resolved afresh by `effectiveAccess` —
 * the same rule the switcher and `enterTournament` use — and their role there
 * is the one checked, not the role they hold in the other tab's tournament. A
 * round in a tournament they cannot reach gets no scope at all, and falls
 * through to the session's own, where `assertEventStage` refuses it exactly as
 * before. Nothing here widens who may write; it only stops the wrong
 * tournament being asked.
 */
async function requireScoreEntryForStage(
  stageId: unknown,
): Promise<{ eventId: string; session: Session; settings: TournamentSettings }> {
  const session = await getSession();
  if (!session) throw new Error("Not authenticated");
  const stage =
    typeof stageId === "string" && stageId
      ? await prisma.stage.findUnique({ where: { id: stageId }, select: { eventId: true } })
      : null;
  if (!stage || stage.eventId === session.eventId) return requireScoreEntry(session);
  const access = await effectiveAccess(session.email, stage.eventId);
  if (!access) return requireScoreEntry(session);
  return requireScoreEntry({
    ...session,
    eventId: stage.eventId,
    accountId: access.accountId,
    role: access.role,
    viewRole: access.role,
  });
}

/**
 * The Player rows this signed-in person is, in this event.
 *
 * `myPlayerIds`, not a third copy of it. `services/me.ts` says why in its own
 * header: "if the screen resolves 'me' differently from the action that writes
 * my card, the app will show one person's round and save another's". That
 * consolidation was started and not finished — this file and
 * `actions/attendance.ts` each kept a private duplicate, identical to the
 * shared one and to each other, and all three matched on email and event with
 * no status test.
 *
 * Which is how a waitlisted entrant came to have a writable card: the screen
 * offered it and this function authorised the write, both agreeing about a row
 * the scoring engines ignore.
 */
const ownPlayerIds = myPlayerIds;

/**
 * A player may write scores for their own match and nobody else's.
 *
 * requireScoreEntry answers "may this role enter scores at all"; it never
 * asked "for whom". With the answer missing, any signed-in player could
 * overwrite any match or any card in the event — the round-code path had
 * this check from day one, and the console path did not. Staff pass through
 * untouched: entering the whole field's cards is their job.
 *
 * Membership means being on one of the match's sides — the player columns in
 * an individual format, team membership in a team format. Same scoring-group
 * rule as domain/attest.ts and savePlayMatchHoles.
 */
async function assertOwnMatch(session: Session, eventId: string, matchId: string): Promise<void> {
  if (session.role !== "player") return;
  const match = await prisma.match.findFirst({
    where: { id: matchId, eventId },
    include: { stage: { select: { type: true, lineupPublished: true } } },
  });
  if (!match) throw new Error("Match not found.");
  // A cup match in a lineup nobody has announced: not playable yet. Every
  // match write a player can reach comes through here, so one check covers
  // the hole-by-hole, the result and the card paths alike.
  if (match.stage && lineupHidden(match.stage)) throw new Error(LINEUP_HIDDEN);
  const own = await ownPlayerIds(eventId, session.email);
  if (own.has(match.playerAId) || own.has(match.playerBId)) return;
  const teamIds = [match.teamAId, match.teamBId].filter((id) => id !== "");
  if (teamIds.length) {
    const member = await prisma.teamMember.findFirst({
      where: { teamId: { in: teamIds }, playerId: { in: [...own] } },
      select: { id: true },
    });
    if (member) return;
  }
  throw new Error("You can only enter scores for your own match.");
}

/** Same rule for a stroke card: your own, or you are staff. */
async function assertOwnCard(session: Session, eventId: string, playerId: string): Promise<void> {
  if (session.role !== "player") return;
  const own = await ownPlayerIds(eventId, session.email);
  if (!own.has(playerId)) throw new Error("You can only enter your own scorecard.");
}

/**
 * KEEPING the numbers on a stroke card: your own, or a partner's in the
 * foursome you were drawn with on THIS round's published tee sheet — the
 * marker system (`domain/group-entry.ts`). Staff pass, as everywhere.
 *
 * Only `saveScorecard` asks this. Certifying and disputing a card still go
 * through `assertOwnCard`: keeping a partner's score is not signing for them.
 *
 * `stageId` is already proven to be this event's by `assertEventStage`, and
 * the sheet is read from that stage, so a caller cannot borrow another
 * round's (or another club's) grouping to reach a card.
 */
async function assertMayKeepCard(
  session: Session,
  eventId: string,
  stageId: string,
  playerId: string,
): Promise<void> {
  if (session.role !== "player") return;
  /**
   * A ROUND AFTER A STROKE CUT BELONGS TO THE PLAYERS WHO MADE IT. Asked
   * here, on the server, because the screens are only the polite half: a
   * card for a player the cut left out would put them straight back on the
   * board. Staff are exempt — a committee may put somebody back in.
   */
  const field = await strokeCutField(eventId, stageId);
  if (field && !field.has(playerId)) {
    throw new Error("Only the players who made the cut have a card for this round.");
  }
  await assertRoundOpen(eventId, stageId);
  const own = await ownPlayerIds(eventId, session.email);
  if (own.has(playerId)) return;
  const [stage, confirmed] = await Promise.all([
    prisma.stage.findFirst({
      where: { id: stageId, eventId },
      select: { teeSheet: true, teeSheetPublished: true },
    }),
    prisma.player.findMany({ where: { eventId, status: "confirmed" }, select: { id: true } }),
  ]);
  const foursomes = publishedFoursomes(
    stage ? parseTeeSheet(stage.teeSheet) : null,
    !!stage?.teeSheetPublished,
    new Set(confirmed.map((p) => p.id)),
  );
  if (!mayWriteCard(own, playerId, foursomes)) {
    throw new Error("You can only keep score for yourself and the group you were drawn with.");
  }
  /**
   * AND NOT A CARD ITS PLAYER HAS RETURNED (2026-10-09). A marker could step
   * a partner's certified card: the save de-certifies a card whose numbers
   * changed, so Faye's signed 72 became an unsigned 73, written by somebody
   * else, with nothing said to her and no line in the record. Under Rule 3.3b
   * a returned card is the committee's to correct. The player's OWN card is
   * above this line and unchanged — they may still fix it until it is approved.
   */
  const theirs = await prisma.scorecard.findFirst({
    where: { eventId, stageId, playerId },
    select: { status: true },
  });
  if (theirs && isPartnerCardSigned(theirs.status)) {
    const who = await prisma.player.findFirst({ where: { id: playerId, eventId }, select: { name: true } });
    throw new Error(SIGNED_PARTNER_REFUSAL(who?.name ?? "That player"));
  }
}

/**
 * The row this id names must belong to the tournament the caller is in.
 *
 * `assertOwnMatch`/`assertOwnCard` answer "whose score is this" and only bind
 * players. They say nothing about which *tournament* an id came from, so on
 * their own they leave a write keyed on a caller-supplied id pointing wherever
 * the caller likes. These two close that half: an id is an attacker-chosen row
 * until something narrows it to this event.
 */
async function assertEventStage(eventId: string, stageId: string): Promise<void> {
  const stage = await prisma.stage.findFirst({ where: { id: stageId, eventId }, select: { id: true } });
  if (!stage) throw new Error("That round isn't in this tournament.");
}

async function assertEventPlayer(eventId: string, playerId: string): Promise<void> {
  const player = await prisma.player.findFirst({ where: { id: playerId, eventId }, select: { id: true } });
  if (!player) throw new Error("That player isn't in this tournament.");
}

async function assertEventTeam(eventId: string, teamId: string): Promise<void> {
  const team = await prisma.team.findFirst({ where: { id: teamId, eventId }, select: { id: true } });
  if (!team) throw new Error("That team isn't in this tournament.");
}

/** Block structural changes once the tournament is live/completed, unless unlocked. */

/**
 * Everything on this screen changed — and so did the public board.
 *
 * `revalidatePath` clears the router cache; it does NOT touch the per-event
 * board entry, which is an `unstable_cache` keyed and tagged separately. So a
 * score entered here would sit behind the board cache until its sixty-second
 * backstop expired — a spectator watching a group come up the 18th, seeing
 * nothing happen.
 *
 * The event comes from the SESSION rather than a parameter, because every
 * action in this file already operates on the caller's own tournament — that
 * is what `requireStaffEvent` and friends establish before any write. Taking
 * it from the session is what let this be one change rather than seventy-eight
 * call sites each remembering to pass an id, and a change nobody has to
 * remember is the only kind that survives.
 */
async function refresh() {
  revalidatePath("/", "layout");
  const session = await getSession();
  if (session?.eventId) boardChanged(session.eventId);
}

/* ── Registration ─────────────────────────────────────────────────────── */

export interface SignupInput {
  name: string;
  handicap: number;
  email?: string;
  phone?: string;
  ghin?: string;
  /** A visitor's own handicap body — `ghin` is their number with it. "" for the club's. */
  handicapBodyId?: string;
  homeClub?: string;
  handicapSource?: string;
  handicapType?: string;
}

export interface SignupResult {
  ok: boolean;
  error?: string;
}

/**
 * A CASUAL ROUND HOLDS AT MOST EIGHT (Ajay, 2026-09-08: "number of players
 * 2–8"), and it is not a tournament — it counts against no allowance. Its
 * creator is its organizer, so the field endpoints accepted them and a round
 * could be grown past the size that keeps it casual (2026-09-30). Null to allow.
 */
async function casualRoundFull(event: { id: string; shape: string }, adding: number): Promise<string | null> {
  if (!isMatch(event.shape)) return null;
  const inField = await prisma.player.count({ where: { eventId: event.id, status: { notIn: LEFT_THE_FIELD } } });
  if (inField + adding <= QUICK_ROUND_MAX_PLAYERS) return null;
  return `A casual round is for up to ${QUICK_ROUND_MAX_PLAYERS} players. For a bigger field, set up a tournament — it's free on ${PLANS.free.name}.`;
}

export async function addSignup(input: SignupInput): Promise<SignupResult> {
  const eventId = await requireStaffEvent();
  const clean = String(input.name ?? "").trim();
  const badName = nameRefusal(clean, PERSON_NAME_MAX, "Enter a player name.");
  if (badName) return { ok: false, error: badName };
  const cleanEmail = String(input.email ?? "").trim().toLowerCase();
  // A home club is a place's name, held to a place's length like the club's
  // own town — said, not cut (the text-box crawl, 2026-10-21).
  if (String(input.homeClub ?? "").trim().length > PLACE_MAX) {
    return { ok: false, error: `Keep the home club to ${PLACE_MAX} characters.` };
  }
  const event = await prisma.event.findUnique({ where: { id: eventId }, include: COURSE_REF });
  if (!event) return { ok: false, error: "Event not found." };
  /**
   * LOCKED IS A REFUSAL IN A SENTENCE, not a throw — the same answer, in the
   * same words, as `addMembersToEvent` beside it on the same screen.
   *
   * This was `assertUnlocked`, which throws on the premise that "a screen that
   * already hides the control" is the only way here. The Add form was the one
   * control on Registration NOT gated on the lock, so on a live medal the
   * organizer filled it in, pressed Add, and got the whole-page "Application
   * error" (walked 2026-09-27). The form is gated now too; this is for any
   * client still out of step, who is a person and should be told something.
   */
  if (configurationLocked(event)) {
    return { ok: false, error: "Configuration is locked. Unlock the tournament to change the field." };
  }
  const casualFull = await casualRoundFull(event, 1);
  if (casualFull) return { ok: false, error: casualFull };
  /**
   * Asked of the tournament, not demanded of everybody — see `entryNeedsEmail`.
   *
   * A tournament signing players in by email genuinely needs one from each of
   * them, and says so. One using Round Codes does not, and refusing the entry
   * anyway is what stopped a society with a names-only roster entering its own
   * members.
   */
  if (!cleanEmail && entryNeedsEmail(settingsOf(event))) {
    return { ok: false, error: "Email is required — it's how this player signs in." };
  }
  if (cleanEmail && !isEmailAddress(cleanEmail)) return { ok: false, error: EMAIL_REFUSAL };
  // A handicap that was typed is one a golfer can have. Not finite is "left
  // blank", which is allowed and is recorded below as no index.
  if (Number.isFinite(input.handicap)) {
    const refused = indexRefusal(input.handicap);
    if (refused) return { ok: false, error: refused };
  }
  // The same rule the public form follows. An organizer typing someone in must
  // not be able to create an entrant the tournament cannot reach, when the
  // stranger filling in the form on their phone cannot.
  const cleanPhone = String(input.phone ?? "").trim();
  if (phoneRequiredFor(event.requirePhone)) {
    if (!cleanPhone) return { ok: false, error: "Enter a mobile number for this player." };
  }
  // A number that was typed is a number, whether or not this tournament asks
  // for one: "call me" stored here is a text nobody can be sent.
  if (cleanPhone && (!looksLikePhone(cleanPhone) || cleanPhone.length > PHONE_MAX)) {
    return { ok: false, error: "That doesn't look like a phone number." };
  }
  /**
   * The same de-duplication the public form has always done.
   *
   * This was the one entry path without it, so an organizer typing in somebody
   * who had already self-registered — the ordinary case of "put me down" after
   * a player has used the link — created a SECOND row for one person: two
   * places against capacity, two tee slots, two rows in the standings, two
   * stakes in an opt-out pot and two shares of every split expense.
   *
   * Reported rather than silently merged. `register.ts` returns `already` and
   * says "you're already registered" warmly, which is right for a stranger
   * re-using a link; an organizer typing a name in needs to know why nothing
   * happened, because they are looking at a field they believe is short by one.
   *
   * Case-insensitive, matching the public form: the same address arrives from a
   * CSV, a phone keyboard and a committee laptop in three different casings.
   */
  /**
   * AND ON THE NAME WHEN THERE IS NO ADDRESS TO MATCH ON.
   *
   * `email: { equals: "" }` does not mean "nobody" — it means EVERY entry
   * without an address, so the first email-less player would have made the
   * second one a duplicate of them, and the third, for the whole field. A
   * check that refuses everybody is worse than the duplicate it was written to
   * catch.
   *
   * Name is what `upsertMember` already falls back to for exactly this case
   * ("email ? findFirst by email : findFirst by name"), so the roster and the
   * field agree about who is already here rather than each having a rule.
   *
   * It is a weaker key and it is the right one: two members really called John
   * Smith are why email became the key in the first place, and an organizer
   * entering the second of them by hand is told the first is already in and
   * can see for themselves. A silent second row is the failure that costs two
   * tee slots and two shares of a split expense; being asked about a real
   * namesake costs one look.
   */
  const duplicate = cleanEmail
    ? await prisma.player.findFirst({
        where: { eventId, ...byAddress(cleanEmail) },
        select: { name: true, status: true },
      })
    : await prisma.player.findFirst({
        where: { eventId, name: { equals: clean, mode: "insensitive" } },
        select: { name: true, status: true },
      });
  if (duplicate) {
    const how = cleanEmail ? "with that email" : "under that name";
    return {
      ok: false,
      error:
        duplicate.status === "withdrawn"
          ? `${duplicate.name} is already entered ${how} but has withdrawn — re-enter them from the roster rather than adding a second entry.`
          : duplicate.status === "disqualified"
            ? // "Already in the field" is the one thing they are not, and a
              // second entry beside the ruling would quietly undo it.
              `${duplicate.name} is already entered ${how} and has been disqualified — reinstate them on Entries rather than adding a second entry.`
            : `${duplicate.name} is already in the field ${how}.`,
    };
  }

  const confirmedCount = await prisma.player.count({ where: { eventId, status: "confirmed" } });
  const maxSeed = await prisma.player.aggregate({ where: { eventId }, _max: { seed: true } });
  // The plan's field cap over the stored number, as `register` and `enter` do.
  // A club moved down to Par keeps the unlimited field it set on a higher tier,
  // and this confirmed an eleventh player past a ten-player cap (2026-09-30).
  const capacity = await fieldLimitFor(event);
  const unlimited = capacity <= 0; // 0 = open / unlimited field
  const status = unlimited || confirmedCount < capacity ? "confirmed" : "waitlisted";
  // Entering someone in a tournament is also how they join the club roster —
  // so the club list is never a separate chore an organizer has to remember.
  const memberId = await upsertMember(
    event.organizationId,
    { ...input, name: clean, email: cleanEmail },
    "staff",
  );
  await prisma.player.create({
    data: {
      eventId,
      memberId,
      name: clean,
      handicap: Number.isFinite(input.handicap) ? input.handicap : 0,
      seed: (maxSeed._max.seed ?? 0) + 1,
      status,
      email: cleanEmail,
      phone: (input.phone ?? "").trim(),
      ghin: (input.ghin ?? "").trim(),
      homeClub: (input.homeClub ?? "").trim(),
      // NO FIGURE, NO CLAIM. An empty handicap box arrives as not-a-number and
      // is stored as "none" whatever the source said: this stored it as 0 "by
      // hand" — a scratch golfer nobody declared, given no strokes in a net
      // round. The guide has always said a blank is not scratch.
      handicapSource: !Number.isFinite(input.handicap)
        ? "none"
        : ["ghin", "manual", "none"].includes(input.handicapSource ?? "")
          ? input.handicapSource!
          : "manual",
      handicapType: input.handicapType === "9" ? "9" : "18",
    },
  });
  await syncPlayerAccount(eventId, clean, cleanEmail);
  // On the record ("Recent changes to the field"), whoever added them.
  await logAudit(eventId, "added", `${clean} was added to the field (${status}).`);
  await refresh();
  return { ok: true };
}

export interface SignupPatch {
  name?: string;
  handicap?: number;
  handicapType?: string;
  email?: string;
  phone?: string;
}

/** Edit an existing player's details in place — e.g. correcting a handicap after import. */
export async function updateSignup(playerId: string, patch: SignupPatch): Promise<SignupResult> {
  const eventId = await requireStaffEvent();
  await assertUnlocked(eventId);
  const player = await prisma.player.findUnique({ where: { id: playerId } });
  if (!player || player.eventId !== eventId) return { ok: false, error: "Player not found." };
  const data: Record<string, string | number> = {};
  if (patch.name !== undefined && String(patch.name).trim()) {
    const name = String(patch.name).trim();
    if (name.length > PERSON_NAME_MAX) return { ok: false, error: `Keep the name to ${PERSON_NAME_MAX} characters.` };
    data.name = name;
  }
  if (patch.handicap !== undefined && Number.isFinite(patch.handicap)) {
    // THE RANGE, HERE AS WELL AS IN THE FORMS. This stored any finite number:
    // the Registration box checks what is typed, a casual round's box did
    // not, and an action is a public endpoint whichever form calls it.
    const refused = indexRefusal(patch.handicap);
    if (refused) return { ok: false, error: refused };
    data.handicap = patch.handicap;
    // Somebody typed this one, so it stops being unknown — including the case
    // this action exists for, correcting an index that arrived blank in a CSV.
    // Without this the roster would keep refusing the correction as "no claim".
    data.handicapSource = "manual";
  }
  if (patch.handicapType !== undefined) data.handicapType = patch.handicapType === "9" ? "9" : "18";
  const oldEmail = player.email.trim().toLowerCase();
  let emailChanged = false;
  if (patch.email !== undefined) {
    const cleanEmail = String(patch.email).trim().toLowerCase();
    if (cleanEmail && !isEmailAddress(cleanEmail)) return { ok: false, error: EMAIL_REFUSAL };
    /**
     * Correcting an email must not create the duplicate `addSignup` now refuses.
     *
     * Typing an address a different entry already holds produces exactly the
     * same two-rows-one-person state, arrived at from the other direction —
     * and the correction that looks like tidying up is what causes it.
     * Scoped `id: { not: playerId }` so re-saving a player's own address, or
     * changing only its casing, is not treated as a clash.
     */
    if (cleanEmail && cleanEmail !== oldEmail) {
      const taken = await prisma.player.findFirst({
        where: {
          eventId,
          id: { not: playerId },
          ...byAddress(cleanEmail),
        },
        select: { name: true },
      });
      if (taken) {
        return { ok: false, error: `${taken.name} is already entered with that email.` };
      }
    }
    data.email = cleanEmail;
    emailChanged = cleanEmail !== oldEmail;
  }
  if (patch.phone !== undefined) {
    // Blank clears it; anything typed is a number, as on the Add form.
    const phone = String(patch.phone).trim();
    if (phone && (!looksLikePhone(phone) || phone.length > PHONE_MAX)) {
      return { ok: false, error: "That doesn't look like a phone number." };
    }
    data.phone = phone;
  }
  if (Object.keys(data).length === 0) return { ok: true };
  await prisma.player.update({ where: { id: playerId }, data });

  /**
   * A CASUAL ROUND TAKES THE CORRECTION (2026-10-07).
   *
   * A round freezes everybody's handicap when its first card comes in, and
   * `RoundHandicap.frozen` is never rewritten — rightly, in a tournament: a
   * committee that changes its mind after play has the override, and a
   * played round is not re-priced by a roster edit. A casual round has no
   * committee. Its handicaps are what the host typed on the first tee, and
   * the panel that corrects one says "Handicaps save when you tap away" —
   * but measured, Bea corrected from 10 to 20 after the 1st kept the shots
   * of a 10 on every screen while the panel read 20.
   *
   * So on a casual round the correction un-freezes that player: the round
   * reads the corrected figure at once, and the next card freezes it again.
   */
  if (data.handicap !== undefined) {
    const shape = await prisma.event.findUnique({ where: { id: eventId }, select: { shape: true } });
    if (isMatch(shape?.shape)) {
      await prisma.roundHandicap.updateMany({
        where: { eventId, playerId, frozen: { not: null } },
        data: { frozen: null, frozenExact: null, frozenParStrokes: null, frozenAt: null },
      });
    }
  }

  // Correcting a detail here corrects it on the roster too — that's the point
  // of having one record per person. Re-resolving rather than updating the
  // linked member directly, because a changed email may now identify someone
  // else on the roster (or nobody, in which case they're added).
  const organizationId = await organizationIdForEvent(eventId);
  if (organizationId) {
    const memberId = await upsertMember(organizationId, {
      name: (data.name as string) ?? player.name,
      email: (data.email as string) ?? player.email,
      phone: (data.phone as string) ?? player.phone,
      ghin: player.ghin,
      homeClub: player.homeClub,
      handicap: (data.handicap as number) ?? player.handicap,
      handicapType: (data.handicapType as string) ?? player.handicapType,
      handicapSource: (data.handicapSource as string) ?? player.handicapSource,
    },
      // Details only: an existing member's index is changed through
      // `setPlayerIndex`, which asks first (2026-10-16).
      "staff-details",
    );
    if (memberId && memberId !== player.memberId) {
      await prisma.player.update({ where: { id: playerId }, data: { memberId } });
    }
  }

  if (emailChanged) {
    const newEmail = data.email as string;
    // The player's old email, if any, no longer belongs to them — revoke the
    // access it granted before (re-)syncing whatever the new one grants.
    if (oldEmail) await revokePlayerAccount(eventId, oldEmail);
    if (newEmail) await syncPlayerAccount(eventId, (data.name as string) ?? player.name, newEmail);
  }
  await refresh();
  return { ok: true };
}

/**
 * Take a player out of the field.
 *
 * Deletes an entry that has no history, and WITHDRAWS one that has. The
 * difference matters because `Scorecard.playerId`, `Match.playerAId` and
 * `Match.playerBId` are plain String columns with no relation and no cascade:
 * deleting a player who has played leaves rows pointing at somebody who no
 * longer exists, and the screens then render a match between a name and a gap.
 *
 * `withdrawn` is the status the schema has documented as the intended soft
 * path since it was written, and no code set or read it. It needs no special
 * handling downstream — the field, the standings and every handicap map are
 * built from `status === "confirmed"`, so a withdrawal drops out of all of
 * them, while `state.players` keeps the row so the matches they did play still
 * have a name on them.
 */
// `keepDefaultStakes` beside it: a stake paid by default is not refunded by
// leaving — see there.
// `hasPlayingHistory` — whether removing this person would DESTROY something —
// lives in services/playing-history.ts, shared with the member's own
// `withdrawMyEntry` so both doors keep a player with history the same way.
export async function removeSignup(playerId: string): Promise<"deleted" | "withdrawn" | "missing"> {
  const eventId = await requireStaffEvent();
  await assertUnlocked(eventId);
  const player = await prisma.player.findUnique({ where: { id: playerId } });
  if (!player || player.eventId !== eventId) return "missing";

  const played = await hasPlayingHistory(eventId, playerId);

  if (played) {
    await prisma.player.update({ where: { id: playerId }, data: { status: "withdrawn" } });
    await keepDefaultStakes(eventId, playerId);
  } else {
    await prisma.player.delete({ where: { id: playerId } });
  }
  if (player.email.trim()) await revokePlayerAccount(eventId, player.email);
  // On the record ("Recent changes to the field") — the organizer's removal, in
  // the same list as a member's own withdrawal.
  //
  // Worded by what they HAD: an entry awaiting approval was never in the field,
  // so turning it away is declining it, and somebody on the waiting list leaves
  // the list — "removed from the field" was false for both (2026-09-28).
  await logAudit(
    eventId,
    "removed",
    player.status === "pending"
      ? `${player.name}'s entry was declined.`
      : player.status === "waitlisted"
        ? `${player.name} was taken off the waiting list.`
        : played
          ? `${player.name} was withdrawn from the field (their results are kept).`
          : `${player.name} was removed from the field.`,
  );

  /**
   * Promote the earliest waitlisted signup if a confirmed spot opened. True of
   * a withdrawal as much as a deletion — the place in the field is free either
   * way, which is the whole reason a club keeps a waitlist.
   *
   * IT NOW CHECKS THAT THERE IS ROOM. This promoted somebody on every departure
   * regardless of the limit, so a field an organizer had just shrunk was pushed
   * back over it one withdrawal at a time — and each promoted player was
   * emailed "you're in, your place is held" for a place that did not exist.
   *
   * `drainWaitlist` is the same arithmetic that fills a field when the capacity
   * goes UP, which is the fault this shares a root with. Doing it here rather
   * than inline also means the limit is read from `playerCountMode` rather than
   * from `capacity`, which goes stale the moment an organizer sets a manual
   * field size.
   */
  if (player.status === "confirmed") {
    await drainWaitlist(eventId);
  }

  await refresh();
  return played ? "withdrawn" : "deleted";
}

/**
 * Bulk delete — e.g. clearing a list before re-uploading a corrected CSV.
 *
 * Reports what it did per outcome, because the two are not the same act and
 * the screen has to be able to say which happened to whom.
 */
export async function removeSignups(
  playerIds: string[],
): Promise<{ deleted: number; withdrawn: number; missing: number }> {
  const eventId = await requireStaffEvent();
  await assertUnlocked(eventId);
  const tally = { deleted: 0, withdrawn: 0, missing: 0 };
  for (const id of playerIds) {
    tally[await removeSignup(id)] += 1;
  }
  return tally;
}

/* CSV parsing lives in src/lib/csv.ts, shared with the roster importer. The
   two have different rules about what a row must contain, but they must
   agree on what a column is — a club whose spreadsheet says "Hcp Index"
   should not be understood by one screen and rejected by the other. */

export interface CsvImportResult {
  imported: number;
  skippedDuplicates: number;
  skippedInvalid: number;
  error?: string;
  /** True when a names-only list switched this tournament to Round Codes as well as email. */
  codesTurnedOn?: boolean;
}

export async function importCsvSignups(csv: string): Promise<CsvImportResult> {
  const eventId = await requireStaffEvent();
  const event = await prisma.event.findUnique({ where: { id: eventId }, include: COURSE_REF });
  if (!event) return { imported: 0, skippedDuplicates: 0, skippedInvalid: 0, error: "Event not found." };
  // A sentence, not a throw — the same reasoning and words as `addSignup`:
  // the import sat beside the Add form, ungated, on a locked tournament.
  if (configurationLocked(event)) {
    return {
      imported: 0,
      skippedDuplicates: 0,
      skippedInvalid: 0,
      error: "Configuration is locked. Unlock the tournament to change the field.",
    };
  }

  /**
   * Parsed with the shared reader, the same one the roster import uses.
   *
   * This had its own header handling and looked only for a single "name"
   * column, so a club system exporting "First Name,Last Name" — at least as
   * common as one combined column — loaded onto the roster and was rejected
   * from the entry list, on the same file, in the same app. Two readers of one
   * format is how that happens; there is now one.
   */
  const table = parseCsv(csv);
  if (!table) return { imported: 0, skippedDuplicates: 0, skippedInvalid: 0, error: "The file is empty." };
  if (!hasNameColumn(table)) {
    return {
      imported: 0,
      skippedDuplicates: 0,
      skippedInvalid: 0,
      error:
        'Couldn\'t find a name column in the header row. Expected a header like: name, handicap, email, phone — or first name and last name in separate columns.',
    };
  }
  // Before anything is written: a casual round cannot be imported past eight.
  const casualFull = await casualRoundFull(event, table.rows.length);
  if (casualFull) return { imported: 0, skippedDuplicates: 0, skippedInvalid: 0, error: casualFull };
  const headerCols = table.columns;
  const emailIdx = headerCols.indexOf("email");
  /**
   * The same rule as every other way in — see `entryNeedsEmail`.
   *
   * Refused at the HEADER for the reason the phone check below records: a file
   * with no email column at all would otherwise read as a hundred individually
   * invalid rows, and the organizer would be told "skipped 100" with no hint
   * that one missing column caused it. That stays; what changes is that a
   * tournament using Round Codes is not asked for the column, because a
   * names-only membership list is exactly the file it will be handed.
   */
  let needsEmail = entryNeedsEmail(settingsOf(event));
  /**
   * A LIST WITH NO ADDRESSES AT ALL TURNS ROUND CODES ON, rather than being
   * refused (Ajay, 2026-09-28, left to my recommendation: "Round Codes by
   * default when the roster has no emails").
   *
   * A club's membership export is very often names and handicaps and nothing
   * else, and the refusal — "email is required so each player can sign in" —
   * sent the organizer off to collect sixty addresses before anybody could be
   * entered. Round Codes exist for exactly that list. So an email-only
   * tournament handed a names-only file keeps email sign-in AND gains codes
   * ("both"), imports the list, and says so on the screen.
   *
   * Only for a file with NO address anywhere. A file where some rows have one
   * is a list with gaps, and those rows are still refused one by one — the
   * organizer meant email sign-in and has most of the addresses.
   */
  const noAddresses = emailIdx === -1 || table.rows.every((cols) => !cell(table, cols, "email").trim());
  const codesTurnedOn = needsEmail && noAddresses;
  const phoneIdx = headerCols.indexOf("phone");
  // Same rule as every other way in: the organizer's setting, on any plan.
  // Refused at the header rather than row by row: a file with no phone column
  // at all would otherwise be read as a hundred individually invalid rows, and
  // the organizer would be told "skipped 100" with no hint that one missing
  // column caused it.
  const needsPhone = phoneRequiredFor(event.requirePhone);
  if (needsPhone && phoneIdx === -1) {
    return {
      imported: 0,
      skippedDuplicates: 0,
      skippedInvalid: 0,
      error:
        'Couldn\'t find a "phone" column in the header row — this tournament collects a mobile number for every entrant. Add a phone column, or enter the field by hand.',
    };
  }
  // After every header refusal, so a file that is going to be turned away
  // anyway does not change the tournament's sign-in on its way out.
  if (codesTurnedOn) {
    await prisma.event.update({ where: { id: eventId }, data: { playerAccess: "both" } });
    await ensureRoundCodes(eventId);
    await logAudit(eventId, "round-codes-on", "Round Codes turned on: the imported list has no email addresses");
    needsEmail = false;
  }
  /**
   * De-duplicated on email where there is one, and on name where there is not.
   *
   * The name check was removed once, correctly, with this reasoning: it drops
   * the second real John Smith in a club that has two of them, "and clubs do"
   * — and it was safe to remove because "the entry importer already requires
   * one from every row".
   *
   * That last clause is no longer true, so the conclusion no longer follows.
   * A file of names with no addresses would re-import in full on every upload,
   * because every row's key is the empty string and `.filter(Boolean)` drops
   * it — the field doubles and nothing says a word.
   *
   * So: email remains the key whenever a row has one, and namesakes are still
   * both imported in that case. Name is the fallback ONLY for rows that have
   * no address at all, which is the same fallback `upsertMember` already makes
   * for the roster. The John Smith cost is real and confined to lists that
   * carry no addresses, where nothing better exists — and it fails towards
   * skipping a row an organizer can add by hand, rather than towards a silent
   * double entry nobody sees until the tee sheet.
   */
  const existing = await prisma.player.findMany({ where: { eventId }, select: { email: true, name: true } });
  const seenEmails = new Set(existing.map((p) => p.email.trim().toLowerCase()).filter(Boolean));
  const seenNames = new Set(
    existing.filter((p) => !p.email.trim()).map((p) => p.name.trim().toLowerCase()).filter(Boolean),
  );

  let confirmedCount = await prisma.player.count({ where: { eventId, status: "confirmed" } });
  // The plan's field cap over the stored number — see `addSignup`.
  const capacity = await fieldLimitFor(event);
  const unlimited = capacity <= 0;
  const agg = await prisma.player.aggregate({ where: { eventId }, _max: { seed: true } });
  let seed = (agg._max.seed ?? 0) + 1;

  let imported = 0;
  let skippedDuplicates = 0;
  let skippedInvalid = 0;

  for (const cols of table.rows) {
    // Handles a single "Name" column and a "First Name"/"Last Name" pair alike.
    const name = nameFrom(table, cols);
    if (!name) {
      skippedInvalid += 1;
      continue;
    }
    const emailKey = emailIdx === -1 ? "" : cell(table, cols, "email").toLowerCase();
    /**
     * A blank address is a refusal only where the tournament needs one. A
     * MALFORMED one is always a refusal — "j.smith@" is somebody's mistake in
     * either case, and importing it would create an entrant whose sign-in can
     * never work while the roster shows an address that looks fine at a
     * glance.
     */
    if (!emailKey && needsEmail) {
      skippedInvalid += 1;
      continue;
    }
    if (emailKey && !EMAIL_RE.test(emailKey)) {
      skippedInvalid += 1;
      continue;
    }
    const nameKey = name.trim().toLowerCase();
    if (emailKey ? seenEmails.has(emailKey) : seenNames.has(nameKey)) {
      skippedDuplicates += 1;
      continue;
    }
    // The column exists (checked above), so a row failing here is that one
    // player's cell being blank or unreadable — the same class as a missing
    // email, and counted the same way.
    if (needsPhone && !looksLikePhone(cell(table, cols, "phone"))) {
      skippedInvalid += 1;
      continue;
    }
    // Same reading as the public form, for the same reason: parseFloat("+2.4")
    // is 2.4, and a plus handicap is 2.4 the other way. An entry list is where
    // the club's better players arrive, so this is the importer where the sign
    // was wrong most often.
    const hcp = parseHandicapInput(cell(table, cols, "handicap"));
    const handicap = hcp.ok ? hcp.value : 0;
    // An empty cell, no handicap column at all, or something unreadable are all
    // the absence of a handicap rather than a scratch one — and the roster has
    // to be told which, or a spring CSV without an index column silently
    // rewrites every stored handicap in the club to 0.
    const handicapSource = hcp.ok ? hcp.source : "none";
    const status = unlimited || confirmedCount < capacity ? "confirmed" : "waitlisted";
    if (status === "confirmed") confirmedCount += 1;
    // One reading, shared with the roster importer — see `parseHandicapType`.
    const handicapType = parseHandicapType(cell(table, cols, "handicapType"));
    const phone = cell(table, cols, "phone");
    // THE COLUMNS THE ROSTER IMPORT READS, READ HERE TOO. A "Home club" or "GHIN"
    // column in an entry list was recognised by its header and then dropped, so
    // the same file put a visitor's club on Members and not on the entry
    // (2026-10-21, checking every door that adds a player).
    const ghin = cell(table, cols, "ghin").trim();
    const homeClub = cell(table, cols, "homeClub").trim();
    // Importing a field also builds the roster: a club that uploads its
    // spring CSV has its member list from then on, without a second import.
    const memberId = await upsertMember(
      event.organizationId,
      { name, email: emailKey, phone, ghin, homeClub, handicap, handicapType, handicapSource },
      "staff",
    );
    await prisma.player.create({
      data: {
        eventId,
        memberId,
        name,
        handicap,
        seed: seed++,
        status,
        email: emailKey,
        phone,
        ghin,
        homeClub,
        handicapType,
        handicapSource,
      },
    });
    // A no-op for a blank address, which is what makes an email-less entry a
    // Round Code player rather than a broken sign-in.
    await syncPlayerAccount(eventId, name, emailKey);
    /**
     * BOTH KEYS UPDATED AS WE GO, or a file that repeats a row imports it
     * twice. `seenEmails` alone would have let every duplicate of an
     * address-less name straight through — the within-file half of the same
     * hole the set above closes for rows already in the field.
     */
    if (emailKey) seenEmails.add(emailKey);
    else seenNames.add(nameKey);
    imported += 1;
  }

  await refresh();
  return { imported, skippedDuplicates, skippedInvalid, ...(codesTurnedOn ? { codesTurnedOn } : {}) };
}

export async function setInviteMessage(message: string) {
  const eventId = await requireStaffEvent();
  await prisma.event.update({ where: { id: eventId }, data: { inviteMessage: message } });
  await refresh();
}

/* ── Event setup ──────────────────────────────────────────────────────── */

export async function saveEvent(data: {
  name: string;
  /**
   * What this one is called — outing, charity day, league. Copy only, and
   * optional so an older caller leaves the club's answer alone.
   */
  playKind?: string;
  dates: string;
  /**
   * THE CALENDAR DATES `dates` IS THE LABEL FOR (2026-10-10). "Save event"
   * stored the label and not these, so a tournament reading "Oct 12 – 13,
   * 2026" on its own screen was filed under "No dates yet" on every member's
   * Events list, the club calendar and the season — only "Save dates", a
   * second button beside the big one, wrote them. Optional so an older caller
   * leaves them alone; cleaned exactly as `setTournamentDates` cleans them.
   */
  startOn?: string;
  endOn?: string;
  /**
   * Whether those dates are still a proposal. Optional so an older caller —
   * or a screen that does not ask the question — leaves the club's answer
   * alone rather than quietly settling it.
   */
  datesTentative?: boolean;
  format: string;
  course: string;
  courseId: string;
  city: string;
  address: string;
  regDeadline: string;
  /** First day entries are taken. Optional so an older caller leaves it alone. */
  regOpens?: string;
  capacity: number;
  playerCountMode: string;
  courseMode: string;
}): Promise<{ ok: boolean; error?: string }> {
  const eventId = await requireAdminEvent();
  await assertUnlocked(eventId);

  /**
   * A TOURNAMENT HAS A NAME (the text-box crawl, 2026-10-21). This stored
   * whatever arrived: a blank, which every list then drew as nothing, and
   * 2,000 characters, which every header then drew. Refused in words; the
   * screen says it beside its Save.
   */
  const name = String(data.name ?? "").trim();
  const badName = nameRefusal(name, TITLE_MAX, "Name the tournament before saving.");
  if (badName) return { ok: false, error: badName };

  /**
   * The course id is proven to be this club's before it is stored.
   *
   * A `"use server"` export is a public HTTP endpoint whatever the screen
   * sends, and an unchecked id here would point a tournament at another
   * organization's card — scoring every round against a stranger's par and
   * stroke index. An id that does not survive this becomes empty rather than
   * refusing the save: the venue is one field of many on this form, and the
   * name beside it still names the course.
   */
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { organizationId: true, course: true, courseId: true },
  });
  const owned = data.courseId?.trim()
    ? await prisma.course.findFirst({
        // Narrowed where the id arrives, not through a variable: the club
        // boundary has to be visible in the same clause as the id.
        where: { id: data.courseId.trim(), organizationId: event?.organizationId ?? "" },
        select: { id: true },
      })
    : null;
  const courseId = owned?.id ?? null;

  /**
   * Changing the venue drops the card that belonged to the old one.
   *
   * customPars/Yards/StrokeIndex are the event's OWN card, entered for
   * whatever course it was set to at the time. Nothing cleared them when the
   * course changed, so a tournament moved from one course to another kept
   * scoring against the first one's stroke index while displaying the
   * second one's name — found on real data: an event reading "Blue Ash Golf
   * Course" still carrying Pebble Beach's card.
   *
   * Only on a CHANGE, so re-saving the form for any other reason leaves a
   * hand-entered card alone.
   */
  const movedVenue =
    !!event && (event.course !== data.course || (event.courseId ?? null) !== courseId);
  const clearedCard = movedVenue
    ? { customPars: "", customYards: "", customStrokeIndex: "" }
    : {};
  const start = data.startOn === undefined ? undefined : cleanIsoDate(String(data.startOn));
  const end = data.endOn === undefined ? undefined : cleanIsoDate(String(data.endOn));
  const calendar =
    start === undefined
      ? {}
      : { startOn: start, endOn: start && end && end < start ? start : (end ?? "") };
  await prisma.event.update({
    where: { id: eventId },
    data: {
      name,
      ...calendar,
      // Only a word this app offers, because a `"use server"` export is a
      // public endpoint and this one prints into a member's sentence.
      ...(data.playKind && isPlayKind(data.playKind) ? { playKind: data.playKind } : {}),
      dates: data.dates,
      ...(data.datesTentative === undefined ? {} : { datesTentative: data.datesTentative }),
      format: data.format === "stroke" ? "stroke" : "match",
      course: data.course,
      // The id and the name together, from the one choice the organizer
      // made. Null where they typed a name by hand or the id was not this
      // club's — the name still names the course either way.
      courseId,
      ...clearedCard,
      city: data.city,
      address: data.address,
      // Only ever the two known values — an unrecognised mode would decide
      // whether every match asks where it was played.
      courseMode: data.courseMode === "open" ? "open" : "fixed",
      regDeadline: data.regDeadline,
      // A real date or nothing. This is a public endpoint, and free text here
      // would be displayed as a date while opening nothing — see
      // `parseDeadlineIso`. Left out entirely, the stored value is kept.
      ...(data.regOpens === undefined
        ? {}
        : { regOpens: parseDeadlineIso(String(data.regOpens)) }),
      // 0 is the deliberate "open / unlimited field" sentinel (see the Fixed/Open
      // toggle in EventSetupClient) — only clamp upward when the organizer has
      // actually set a positive fixed capacity, otherwise every save was
      // silently converting "open" into "capacity 1" the moment anyone hit Save.
      //
      // STORED AS THE ORGANIZER SET IT, and held to the plan's cap where it is
      // READ (2026-10-09). This stored the cap — "open" on Par became ten — so
      // a club that later moved up a tier kept a ten-player field it never
      // chose. Every intake, promotion and waitlist path reads through
      // `fieldLimitFor` / `fieldCapFor`; see `createTournament`.
      capacity: data.capacity <= 0 ? 0 : Math.max(1, Math.round(data.capacity)),
      playerCountMode: data.playerCountMode === "manual" ? "manual" : "registration",
      // `sideStyle` is no longer written. Tournament details stopped asking
      // "how do people play?" — see the note where that field stood — and the
      // two things it decided are now read from the rounds themselves. The
      // column stays as it is; nothing reads it.
    },
  });

  /**
   * A bigger field takes the people already queuing for it.
   *
   * Nothing reconciled this. An organizer with eight confirmed and four waiting
   * who opened the field to sixteen left all four exactly where they were —
   * while the public registration page began advertising the new places
   * immediately. So the next strangers to open the link were confirmed ahead of
   * the people who had queued first, which is the one thing a waitlist exists
   * to prevent.
   *
   * Unconditional rather than gated on "did the capacity go up". `drainWaitlist`
   * promotes nobody when there is no room, so asking it every save is both
   * correct and cheaper to reason about than reconstructing what changed — and
   * it catches the cases a capacity comparison would miss, such as switching
   * playerCountMode from a manual count back to registration.
   *
   * It never demotes. Cutting the capacity with a full field is a decision an
   * organizer makes with the field in front of them, and silently moving
   * confirmed players out because a number went down would be a far worse
   * surprise than an over-full field they can see. `applyManualCount` handles
   * the trimming case deliberately, behind a confirmation.
   */
  await drainWaitlist(eventId);

  /**
   * THE TOURNAMENT'S OWN COURSE IS ONE OF ITS VENUES.
   *
   * Every other writer of a venue links it — `setStageCourse`,
   * `setMatchCourse` and `nameMatchVenue` all upsert this row, each with a
   * comment saying why: "so the existing per-match course picker and every
   * downstream resolver accept it". This one, the screen where a club picks
   * the course in the first place, wrote `Event.courseId` and stopped.
   *
   * So a tournament could hold two answers to "where is this played" that
   * disagreed, and the demo data does: `Event.courseId` names Blue Ash while
   * the only `EventCourse` row names Green Crest.
   *
   * That is not cosmetic, because `teesForEvent` reads tees through the
   * VENUE join. On that tournament the "Played from" picker offered Green
   * Crest's three sets — 69.5/122, 68.3/119, 68.1/110 — under a header
   * reading Blue Ash, and `teeForPlay`, asked to scope its fallback to
   * `event.courseId`, found no tees at that course at all and fell through to
   * the first across every venue. A round at Blue Ash priced off Green
   * Crest's slope.
   *
   * UPSERT, NEVER DELETE. A tournament may legitimately have several venues,
   * and a round or a match may already point at the old one — removing it
   * would orphan them. Changing the event's course adds a venue; it does not
   * retire the others, which is what the Courses list is for.
   */
  if (courseId) {
    await prisma.eventCourse.upsert({
      where: { eventId_courseId: { eventId, courseId } },
      update: {},
      create: { eventId, courseId },
    });
  }

  await refresh();
  return { ok: true };
}

export async function applyManualCount(target: number, force = false): Promise<RegenResult> {
  const eventId = await requireStaffEvent();
  await assertUnlocked(eventId);

  // Resizing the field rebuilds the schedule, which discards scored matches
  // exactly as regenGroups does — same guard, for the same reason.
  const scored = await scoredMatchCount(eventId);
  if (scored > 0 && !force) {
    return { ok: false, needsConfirm: true, scoredMatches: scored };
  }

  const t = Math.max(0, Math.round(target));
  // The plan's field cap, where one is enforced. Refused rather than clamped:
  // this pads the field with placeholder players, and quietly making fewer
  // than asked would leave the organizer counting names to find out why.
  const owner = await prisma.event.findUnique({ where: { id: eventId }, select: { organizationId: true } });
  const cap = owner ? await fieldCapFor(owner.organizationId) : null;
  if (cap !== null && t > cap) {
    return { ok: false, error: `Your plan holds up to ${cap} players in a tournament. Upgrade for a bigger field.` };
  }
  const confirmed = await prisma.player.findMany({
    where: { eventId, status: "confirmed" },
    orderBy: { seed: "asc" },
  });

  if (confirmed.length > t) {
    // Trim excess to the waitlist (highest seeds first).
    const excess = confirmed.slice(t);
    await prisma.player.updateMany({
      where: { id: { in: excess.map((p) => p.id) } },
      // Cleared, or somebody moved back OFF the field would keep a badge
      // reading "Promoted 2 days ago" — a true statement about a player who is
      // no longer in it, which is worse than saying nothing.
      data: { status: "waitlisted", promotedAt: null },
    });
    /**
     * The direction that must never be silent.
     *
     * These people were told "You're confirmed in the field" and are not any
     * more. Nobody re-checks whether they are still entered, so without this
     * they find out at the course.
     */
    await notifyFieldChange(
      eventId,
      excess.map((p) => ({ email: p.email, name: p.name })),
      "waitlisted",
    );
  } else if (confirmed.length < t) {
    let need = t - confirmed.length;
    // Promote waitlist first.
    const wait = await prisma.player.findMany({
      where: { eventId, status: "waitlisted" },
      orderBy: { seed: "asc" },
      take: need,
    });
    if (wait.length) {
      await prisma.player.updateMany({
        where: { id: { in: wait.map((p) => p.id) } },
        data: { status: "confirmed", promotedAt: new Date() },
      });
      await notifyFieldChange(
        eventId,
        wait.map((p) => ({ email: p.email, name: p.name })),
        "promoted",
      );
      need -= wait.length;
    }
    // Then pad with placeholders.
    const agg = await prisma.player.aggregate({ where: { eventId }, _max: { seed: true } });
    let seed = (agg._max.seed ?? 0) + 1;
    for (let i = 0; i < need; i += 1) {
      await prisma.player.create({
        data: { eventId, name: `Player ${seed}`, handicap: 12, seed: seed, status: "confirmed" },
      });
      seed += 1;
    }
  }
  await prisma.event.update({
    where: { id: eventId },
    data: { playerCountMode: "manual", manualPlayerCount: t },
  });
  if (scored > 0) {
    await logAudit(eventId, "resize-field", `Resized field to ${t}, discarding ${scored} scored matches`);
  }
  await regenerateGroupsAndSchedule(eventId);
  await refresh();
  return { ok: true };
}

/* ── Grouping ─────────────────────────────────────────────────────────── */

const FLIGHT_MODES = ["auto", "count", "perFlight"];

export interface RegenResult {
  ok: boolean;
  /** Set when the call was refused because it would destroy real results.
   *  Call again with `force` to go ahead anyway. */
  needsConfirm?: boolean;
  scoredMatches?: number;
  error?: string;
}

/**
 * Rebuild flights and the round-robin schedule.
 *
 * This deletes every Round Robin match and recreates them, so on a tournament
 * that is part-played it destroys results. `assertUnlocked` does not catch
 * that: it keys off `Event.status`, which stays "draft" until someone presses
 * Launch — a tournament can be most of the way played and still be unlocked.
 *
 * So the guard is on scored matches, and the organizer has to confirm.
 */
export interface MovePlayerResult {
  ok: boolean;
  error?: string;
  /** Set when matches already exist for the flights involved. */
  needsConfirm?: boolean;
  scoredMatches?: number;
}

/**
 * Move one player into a different flight.
 *
 * The manual formation rule chunks the roster into flights and, until now,
 * that was the end of it — an organizer who wanted Ferris in Flight 2 had to
 * reorder the roster and regenerate, which reshuffles everyone else too. This
 * is the missing half: manual has to mean manual.
 *
 * Refuses once scores exist unless forced. Flights decide who plays whom, so
 * moving someone after a match has been returned changes what that result was
 * a result *of* — recoverable, but never silently.
 */
export async function movePlayerToGroup(
  playerId: string,
  groupId: string,
  force = false,
): Promise<MovePlayerResult> {
  const eventId = await requireStaffEvent();
  // Returned, not thrown: the board can be open in a tab while the tournament is launched in
  // another, and a throw made the whole screen "This screen didn't load" (2026-10-21).
  const locked = await lockedRefusal(eventId, "change the flights");
  if (locked) return { ok: false, error: locked };
  // A confirmed draw is moved by nobody until it is reopened — checked here, not only hidden on the
  // board, because a server action is a public endpoint.
  const confirmedDraw = await prisma.event.findUnique({ where: { id: eventId }, select: { flightsConfirmed: true } });
  if (confirmedDraw?.flightsConfirmed) return { ok: false, error: "Draw confirmed. Reopen it to move anyone." };

  // Both ends scoped to the caller's tournament. Either one unscoped would let
  // an organizer of any event move a stranger's player into a stranger's
  // flight by posting two ids.
  //
  // And `stageId: null`, so the destination is a FLIGHT. A match carrier is a
  // round's fixture bucket with no players in it by definition, and moving
  // somebody into one would put a player in a row every screen has just been
  // taught to hide. Checked here rather than trusted to the UI, because a
  // `"use server"` export is a public HTTP endpoint.
  const [player, group] = await Promise.all([
    prisma.player.findFirst({ where: { id: playerId, eventId }, select: { id: true, groupId: true } }),
    prisma.group.findFirst({ where: { id: groupId, eventId, isCarrier: false }, select: { id: true } }),
  ]);
  if (!player) return { ok: false, error: "Player not found in this tournament." };
  if (!group) return { ok: false, error: "Flight not found in this tournament." };
  if (player.groupId === groupId) return { ok: true };

  const scored = await scoredMatchCount(eventId);
  if (scored > 0 && !force) {
    return { ok: false, needsConfirm: true, scoredMatches: scored };
  }

  await prisma.player.update({ where: { id: playerId }, data: { groupId } });
  /**
   * They cannot captain a flight they have left.
   *
   * `setFlightCaptain` refuses to appoint somebody who is not a member; this
   * is the other end of the same rule, and it was missing — the move wrote
   * `Player.groupId` and left `captainId` pointing at a player who is now
   * somewhere else. The grouping screen then named an absent captain, and the
   * ex-captain kept the flight's availability panel.
   *
   * Scoped to the flight they came FROM. Moving into a flight they already
   * captain is not a resignation, and `player.groupId === groupId` returned
   * early above anyway.
   */
  if (player.groupId) {
    await prisma.group.updateMany({
      where: { id: player.groupId, eventId, captainId: playerId },
      data: { captainId: null },
    });
    await prisma.group.updateMany({
      where: { id: player.groupId, eventId, viceCaptainId: playerId },
      data: { viceCaptainId: null },
    });
  }
  // The flight decides who they play. Without this the move changed a foreign
  // key and nothing else: the player kept a full card of matches against their
  // old flight and had none against their new one, and the standings showed
  // them under a flight they had never played anybody in.
  await repairPlayerPairings(eventId, playerId);
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function regenGroups(
  rule: FormationRule,
  mode = "auto",
  value = 0,
  force = false,
): Promise<RegenResult> {
  const eventId = await requireStaffEvent();
  await assertUnlocked(eventId);

  // Refused, not quietly rewritten.
  //
  // These used to fall back to "balanced" and "auto" for anything they didn't
  // recognise. The organizer pressed Generate flights with Manual selected,
  // the screen came back saying Balanced, and nothing anywhere said why — the
  // exact shape of the standing "manual flights reset to Auto" report. A
  // silent coercion here can only ever turn a caller's mistake into a
  // tournament drawn under a rule nobody chose, so it says so instead.
  if (!(FORMATION_RULES as string[]).includes(rule)) {
    return { ok: false, error: `"${rule}" isn't a formation rule this tournament can use.` };
  }
  if (!FLIGHT_MODES.includes(mode)) {
    return { ok: false, error: `"${mode}" isn't a flight-size setting this tournament can use.` };
  }

  const scored = await scoredMatchCount(eventId);
  if (scored > 0 && !force) {
    return { ok: false, needsConfirm: true, scoredMatches: scored };
  }

  await prisma.event.update({
    where: { id: eventId },
    data: {
      formationRule: rule,
      flightMode: mode,
      flightValue: Math.max(0, Math.round(value)),
    },
  });
  if (scored > 0) {
    await logAudit(eventId, "regenerate-flights", `Rebuilt flights, discarding ${scored} scored matches`);
  }
  await regenerateGroupsAndSchedule(eventId);
  await refresh();
  return { ok: true };
}

/**
 * Build the schedule for a single Round Robin stage that has a cut line
 * entering it — separate from the global "Generate flights" reset because it
 * depends on the PREVIOUS round's real results, which only exist once that
 * round has been played. Only that stage's matches are touched; every other
 * round's data and scores are left alone.
 */
export async function generateNextRound(stageId: string) {
  const eventId = await requireStaffEvent();
  /**
   * RUNNING THE COMPETITION, NOT SETTING IT UP (Ajay, 2026-09-27: "go with
   * what a golf pro would decide"). Drawing the next round from the results
   * is what a committee does DURING an event, so a live tournament no longer
   * has to be unlocked for it.
   *
   * What the lock was also doing, and still must: `generateCutRound` DELETES
   * the target round's cards or matches before drawing it. So once setup is
   * locked, the draw is allowed only while that round has nothing on it — a
   * re-press after the round has started would wipe the scores being played.
   * Redrawing a round with results in it stays behind an explicit unlock.
   */
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { status: true, configUnlocked: true } });
  if (event && configurationLocked(event) && (await enteredCardCount(eventId, stageId)) > 0) {
    return {
      ok: false as const,
      error:
        "That round already has scores, so drawing it again would wipe them. Unlock setup first if that is really what you want.",
    };
  }
  const result = await generateCutRound(eventId, stageId);
  /**
   * A refusal has to reach the screen, or it is the same silence as before.
   *
   * `generateCutRound` used to return void, so a round that could not be built
   * looked exactly like one that had been: the button finished, the page
   * revalidated, and the round was still empty. Only `no-results` carries a
   * message, because it is the only one an organizer can act on — the others
   * mean the caller sent an id for a stage that is not a playing round, which
   * the UI does not offer.
   */
  if (!result.ok) {
    if (result.reason === "no-results") {
      return {
        ok: false as const,
        error: `${result.roundName} has no scores yet. A cut taken now would rank the whole field on zero and advance the lowest handicaps. Enter that round's results first.`,
      };
    }
    if (result.reason === "no-pairings") {
      return {
        ok: false as const,
        error:
          result.survivors === 1
            ? "Only one player survives this cut, so there is nobody left to play. Widen the cut, or finish the tournament here."
            : `Only ${result.survivors} players survive this cut and none of them can be paired. Widen the cut.`,
      };
    }
    if (result.reason === "seeded-not-generated") {
      return {
        ok: false as const,
        error:
          "A bracket is seeded from the standings, not generated. Set who qualifies under Qualification — a cut on this round does not change the draw.",
      };
    }
    return { ok: false as const, error: "That round can't be generated." };
  }
  await refresh();
  return { ok: true as const };
}

/* ── Scoring rules ────────────────────────────────────────────────────── */

export async function saveScoring(data: {
  winPts: number;
  tiePts: number;
  lossPts: number;
  holeRatioPts: number;
  bonusPts: number;
  maxPerMatch: number;
}) {
  const eventId = await requireStaffEvent();
  await assertUnlocked(eventId);
  await prisma.event.update({
    where: { id: eventId },
    data: {
      winPts: data.winPts,
      tiePts: data.tiePts,
      lossPts: data.lossPts,
      holeRatioPts: data.holeRatioPts,
      bonusPts: data.bonusPts,
      maxPerMatch: data.maxPerMatch,
    },
  });
  await refresh();
}

export async function setQualifyPerGroup(n: number) {
  const eventId = await requireStaffEvent();
  await assertUnlocked(eventId);
  await prisma.event.update({
    where: { id: eventId },
    data: { qualifyPerGroup: Math.min(3, Math.max(1, Math.round(n))) },
  });
  await refresh();
}

/* ── Stages ───────────────────────────────────────────────────────────── */

export async function setStageDeadline(stageId: string, deadline: string): Promise<{ ok: boolean; error?: string }> {
  const eventId = await requireStaffEvent();
  // Not behind the lock: moving the day scores are due is a decision made
  // during an event (rain, a late group) — Ajay, 2026-09-27.
  const updated = await prisma.stage.updateMany({ where: { id: stageId, eventId }, data: { deadline } });
  // A round removed in another tab matched nothing, and the box went on showing a date nobody
  // held, with nothing said (2026-10-21). The same words the sign-up deadline uses.
  if (updated.count === 0) return { ok: false, error: "That round isn't in this tournament." };
  await refresh();
  return { ok: true };
}

/**
 * The tournament's own dates, and whether the club has fixed them yet.
 *
 * SEPARATE FROM `saveEvent`, and deliberately NOT behind the setup lock — the
 * same reasoning as `setStagePlayedOn` directly below, and found the same way:
 * by trying it. Launching now requires dates, and the honest answer for a club
 * that has not settled them is "tentative". A tentative date becomes a fixed
 * one WEEKS LATER, by which time the tournament is live and its configuration
 * locked, so the whole feature would have been a flag nobody could ever clear
 * without unlocking a tournament that is being played.
 *
 * A date is not structure: it moves no score, no draw and no flight. What it
 * moves is what the field is told, which is the point of it.
 */
export async function setTournamentDates(
  startOn: string,
  endOn: string,
  tentative: boolean,
  label: string,
) {
  const eventId = await requireAdminEvent();
  /**
   * CALENDAR DATES ARE THE TRUTH; the label is what screens read.
   *
   * `cleanIsoDate` is the same reader every other date in this file goes
   * through, so anything that is not a date becomes "" rather than being
   * stored — a `"use server"` export is a public HTTP endpoint and will be
   * called with whatever the caller likes. An end before the start is taken
   * as a single day: a golf tournament cannot finish before it starts, and
   * refusing the save would lose the start date the organizer did give.
   */
  const start = cleanIsoDate(startOn);
  const end = cleanIsoDate(endOn);
  const ordered = start && end && end < start ? start : end;
  await prisma.event.update({
    where: { id: eventId },
    data: {
      startOn: start,
      endOn: ordered,
      // Derived, never typed — but taken from the caller so it is formatted in
      // the club's own date order, which only the screen knows. Empty dates
      // leave whatever an older row already said: that sentence is the only
      // record of when a tournament created before these columns was played.
      ...(start ? { dates: label.trim() } : {}),
      datesTentative: tentative,
    },
  });
  await refresh();
}

/**
 * Move one round to a different day.
 *
 * The rain-out. A league night gets called off and the committee replays it a
 * fortnight later; nothing about the other weeks changes, and nothing about
 * the scores already entered changes either — this is a date, not a reset.
 *
 * Empty clears the date back to "no fixed day". Anything unparseable is
 * treated as empty rather than stored, so a bad value can never render as a
 * confidently wrong date on every player's phone.
 */
/**
 * A Par tournament's rounds fall within `ROUND_WINDOW_DAYS` (Ajay, 2026-09-29):
 * the reason a date is refused, or null. Only where the Par terms apply — the
 * same `wipesOnCloseFor` that decides whether completing deletes it — so a
 * grandfathered club, a paid one and a held tournament date rounds freely.
 */
async function parRoundWindowRefusal(
  eventId: string,
  newDates: string[],
  exceptStageId?: string,
): Promise<string | null> {
  const dated = newDates.filter(Boolean);
  if (dated.length === 0 || !(await wipesOnCloseFor(eventId))) return null;
  const others = (
    await prisma.stage.findMany({
      where: { eventId, ...(exceptStageId ? { id: { not: exceptStageId } } : {}) },
      select: { playedOn: true },
    })
  ).map((s) => s.playedOn);
  return roundWindowRefusal(dated[0], [...others, ...dated.slice(1)]);
}

export async function setStagePlayedOn(stageId: string, date: string): Promise<{ ok: boolean; error?: string }> {
  const eventId = await requireStaffEvent();
  const refusal = await parRoundWindowRefusal(eventId, [cleanIsoDate(date)], stageId);
  if (refusal) return { ok: false, error: refusal };
  /**
   * NOT behind the setup lock (2026-09-19). A date is not structure: it moves
   * no score, no draw and no flight, and the field's own help text promises
   * "Rained off? Change the date here" — which is a mid-season act, on a
   * league that is live and therefore locked. The field stayed editable and
   * the save then failed, so a rain-out could not be recorded without first
   * unlocking the whole tournament's setup.
   */
  await prisma.stage.updateMany({
    where: { id: stageId, eventId },
    data: { playedOn: cleanIsoDate(date) },
  });
  await refresh();
  return { ok: true };
}

/**
 * Date every undated round in one go — `planSeasonDates` says which gets what.
 *
 * Staff only, on an unlocked tournament, like `setStagePlayedOn` above; each
 * write is bounded by `{ id, eventId }`, so a round of another tournament can
 * never be touched. Only PLAYING rounds are dated: a cut is not a day anybody
 * turns up for.
 */
export async function dateUndatedRounds(
  startDate: string,
  intervalDays: unknown,
): Promise<{ dated: number; first?: string; error?: string }> {
  const eventId = await requireStaffEvent();
  // Not behind the setup lock, for the reason on setStagePlayedOn: a live
  // league is exactly the one whose players are missing their calendar.
  const start = cleanIsoDate(startDate);
  if (!start) throw new Error("Choose the date of the first round.");
  const step = Number(intervalDays);
  if (!Number.isInteger(step) || step < 1 || step > 31) {
    throw new Error("How often the rounds are played should be between 1 and 31 days.");
  }
  const stages = await prisma.stage.findMany({
    where: { eventId },
    orderBy: { position: "asc" },
    select: { id: true, type: true, playedOn: true },
  });
  const plan = planSeasonDates(
    stages.filter((s) => isPlayingRound(s.type)),
    start,
    step,
  );
  // Returned rather than thrown: Next strips a thrown message in production.
  const refusal = await parRoundWindowRefusal(eventId, plan.map((p) => p.playedOn));
  if (refusal) return { dated: 0, error: refusal };
  for (const p of plan) {
    await prisma.stage.updateMany({ where: { id: p.id, eventId }, data: { playedOn: p.playedOn } });
  }
  await refresh();
  // The earliest day given, for the confirmation ("…, the first on Sat 7 Nov").
  const first = plan.map((p) => p.playedOn).sort()[0] ?? "";
  return { dated: plan.length, first };
}

export async function setStageCarry(stageId: string, enabled: boolean, pct: number) {
  const eventId = await requireStaffEvent();
  await assertUnlocked(eventId);
  await prisma.stage.updateMany({
    where: { id: stageId, eventId },
    data: {
      carryForwardEnabled: enabled,
      carryForwardPct: Math.min(100, Math.max(0, Math.round(pct / 5) * 5)),
      // Touching the control at all counts as answering, including turning it
      // off — "no, rounds start fresh" is a decision, and the prompt should
      // not keep asking someone who has made it.
      carryForwardAsked: true,
    },
  });
  await refresh();
}

export async function setStageCut(stageId: string, enabled: boolean, mode: string, count: number, percent: number) {
  const eventId = await requireStaffEvent();
  await assertUnlocked(eventId);
  await prisma.stage.updateMany({
    where: { id: stageId, eventId },
    data: {
      cutEnabled: enabled,
      cutMode: mode === "percent" ? "percent" : "count",
      cutCount: Math.max(1, Math.round(count)),
      cutPercent: Math.min(100, Math.max(1, Math.round(percent))),
    },
  });
  await refresh();
}

/**
 * WHAT THIS ROUND IS DECIDED ON — which is the competition, not a display
 * preference.
 *
 * Gross, net and Stableford rank the same eighteen numbers into three
 * different orders, and since the countback was corrected to run on the basis
 * and nothing else, this also decides every tie. A scratch competition flipped
 * to net hands the prizes to the high handicappers it was played to exclude,
 * and back again; nothing is deleted and no screen says a thing.
 *
 * Same guard and same shape as `setStageFormat`, for the same reason.
 */
export async function setStageScoringBasis(stageId: string, basis: string, force = false) {
  const eventId = await requireStaffEvent();
  await assertUnlocked(eventId);
  const current = await prisma.stage.findFirst({
    where: { id: stageId, eventId },
    select: { scoringBasis: true, format: true },
  });
  // A Stableford round is always net — `basisFor` has the ruling. A caller
  // asking for gross on one gets net, because this is a public endpoint and the
  // picker no longer offers it.
  const value = basisFor(current?.format, basis);
  // No "this re-scores N cards" on a Stableford round: its points were always
  // worked out off handicap, so moving a stored "gross" to net changes nothing.
  if (!force && !isStablefordFormat(current?.format)) {
    // Only when it actually changes — see `setStageHoles`.
    if (current && current.scoringBasis !== value) {
      const cards = await enteredCardCount(eventId, stageId);
      if (cards > 0) return { ok: false as const, needsConfirm: true as const, cards };
    }
  }
  await prisma.stage.updateMany({
    where: { id: stageId, eventId },
    data: { scoringBasis: value },
  });
  await refresh();
  return { ok: true as const };
}

/**
 * The committee's override for how this round's scores are RECORDED.
 *
 * Distinct from `setStageScoringBasis`, which decides how they are SCORED.
 * Gross or net is what the round is played for; a card or hole results is what
 * the field writes down, and a gross card can be re-scored either way while
 * hole results cannot.
 *
 * Empty clears it and returns the round to the input its format declares,
 * exactly as a zero allowance does. A value the format does not offer is
 * refused rather than stored: this is a `"use server"` export, so it is a
 * public HTTP endpoint that will be called with whatever the caller likes, and
 * "final result only" on a Stableford round would be a shape no engine reads.
 */
export async function setStageScoreInput(stageId: string, input: string) {
  const eventId = await requireStaffEvent();
  await assertUnlocked(eventId);
  const stage = await prisma.stage.findFirst({
    where: { id: stageId, eventId },
    // The basis as well as the format: whether a two-ball side may record
    // one score depends on whether the round is won on gross or on net.
    select: { format: true, scoringBasis: true },
  });
  if (!stage) return;
  const wanted = (input ?? "").trim();
  /**
   * "" always means "no opinion" and is always allowed; anything else must be
   * one of the shapes the format actually offers.
   *
   * Two axes share this column, because a round is either a match round or a
   * team round and never both: how a MATCH is written down (gross cards, hole
   * results, a bare result) and whose CARD a team round is on (each player's,
   * or the side's). Only one of them offers anything for a given format, so
   * asking both is the same guard rather than a looser one — and a foursomes
   * round cannot be handed "match-result", nor a singles match "side-only".
   */
  const value =
    wanted === "" ||
    inputChoices(stage.format).includes(wanted as MatchEntryMode) ||
    teamEntryChoices(stage.format, stage.scoringBasis).includes(wanted as TeamEntryMode)
      ? wanted
      : "";
  await prisma.stage.updateMany({ where: { id: stageId, eventId }, data: { scoreInput: value } });
  await refresh();
}

/**
 * HOW PLAYERS KEEP THIS ROUND'S MATCHES — tap who won each hole, or stroke
 * cards (Ajay, 2026-10-19). Read through `matchKeptBy`, the only reader.
 *
 * Match Play and Nassau are refused here: they carry this choice in "How scores
 * are recorded" (`setStageScoreInput`), and two controls for one choice is two
 * answers waiting to disagree.
 *
 * AND NOT ONCE A MATCH HAS A SCORE. A round kept half one way and half the
 * other is the fault this setting exists to prevent — a stroke card rebuilds
 * a match over holes somebody tapped — so a switch is refused, in words, while
 * any match in the round holds a hole or a card.
 */
export async function setStageMatchKeptBy(stageId: string, kept: string): Promise<{ ok: boolean; error?: string }> {
  const eventId = await requireStaffEvent();
  await assertUnlocked(eventId);
  const stage = await prisma.stage.findFirst({
    where: { id: String(stageId), eventId },
    select: { id: true, type: true, format: true, scoreInput: true, matchKeptBy: true },
  });
  if (!stage) return { ok: false, error: "Round not found." };
  const wanted = String(kept ?? "").trim();
  if (wanted !== "holes" && wanted !== "cards") return { ok: false, error: "Choose tapping or stroke cards." };
  const now = matchKeptBy(stage);
  if (now === null) return { ok: false, error: "This round has no matches to keep." };
  if (keptByScoreInput(stage.format)) {
    return { ok: false, error: `${stage.format} is set under How scores are recorded.` };
  }
  if (now !== wanted && (await roundHoldsAScore(stage.id))) {
    return {
      ok: false,
      error:
        "Some matches in this round already have scores, so they stay kept the way they were started. Change this before anyone scores.",
    };
  }
  await prisma.stage.updateMany({ where: { id: stage.id, eventId }, data: { matchKeptBy: wanted } });
  await refresh();
  return { ok: true };
}

/** Whether any match in this round holds a hole, a result or a card. */
async function roundHoldsAScore(stageId: string): Promise<boolean> {
  const [matches, teamCards, matchCards] = await Promise.all([
    prisma.match.findMany({ where: { stageId }, select: { holes: true } }),
    prisma.teamScorecard.count({ where: { stageId, matchId: { not: "" } } }),
    prisma.matchScorecard.count({ where: { match: { stageId } } }),
  ]);
  if (teamCards > 0 || matchCards > 0) return true;
  return matches.some((m) => {
    try {
      const holes = JSON.parse(m.holes || "[]") as unknown[];
      return Array.isArray(holes) && holes.some((h) => h !== null && h !== "");
    } catch {
      return false;
    }
  });
}

export async function setStageFormat(stageId: string, format: string, force = false) {
  const eventId = await requireStaffEvent();
  await assertUnlocked(eventId);
  /**
   * Changing a format re-scores every card in the round.
   *
   * The strokes are untouched; what they MEAN changes. The same eighteen
   * numbers read as Stableford points, as a medal total, or as holes won,
   * and switching between those silently rewrites the result of a round
   * somebody has already played.
   */
  // REFUSED, not read as Match Play. Anything this did not recognise became
  // match play — so a name that had drifted between two versions of the app
  // turned a medal into holes won, re-read every card in it, and said "ok".
  // Before the cards question, so a caller is never asked to confirm
  // re-scoring a round into a format that does not exist.
  if (!FORMAT_NAMES.includes(format)) return { ok: false as const, error: "That is not a format this round can be played in." };
  // And not one this KIND of round cannot be scored in — the list the screen
  // offers, from `formatChoicesFor` (2026-10-16). Asked before the cards
  // question for the same reason as the line above.
  const shape = await prisma.stage.findFirst({ where: { id: stageId, eventId }, select: { type: true, format: true } });
  if (shape && shape.format !== format && !formatFitsRound(shape.type, format)) {
    return { ok: false as const, error: roundShapeMismatch(shape.type, format)?.message ?? "That format cannot be played in this kind of round." };
  }
  if (!force) {
    const cards = await enteredCardCount(eventId, stageId);
    if (cards > 0) return { ok: false as const, needsConfirm: true as const, cards };
  }
  const value = format;
  // A round becoming Stableford becomes net with it — `basisFor`. Its current
  // basis is kept for every other format.
  const before = await prisma.stage.findFirst({
    where: { id: stageId, eventId },
    select: { scoringBasis: true, format: true, type: true, handicapAllowance: true, allowanceWeights: true },
  });
  const flightsBefore = await flightDefaultFor(eventId);
  await prisma.stage.updateMany({
    where: { id: stageId, eventId },
    data: {
      format: value,
      scoringBasis: basisFor(value, before?.scoringBasis),
      // A committee's figure is kept only where it still means the same thing
      // (`overridesAfterFormatChange`): a medal's 95 is not 95% of a foursomes
      // pair's combined handicaps.
      ...(before ? overridesAfterFormatChange(before, value) : {}),
    },
  });
  await followFlightDefault(eventId, flightsBefore);
  await refresh();
  return { ok: true as const };
}

/**
 * HOW MANY HOLES THIS ROUND IS, WHICH RE-SCORES IT AS SURELY AS THE FORMAT DOES.
 *
 * `setStageFormat` above refuses on a round with cards in and says why; this
 * sat directly underneath it and wrote straight through. Eighteen to nine is
 * not a smaller version of the same round:
 *
 *   - every to-par, net and countback is measured against a different
 *     denominator, and `holesOwed` decides whether a card reads "F";
 *   - `rankStrokeIndex` RE-RANKS the stroke index to the nine actually played,
 *     so the handicap shots land on different holes than the ones they were
 *     given on.
 *
 * Nothing is deleted either way, which is what makes it quiet: the strokes all
 * stay where they are and the results computed from them change underneath.
 * See `enteredCardCount`, whose own header calls that out and names this as
 * the kind of thing that must ask first.
 */
export async function setStageHoles(stageId: string, holes: number, force = false) {
  const eventId = await requireStaffEvent();
  await assertUnlocked(eventId);
  const value = holesPlayed(holes);
  if (!force) {
    const current = await prisma.stage.findFirst({
      where: { id: stageId, eventId },
      select: { holes: true },
    });
    // Only when it actually CHANGES. Re-saving the same number re-scores
    // nothing, and a confirmation on a no-op teaches an organizer to click
    // through the one that matters.
    if (current && holesPlayed(current.holes) !== value) {
      const cards = await enteredCardCount(eventId, stageId);
      if (cards > 0) return { ok: false as const, needsConfirm: true as const, cards };
    }
  }
  await prisma.stage.updateMany({
    where: { id: stageId, eventId },
    data: { holes: value },
  });
  await refresh();
  return { ok: true as const };
}

/* ── Per-round handicaps ──────────────────────────────────────────────────
   What one player plays off in ONE round. The rule is in
   lib/domain/round-handicap.ts and the freeze is in
   lib/services/round-handicap.ts; these are the two doors an organizer uses.

   Deliberately NOT behind assertUnlocked. Rounds are made weeks ahead and a
   wrong roster handicap should simply be fixable — including, and especially,
   once the tournament is live, which is when somebody notices. The freeze is
   the lock here: a round that has cards in it refuses, and CLAUDE.md rule 5
   says a second lock concept would just be a second reader of one rule. The
   round's ALLOWANCE stays governed by isSetupLocked, as a round setting. */

/**
 * Decide what a player plays off in one round. Null clears the decision, and
 * the round goes back to the roster handicap.
 */
export async function setRoundHandicapOverride(
  stageId: string,
  playerId: string,
  value: number | null,
): Promise<{ ok: boolean; error?: string }> {
  const eventId = await requireStaffEvent();
  // Both ids checked against this event, for the reason saveScorecard has the
  // same two lines: the (stageId, playerId) pair is caller-supplied and is
  // half of a unique key, so an unscoped write reaches another club's round.
  await assertEventStage(eventId, stageId);
  await assertEventPlayer(eventId, playerId);

  // The question is whether the round has been SCORED, not whether a row
  // happens to exist. Those agree for every round played since the freeze
  // existed, and differ for every round played before it: cards in, no frozen
  // row, and an override here would silently re-price them.
  //
  // Freezing on the way past is what makes that safe rather than merely
  // refused — a played round with no frozen value is still being resolved live,
  // so a roster edit would move it whatever this action does. It freezes at
  // what the board is using right now, so nothing on any screen changes.
  if (await roundHasReturnedCard(eventId, stageId)) {
    await freezeRoundHandicaps(eventId, stageId);
    return { ok: false, error: FROZEN_HANDICAP_REFUSAL };
  }
  const existing = await prisma.roundHandicap.findFirst({
    where: { eventId, stageId, playerId },
    select: { id: true, frozen: true },
  });
  // One reader for "may this change", shared with the screen that hides the
  // control — a hidden control stops nobody from calling this action.
  if (!acceptsHandicapChange(existing?.frozen != null)) {
    return { ok: false, error: FROZEN_HANDICAP_REFUSAL };
  }

  // A handicap is a whole number of strokes here, as it is everywhere else in
  // the app, and the type on this signature is erased at runtime. Plus
  // handicaps are real, so the floor is below zero; the ceiling is WHS's.
  const clean =
    value === null || !Number.isFinite(value)
      ? null
      : Math.min(54, Math.max(-10, Math.round(value)));

  await prisma.roundHandicap.upsert({
    where: { stageId_playerId: { stageId, playerId } },
    update: { override: clean },
    create: { eventId, stageId, playerId, override: clean },
  });
  await refresh();
  return { ok: true };
}

/**
 * Write this round's decision onto every later round as its own fact.
 *
 * "He plays off 12 all week" is a thing organizers say, and the requirement
 * says an override belongs to one round. Both are satisfied by copying rather
 * than inheriting: each round ends up holding its own number, which one of
 * them can then be changed without touching the others.
 *
 * Later rounds only — an earlier round has already been played or is being
 * played, and this is a decision about what is still to come. A frozen round
 * is skipped rather than refused: it is not a failure that the rounds already
 * scored keep what they were scored against.
 */
export async function applyRoundHandicapToRest(
  stageId: string,
  playerId: string,
): Promise<{ ok: boolean; written: number; skipped: number; skippedCards: number; skippedOther: number; error?: string }> {
  const eventId = await requireStaffEvent();
  await assertEventStage(eventId, stageId);
  await assertEventPlayer(eventId, playerId);

  const [from, stages] = await Promise.all([
    prisma.roundHandicap.findFirst({
      where: { eventId, stageId, playerId },
      select: { override: true },
    }),
    prisma.stage.findMany({ where: { eventId }, orderBy: { position: "asc" } }),
  ]);
  if (from?.override == null) {
    return { ok: false, written: 0, skipped: 0, skippedCards: 0, skippedOther: 0, error: "Set this round's handicap first." };
  }

  const here = stages.findIndex((s) => s.id === stageId);
  if (here < 0) return { ok: false, written: 0, skipped: 0, skippedCards: 0, skippedOther: 0, error: "That round isn't in this tournament." };
  // Rounds the field actually plays. A cut or a bracket seeding round is not
  // somewhere a handicap gets used.
  const later = playingStages(stages.slice(here + 1));
  if (later.length === 0) return { ok: true, written: 0, skipped: 0, skippedCards: 0, skippedOther: 0 };

  const frozenRows = await prisma.roundHandicap.findMany({
    where: { eventId, playerId, stageId: { in: later.map((s) => s.id) }, frozen: { not: null } },
    select: { stageId: true },
  });
  const frozen = new Set(frozenRows.map((r) => r.stageId));
  // And any round already scored, frozen row or not — same reason as above,
  // and it freezes those rather than leaving them live.
  for (const s of later) {
    if (frozen.has(s.id)) continue;
    if (await roundHasReturnedCard(eventId, s.id)) {
      await freezeRoundHandicaps(eventId, s.id);
      frozen.add(s.id);
    }
  }
  /**
   * ONLY WHERE THE SAME STROKES MEAN THE SAME THING (2026-10-16; the golf
   * professional on the review panel). The figure is a COURSE handicap: whole
   * strokes for one course, set of tees and length of round (Rules of
   * Handicapping 6.1). Copied onto a round at another course, on other tees or
   * of nine holes, it is simply the wrong number there. Those rounds are left,
   * and counted with the ones that have cards in; changing the player's INDEX
   * is how one decision reaches every round.
   */
  const source = stages[here];
  const sameCard = (s: (typeof stages)[number]) =>
    s.courseId === source.courseId && s.teeId === source.teeId && s.holes === source.holes;
  const open = later.filter((s) => !frozen.has(s.id) && sameCard(s));

  for (const s of open) {
    await prisma.roundHandicap.upsert({
      where: { stageId_playerId: { stageId: s.id, playerId } },
      update: { override: from.override },
      create: { eventId, stageId: s.id, playerId, override: from.override },
    });
  }
  await refresh();
  // Each reason counted apart, so the screen can say the true one (`laterRoundsSaid`).
  const skippedCards = later.filter((s) => frozen.has(s.id)).length;
  const skippedOther = later.filter((s) => !frozen.has(s.id) && !sameCard(s)).length;
  return { ok: true, written: open.length, skipped: later.length - open.length, skippedCards, skippedOther };
}

/* ── Tiebreakers & qualification ──────────────────────────────────────── */

export async function saveTiebreakers(order: string[]) {
  const eventId = await requireStaffEvent();
  await assertUnlocked(eventId);
  // isTiebreakerKey rather than a membership test against a fixed list: the
  // countbacks are `toughest-N` for any N a committee names, and it bounds N
  // to the holes on a card. De-duplicated because the same tiebreaker twice
  // is a chain whose second copy can never decide anything.
  const valid = [...new Set(order.filter(isTiebreakerKey))];
  // A chain with nothing recognisable in it is a broken request, and is not
  // the same thing as a committee choosing none — which arrives as an empty
  // list and is kept as one. This used to store every tie-breaker there is in
  // place of none, so unticking the last box ticked all eight.
  if (order.length > 0 && valid.length === 0) throw new Error("Unknown tie-breaker.");
  await prisma.event.update({
    where: { id: eventId },
    data: { tiebreakers: JSON.stringify(valid) },
  });
  await refresh();
}

export async function setQualifyMode(mode: string, overall: number) {
  const eventId = await requireStaffEvent();
  await assertUnlocked(eventId);
  await prisma.event.update({
    where: { id: eventId },
    data: {
      qualifyMode: mode === "overall" ? "overall" : "perFlight",
      qualifyOverall: Math.max(1, Math.round(overall)),
    },
  });
  await refresh();
}

/* Stage types live in src/lib/stage-types.ts, shared with the picker. Two
   lists describing the same thing drift: a type offered in the UI but absent
   from the validator here silently becomes a Round Robin on save. */

/** Returns the new stage's id so callers can act on it immediately (e.g. set a cut line before the page revalidates). */
/**
 * The most weeks one click may create.
 *
 * A season, generously. High enough that no real league is refused, low enough
 * that a mistyped number cannot fill a tournament with hundreds of rounds
 * somebody then has to delete one at a time.
 */
/**
 * Add one round, or a run of them.
 *
 * `count` exists because a weekly league is not built one round at a time. A
 * ten-week season meant ten clicks and then ten format changes, each of which
 * is a chance to set one week differently from the rest by accident.
 *
 * Every round is created identically. Changing any one of them afterwards is
 * the ordinary per-round edit, which is the point: same format by default,
 * overridable individually.
 */
export interface AddStageOptions {
  count?: number;
  /** Applies to every round created. Ignored if the app cannot run it. */
  format?: string;
  holes?: number;
  /** ISO date for the first round; the rest follow at `intervalDays`. */
  startDate?: string;
  intervalDays?: number;
}

export async function addStage(
  type: string,
  countOrOpts: number | AddStageOptions = 1,
): Promise<{ id?: string; error?: string }> {
  const eventId = await requireStaffEvent();
  // Not behind the lock: a live league adds next week's round as it goes, and
  // a championship adds a play-off round when the field finishes level. Adding
  // is additive — the rounds already played are untouched (2026-09-27).
  // Deleting a round (`removeStage`) and changing one's format stay locked.
  // Refused, not read as a round robin: an unknown kind of round used to add a
  // full set of pairings for whatever the caller had actually meant.
  if (!isStageType(type)) return { error: "That is not a kind of round." };
  const stageType = type;
  const opts: AddStageOptions =
    typeof countOrOpts === "number" ? { count: countOrOpts } : countOrOpts;
  // Clamped, not trusted: this is a public server action and the numbers come
  // off a form.
  const howMany = Math.min(MAX_ROUNDS_AT_ONCE, Math.max(1, Math.round(Number(opts.count) || 1)));
  const agg = await prisma.stage.aggregate({ where: { eventId }, _max: { position: true } });
  const position = (agg._max.position ?? -1) + 1;
  const flightsBefore = await flightDefaultFor(eventId);
  /**
   * WHAT THE LAST ROUND PLAYED, which is what a club does.
   *
   * This asked the EVENT's "how do people play" setting — a question
   * Tournament details no longer puts, because it was one of the two that made
   * that screen read as though it decided the format when every round decides
   * its own. A club adding week 8 of a Stableford league wants Stableford, and
   * the tournament-level answer could not say that: it held "individual", from
   * which the most ordinary format was inferred.
   *
   * So the seed is the previous round's format. A league repeats itself, a
   * championship repeats itself, and the one case where it is wrong — a
   * deliberately mixed tournament — is the case where the organizer is already
   * choosing per round, which both add-a-round screens require them to do.
   */
  const ev = await prisma.event.findUnique({
    where: { id: eventId },
    select: { format: true, shape: true },
  });
  // A CASUAL ROUND IS ONE ROUND (Ajay, 2026-09-08). Its creator — any member —
  // is its organizer, so this endpoint accepted them, and a round that never
  // counts as a tournament could be grown into one (2026-09-30).
  if (isMatch(ev?.shape)) {
    return { error: `A casual round is one round. For more than one, set up a tournament — it's free on ${PLANS.free.name}.` };
  }
  const previous = await prisma.stage.findFirst({
    where: { eventId },
    orderBy: { position: "desc" },
    select: { format: true, type: true, scoringBasis: true },
  });
  const scoring = ev?.format === "stroke" ? "stroke" : "match";
  const common = {
      eventId,
      type: stageType,
      description: STAGE_DESCRIPTIONS[stageType] ?? "",
      deadline: "",
      /**
       * A BACKSTOP, not a choice. Both screens that add a round now require a
       * format, so in practice `opts.format` below always wins; this is what a
       * programmatic caller gets, and it must not be nonsense.
       *
       * The schema's default is Match Play, which is a contradiction on a
       * round with no opponents: "Add stroke play round" produced "Round 1 ·
       * Stroke Play Round — Match Play", and score entry opened it in match
       * mode with nothing to enter.
       *
       * That was fixed once, against `generatesPairings`, and the fix did not
       * hold — because that asks whether the SCHEDULER draws the fixtures,
       * which is a different question. A medal round draws none and needs no
       * opponent; a BRACKET also draws none and is nothing but opponents. So
       * an ordinary individual event still produced the same contradiction
       * (`defaultFormatFor("individual", "match")` is Match Play), and it was
       * still there on 2026-09-09, read off the screen after adding one.
       *
       * `isHeadToHead` is the question that was meant, declared per type in
       * stage-types.ts. A round with opponents keeps the scoring the event
       * chose; one without repeats the last round, or opens on the most
       * ordinary individual format when this is the first.
       */
      format: isHeadToHead(stageType)
        ? scoring === "stroke"
          ? "Stroke Play"
          : "Match Play"
        : previous?.format && isPlayable(previous.format)
          ? previous.format
          : defaultFormatFor("individual", "stroke"),
  };
  /**
   * AND NEVER A PAIR THAT CANNOT BE SCORED (2026-10-16). The backstop above
   * repeats the last round, and the last round of a match-play qualifier is
   * Match Play — which a stroke round after it cannot be played in. Where the
   * seed does not fit this type, the type's own format, as a club plays it.
   */
  if (!formatFitsRound(stageType, common.format)) common.format = naturalFormatFor(stageType);

  // A format chosen in the create step applies to every round in the run —
  // that is the point of choosing it there rather than on N cards afterwards.
  // Only honoured when the app can actually run it, so a stale or hand-crafted
  // value cannot create rounds with nowhere to enter a card.
  if (opts.format && isPlayable(opts.format)) {
    // REFUSED, in words, where the type cannot be played in it — the same list
    // the screen offers (`formatChoicesFor`). It used to create the round and
    // let its card say "This round cannot be scored as set" afterwards.
    if (!formatFitsRound(stageType, opts.format)) {
      return { error: roundShapeMismatch(stageType, opts.format)?.message ?? "That format cannot be played in this kind of round." };
    }
    common.format = opts.format;
  }
  // Off handicap unless the organizer says scratch — `newRoundBasis`. A
  // Stableford round is net either way.
  /**
   * …AND A ROUND AFTER THAT REPEATS THE LAST ONE'S, as the format does (the
   * golf professional and the tournament director on the review panel, both
   * ranking it first): Round 2 of a scratch 36-hole championship was created
   * NET, because only the first round should start from the club default. A
   * championship is gross every day; a medal series is net every week.
   */
  const scoringBasis = previous ? basisFor(common.format, previous.scoringBasis) : newRoundBasis(common.format);
  const holes = Number(opts.holes);
  if (holes === 9 || holes === 18) (common as { holes?: number }).holes = holes;

  // Dates for the run. An unparseable start date yields no dates rather than a
  // wrong one — see cleanIsoDate.
  const start = cleanIsoDate(opts.startDate);
  const dates = start
    ? roundDates(start, howMany, Number(opts.intervalDays) || 0)
    : [];
  // RETURNED, before a single round is created — not thrown, because Next
  // strips a thrown server-action message in production and the organizer would
  // read "an error occurred" instead of why.
  const windowRefusal = await parRoundWindowRefusal(eventId, dates);
  if (windowRefusal) return { error: windowRefusal };

  // Created one at a time rather than with createMany so the first round's id
  // can be returned — the screen scrolls to and opens the round it just made,
  // and losing that would make adding a round feel like nothing happened.
  let firstId: string | undefined;
  for (let i = 0; i < howMany; i += 1) {
    const created = await prisma.stage.create({
      data: { ...common, scoringBasis, position: position + i, playedOn: dates[i] ?? "" },
    });
    if (i === 0) firstId = created.id;
  }
  // A medal's field divides by handicap unless somebody has chosen otherwise.
  await followFlightDefault(eventId, flightsBefore);

  /**
   * THE FIRST ROUND SETS HOW THE TOURNAMENT IS DECIDED, when it has no
   * opponents — the rule `createEvent` applies to a template's rounds, here for
   * "start from scratch", which creates none.
   *
   * Walked 2026-09-30 as a new society: create "Autumn Medal" as a single
   * round, add its one stroke play round, and the very next screen read "These
   * rounds cannot be scored as set … Set Scoring to Stroke play on Tournament
   * details" — the column default, Match play, which nobody chose, contradicted
   * by the only round anybody did. The app made the mistake and told the
   * secretary to fix it.
   *
   * Only for a round with no opponents: that one cannot be ranked any other
   * way, so stroke is the only answer and overriding is safe. A head-to-head
   * first round leaves the event alone — match play or a stroke round robin
   * are both real choices, and nothing here can tell which was meant.
   */
  if (!previous && !isHeadToHead(stageType) && ev?.format !== "stroke") {
    await prisma.event.update({ where: { id: eventId }, data: { format: "stroke" } });
  }

  /**
   * A KNOCKOUT AFTER STROKE QUALIFYING TAKES THE TOP N OVERALL (2026-10-16).
   *
   * The event's qualification starts at "top 2 per flight", which is right for
   * a knockout after round-robin groups and is a FINAL after a medal: walked as
   * a new organizer, a stroke round then a bracket drew two players from a field
   * in one flight. A club qualifying on strokes takes the top 8 or 16 overall.
   * Set when the knockout is added after a round with no opponents — the moment
   * the question first means anything — and the organizer can change it there.
   */
  /**
   * ONLY FOR THE FIRST KNOCKOUT, AND ONLY WHERE THE FIELD IS NOT IN FLIGHTS (the
   * golf professional and the tournament director on the review panel): this
   * wrote "overall" every time a knockout followed a medal, overwriting a
   * per-flight choice the organizer had made and merging a flighted
   * championship — Championship, First and Second flights each qualifying their
   * own — into one draw.
   */
  if (isKnockoutRound(stageType) && previous && !isHeadToHead(previous.type)) {
    const [knockoutsBefore, flights] = await Promise.all([
      prisma.stage.count({ where: { eventId, type: { in: [...KNOCKOUT_STAGE_TYPES] }, position: { lt: position } } }),
      // Flights, not team carriers (`flights-are-not-carriers.test.ts`).
      prisma.group.count({ where: { eventId, isCarrier: false } }),
    ]);
    if (knockoutsBefore === 0 && flights <= 1) {
      await prisma.event.update({ where: { id: eventId }, data: { qualifyMode: "overall" } });
    }
  }

  // A new round of a code-using tournament needs a code, or it is a round
  // nobody without an account can enter. No-op when codes are off.
  await ensureRoundCodes(eventId);

  await refresh();
  return { id: firstId };
}

export async function removeStage(stageId: string, force = false) {
  const eventId = await requireStaffEvent();
  await assertUnlocked(eventId);

  /**
   * Deleting a round deletes everything played in it.
   *
   * Matches, cards, and — through the cascade — the round's skins pot with
   * every stake already collected. Behind one bare trash icon, with no prompt
   * and no audit line, while changing that same round's FORMAT sixty lines
   * above refuses when cards exist. The dangerous door was the unguarded one.
   *
   * `SkinsEntry.confirmed` means somebody has handed over cash. CLAUDE.md rule
   * 7 says this app records money rather than moving it, which makes the record
   * the only thing there is — losing it silently is losing the money.
   */
  if (!force) {
    const [cards, stakes] = await Promise.all([
      enteredCardCount(eventId, stageId),
      prisma.skinsEntry.count({ where: { pot: { stageId }, confirmed: true } }),
    ]);
    if (cards > 0 || stakes > 0) {
      return { ok: false as const, needsConfirm: true as const, cards, stakes };
    }
  }

  const flightsBefore = await flightDefaultFor(eventId);
  await prisma.stage.deleteMany({ where: { id: stageId, eventId } });
  await followFlightDefault(eventId, flightsBefore);
  await refresh();
  return { ok: true as const };
}

/* ── Match score entry ────────────────────────────────────────────────── */


export async function saveMatchHoles(matchId: string, holes: HoleResult[]) {
  const { eventId, session, settings } = await requireScoreEntry();
  await assertOwnMatch(session, eventId, matchId);
  // A card of THIS round's length, as the round-code screen's path cleans it
  // (`actions/play.ts`). This stored the list as it came and called it complete
  // by `resolveMatch(list).complete`: an empty list was a finished match, and
  // ["A"] an eighteen-hole match won 1 up
  // (`a-match-result-is-a-card-of-its-length.audit.test.ts`).
  const owner = await prisma.match.findFirst({ where: { id: matchId, eventId }, select: { stageId: true, stage: { select: { holes: true } } } });
  if (!owner) throw new Error("Match not found.");
  // Not on a round kept on stroke cards: the next card would rebuild over it.
  const keptOnCards = await keptByRefusal(owner.stageId, "holes");
  if (keptOnCards) throw new Error(keptOnCards);
  const clean = cleanHoleResults(holes, holesPlayed(owner.stage?.holes));
  if (!clean) throw new Error("Each hole is won by one side or halved. Check the card and save again.");
  const complete = matchIsOver(clean);
  // Where the organizer wants finished cards only, a player can't dribble
  // holes onto the leaderboard as they play. Staff are never restricted this
  // way — they enter scores as groups come in.
  if (!complete && !mayReportPartialCard(settings, session.role)) {
    throw new Error("Enter the full round, then submit it.");
  }
  // Any score edit resets confirmation to pending — including an organizer's,
  // so a correction always goes back through approval.
  await prisma.match.updateMany({
    where: { id: matchId, eventId },
    data: {
      holes: JSON.stringify(clean),
      // A real result supersedes a forfeit. Without this, an organizer who
      // forfeited against the wrong name and then entered the true card would
      // see the card on screen and the forfeit in the standings — the entered
      // result silently discarded. Not in a cup — see `keepsConcession`.
      ...(await clearsConcession(matchId)),
      scoreStatus: "pending",
      scoredAt: complete ? new Date() : null,
      confirmedById: null,
    },
  });
  await refresh();
}

/** Existing hole count for a match, from its stored holes array (18 or 9 depending on the round). */
function matchHoleCount(holesJson: string): number {
  try {
    const parsed = JSON.parse(holesJson) as unknown[];
    return Array.isArray(parsed) && parsed.length > 0 ? parsed.length : 18;
  } catch {
    return 18;
  }
}

export async function applyMatchResult(
  matchId: string,
  winner: "A" | "B" | "H",
  margin: string,
) {
  const { eventId, session } = await requireScoreEntry();
  await assertOwnMatch(session, eventId, matchId);
  const match = await prisma.match.findUnique({ where: { id: matchId } });
  if (!match || match.eventId !== eventId) return;
  // A player on a round kept on stroke cards enters strokes, not a result.
  // Staff may still record one — a walkover, a committee's decision.
  if (session.role !== "admin" && session.role !== "assistant") {
    const keptOnCards = await keptByRefusal(match.stageId, "holes");
    if (keptOnCards) throw new Error(keptOnCards);
  }
  // A "use server" export is called with whatever the caller likes: a winner
  // that is none of the three was read as B.
  if (winner !== "A" && winner !== "B" && winner !== "H") throw new Error("Pick a winner, or halved.");
  // A winner needs a margin, and one a match can finish on — the one rule every
  // door asks (`marginRefusal`). "2&3" typed as-is reconstructs a card the
  // standings read as still in progress, forever; a blank one was stored as a
  // halved match.
  const total = matchHoleCount(match.holes);
  margin = String(margin ?? "");
  const refusal = marginRefusal(winner, margin, total);
  if (refusal) throw new Error(refusal);
  const holes = marginToHoles(winner, margin, total);
  await prisma.match.update({
    where: { id: matchId },
    data: { holes: JSON.stringify(holes), ...(await clearsConcession(matchId)), scoreStatus: "pending", scoredAt: new Date(), confirmedById: null, confirmedBy: "", enteredBy: session.name, enteredById: await authorPlayerId(eventId, session), attestedBy: "[]" },
  });
  await refresh();
}

/**
 * A SIGNED-IN PLAYER KEEPING THEIR OWN MATCH, from the player app (2026-10-18).
 *
 * The card is `MatchKeeper`, the one the round-code page draws, and it expects
 * a save that RETURNS its refusal in words. `saveMatchHoles` and
 * `applyMatchResult` throw instead, and a thrown message does not survive to
 * the browser in a production build, so a player would read "Couldn't save."
 * over a refusal that had a reason. These two say it — after asking the same
 * two questions themselves: the tournament lets players score, and the match
 * is the caller's own, on either side of it, in an announced lineup.
 */
export async function keepMyMatchHoles(matchId: string, holes: HoleResult[]): Promise<{ ok: boolean; error?: string }> {
  const { eventId, session } = await requireScoreEntry();
  await assertOwnMatch(session, eventId, String(matchId));
  try {
    await saveMatchHoles(String(matchId), holes);
    return { ok: true };
  } catch (err) {
    unstable_rethrow(err);
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't save." };
  }
}

export async function keepMyMatchResult(matchId: string, winner: "A" | "B" | "H", margin: string): Promise<{ ok: boolean; error?: string }> {
  const { eventId, session } = await requireScoreEntry();
  await assertOwnMatch(session, eventId, String(matchId));
  try {
    await applyMatchResult(String(matchId), winner, String(margin ?? ""));
    return { ok: true };
  } catch (err) {
    unstable_rethrow(err);
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't save." };
  }
}

/**
 * A SIGNED-IN PLAYER'S OWN STROKE CARD for a match on a round kept on cards
 * (`matchKeptBy`, 2026-10-19) — the `MatchStrokeKeeper` card on `/me/match`.
 *
 * The ball is the caller's, worked out here and never taken from the caller:
 * their slot in a singles match, their own card in a four-ball, or their side's
 * one card where the side plays one ball. Then the console's own savers
 * (`saveMatchScorecard`, `saveTeamScorecard`), which refuse a round kept by
 * tapping and store the match through `services/match-from-cards.ts`. Answered
 * in words, like the two above.
 */
export async function keepMyMatchCard(matchId: string, strokes: (number | null)[]): Promise<{ ok: boolean; error?: string }> {
  const { eventId, session } = await requireScoreEntry();
  await assertOwnMatch(session, eventId, String(matchId));
  const match = await prisma.match.findFirst({ where: { id: String(matchId), eventId } });
  if (!match) return { ok: false, error: "Match not found." };
  const mine = await myPlayerIds(eventId, session.email);
  try {
    const sideMatch = match.teamAId !== "" && match.teamBId !== "" && match.playerAId === "" && match.playerBId === "";
    if (!sideMatch) {
      const slot = mine.has(match.playerAId) ? "A" : mine.has(match.playerBId) ? "B" : null;
      if (!slot) return { ok: false, error: "You can only enter your own card." };
      await saveMatchScorecard(match.id, slot, strokes);
      return { ok: true };
    }
    const member = await prisma.teamMember.findFirst({
      where: { playerId: { in: [...mine] }, teamId: { in: [match.teamAId, match.teamBId] } },
      select: { teamId: true, playerId: true },
    });
    if (!member) return { ok: false, error: "You can only enter your own card." };
    const stage = await prisma.stage.findUnique({
      where: { id: match.stageId },
      select: { format: true, scoreInput: true, scoringBasis: true },
    });
    const oneBall = !!stage && oneCardPerSide(stage.format, stage.scoreInput, stage.scoringBasis);
    return await saveTeamScorecard(member.teamId, oneBall ? "" : member.playerId, match.id, strokes);
  } catch (err) {
    unstable_rethrow(err);
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't save." };
  }
}

/**
 * Record a match as forfeited, or take a forfeit back.
 *
 * Covers the three ways a match ends without being played out: a player
 * concedes it (Rule 3.2b(1)), a player does not appear, or a player withdraws.
 * None of these could be recorded at all — the organizer's only options were to
 * invent a scoreline, which then decided the flight on fictional holes, or to
 * leave the match Live forever, which kept it out of the standings entirely.
 *
 * Pass an empty `forfeitedBy` to undo. The holes are left exactly as they were
 * in both directions: a player who walked in after nine holes has those nine
 * on the card, and if the organizer entered the forfeit against the wrong name
 * the correction restores the real position rather than a blank.
 *
 * Staff only. A player conceding a match tells the organizer, who records it —
 * the same rule the rest of the app follows for anything that decides a
 * result, and the reason there is no self-service path here.
 */
export async function forfeitMatch(matchId: string, forfeitedBy: string) {
  /**
   * Admin only, and audited — because UNDOING a forfeit is a reopen.
   *
   * The first cut of this took staff and wrote `scoreStatus: "pending"`,
   * `confirmedById: null` and `confirmedBy: ""` on BOTH paths. That made
   * `forfeitMatch(id, "")` an unaudited assistant-accessible `reopenMatch`:
   * it stripped a player's sign-off from a confirmed match and left no trace
   * of who did it. `reopenMatch` is deliberately admin-only and logged, with
   * the note that "an assistant reversing that quietly would hollow the
   * guarantee out" — and this handed the same power to a lower role through a
   * different door.
   */
  const eventId = await requireAdminEvent();
  const session = await getSession();
  const match = await prisma.match.findUnique({ where: { id: matchId } });
  if (!match || match.eventId !== eventId) return { ok: false, error: "That match isn't in this tournament." };

  // Only one of the two sides can forfeit, and only a side actually in this
  // match. An unchecked id here would decide a match in favour of somebody who
  // never played in it. Checked on the undo path too: an empty string is the
  // only value that may name nobody.
  const sides = [match.playerAId, match.playerBId, match.teamAId, match.teamBId].filter(Boolean);
  if (forfeitedBy && !sides.includes(forfeitedBy)) {
    return { ok: false, error: "That player isn't in this match." };
  }

  /**
   * A team cannot forfeit yet, and this says so rather than pretending.
   *
   * The column accepted a team id and stored it perfectly, and nothing ever
   * read it: standings aggregate over playerAId/playerBId, which a team round
   * leaves empty, and there is no team match-play aggregation to teach. So an
   * organizer recorded a concession, saw it accepted, and got a result that
   * counted for nothing — the worst of the three possible behaviours, because
   * it is the one they will not check.
   *
   * Refusing is the honest half of the fix until team standings exist to
   * honour it. The undo path stays open: an empty string still clears a team
   * forfeit stored before this, so nobody is stuck with one.
   */
  /*
   * EXCEPT IN A TEAM CUP (2026-10-06), where team results ARE aggregated: the
   * cup board reads `forfeitedBy` against the team columns and gives the point
   * to the other side. There the concession is the organizer's call by
   * decision — the captain tells the committee — so a pairs match conceded at
   * the 12th is recorded here, and the players' cards stay as they were.
   */
  const isTeamSide = forfeitedBy === match.teamAId || forfeitedBy === match.teamBId;
  const cupMatch = keepsConcession(
    (await prisma.stage.findUnique({ where: { id: match.stageId }, select: { type: true } }))?.type ?? "",
  );
  if (forfeitedBy && isTeamSide && !cupMatch) {
    return {
      ok: false,
      error:
        "A team can't be recorded as forfeiting yet — team results aren't aggregated, so it wouldn't count for anything. Enter the concession as a match result instead.",
    };
  }
  if (forfeitedBy && match.forfeitedBy === forfeitedBy) return { ok: true };

  await prisma.match.update({
    where: { id: matchId },
    data: {
      forfeitedBy,
      // Recording a forfeit settles the match, so it is scored and dated like
      // any other result. UNDOING one restores the card's own state rather
      // than wiping it: the confirmation columns are left exactly as they
      // were, because a forfeit entered against the wrong name and corrected a
      // minute later must not cost a player the sign-off they gave.
      ...(forfeitedBy
        ? { scoreStatus: "pending", scoredAt: new Date(), confirmedById: null, confirmedBy: "", enteredBy: session?.name ?? "" }
        : {}),
    },
  });
  await logAudit(
    eventId,
    forfeitedBy ? "match.forfeit" : "match.forfeit.undo",
    forfeitedBy ? `Forfeited by ${forfeitedBy}` : `Forfeit removed (was ${match.forfeitedBy || "none"})`,
    { matchId },
  );
  await refresh();
  return { ok: true };
}

/**
 * Blank a match back to no result.
 *
 * A CONFIRMED result has to be reopened first, by someone who may reopen it.
 * This wrote the confirmation columns with no check that there was a
 * confirmation to write over, which made it the quiet way around `reopenMatch`
 * — organizer-only and logged precisely because undoing a sign-off is the one
 * thing an assistant reversing quietly would hollow out. Clearing does
 * strictly more than reopening: a player who lost 5&2 could erase the result
 * AND their opponent's sign-off together, leaving nothing on any screen to say
 * the match had ever been played. Same door, one step further in, no lock.
 *
 * The status is the EFFECTIVE one. A match left pending for a day in a
 * player-approval event is auto-confirmed — the column still reads "pending",
 * and reading the column is how the guard would have been true and useless.
 */
export async function clearMatch(matchId: string): Promise<{ ok: boolean; error?: string }> {
  const { eventId, session, settings } = await requireScoreEntry();
  await assertOwnMatch(session, eventId, matchId);
  const match = await prisma.match.findUnique({ where: { id: matchId } });
  if (!match || match.eventId !== eventId) return { ok: false, error: "That match isn't in this tournament." };

  const status = effectiveScoreStatus(match, allowsAutoConfirm(settings));
  if (status === "confirmed" || status === "auto-confirmed") {
    return {
      ok: false,
      error: "That result has been confirmed. An organizer has to reopen it before it can be cleared.",
    };
  }

  const empty = new Array(matchHoleCount(match.holes)).fill(null);
  await prisma.match.updateMany({
    where: { id: matchId, eventId },
    // Clearing a match clears the forfeit too: "no result" has to mean no
    // result, or a cleared match would keep paying out a win nobody can see.
    data: { holes: JSON.stringify(empty), forfeitedBy: "", scoreStatus: "pending", scoredAt: null, confirmedById: null },
  });
  // Erasing a card is not a smaller act than entering one, and every other
  // path that ends a result — forfeit, reopen, confirm, dispute — has left a
  // row since it was written.
  await logAudit(eventId, "match.clear", "Score cleared", { matchId });
  await refresh();
  return { ok: true };
}

/* ── Stroke play ──────────────────────────────────────────────────────── */

/**
 * Save the organizer's own hole-by-hole course data when the event's course
 * doesn't match a built-in preset — prompted from Score entry so scoring
 * math (par, net, stroke index) never silently runs against fake data.
 */
export async function saveCustomCourse(
  courseName: string,
  city: string,
  pars: number[],
  yards: number[],
  strokeIndex: number[],
): Promise<{ ok: boolean; error?: string }> {
  // Deliberately no assertUnlocked: this supplies missing reference data
  // (par/yardage/stroke index) for scoring math, not a structural change to
  // the field/schedule — and the gap is most likely to surface exactly when
  // the event is already live and staff are trying to enter scores.
  const eventId = await requireStaffEvent();

  /**
   * The same standard as every other way a card gets in.
   *
   * This wrote whatever it was handed straight onto the Event — no par range,
   * no stroke index check, nothing. It is a `"use server"` export, so it is a
   * public HTTP endpoint, and the card it stores is what every round of the
   * tournament is then scored against.
   */
  const refusal = cardRefusal(pars, yards, strokeIndex, 18);
  if (refusal) return { ok: false as const, error: refusal };
  await prisma.event.update({
    where: { id: eventId },
    data: {
      course: courseName,
      city,
      customPars: JSON.stringify(pars),
      customYards: JSON.stringify(yards),
      customStrokeIndex: JSON.stringify(strokeIndex),
    },
  });
  await refresh();
  return { ok: true };
}

/**
 * The answer a save gives back, so a queued card cannot silently win.
 *
 * Declared with the write itself now — see `services/scorecard-write.ts`.
 * Re-exported here because this module is where every caller imports it from,
 * and moving a type is not a reason to touch nine screens.
 *
 * A card is written WHOLE. Since scoring works offline, a card can be minutes
 * old when it arrives — and replaying it replaces everything the server holds,
 * including a correction an organizer made in between. So a caller may say
 * which revision it was working from, and a save that would land on top of
 * somebody else's comes back as a CONFLICT carrying both sides. Choosing
 * between them is a person's job.
 */
export type { SaveCardResult };

export async function saveScorecard(
  stageId: string,
  playerId: string,
  strokes: (number | null)[],
  /**
   * The revision this caller last read. Omitted means an unconditional
   * write — every caller that has the card in front of it right now, which
   * is the console's own entry screen.
   */
  expectedRevision?: string,
): Promise<SaveCardResult> {
  const { eventId, session, settings } = await requireScoreEntryForStage(stageId);
  // Both ids, not just the player's. The upsert below is keyed on
  // (stageId, playerId) — the `eventId` in its `create` branch decorates a new
  // row and constrains nothing — so an unscoped pair let a staff member of any
  // tournament overwrite another club's card outright. assertOwnCard doesn't
  // catch it: it returns immediately for staff, and for a player it only
  // checks the playerId, leaving the round free to point anywhere.
  await assertEventStage(eventId, stageId);
  await assertEventPlayer(eventId, playerId);
  await assertMayKeepCard(session, eventId, stageId, playerId);

  /**
   * The write itself, in `services/scorecard-write.ts`.
   *
   * The guards above answer "may this person write here"; everything that
   * follows answers "is this a scorecard, and what does saving it mean" —
   * validation, the partial-card rule, the revision conflict, whether a save
   * retracts a certification, and freezing the round's handicaps.
   *
   * Lifted out unchanged so the Round Code surface can write a card through
   * the same rules rather than a second copy of them. The authorization
   * deliberately did NOT go with it: this action asks `requireScoreEntry`
   * and three scoping asserts, and the play surface asks something else.
   */
  /**
   * A COMMITTEE CORRECTION GOES ON THE RECORD, hole by hole (2026-10-08).
   *
   * Staff only, and only on a card that has been approved before or sits in a
   * round the committee has closed — the cards whose figures were already a
   * result. A secretary typing the day's cards in is not correcting anything,
   * and forty lines saying so would bury the one that matters. `approvedAt`
   * survives a reopen on purpose (see `reopenScorecard`), which is what lets
   * this tell a correction from a first entry. See `holesChanged`.
   */
  const correcting =
    session.role !== "player"
      ? await Promise.all([
          prisma.scorecard.findFirst({
            where: { eventId, stageId, playerId },
            select: { strokes: true, approvedAt: true },
          }),
          prisma.stage.findFirst({ where: { id: stageId, eventId }, select: { closedAt: true, nine: true } }),
        ])
      : null;
  const result = await writeScorecard({
    eventId,
    stageId,
    playerId,
    strokes,
    settings,
    role: session.role,
    expectedRevision,
  });
  if (result.ok && correcting) {
    const [before, stage] = correcting;
    if (before && (before.approvedAt || stage?.closedAt)) {
      let was: (number | null)[] = [];
      try {
        was = JSON.parse(before.strokes) as (number | null)[];
      } catch {
        was = [];
      }
      const changed = holesChanged(was, strokes, stage?.nine === "back" ? 10 : 1);
      if (changed) {
        await logAudit(
          eventId,
          "card.correct",
          `${playerId}'s ${await roundWordsFor(eventId, stageId)} card corrected — ${changed}`,
        );
      }
    }
  }
  // The cache belongs to the caller: this action serves the console, and the
  // play surface revalidates something else entirely.
  if (result.ok) await refresh();
  return result;
}

/** The most cards one batch may carry — a casual round is eight at most. */
const MAX_CARDS_IN_ONE_SAVE = 24;

/**
 * SEVERAL OF ONE ROUND'S CARDS IN ONE REQUEST (2026-10-07).
 *
 * A casual card saves every card the phone changed. It did that with one
 * `saveScorecard` per card, one after another — and when the scorer left the
 * screen just after a hole, the save sent on the way out reached the server
 * for the first card and was ABORTED for the second (`net::ERR_ABORTED`,
 * measured in the browser): the last hole of the second player was lost.
 * One request carries them all, so there is no second request to lose.
 *
 * Each card still goes through `saveScorecard`, guards and all — this adds a
 * door, not a way round one.
 */
export async function saveScorecards(
  stageId: string,
  cards: Array<{ playerId: string; strokes: (number | null)[] }>,
): Promise<Array<{ playerId: string; ok: boolean; error?: string }>> {
  const { eventId } = await requireScoreEntryForStage(stageId);
  await assertEventStage(eventId, stageId);
  if (!Array.isArray(cards) || cards.length > MAX_CARDS_IN_ONE_SAVE) {
    return [{ playerId: "", ok: false, error: "Too many cards in one save." }];
  }
  const out: Array<{ playerId: string; ok: boolean; error?: string }> = [];
  for (const card of cards) {
    const playerId = typeof card?.playerId === "string" ? card.playerId : "";
    try {
      // Checked here as well as inside `saveScorecard`: the id arrived through
      // this door, so this door says whose it is.
      await assertEventPlayer(eventId, playerId);
      const r = await saveScorecard(stageId, playerId, Array.isArray(card?.strokes) ? card.strokes : []);
      out.push(r.ok ? { playerId, ok: true } : { playerId, ok: false, error: "This card was changed elsewhere — reload to see it." });
    } catch (e) {
      out.push({ playerId, ok: false, error: e instanceof Error && e.message ? e.message : "It didn't save — try again." });
    }
  }
  return out;
}

/**
 * Net (handicap) match play: record one player's gross strokes-per-hole card
 * for the match, then re-derive the match's `holes[]` result from both
 * players' cards net of their handicap allowance. Everything downstream
 * (standings, leaderboard, bracket) keeps reading Match.holes unchanged.
 */
export async function saveMatchScorecard(matchId: string, slot: "A" | "B", strokes: (number | null)[]) {
  const { eventId, session, settings } = await requireScoreEntry();
  await assertOwnMatch(session, eventId, matchId);
  const match = await prisma.match.findUnique({ where: { id: matchId } });
  if (!match || match.eventId !== eventId) return;
  // Not on a round kept by tapping: this card would rebuild over the taps.
  const keptByHoles = await keptByRefusal(match.stageId, "cards");
  if (keptByHoles) throw new Error(keptByHoles);

  // `slot` is half the unique key this upserts on, and its "A" | "B" type is
  // erased at runtime — an unrecognised value would not overwrite a card, it
  // would create a third one that nothing reads and nothing cleans up.
  if (slot !== "A" && slot !== "B") throw new Error("Unknown side.");

  // The card, checked the same way the stroke path is: these numbers are
  // re-derived into the match result below, so a bad one does not sit in a
  // row — it decides who won the hole.
  const cardStage = await prisma.stage.findUnique({
    where: { id: match.stageId },
    select: { holes: true },
  });
  const clean = cleanStrokes(strokes, holesPlayed(cardStage?.holes));
  // Names the hole and the number — see `strokeFault`. The old sentence told a
  // scorer to reload, which discards the card they have just typed.
  if (!clean) throw new Error(strokeFault(strokes, holesPlayed(cardStage?.holes)));

  if (!mayReportPartialCard(settings, session.role)) {
    const filled = clean.filter((s) => typeof s === "number" && s > 0).length;
    if (filled < clean.length) throw new Error("Enter the full round, then submit it.");
  }

  await prisma.matchScorecard.upsert({
    where: { matchId_slot: { matchId, slot } },
    update: { strokes: JSON.stringify(clean) },
    create: { eventId, matchId, slot, strokes: JSON.stringify(clean) },
  });
  // Net match play prices this card off a handicap too, so the same round is
  // frozen by the same rule as a stroke round.
  if (isReturnedCard(clean)) await freezeRoundHandicaps(eventId, match.stageId);

  await deriveMatchFromItsCards(eventId, match, { name: session.name, playerId: await authorPlayerId(eventId, session) });
  await refresh();
}

/**
 * Save a card for a team round.
 *
 * `playerId` decides which of the two shapes of team golf this is, and it is
 * not a free choice — it must agree with the format:
 *
 *   Empty  — the side plays one ball, so there is one card for the team
 *            (foursomes, alternate shot, scramble, Chapman).
 *   Set    — each partner keeps their own card and the side's score is derived
 *            per hole (four-ball, best ball, shamble).
 *
 * Sending the wrong one would produce a card the scoring engine then reads
 * with the other shape's rules, so the mismatch is rejected rather than
 * quietly stored.
 */
export async function saveTeamScorecard(
  teamId: string,
  playerId: string,
  matchId: string,
  strokes: (number | null)[],
  /** Per hole, this ball picked up — match play only. See `TeamScorecard.pickedUp`. */
  pickedUp?: boolean[],
): Promise<{ ok: boolean; error?: string }> {
  const { eventId, session, settings } = await requireScoreEntry();
  /**
   * ONLY AGAINST A MATCH (2026-10-10). A team STROKE round — a four-ball or a
   * best-ball medal — has no match, and `matchId` is empty; asking
   * `assertOwnMatch` about it threw "Match not found." for every member, so no
   * player could save their own four-ball card anywhere, and the throw took the
   * whole screen down ("This screen didn't load"). Walked on a club's 120-player
   * four-ball. Staff never reached it — `assertOwnMatch` waves them through —
   * which is why committee entry worked and hid it. A player's right to THIS
   * card is checked below: on the side, and their own card.
   *
   * And answered, not thrown: this action returns `{ ok, error }` and its screen
   * shows the error beside the card.
   */
  if (matchId) {
    try {
      await assertOwnMatch(session, eventId, matchId);
    } catch (e) {
      if (e instanceof Error) return { ok: false, error: e.message };
      throw e;
    }
  }

  const team = await prisma.team.findUnique({
    where: { id: teamId },
    include: { members: { select: { playerId: true } }, stage: { select: { id: true, format: true } } },
  });
  if (!team || team.eventId !== eventId) return { ok: false, error: "Team not found." };

  // A team may be event-wide (stageId null), in which case the round comes
  // from the match being scored.
  let stageId = team.stageId;
  let match: { id: string; stageId: string; eventId: string; teamAId: string; teamBId: string } | null = null;
  if (matchId) {
    const m = await prisma.match.findUnique({ where: { id: matchId } });
    if (!m || m.eventId !== eventId) return { ok: false, error: "Match not found." };
    if (m.teamAId !== teamId && m.teamBId !== teamId) {
      return { ok: false, error: "That team is not in this match." };
    }
    match = m;
    stageId = m.stageId;
    // A match on a round kept by tapping takes no card: it would rebuild the
    // match over the taps. A team MEDAL (no match) is untouched.
    const keptByHoles = await keptByRefusal(m.stageId, "cards");
    if (keptByHoles) return { ok: false, error: keptByHoles };
  }
  if (!stageId) return { ok: false, error: "This card has no round to belong to." };

  const stage = await prisma.stage.findUnique({
    where: { id: stageId },
    select: { format: true, holes: true, type: true, lineupPublished: true, scoreInput: true, scoringBasis: true },
  });
  if (!stage) return { ok: false, error: "Round not found." };
  const format = findFormat(stage.format);
  // The committee's shape for this round's cards, not the format's raw one.
  const oneCard = oneCardPerSide(stage.format, stage.scoreInput, stage.scoringBasis);

  // A player may only enter cards for a side they are actually on. Staff are
  // exempt — entering everyone's scores is the job in a committee-run event.
  //
  // Identity comes from the session email resolved to this event's Player row,
  // the same way confirmMatch does it: the session carries an account, not an
  // entry, and the two are only linked by email.
  const isStaff = session.role === "admin" || session.role === "assistant";

  // A cup lineup nobody has announced is not a match anybody can play yet.
  if (!isStaff && lineupHidden(stage)) return { ok: false, error: LINEUP_HIDDEN };
  let callerPlayerId = "";
  if (!isStaff) {
    const own = await prisma.player.findFirst({
      where: { eventId, email: session.email },
      select: { id: true },
    });
    if (!own || !team.members.some((m) => m.playerId === own.id)) {
      return { ok: false, error: "You're not on this team." };
    }
    callerPlayerId = own.id;
  }

  // The card shape must match the format, not the caller's choice.
  if (oneCard && playerId !== "") {
    return {
      ok: false,
      error:
        format.ball === "single"
          ? `${format.name} is played with one ball per side — one card, not one each.`
          : "This round is entered as one card for the side, not one each.",
    };
  }
  if (!oneCard && playerId === "") {
    return { ok: false, error: `${format.name} needs a card for each partner.` };
  }
  if (playerId && !team.members.some((m) => m.playerId === playerId)) {
    return { ok: false, error: "That player is not on this team." };
  }
  // A player entering a partner's card is the same hole confirmMatch had: on a
  // side, but not this person. Shared-ball formats are exempt by construction,
  // since that card belongs to nobody in particular.
  if (!isStaff && playerId && playerId !== callerPlayerId) {
    return { ok: false, error: "You can only enter your own card." };
  }

  // Same boundary as the individual paths. A side's card is aggregated into
  // the team's score — best ball, combined, best N of four — so an
  // out-of-range stroke does not affect one player, it decides the side's
  // result and the match with it. `stage.holes` is already loaded above.
  const cardHoles = holesPlayed(stage.holes);
  const cleanStrokesIn = cleanStrokes(strokes, cardHoles);
  if (!cleanStrokesIn) {
    return { ok: false, error: strokeFault(strokes, cardHoles) };
  }
  /**
   * PICKED UP, which only means something against an opponent: in match play a
   * ball out of the hole concedes it once the side has none left (Rule
   * 3.2b(1)). A medal has no such thing — every hole is holed out — so a
   * pick-up on a stroke round is refused rather than stored and ignored.
   * Validated as data, like the strokes: a `"use server"` export takes
   * whatever the caller posts.
   */
  let picks: boolean[] = [];
  if (pickedUp !== undefined) {
    if (!Array.isArray(pickedUp) || pickedUp.length !== cardHoles || pickedUp.some((p) => typeof p !== "boolean")) {
      return { ok: false, error: "Those picked-up holes aren't valid. Reload the card and try again." };
    }
    if (pickedUp.some(Boolean) && !isHeadToHead(stage.type)) {
      return { ok: false, error: "Picking up is for match play — in a medal every hole is holed out." };
    }
    picks = pickedUp.some(Boolean) ? pickedUp : [];
  }
  // A ball picked up has no score on that hole, whatever was typed into it.
  const cleanCard = cleanStrokesIn.map((s, h) => (picks[h] ? null : s));

  if (!mayReportPartialCard(settings, session.role)) {
    // A hole picked up is a hole finished, not one still to enter.
    const filled = cleanCard.filter((s, h) => picks[h] || (typeof s === "number" && s > 0)).length;
    if (filled < cleanCard.length) {
      return { ok: false, error: "Enter the full round, then submit it." };
    }
  }

  await prisma.teamScorecard.upsert({
    where: { stageId_matchId_teamId_playerId: { stageId, matchId, teamId, playerId } },
    // `pickedUp` only when the caller sent it: a save from a screen that knows
    // nothing about picking up must not wipe the marks another one recorded.
    update: { strokes: JSON.stringify(cleanCard), ...(pickedUp !== undefined ? { pickedUp: JSON.stringify(picks) } : {}) },
    create: { eventId, stageId, matchId, teamId, playerId, strokes: JSON.stringify(cleanCard), pickedUp: JSON.stringify(picks) },
  });
  // A side's card is aggregated net of each partner's handicap, so a team
  // round freezes on its first card like any other.
  if (isReturnedCard(cleanCard)) await freezeRoundHandicaps(eventId, stageId);

  // Team match play: recompute the match from both sides' cards, so the same
  // resolveMatch that decides singles decides this too.
  if (match) {
    await recomputeTeamMatch(eventId, match, stage.format, holesPlayed(stage.holes));
  }

  await refresh();
  return { ok: true };
}

/**
 * Several team cards in ONE request — `saveScorecards`, for a side's cards,
 * for the same reason: a second request sent as the scorer leaves the screen
 * can be aborted, and its card lost. Each card goes through
 * `saveTeamScorecard`, guards and all.
 */
export async function saveTeamScorecards(
  cards: Array<{ teamId: string; playerId: string; matchId: string; strokes: (number | null)[]; pickedUp?: boolean[] }>,
): Promise<Array<{ ok: boolean; error?: string }>> {
  const { eventId, session } = await requireScoreEntry();
  if (!Array.isArray(cards) || cards.length > MAX_CARDS_IN_ONE_SAVE) {
    return [{ ok: false, error: "Too many cards in one save." }];
  }
  const out: Array<{ ok: boolean; error?: string }> = [];
  for (const c of cards) {
    const teamId = typeof c?.teamId === "string" ? c.teamId : "";
    const playerId = typeof c?.playerId === "string" ? c.playerId : "";
    const matchId = typeof c?.matchId === "string" ? c.matchId : "";
    try {
      // Checked here as well as inside `saveTeamScorecard`: the ids arrived
      // through this door, so this door says whose they are. An empty player
      // is a shared-ball side's card, and an empty match a team stroke round.
      await assertEventTeam(eventId, teamId);
      if (playerId) await assertEventPlayer(eventId, playerId);
      if (matchId) await assertOwnMatch(session, eventId, matchId);
      out.push(
        await saveTeamScorecard(
          teamId,
          playerId,
          matchId,
          Array.isArray(c?.strokes) ? c.strokes : [],
          Array.isArray(c?.pickedUp) ? c.pickedUp : undefined,
        ),
      );
    } catch (e) {
      out.push({ ok: false, error: e instanceof Error && e.message ? e.message : "not saved" });
    }
  }
  return out;
}

/* ── Score confirmation ───────────────────────────────────────────────── */

/**
 * Sign off a result.
 *
 * Who may do this depends on the tournament's approval setting:
 *   - `staff`   — organizers and assistants only.
 *   - `players` — either player *in that match*, or staff.
 *
 * Previously this only required a session, so any signed-in participant could
 * confirm any match in the event, including their own. Both the role and the
 * caller's presence in the specific match are now checked.
 */
/**
 * What confirming did, REPORTED rather than thrown.
 *
 * This threw for every refusal, and its one caller was
 * `startTransition(() => void confirmMatch(id))` — a discarded promise behind
 * an optimistic `setStatus(id, "confirmed")`. So a refusal painted the row
 * confirmed and vanished, which is the exact failure this function's own
 * comment records happening to team matches once before.
 *
 * Attestation made that far worse, because it added a SUCCESS that is not a
 * confirmation: under "everyone in the match" a valid signature leaves the
 * result pending, and the screen would have called that confirmed too.
 *
 * `audit-guards` already states the rule for the play surface — actions called
 * straight from a client component return their wording, because a thrown
 * error reaches the player as an unhandled server-action failure with nothing
 * to show. This is that kind of action.
 */
export type ConfirmResult =
  | { ok: true; status: "confirmed" | "pending"; outstanding: number }
  | { ok: false; error: string };

export async function confirmMatch(matchId: string): Promise<ConfirmResult> {
  const session = await getSession();
  if (!session) throw new Error("Not authenticated");
  const eventId = session.eventId;

  const [event, match] = await Promise.all([
    prisma.event.findUnique({ where: { id: eventId }, include: COURSE_REF }),
    prisma.match.findUnique({ where: { id: matchId } }),
  ]);
  if (!event || !match || match.eventId !== eventId) {
    return { ok: false, error: "That match is not in this tournament." };
  }

  const settings = settingsOf(event);
  const isStaff = session.role === "admin" || session.role === "assistant";

  if (!isStaff) {
    if (settings.scoreApproval === "staff") {
      return { ok: false, error: "An organizer approves scores for this tournament." };
    }
    /**
     * Player confirmation is peer review, and only of a match they played.
     *
     * "Played in" has two shapes. An individual match names its two players in
     * `playerAId` / `playerBId`; a TEAM match names two sides and leaves those
     * columns deliberately empty — `teams.ts` says so at the point of writing:
     * "the sides are teams, so the player columns stay empty".
     *
     * Reading only the player columns therefore asked `id: { in: ["", ""] }`
     * for every team match, found nobody, and told a player they could only
     * confirm a match they played in — about a match they had just played. Peer
     * confirmation was impossible for every four-ball and foursomes round in a
     * tournament whose own setting said players confirm.
     *
     * It failed silently too: the entry screen marks the row confirmed before
     * awaiting, and the throw is swallowed inside `startTransition`, so the
     * screen said "confirmed" while the row stayed pending.
     */
    const me = await prisma.player.findFirst({
      where: { eventId, email: session.email },
      select: { id: true },
    });
    const sides = [match.teamAId, match.teamBId].filter(Boolean) as string[];
    const inMatch = me
      ? [match.playerAId, match.playerBId].includes(me.id) ||
        (sides.length > 0 &&
          (await prisma.teamMember.count({
            where: { playerId: me.id, teamId: { in: sides } },
          })) > 0)
      : false;
    if (!inMatch) return { ok: false, error: "You can only confirm a match you played in." };

    /**
     * THE CLUB'S ATTESTATION RULE, WHICH USED TO BE IGNORED.
     *
     * `attestBy` offers one playing partner, someone from the other side, or
     * everyone in the match — and this function confirmed on the first
     * signature whichever was chosen, because a single `confirmedById` cannot
     * express the third. An organizer who picked the strictest option, on a
     * result they expected to be argued about, got the fastest one.
     *
     * The decision lives in services/attestation.ts so the round-code surface
     * and anything written later cannot answer it differently.
     */
    const outcome = attestMatch(
      await matchSidesOf(match),
      match,
      me!.id,
      ruleFrom(settings.attestBy),
    );
    if (!outcome.ok) return { ok: false, error: outcome.error };

    await prisma.match.updateMany({
      where: { id: matchId, eventId },
      data: {
        scoreStatus: outcome.status,
        attestedBy: JSON.stringify(outcome.attestedBy),
        // Named only once the result is actually confirmed. Recording a
        // signatory on a card still waiting for two more would put a name
        // against a result nobody has agreed yet.
        ...(outcome.status === "confirmed"
          ? { confirmedById: session.accountId || null, confirmedBy: session.name }
          : {}),
      },
    });
    await logAudit(
      eventId,
      "confirm",
      outcome.status === "confirmed"
        ? `Confirmed by ${session.name}`
        : `Signed by ${session.name}; ${outcome.outstanding.length} still to sign`,
      { matchId },
    );
    await refresh();
    return { ok: true, status: outcome.status, outstanding: outcome.outstanding.length };
  }

  await prisma.match.updateMany({
    where: { id: matchId, eventId },
    data: { scoreStatus: "confirmed", confirmedById: session.accountId || null, confirmedBy: session.name },
  });
  await logAudit(eventId, "confirm", "Approved by organizer", { matchId });
  await refresh();
  return { ok: true, status: "confirmed", outstanding: 0 };
}

/**
 * Approve a batch of finished matches at once.
 *
 * Organizers only, deliberately — unlike confirmMatch, which a player may call
 * for a match they played. Peer confirmation is a person vouching for a card
 * they were standing next to; there is no version of that which applies to
 * eleven cards in one tap, so this is not offered to players at all rather
 * than offered and then filtered down to the one match they could have signed.
 *
 * Written as one updateMany scoped to the event and to the matches that are
 * actually waiting. That scoping is the whole security of it: ids arrive from
 * the browser, and a match belonging to another tournament simply is not in
 * the `where`, so it cannot be touched however it got into the list.
 *
 * Already-confirmed and disputed matches are excluded rather than refused. A
 * card that was confirmed while the organizer was reading the screen is not an
 * error worth failing the batch over — and a disputed one is precisely what
 * must not be swept up by a bulk approve.
 */
export async function confirmMatches(
  matchIds: string[],
): Promise<{ ok: boolean; confirmed: number; error?: string }> {
  const session = await getSession();
  if (!session) return { ok: false, confirmed: 0, error: "Not authenticated." };
  if (session.role !== "admin" && session.role !== "assistant") {
    return { ok: false, confirmed: 0, error: "An organizer approves scores." };
  }
  const eventId = session.eventId;

  const result = await prisma.match.updateMany({
    where: {
      // Cleaned inline rather than through a local, so the ids and the
      // eventId that bounds them are visibly one clause — audit-idor.test.ts
      // reads these where clauses, and a local would have hidden the scoping
      // from it as effectively as omitting it. An empty list matches nothing
      // and updates nothing, which is the right answer for an empty selection.
      id: { in: [...new Set((matchIds ?? []).map((id) => (id ?? "").trim()).filter(Boolean))] },
      eventId,
      // Not "everything selected": only what is genuinely awaiting a decision.
      scoreStatus: { notIn: ["confirmed", "auto-confirmed", "disputed"] },
    },
    data: { scoreStatus: "confirmed", confirmedById: session.accountId || null, confirmedBy: session.name },
  });

  if (result.count > 0) {
    // One audit line for the batch, not one per match. The question this log
    // answers is "who signed these off and when", and 48 identical rows a
    // second apart buries that rather than recording it.
    await logAudit(eventId, "confirm-batch", `Approved ${result.count} results by organizer`);
    await refresh();
  }
  return { ok: true, confirmed: result.count };
}

/**
 * Flag a result as wrong.
 *
 * FOR THE PLAYERS IN THE MATCH, AND THE COMMITTEE (ruling of 2026-10-11).
 *
 * This read "open to anyone in the event — a disputed score blocks
 * confirmation rather than changing anything, so the permissive side is the
 * safe one". It is not safe: any entrant could mark any match disputed — a
 * pair two groups away, a final they were not in — and a disputed result
 * holds up the whole tournament's finish; it also took a result the committee
 * had already confirmed back out of "confirmed". The screen has only ever
 * offered Dispute on a player's own match, before it is confirmed. Found by
 * the every-action sweep's member, signed in to a tournament with matches.
 *
 * In match play a result is the two sides' business and then the committee's
 * (Rule 20.1b): somebody outside the match who knows something tells the
 * committee, and once the committee has confirmed a result a player asks them
 * to reopen it — `reopenMatch`, which is theirs alone.
 */
export async function disputeMatch(matchId: string): Promise<{ ok: boolean; error?: string }> {
  const session = await getSession();
  if (!session) throw new Error("Not authenticated");
  const eventId = session.eventId;
  const match = await prisma.match.findFirst({
    where: { id: matchId, eventId },
    select: { playerAId: true, playerBId: true, teamAId: true, teamBId: true, scoreStatus: true, scoredAt: true },
  });
  if (!match) return { ok: false, error: "That match isn't in this tournament." };
  if (session.role === "player") {
    if (!(await playsInMatch(eventId, session.email, match))) {
      return { ok: false, error: "Only the players in a match, or the committee, can dispute its result." };
    }
    // The EFFECTIVE status, as `clearMatch` reads it: a result left a day where
    // players approve is confirmed while its column still says "pending"
    // (`an-auto-confirmed-result-is-not-disputed-by-a-player.audit.test.ts`).
    const event = await prisma.event.findUnique({ where: { id: eventId } });
    const status = effectiveScoreStatus(match, event ? allowsAutoConfirm(settingsOf(event)) : false);
    if (status === "confirmed" || status === "auto-confirmed") {
      return { ok: false, error: "That result has been confirmed. Ask the organizer to reopen it." };
    }
  }
  const moved = await prisma.match.updateMany({
    where: { id: matchId, eventId },
    data: { scoreStatus: "disputed" },
  });
  // Only what happened is on the record.
  if (moved.count === 0) return { ok: false, error: "That match isn't in this tournament." };
  await logAudit(eventId, "dispute", "Result disputed", { matchId });
  await refresh();
  return { ok: true };
}

/**
 * Organizer override: reopen a match for re-scoring; logged to the audit trail.
 *
 * Organizer-only, unlike the rest of score entry. This is the one action that
 * undoes an approval, and under staff sign-off the whole point is that an
 * organizer stands behind the number — an assistant reversing that quietly
 * would hollow the guarantee out.
 */
export async function reopenMatch(matchId: string) {
  const eventId = await requireAdminEvent();
  const moved = await prisma.match.updateMany({
    where: { id: matchId, eventId },
    data: { scoreStatus: "pending", scoredAt: new Date(), confirmedById: null, confirmedBy: "" },
  });
  // As `disputeMatch`: nothing reopened, nothing recorded.
  if (moved.count === 0) return;
  await logAudit(eventId, "reopen", "Organizer reopened the scorecard", { matchId });
  await refresh();
}

/* ── Bracket ──────────────────────────────────────────────────────────── */

export async function setBracketWinner(key: string, winnerId: string): Promise<{ ok: boolean; error?: string }> {
  const eventId = await requireStaffEvent();
  /**
   * THE WINNER OF A TIE IS ONE OF THE TWO PLAYERS IN IT (2026-10-11).
   *
   * This took any key and any id. The screen only ever sends a tie's own two
   * players, but a `"use server"` export is called with whatever the caller
   * likes: a bracket could be given a winner from another club's tournament —
   * whose name the draw would then print — or a result for a tie the draw
   * does not have (found by the every-action sweep). A player's own REPORT
   * has been held to this since it was written (`tieReportRefusal`), and
   * `matrix.test.ts` asserts it of every bracket; the organizer's door was
   * the one that never asked.
   */
  if (typeof key !== "string" || typeof winnerId !== "string") return { ok: false, error: "Choose who won the tie." };
  const state = await loadEventState(eventId);
  const tie = state ? tieByKey(bracketDraws(state.brackets), key) : null;
  if (!tie) return { ok: false, error: "That tie isn't in the draw." };
  if (tie.match.a.playerId !== winnerId && tie.match.b.playerId !== winnerId) {
    return { ok: false, error: "The winner of a tie is one of the two players in it." };
  }
  const existing = await prisma.bracketWinner.findFirst({ where: { eventId, key } });

  if (existing?.winnerId === winnerId) {
    // Toggle off if the same slot is clicked again.
    await prisma.bracketWinner.delete({ where: { id: existing.id } });
    /**
     * Clearing the last result re-opens the draw.
     *
     * Without this a frozen draw would be a one-way door: an organizer who
     * recorded a result by mistake, undid it, and then fixed the qualifying
     * scores would be stuck with a bracket seeded from the wrong standings and
     * no way in the UI to say so. A bracket with no results has not started,
     * so there is no draw to protect.
     */
    const remaining = await prisma.bracketWinner.count({ where: { eventId } });
    if (remaining === 0) {
      // A FLAT draw is what the first result wrote down, and is what this
      // re-opens. A division into flights was made by the organizer before any
      // result and is not a by-product of one: clearing the last result leaves
      // it exactly as they arranged it.
      const kept = await prisma.event.findUnique({ where: { id: eventId }, select: { bracketDraw: true } });
      if (!parseFlightPlan(kept?.bracketDraw)) {
        await prisma.event.update({ where: { id: eventId }, data: { bracketDraw: "" } });
      }
    }
  } else {
    await recordBracketWinner(eventId, key, winnerId);
  }
  // Whatever a player reported for this tie, staff have now answered it
  // themselves — a report left behind would ask them the same question again.
  await prisma.bracketReport.deleteMany({ where: { eventId, key } });
  await refresh();
  return { ok: true };
}

/**
 * THE ONE WRITE OF A KNOCKOUT RESULT — the console's click and a player's
 * approved report both come through here, so the draw is frozen the same way
 * whichever of them records the first result. Not a server action: it trusts
 * its caller to have checked who may write.
 */
async function recordBracketWinner(eventId: string, key: string, winnerId: string, result?: string) {
  const existing = await prisma.bracketWinner.findFirst({ where: { eventId, key } });

  /**
   * The first result is what makes the draw a draw.
   *
   * Until somebody has played, re-seeding from live standings is right: a late
   * entry or a corrected score SHOULD change who is in the bracket. The moment
   * one knockout match has a winner, it stops being right — the pairings are
   * now the thing the results are recorded against, and recomputing them
   * reshuffles played matches out of existence.
   *
   * So the draw is written down here, before the result that ends the
   * re-seeding, and it is the draw the organizer was looking at when they
   * clicked. Nothing else in the app writes it.
   */
  if (!existing) {
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      select: { bracketDraw: true },
    });
    if (event && !event.bracketDraw) {
      const state = await loadEventState(eventId);
      if (state && state.qualifiers.length > 0) {
        await prisma.event.update({
          where: { id: eventId },
          data: { bracketDraw: serializeBracketDraw(state.qualifiers.map((p) => p.id)) },
        });
      }
    }
  }

  const margin = result === undefined ? {} : { result: cleanMargin(result) };
  if (existing) {
    await prisma.bracketWinner.update({ where: { id: existing.id }, data: { winnerId, ...margin } });
  } else {
    await prisma.bracketWinner.create({ data: { eventId, key, winnerId, ...margin } });
  }
}

export async function setBracketResult(key: string, result: string) {
  const eventId = await requireStaffEvent();
  await prisma.bracketWinner.updateMany({
    where: { eventId, key },
    data: { result: cleanMargin(result) },
  });
  await refresh();
}

/**
 * A PLAYER REPORTS THEIR KNOCKOUT TIE (Ajay, 2026-09-28: "player may enter it
 * but organizer/club needs to approve it").
 *
 * This files a REQUEST, never a result: it writes a `BracketReport` row, which
 * nothing that ranks, advances or crowns reads. Staff approve it on the Bracket
 * screen and only then does the draw move. Either player may report, and a
 * second report of the same tie replaces the first — the organizer sees one
 * question per tie, with the latest answer.
 */
export async function reportBracketResult(
  key: string,
  winnerId: string,
  result: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Your session expired. Sign in again." };
  const eventId = session.eventId;
  if (typeof key !== "string" || typeof winnerId !== "string") {
    return { ok: false, error: "Choose who won the tie." };
  }

  // A draw nobody has launched is not being played yet — the same rule as a card.
  const notStarted = await playRefusalFor(eventId);
  if (notStarted) return { ok: false, error: notStarted };

  const [state, mine] = await Promise.all([loadEventState(eventId), myPlayerIds(eventId, session.email)]);
  if (!state) return { ok: false, error: "That tournament isn't available." };
  const tie = tieByKey(bracketDraws(state.brackets), key);
  const refusal = tieReportRefusal({ tie, reporterIds: mine, winnerId });
  if (refusal || !tie) return { ok: false, error: refusal ?? "That tie isn't in the draw." };

  const m = tie.match;
  const reporterId = mine.has(m.a.playerId!) ? m.a.playerId! : m.b.playerId!;
  const reporter = m.a.playerId === reporterId ? m.a.name : m.b.name;
  const winner = m.a.playerId === winnerId ? m.a.name : m.b.name;
  const loser = m.a.playerId === winnerId ? m.b.name : m.a.name;
  const margin = cleanMargin(result);
  await prisma.bracketReport.upsert({
    where: { eventId_key: { eventId, key } },
    create: { eventId, key, winnerId, result: margin, reportedById: reporterId, reportedBy: reporter },
    update: { winnerId, result: margin, reportedById: reporterId, reportedBy: reporter, createdAt: new Date() },
  });
  await logAudit(
    eventId,
    "knockout.report",
    `${tie.round}: ${winner} beat ${loser}${margin ? ` ${margin}` : ""}, reported by ${reporter} for approval`,
  );
  await refresh();
  return { ok: true };
}

/**
 * Staff approve a player's report: the result is recorded exactly as if they
 * had clicked the winner themselves, margin included.
 *
 * The tie is checked again rather than trusted. Between the report and the
 * approval an organizer may have recorded a result by hand or re-seeded the
 * draw, and a winner who is no longer in that tie must not be advanced out of it.
 */
export async function approveBracketReport(key: string): Promise<{ ok: boolean; error?: string }> {
  const eventId = await requireStaffEvent();
  const report = await prisma.bracketReport.findUnique({ where: { eventId_key: { eventId, key } } });
  if (!report) return { ok: false, error: "That report has already been dealt with." };

  const state = await loadEventState(eventId);
  const tie = state ? tieByKey(bracketDraws(state.brackets), key) : null;
  const m = tie?.match;
  if (!m || (m.a.playerId !== report.winnerId && m.b.playerId !== report.winnerId)) {
    await prisma.bracketReport.delete({ where: { id: report.id } });
    await refresh();
    return { ok: false, error: "The draw has changed since that was reported, so it was set aside. Record the tie on the draw." };
  }
  if (m.winnerId) {
    await prisma.bracketReport.delete({ where: { id: report.id } });
    await refresh();
    return { ok: false, error: "That tie already has a result, so the report was set aside." };
  }

  await recordBracketWinner(eventId, key, report.winnerId, report.result);
  await prisma.bracketReport.delete({ where: { id: report.id } });
  const winner = m.a.playerId === report.winnerId ? m.a.name : m.b.name;
  const loser = m.a.playerId === report.winnerId ? m.b.name : m.a.name;
  await logAudit(
    eventId,
    "knockout.approve",
    `${tie!.round}: ${winner} beat ${loser}${report.result ? ` ${report.result}` : ""} — approved, as reported by ${report.reportedBy}`,
  );
  await refresh();
  return { ok: true };
}

/** Staff turn a player's report down; the tie stays waiting on a result. */
export async function rejectBracketReport(key: string): Promise<{ ok: boolean; error?: string }> {
  const eventId = await requireStaffEvent();
  const report = await prisma.bracketReport.findUnique({ where: { eventId_key: { eventId, key } } });
  if (!report) return { ok: false, error: "That report has already been dealt with." };
  await prisma.bracketReport.delete({ where: { id: report.id } });
  await logAudit(eventId, "knockout.reject", `Turned down ${report.reportedBy}'s report of their tie; it stays open`);
  await refresh();
  return { ok: true };
}

/* ── Access control ───────────────────────────────────────────────────── */

const ACCOUNT_ROLES = ["admin", "assistant", "player"];
const cleanRole = (role: string) => (ACCOUNT_ROLES.includes(role) ? role : "player");

export async function addAccount(name: string, email: string, role: string): Promise<{ ok: boolean; error?: string }> {
  const eventId = await requireAdminEvent();
  const clean = String(name ?? "").trim();
  const cleanEmail = String(email ?? "").trim().toLowerCase();
  if (!clean || !cleanEmail) return { ok: false, error: "Enter a name and email." };
  // The same two rules as every other door a person is named at: a name of a
  // person's length, and an address that is one (the text-box crawl stored
  // both, 2026-10-21).
  const badName = nameRefusal(clean, PERSON_NAME_MAX, "Enter a name and email.");
  if (badName) return { ok: false, error: badName };
  if (!isEmailAddress(cleanEmail)) return { ok: false, error: EMAIL_REFUSAL };
  const next = cleanRole(role);

  // Per-event organizer and assistant roles consume a staff seat too. Without
  // this the seat limit would be trivially bypassed by granting rights on each
  // event instead of at the club.
  if (next !== "player") {
    const orgId = await organizationIdForEvent(eventId);
    const refusal = orgId ? await seatRefusalFor(orgId, cleanEmail) : null;
    if (refusal) return { ok: false, error: refusal };
  }

  // This upserts by email, so re-adding an existing admin with a different
  // role is a silent downgrade — guard it the same as setAccountRole.
  const existing = await prisma.account.findUnique({ where: { eventId_email: { eventId, email: cleanEmail } } });
  if (existing && existing.role === "admin" && next !== "admin" && !(await hasOtherAdmin(eventId, existing.id))) {
    return { ok: false, error: "This is the only Organizer on this event — promote someone else first." };
  }

  await prisma.account.upsert({
    where: { eventId_email: { eventId, email: cleanEmail } },
    update: { name: clean, role: next },
    create: { eventId, name: clean, email: cleanEmail, role: next },
  });
  await refresh();
  return { ok: true };
}


/** True once this event has more than one admin — i.e. `accountId` is safe
 *  to demote/remove without leaving the event with nobody who can manage it. */
async function hasOtherAdmin(eventId: string, accountId: string): Promise<boolean> {
  const otherAdmins = await prisma.account.count({
    where: { eventId, role: "admin", id: { not: accountId } },
  });
  return otherAdmins > 0;
}

export async function setAccountRole(accountId: string, role: string): Promise<{ ok: boolean; error?: string }> {
  const eventId = await requireAdminEvent();
  const next = cleanRole(role);
  const account = await prisma.account.findFirst({ where: { id: accountId, eventId } });
  if (!account) return { ok: false, error: "Account not found." };
  if (account.role === "admin" && next !== "admin" && !(await hasOtherAdmin(eventId, accountId))) {
    return { ok: false, error: "This is the only Organizer on this event — promote someone else first." };
  }
  // A PROMOTION takes a seat as surely as an addition does — see
  // `seatRefusalFor`. Without this, "add as a player, then promote" was the way
  // round the seat limit.
  if (next !== "player" && account.role === "player") {
    const orgId = await organizationIdForEvent(eventId);
    const refusal = orgId ? await seatRefusalFor(orgId, account.email) : null;
    if (refusal) return { ok: false, error: refusal };
  }
  await prisma.account.update({ where: { id: accountId }, data: { role: next } });
  await refresh();
  return { ok: true };
}

export async function removeAccount(accountId: string): Promise<{ ok: boolean; error?: string }> {
  const eventId = await requireAdminEvent();
  const account = await prisma.account.findFirst({ where: { id: accountId, eventId } });
  if (!account) return { ok: false, error: "Account not found." };
  if (account.role === "admin" && !(await hasOtherAdmin(eventId, accountId))) {
    return { ok: false, error: "This is the only Organizer on this event — promote someone else before removing them." };
  }
  await prisma.account.deleteMany({ where: { id: accountId, eventId } });
  await refresh();
  return { ok: true };
}

/* ── Multiple tournaments ─────────────────────────────────────────────── */

/** Switch which tournament the organizer is managing (events they belong to). */
export async function switchEvent(eventId: string) {
  const session = await getSession();
  if (!session) throw new Error("Not authenticated");
  // Access can come from a per-event Account *or* from being an owner/admin of
  // the organization that runs the event. Checking Account alone locked club
  // admins out of their own club's tournaments — the events showed up in their
  // list and then refused to open.
  const access = await effectiveAccess(session.email, eventId);
  if (!access) throw new Error("You don't have access to that tournament");
  await setActiveEvent(eventId);
  await refresh();
}

/**
 * Create a tournament by copying an existing one.
 *
 * Most tournaments are not new — they're this year's version of last year's,
 * and the organizer's own proven setup beats any preset someone else authored.
 *
 * Configuration only. Deliberately *not* copied:
 *
 *   - Players, matches, scorecards, prizes, announcements. A clone carrying
 *     last year's results would be a disaster, and one carrying last year's
 *     field would quietly enter people who never entered.
 *   - The share token. It is unique, so copying would collide — and it would
 *     hand this year's tournament last year's public link.
 *   - Round Codes. They are credentials; a new tournament gets new ones, and
 *     only if it turns code access on.
 */
export async function cloneEvent(sourceEventId: string, name: string): Promise<{ ok: boolean; error?: string }> {
  const session = await getSession();
  if (!session) throw new Error("Not authenticated");

  // Organizer-level, and on the *source* event specifically — because the copy
  // lands in the source's organization, not the caller's own. Merely having
  // access is the wrong bar: effectiveAccess also returns a role for players,
  // so `if (!access)` would let anyone entered in a club's tournament create an
  // event inside that club and make themselves its organizer. Same rule as
  // deleteEvent: creating and destroying tournaments in a club's name is an
  // organizer act, not an assistant's.
  const access = await effectiveAccess(session.email, sourceEventId);
  if (access?.role !== "admin") {
    return { ok: false, error: "Only an organizer of that tournament can make a copy of it." };
  }

  const source = await prisma.event.findUnique({
    where: { id: sourceEventId },
    include: { stages: { orderBy: { position: "asc" } }, courses: true },
  });
  if (!source) return { ok: false, error: "Tournament not found." };

  const clean = name.trim() || `${source.name} (copy)`;

  // A copy is a new tournament and counts like one.
  const refusal = await refusalFor(source.organizationId, "activeEvents");
  if (refusal) return { ok: false, error: refusal };

  /**
   * Copied FROM the declared policy, not from a second list kept by hand.
   *
   * `CLONED_EVENT_FIELDS` names 43 fields and this wrote 30 of them, so
   * thirteen declared-clonable settings were silently dropped — and every one
   * has a non-neutral schema default, so the copy came back configured as
   * something else rather than obviously blank. `shape` defaults to "series",
   * so a copied knockout returned as a league with every knockout control
   * hidden. `bracketMode` reverted a plate to "split", `sideStyle` a pairs
   * event to "individual", `attendanceMode` an opt-in league to "everyone" —
   * entering the whole roster into every week. Three of them change
   * arithmetic: `playPts`, `maxPerMatch` and `matchTiebreakers`.
   *
   * The organizer's stated reason to clone is "the organizer's own proven
   * setup", and they got a tournament that looked configured and scored
   * differently. `clone.test.ts` already forces every Event column to be
   * classified in writing; deriving the write from that classification is what
   * makes the declaration true rather than merely documented.
   */
  const carried = Object.fromEntries(
    CLONED_EVENT_FIELDS.map((f) => [f, source[f]]),
  ) as Pick<typeof source, (typeof CLONED_EVENT_FIELDS)[number]>;

  // The plan's field cap, where one is enforced — a copy of a 40-player
  // event made in a Free club is a 10-player event (`fieldCapFor`).
  const fieldCap = await fieldCapFor(source.organizationId);

  const created = await prisma.event.create({
    data: {
      ...carried,
      // The organizer's number, carried as it was; the cap is applied on read
      // (see `createTournament`), so a copy made on Par still holds ten.
      capacity: carried.capacity,
      manualPlayerCount:
        fieldCap === null ? carried.manualPlayerCount : Math.min(carried.manualPlayerCount, fieldCap),
      name: clean,
      // Dates and the registration deadline are the two things that are always
      // wrong on a copy, so they start empty rather than pointing at last year.
      dates: "",
      regDeadline: "",
      status: "draft",
      // A fresh token: unique index aside, the copy must not inherit the
      // original's public link.
      shareToken: generateShareToken(),
    },
  });

  // Venues carry over — a club plays the same courses year on year.
  for (const link of source.courses) {
    await prisma.eventCourse.create({ data: { eventId: created.id, courseId: link.courseId } });
  }

  // Rounds carry their shape, but never their Round Codes. From the declared
  // policy for the same reason the Event is: this loop copied the four cut
  // fields and not `cutScope`, so a per-flight cut quietly became an overall
  // one and advanced a different set of players.
  const newStageId = new Map<string, string>();
  for (const s of source.stages) {
    const round = Object.fromEntries(
      CLONED_STAGE_FIELDS.map((f) => [f, s[f]]),
    ) as Pick<typeof s, (typeof CLONED_STAGE_FIELDS)[number]>;
    const copyStage = await prisma.stage.create({
      data: {
        ...round,
        eventId: created.id,
        // A copy of a Stableford round stored "gross" before the ruling comes
        // out net — `basisFor`. Every other round keeps its basis.
        scoringBasis: basisFor(s.format, s.scoringBasis),
        // Always in the past on a copy.
        deadline: "",
        /**
         * Written in the second pass below, once every round exists and has an
         * id to point at.
         *
         * Empty in between rather than last year's value: a `stage-winners`
         * rule names Stage ids, and copying those verbatim gave the new
         * tournament a final waiting on two rounds in the OLD one — forever,
         * and saying "Waiting on the earlier rounds" the whole time. If this
         * copy is interrupted between the passes, "no pairing rule set" is a
         * state an organizer can see and fix.
         */
        singleMatchRule: "",
      },
    });
    newStageId.set(s.id, copyStage.id);
  }

  // Second pass, now that the map is complete: a rule may name a round that
  // comes after it (a play-off for third against the winner of a plate), so
  // remapping inside the loop above would be right only by luck of ordering.
  for (const s of source.stages) {
    const rule = cloneSingleMatchRule(s.singleMatchRule, (id) => newStageId.get(id) ?? null);
    if (!rule) continue;
    await prisma.stage.update({ where: { id: newStageId.get(s.id)! }, data: { singleMatchRule: rule } });
  }

  // The creator is the organizer of the copy.
  await prisma.account.create({
    data: { eventId: created.id, name: session.name, email: session.email, role: "admin" },
  });

  /**
   * FRESH CODES FOR THE COPY, since it deliberately inherited none.
   *
   * The loop above is right not to carry them: a Round Code is a credential,
   * and last year's code opening this year's rounds is the same fault as
   * reusing a password. But the copy DOES inherit `playerAccess`, so without
   * this it is a tournament with code entry switched on and not one code in
   * it — and because the setting never changes, the old transition guard in
   * `saveTournamentSettings` would never have fired for it either.
   */
  await ensureRoundCodes(created.id);

  await setActiveEvent(created.id);
  await refresh();
  return { ok: true };
}

/**
 * Create a fresh tournament (owned by the current organizer) and switch to it.
 *
 * `templateKey` is a starting point, never a lock — every setting it seeds
 * stays editable on Event setup, and nothing reads the key again afterwards.
 * An explicit template beats the club's house defaults, since picking one is a
 * deliberate act; "custom" and an absent key both leave the house defaults in
 * place.
 */
export async function createEvent(
  name: string,
  templateKey?: string,
  shapeKey?: string,
  orgName?: string,
  /**
   * WHICH ORGANIZATION, when the organizer was asked.
   *
   * Only asked at all when they own more than one — see
   * `organizationsForOrganizer`. Verified inside
   * `organizationForNewEvent` against this person's own owner/admin
   * memberships, never taken on trust: a "use server" export is a public HTTP
   * endpoint, and an id belonging to somebody else's club would otherwise
   * create an event inside it.
   */
  chosenOrganizationId?: string,
  /**
   * "Yes, I know, it is a different one" — the answer to the question below.
   *
   * Only ever set by somebody who has been shown `clubExistsQuestion` and
   * chosen to carry on, which is why the check runs when it is absent and not
   * when it is present.
   */
  confirmedClubName?: boolean,
  /**
   * What kind of outfit is running it — club, community or personal — asked
   * beside "Who's running this?" (2026-09-28). Applied only where the name is,
   * and never so as to hide a members list; see `nameIfStillUnnamed`.
   */
  orgKind?: string,
): Promise<{ ok: boolean; error?: string; clubExists?: string }> {
  const session = await getSession();
  if (!session) throw new Error("Not authenticated");
  const clean = name.trim() || "New Tournament";
  /**
   * THE SHAPE IS ASKED, NEVER ASSUMED.
   *
   * It decides what the rest of setup is even about — a single round has no
   * next round to carry into, a knockout has a bracket where a league has
   * none — so it is asked alongside the name rather than buried in a settings
   * screen later. And then this line read `shapeOf`, which falls back to a
   * series, so it was not asked at all: the event switcher never passed one,
   * and every tournament created from inside the app was silently made a
   * league. The picker on `/choose` preselected the same answer, so the two
   * agreed and neither was a choice anybody made.
   *
   * `shapeOf`'s fallback is right where it is used — reading a STORED value,
   * where an unknown shape must never stop a tournament from opening. It is
   * wrong at creation, which is the one moment there is a person to ask.
   *
   * "match" is refused with the rest: a casual round is created by
   * `createMatch`, which pins five settings a tournament does not want. Coming
   * through here would make one without them.
   */
  if (!shapeKey || !isTournamentShape(shapeKey) || shapeKey === "match") {
    return { ok: false, error: "Choose how it's played first." };
  }
  const shape = shapeKey;
  const template = templateKey ? templateFor(templateKey) : null;
  // `blank`, not "is it the default". Those are the same entry today only by
  // naming coincidence, and inferring what something IS from a comparison
  // against a movable constant is the shape that silently broke the branding
  // nudge for every existing club. See tournament-templates.ts.
  const templated = template && !template.blank ? template : null;
  // Every tournament belongs to a billing tenant; this creates the organizer's
  // organization on their first event, named after their club/society/company
  // when they said who runs it (else after them). An organizer who already owns
  // one keeps it — orgName never renames an existing organization.
  /**
   * IS THIS THE OUTFIT THAT IS ALREADY HERE? Asked BEFORE anything is created,
   * because after it the second tenant exists and only a merge undoes it.
   *
   * Ajay, 2026-09-17: a club with one secretary will never see this. A local
   * league, a society or an outing has three people who each think they are
   * the one setting it up, and the first any of them hears about it is a
   * season later with the roster in two halves.
   *
   * Asked, not enforced — see `org-name-match.ts` for why a refusal here would
   * be wrong — so a "no, mine is a different one" comes straight back with
   * `confirmedClubName` and nothing stands in their way.
   */
  if (!confirmedClubName) {
    const clash = await clubNameClash(session.email, session.name, orgName, chosenOrganizationId);
    if (clash) {
      return {
        ok: false,
        clubExists: clash.name,
        error: clubExistsQuestion({
          name: clash.name,
          label: orgProfile(clash.kind, clash.country, clash.communityNoun).label,
          where: clash.where,
          runBy: clash.runBy,
        }),
      };
    }
  }

  const organizationId = await organizationForNewEvent(
    session.email,
    session.name,
    orgName,
    chosenOrganizationId,
    typeof orgKind === "string" ? orgKind : undefined,
  );
  /**
   * THE CLUB IS NAMED BEFORE ITS FIRST TOURNAMENT EXISTS.
   *
   * Checked here rather than only on the screen, because a `"use server"`
   * export is a public HTTP endpoint and a disabled button stops nobody. It
   * fires once in an organization's life at most — see `orgSetupState` for why
   * an existing club and a standalone organizer are never asked.
   *
   * THE SAME RULE THE CHECKLIST DRAWS, read from the same function. There was
   * briefly a second one, `clubFirstRefusal`, which knew only about the name;
   * two rules deciding one thing is this codebase's most-repeated defect and
   * the checklist would have shown a step as outstanding while the action let
   * it through. `blockedByClubSetup` is the whole answer and carries its own
   * wording, so the screen and the endpoint cannot say different things.
   *
   * After `organizationForNewEvent`, deliberately: that call is what CREATES
   * the organization on a first event, and `orgName` passed from the picker
   * names it on the way through. So somebody who answers "Who's running this?"
   * in the same breath has already satisfied that half by the time it is read,
   * and is not stopped to do a thing they just did.
   */
  const owner = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: {
      name: true,
      kind: true,
      moneyMode: true,
      _count: { select: { roster: true, events: true, courses: true } },
    },
  });
  if (owner) {
    const setup = orgSetupState({
      kind: owner.kind,
      named: organizationWasNamed(owner.name, session.name, session.email),
      hasCourse: owner._count.courses > 0,
      memberCount: owner._count.roster,
      eventCount: owner._count.events,
      moneyAnswered: owner.moneyMode.trim() !== "",
    });
    if (setup.blockedByClubSetup) return { ok: false, error: setup.blockedByClubSetup };
  }

  // Plan limits bite once billing is connected, or from day one for a club
  // created on the published terms — see services/limits.ts.
  const refusal = await refusalFor(organizationId, "activeEvents");
  if (refusal) return { ok: false, error: refusal };
  const event = await prisma.event.create({
    data: {
      organizationId,
      name: clean,
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      /**
       * AN OPEN FIELD, AND THE PLAN'S CAP APPLIED WHEN IT IS READ (2026-10-09).
       *
       * This stored the cap itself — ten, on Par — and a stored number is the
       * organizer's, not the plan's: a club that created its championship on
       * Par and then moved to Eagle imported 120 members and found 10
       * confirmed and 110 on a waiting list, in a tier with no cap at all.
       * Every intake and promotion path already reads through
       * `fieldLimitFor` / `fieldCapFor`, so a Par club's field still holds
       * ten — `a-downgraded-field-holds-its-cap` is that guarantee.
       */
      capacity: 0,
      status: "draft",
      shape,
      /**
       * ONE BRACKET, which is what a club knockout is (2026-09-28, left to my
       * recommendation). The schema's "split" divides the qualifiers into a
       * main draw and a consolation before anybody has played — right for a
       * society's two-tier day, surprising as the default for a club's
       * match-play championship. Changeable on Bracket until it is played.
       */
      bracketMode: "single",
      // Start from the club's house defaults, then own them outright.
      ...(await settingsForNewEvent(organizationId)),
      ...(templated ? templated.settings : {}),
    },
  });
  // A club plays at its own course, so a new tournament starts there and
  // nobody is asked to pick a venue they were never going to change. Societies
  // and community organizations have no home course; they choose per event.
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { defaultCourseId: true },
  });
  const home = org?.defaultCourseId
    ? await prisma.course.findFirst({
        where: { id: org.defaultCourseId, organizationId },
        select: { id: true, name: true, city: true },
      })
    : null;
  if (home) {
    await prisma.eventCourse.create({
      data: { eventId: event.id, courseId: home.id },
    });
    /**
     * AND THE TOURNAMENT'S OWN COURSE, not only a venue — the same three
     * fields `saveEvent` writes when the course is picked on Tournament
     * details. This linked the venue and stopped, so every club tournament
     * began with `Event.courseId` empty: Score entry found the card through
     * its sole venue and every board resolving through `courseRef` found none,
     * showing a Scramble with both cards in as two sides on 0 holes. See
     * `soleVenueCourse`, which answers for tournaments created before this.
     */
    await prisma.event.update({
      where: { id: event.id },
      data: { courseId: home.id, course: home.name, city: home.city },
    });
  }

  /**
   * NOTHING IS CREATED WHEN NOBODY CHOSE A FORMAT.
   *
   * A template names its rounds, and picking one IS choosing them — the blurb
   * says what a member-guest is, and building its five nine-hole matches by
   * hand is the assembly work that keeps clubs on what they know.
   *
   * "Start from scratch" names nothing, and this used to fall through to the
   * SHAPE's opening round: every such tournament arrived holding a Round Robin
   * it had not been asked about. That is a defaulted format and a defaulted
   * stage type, decided by the app, on the one path whose whole promise is
   * "set everything yourself".
   *
   * It is not a harmless placeholder either. A round's type and format decide
   * what is scored and how — `stage-types.ts` records a round robin set to
   * stroke play "generating a full set of pairings for a round in which nobody
   * plays anybody" — so a default here is a scoring decision made on the
   * organizer's behalf and never mentioned again.
   *
   * Zero rounds is an ALREADY-SUPPORTED state, not a new one: the setup
   * checklist has said "No rounds yet — sequence the tournament" since it was
   * written, and Rounds & formats is step two of the guided flow. The
   * organizer now arrives there and picks, which is what that screen is for.
   */
  const plannedRounds = templated?.rounds ?? [];
  if (plannedRounds.length > 0) {
    await prisma.stage.createMany({
      data: plannedRounds.map((r, position) => ({
        eventId: event.id,
        position,
        description: r.description ?? "",
        type: r.type,
        format: r.format,
        holes: r.holes,
        scoringBasis: basisFor(r.format, r.scoringBasis),
        // How the template keeps its matches, where it says (`TemplateRound.kept`).
        ...(r.kept
          ? keptByScoreInput(r.format)
            ? { scoreInput: r.kept === "cards" ? "gross-cards" : "hole-results" }
            : { matchKeptBy: r.kept }
          : {}),
      })),
    });
    // A new event has no flights and the schema's rule — the default for no
    // rounds — so a medal template starts dividing by handicap.
    await followFlightDefault(event.id, "balanced");

    /**
     * AND THE EVENT'S SCORING IS SET FROM THE ROUNDS IT JUST MADE.
     *
     * `Event.format` decides how the leaderboard ranks — it is the only thing
     * `isStroke` reads — and nothing here touched it, so every templated
     * tournament kept the column default, "match". A charity day therefore
     * arrived set to Match play with a medal round in it, and the board
     * rendered its match-points table: P, W, ½, L, PTS, every cell zero, the
     * field in seed order. Exactly the failure `scoring-mismatch.ts` was
     * written about, arriving through the front door of a named template.
     *
     * DERIVED rather than a seventh field on the template, so a template added
     * next year cannot forget it, and so this cannot come to disagree with
     * `scoringMismatch` — which states the same rule and would then be warning
     * about a contradiction the app had created itself.
     *
     * Only where the template names its rounds. "Start from scratch" creates
     * none and is left exactly as it was: a tournament with nothing in it has
     * nothing to derive from, and the setup flow asks.
     */
    const anyHeadToHead = plannedRounds.some((r) => isHeadToHead(r.type));
    await prisma.event.update({
      where: { id: event.id },
      data: { format: anyHeadToHead ? "match" : "stroke" },
    });
  }
  await prisma.account.create({
    data: { eventId: event.id, name: session.name, email: session.email, role: "admin" },
  });
  /**
   * A NEW TOURNAMENT INHERITS THE CLUB'S ACCESS SETTING, so it can be created
   * with code entry already switched on — and then there is no transition for
   * `saveTournamentSettings` to catch and its rounds never get codes at all.
   *
   * Two of the three code-using tournaments in the development database were
   * in exactly that state on 2026-09-14: the feature on, and zero of their
   * rounds reachable by it.
   *
   * Outside the `plannedRounds` block on purpose — "Start from scratch"
   * creates no rounds, and this must still be the call that runs when rounds
   * arrive later, which `addStage` now also makes.
   */
  await ensureRoundCodes(event.id);
  await setActiveEvent(event.id);
  await refresh();
  return { ok: true };
}

/** Delete a tournament (primary Organizer only). Re-anchors the session so the
 *  organizer isn't stranded, then lands on a surviving tournament. */
export async function deleteEvent(eventId: string) {
  const session = await getSession();
  if (!session) throw new Error("Not authenticated");
  // Same rule as switchEvent, but admin-level only: an organization owner or
  // admin holds the same authority over their club's events as an organizer
  // named on the event itself.
  const access = await effectiveAccess(session.email, eventId);
  if (access?.role !== "admin") throw new Error("Only the organizer can delete a tournament");

  await prisma.event.delete({ where: { id: eventId } }); // cascades to all children
  await landAfterDeleting(session);
}

/**
 * Where an organizer goes once the tournament they were in no longer exists —
 * shared by `deleteEvent` and the Free plan's deletion on completion, so both
 * leave them in the same place. Always redirects.
 */
async function landAfterDeleting(session: { email: string; eventId: string }): Promise<never> {
  /**
   * Re-anchor the ACTIVE EVENT, and nothing else.
   *
   * This called `createSession(anchor.id)` with an Account id, and
   * `createSession` takes a USER id — it says so on the line. `Account.id` and
   * `User.id` are independent cuids, so the cookie was signed over an id no
   * User row has: the very next request's `getSession` looked it up, found
   * nothing, and returned null. Deleting one tournament signed the organizer
   * out and dropped them at the sign-in page.
   *
   * The session already holds the right user, so the fix is to stop re-signing
   * it. Only the active event needs to move.
   *
   * The anchor also has to include events reached through the CLUB. Access can
   * come from an Account on the event or from being an owner or admin of the
   * organization that runs it — `effectiveAccess` says so, and this action's
   * own permission check relies on it. A club owner holds no Account rows at
   * all, so the old lookup found nothing and took the `destroySession` branch:
   * deleting one of ten club events signed them out while nine remained.
   */
  const user = await prisma.user.findUnique({
    where: { email: session.email },
    select: { id: true },
  });
  const orgIds = user
    ? (
        await prisma.organizationMember.findMany({
          where: { userId: user.id },
          select: { organizationId: true },
        })
      ).map((m) => m.organizationId)
    : [];

  const reachable = {
    OR: [
      { accounts: { some: { email: session.email } } },
      ...(orgIds.length ? [{ organizationId: { in: orgIds } }] : []),
    ],
  };

  // The one they were looking at, if it survived; otherwise their most recent.
  const anchor =
    (await prisma.event.findFirst({
      where: { AND: [{ id: session.eventId }, reachable] },
      select: { id: true },
    })) ??
    (await prisma.event.findFirst({
      where: reachable,
      orderBy: { createdAt: "desc" },
      select: { id: true },
    }));

  // No tournaments left is not a reason to sign somebody out of their own
  // account — they are still who they were, and the next thing they will do is
  // create one.
  if (!anchor) redirect("/");
  await setActiveEvent(anchor.id);
  redirect("/dashboard");
}

/* ── Lifecycle ────────────────────────────────────────────────────────── */

export async function setEventStatus(
  status: string,
  /** Must be true to complete a tournament the Free plan deletes on completion. */
  confirmDelete = false,
): Promise<{ ok: boolean; error?: string; needsDeleteConfirm?: boolean }> {
  const eventId = await requireAdminEvent();
  // A status is moved, not set: see `statusMove` for the three things that
  // followed from writing whatever arrived, an unknown word read as "draft"
  // among them.
  const current = await prisma.event.findUnique({ where: { id: eventId }, select: { status: true, closesAt: true } });
  if (!current) return { ok: false, error: "That tournament no longer exists." };
  const move = statusMove(current.status, status);
  if (move.kind === "refuse") return { ok: false, error: move.error };
  if (move.kind === "launch") return launchTournament();
  const s = status;
  /**
   * A COMPLETED PAR TOURNAMENT IS READ-ONLY (Ajay, 2026-10-21): it stays open to view for fifteen
   * days and is then deleted. Reopening it would be a way round the fifteen days, so it is refused
   * — upgrading lifts it, because `wipesOnClose` no longer holds for a paid plan.
   */
  if (current.status === "completed" && s !== "completed" && (await wipesOnCloseFor(eventId))) {
    // An instant, worded as the day it is at the club (`dayAtClubForEvent`).
    const words = current.closesAt ? (await dayAtClubForEvent(eventId))(current.closesAt) : null;
    const refusal = reopenRefusal({ planTermsApply: true, plan: "free", shape: "stroke" }, words);
    if (refusal) return { ok: false, error: refusal };
  }
  /**
   * FINISHING IS A STATEMENT, not a tidy-up.
   *
   * It publishes the standings as final and, on a free plan, starts the clock
   * the retention window runs on. Doing it with cards still waiting to be
   * signed off declares a winner from scores nobody has agreed.
   *
   * Only in the completing direction: re-opening a finished tournament is how
   * a club fixes exactly this, and a gate on the way back would be the app
   * refusing the remedy it just asked for.
   */
  if (s === "completed") {
    const state = await loadEventState(eventId);
    const refusal = state
      ? finishRefusal({
          pendingConfirmations: state.pendingConfirmations,
          disputed: state.reviewing.disputed,
        })
      : null;
    if (refusal) return { ok: false, error: refusal };

    /**
     * ON THE FREE PLAN, COMPLETING IS DELETING (Ajay, 2026-09-29) — for a club
     * held to the published terms; `wipesOnClose` says exactly which.
     *
     * Never without `confirmDelete`. The button asks first, with the download
     * in front of the organizer, but this is a `"use server"` export and so a
     * public endpoint: a caller that did not ask is refused with the question
     * rather than trusted to have asked it. Checked after `finishRefusal`, so a
     * tournament with cards still disputed is never deleted as "finished".
     */
    /**
     * …AND SINCE 2026-10-21 COMPLETING KEEPS IT, READ-ONLY, FOR FIFTEEN DAYS (Ajay: "keep it for 15
     * days"). Deleting it on the spot took the link the members had just been sent, and the
     * settle-up, at prize-giving. Completing now stamps `closesAt` fifteen days on
     * (`closesAtOnComplete`), and the daily sweep (`sweepClosedPar`) deletes it then. Still asked
     * first: the organizer is told when it goes.
     */
    if (await wipesOnCloseFor(eventId)) {
      if (!confirmDelete) return { ok: false, needsDeleteConfirm: true, error: WIPE_ON_CLOSE };
      await prisma.event.update({
        where: { id: eventId },
        data: { closesAt: closesAtOnComplete(current.closesAt) },
      });
    }
  }
  // Stamp the completion time, because on a free plan it starts the clock the
  // retention window runs on. Reopening a tournament clears it: a club that
  // un-completes an event has said the result isn't final, and the countdown
  // to deleting it should not keep running underneath them.
  const now = new Date();
  await prisma.event.update({
    where: { id: eventId },
    data: { status: s, completedAt: s === "completed" ? now : null },
  });
  /**
   * AND THE CONSOLE STAYS ON IT (2026-10-10). With no active-event cookie — a
   * fresh device, a new browser — the console shows the organizer's tournament
   * being played NOW (`landingEvent`). Completing it stops it being that, so
   * the very next screen silently became a different live tournament of the
   * club's: walked as a secretary who pressed Complete and then read another
   * event's leaderboard, at the moment the prizes were to be awarded from this
   * one. Pinned here, by the act that would otherwise move them.
   */
  await setActiveEvent(eventId);
  /**
   * COMPLETING CLOSES EVERY ROUND STILL OPEN — Ajay's call, 2026-09-26.
   *
   * A round is over when the organizer says so (#577), and marking the
   * tournament Completed is the organizer saying so about all of them. Without
   * this the seeded Club Championship was Completed with round 2 still open,
   * so the players cut after round 1 were still ranked among the finishers —
   * one on +14 over 18 holes above two who played all 36 — because
   * `missedAClosedRound` only unranks a player for a round somebody closed.
   *
   * Only rounds still open are stamped, so a round the committee closed
   * earlier keeps its own time. REOPENING does not undo it: closing blocks no
   * card (a late one still counts the moment it is entered), and each round
   * can be re-opened on Rounds & formats, which is where a committee
   * correcting one round goes anyway.
   */
  if (s === "completed") {
    // Every round, not only the open ones: a round is NAMED by where it sits in
    // the whole tournament (`roundLabel`), which a subset cannot answer.
    const all = await prisma.stage.findMany({
      where: { eventId },
      orderBy: { position: "asc" },
      select: { id: true, type: true, description: true, position: true, closedAt: true },
    });
    const open = all.filter((st) => st.closedAt === null && isPlayingRound(st.type));
    if (open.length > 0) {
      await prisma.stage.updateMany({
        where: { id: { in: open.map((st) => st.id) } },
        data: { closedAt: now },
      });
      await logAudit(
        eventId,
        "round-closed",
        `Completing the tournament closed ${open
          .map((st) => st.description || roundLabel(all, st.id))
          .join(", ")}. Anybody without a card for a closed round no longer holds a place on a stroke board.`,
      );
    }
  }
  await refresh();
  return { ok: true };
}

export async function launchTournament(): Promise<{ ok: boolean; error?: string }> {
  const eventId = await requireAdminEvent();
  /**
   * NOTHING USED TO STOP THIS, and launching is not a small act: it publishes
   * the tournament to its field and clears `configUnlocked`, so a tournament
   * with no rounds and nobody in it went live AND locked. The organizer's next
   * move was to unlock the thing they had just locked, in order to build the
   * tournament they had just published.
   *
   * The two conditions are in `launchRefusal` with the reasoning. Guided
   * inside setting up, gated between phases — see phase-gate.ts.
   */
  const [stages, confirmed, event] = await Promise.all([
    prisma.stage.findMany({ where: { eventId }, select: { id: true, type: true, format: true, position: true } }),
    prisma.player.count({ where: { eventId, status: "confirmed" } }),
    prisma.event.findUnique({ where: { id: eventId }, select: { dates: true } }),
  ]);
  const playingRounds = stages.filter((s) => isPlayingRound(s.type)).length;
  const refusal = launchRefusal({
    playingRounds,
    confirmed,
    dated: !!event?.dates.trim(),
    missingCards: await roundsMissingCards(eventId),
    unscorable: unscorableRoundLabels(stages),
  });
  if (refusal) return { ok: false, error: refusal };

  // On launch, every non-staff account receives the Player role. Once registration
  // collects player emails (Phase 4), this also provisions their logins.
  await prisma.account.updateMany({
    where: { eventId, role: { notIn: ["admin", "assistant"] } },
    data: { role: "player" },
  });
  await prisma.event.update({
    where: { id: eventId },
    data: { status: "live", launchedAt: new Date(), configUnlocked: false },
  });
  await refresh();
  return { ok: true };
}

export async function setConfigUnlocked(unlocked: boolean) {
  const eventId = await requireAdminEvent();
  await prisma.event.update({ where: { id: eventId }, data: { configUnlocked: unlocked } });
  await refresh();
}

/* ── Prizes & payouts ─────────────────────────────────────────────────── */

/**
 * THE PURSE IS MONEY, SO IT LEAVES A TRAIL.
 *
 * These four wrote `Prize` — what a club is putting up and who takes it — with
 * nothing recording who changed it, while every other money action in the app
 * audits. `setPrizeWinner` is the sharp end: it awards a named person a sum,
 * and "who decided that" had no answer anywhere.
 *
 * Found by sweeping every server action that writes a money row for the audit
 * line beside it, 2026-09-13. Same sweep, same day, as the whole of skins.ts.
 */
export async function addPrize(category: string, amount: number, detail = ""): Promise<{ ok: boolean; error?: string }> {
  const eventId = await requireStaffEvent();
  // REFUSED IN WORDS (the text-box crawl, 2026-10-21): a blank name returned
  // nothing, and the screen pressing Add said nothing; an impossible amount
  // was stored as no prize. See `prize-amount.ts`.
  const clean = String(category ?? "").trim();
  if (!clean) return { ok: false, error: PRIZE_CATEGORY_BLANK };
  if (clean.length > PRIZE_CATEGORY_MAX) return { ok: false, error: `Keep the prize's name to ${PRIZE_CATEGORY_MAX} characters.` };
  const cleanDetail = String(detail ?? "").trim();
  if (cleanDetail.length > PRIZE_DETAIL_MAX) return { ok: false, error: `Keep the detail to ${PRIZE_DETAIL_MAX} characters.` };
  const sum = typeof amount === "number" ? amount : Number.NaN;
  const badAmount = prizeAmountRefusal(sum);
  if (badAmount) return { ok: false, error: badAmount };
  const agg = await prisma.prize.aggregate({ where: { eventId }, _max: { position: true } });
  await prisma.prize.create({
    data: {
      eventId,
      category: clean,
      detail: cleanDetail,
      amount: sum,
      position: (agg._max.position ?? 0) + 1,
      // A line typed by hand counts toward one prize per player unless its
      // name says it is a skill prize — switchable on the row.
      countsForOnePrize: !looksLikeSkillPrize(clean),
    },
  });
  await logAudit(eventId, "prize.add", `${clean}${sum > 0 ? ` — ${sum}` : ""}`);
  await refresh();
  return { ok: true };
}

export async function updatePrize(
  prizeId: string,
  data: { category?: string; detail?: string; amount?: number },
): Promise<{ ok: boolean; error?: string }> {
  const eventId = await requireStaffEvent();
  const patch: { category?: string; detail?: string; amount?: number } = {};
  if (data.category !== undefined) {
    const category = String(data.category).trim();
    if (!category) return { ok: false, error: PRIZE_CATEGORY_BLANK };
    if (category.length > PRIZE_CATEGORY_MAX) return { ok: false, error: `Keep the prize's name to ${PRIZE_CATEGORY_MAX} characters.` };
    patch.category = category;
  }
  if (data.detail !== undefined) {
    const detail = String(data.detail).trim();
    if (detail.length > PRIZE_DETAIL_MAX) return { ok: false, error: `Keep the detail to ${PRIZE_DETAIL_MAX} characters.` };
    patch.detail = detail;
  }
  if (data.amount !== undefined) {
    // An impossible amount is REFUSED and the prize keeps what it had. This
    // used to store it as no prize — "-5" made the purse smaller without a word.
    const sum = typeof data.amount === "number" ? data.amount : Number.NaN;
    const badAmount = prizeAmountRefusal(sum);
    if (badAmount) return { ok: false, error: badAmount };
    patch.amount = sum;
  }
  const moved = await prisma.prize.updateMany({ where: { id: prizeId, eventId }, data: patch });
  // Only what happened is on the record: a prize that is not this
  // tournament's changes nothing, and used to be logged as edited all the same
  // (the class of `disputeMatch`, 2026-10-11).
  if (moved.count === 0) return { ok: false, error: "That prize isn't in this tournament." };
  // What actually changed, rather than "a prize was edited" — the amount is
  // the half somebody would come back and ask about.
  await logAudit(
    eventId,
    "prize.update",
    Object.entries(patch).map(([k, v]) => `${k}: ${v}`).join(", ") || "no change",
  );
  await refresh();
  return { ok: true };
}

export async function setPrizeWinner(
  prizeId: string,
  winnerId: string,
): Promise<{ ok: boolean; error?: string; choose?: boolean }> {
  const eventId = await requireStaffEvent();
  /**
   * A PRIZE GOES TO SOMEBODY IN THE FIELD, AND THE RECORD NAMES THEM
   * (2026-10-11).
   *
   * The same door as `setBracketWinner`, one room along: any id was stored as
   * the winner, the audit line was written whether or not a prize of this
   * tournament was touched, and it named the winner by row id — "Awarded to
   * player cmx…", in a log whose whole job is to be read by a committee.
   */
  const id = typeof winnerId === "string" ? winnerId : "";
  const awardedTo = id
    ? await prisma.player.findFirst({ where: { id, eventId }, select: { name: true } })
    : null;
  if (id && !awardedTo) return { ok: false, error: "A prize goes to somebody in this tournament's field." };
  /**
   * ONE PRIZE PER PLAYER IS KEPT HERE, where the award is saved — not only in
   * the picker, which is a guard a later screen could forget to draw
   * (2026-10-21). Read and written under a lock on the tournament's row, so two
   * awards pressed at once on two phones cannot both see the player holding
   * nothing. `choose` tells the screen the remedy is another name, not a reload.
   */
  const outcome = await prisma.$transaction(async (tx) => {
    await lockEventForPrizes(tx, eventId);
    const event = await tx.event.findUnique({ where: { id: eventId }, select: { onePrizePerPlayer: true } });
    const holdings = await prizeHoldings(tx, eventId);
    if (!holdings.some((p) => p.id === prizeId)) return { ok: false, error: "That prize isn't in this tournament." };
    const refusal = onePrizeRefusal({
      on: !!event?.onePrizePerPlayer,
      prizes: holdings,
      prizeId,
      playerId: id,
      playerName: awardedTo?.name ?? "",
    });
    if (refusal) return { ok: false, error: refusal, choose: true };
    await tx.prize.updateMany({ where: { id: prizeId, eventId }, data: { winnerId: id || null } });
    return { ok: true };
  });
  if (!outcome.ok) return outcome;
  await logAudit(eventId, "prize.winner", awardedTo ? `Awarded to ${awardedTo.name}` : "Winner cleared");
  await refresh();
  return { ok: true };
}

type PrizeTx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** Every award on the tournament's prize list, as the rule reads it. */
async function prizeHoldings(tx: PrizeTx, eventId: string): Promise<PrizeHolding[]> {
  const rows = await tx.prize.findMany({
    where: { eventId },
    orderBy: { position: "asc" },
    select: { id: true, category: true, winnerId: true, countsForOnePrize: true },
  });
  return rows.map((r) => ({ id: r.id, category: r.category, winnerId: r.winnerId, counts: r.countsForOnePrize }));
}

/** One writer at a time on a tournament's awards and its one-prize rule. */
async function lockEventForPrizes(tx: PrizeTx, eventId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM "Event" WHERE id = ${eventId} FOR UPDATE`;
}

/** Players' names for a refusal that names them. */
async function prizeWinnerNames(eventId: string, ids: string[]): Promise<Map<string, string>> {
  const rows = await prisma.player.findMany({ where: { eventId, id: { in: ids } }, select: { id: true, name: true } });
  return new Map(rows.map((r) => [r.id, r.name]));
}

/**
 * The tick-box "One prize per player", on Prizes.
 *
 * TICKING IT WHILE SOMEBODY HOLDS TWO COUNTING PRIZES IS REFUSED, naming who and
 * what. Ticking it anyway and listing the clash would leave the tournament in a
 * state its own rule says cannot exist — the report would name one player for
 * two placings under a line saying one prize per player — and nothing would say
 * which of the two awards the rule meant to undo. That is the committee's
 * choice, so the tick waits for them to clear one; nothing changes silently.
 * Unticking is never refused.
 */
export async function setOnePrizePerPlayer(on: boolean): Promise<{ ok: boolean; error?: string }> {
  const eventId = await requireStaffEvent();
  const want = on === true;
  const outcome = await prisma.$transaction(async (tx) => {
    await lockEventForPrizes(tx, eventId);
    if (want) {
      const holdings = await prizeHoldings(tx, eventId);
      const names = await prizeWinnerNames(eventId, holdings.flatMap((p) => (p.winnerId ? [p.winnerId] : [])));
      const refusal = onePrizeTickRefusal(holdings, (pid) => names.get(pid) ?? "");
      if (refusal) return { ok: false, error: refusal };
    }
    await tx.event.update({ where: { id: eventId }, data: { onePrizePerPlayer: want } });
    return { ok: true };
  });
  if (!outcome.ok) return outcome;
  await logAudit(eventId, "prize.rule", want ? "One prize per player: on" : "One prize per player: off");
  await refresh();
  return { ok: true };
}

/**
 * Whether one line counts toward one prize per player — the switch on its row.
 *
 * Switching a line ON is refused where it would give its winner a second
 * counting prize, for the reason the tick above is: the rule must never be
 * found already broken.
 */
export async function setPrizeCounts(prizeId: string, counts: boolean): Promise<{ ok: boolean; error?: string }> {
  const eventId = await requireStaffEvent();
  const want = counts === true;
  const outcome = await prisma.$transaction(async (tx) => {
    await lockEventForPrizes(tx, eventId);
    const event = await tx.event.findUnique({ where: { id: eventId }, select: { onePrizePerPlayer: true } });
    const holdings = await prizeHoldings(tx, eventId);
    const prize = holdings.find((p) => p.id === prizeId);
    if (!prize) return { ok: false, error: "That prize isn't in this tournament." };
    if (want && event?.onePrizePerPlayer && prize.winnerId) {
      const names = await prizeWinnerNames(eventId, [prize.winnerId]);
      const refusal = onePrizeRefusal({
        on: true,
        prizes: holdings.map((p) => (p.id === prizeId ? { ...p, counts: true } : p)),
        prizeId,
        playerId: prize.winnerId,
        playerName: names.get(prize.winnerId) ?? "",
      });
      if (refusal) {
        const held = holdings.find((p) => p.id !== prizeId && p.counts && p.winnerId === prize.winnerId);
        return {
          ok: false,
          error: `${names.get(prize.winnerId) ?? "Its winner"} already has ${held?.category ?? "a prize that counts"}, so ${prize.category} can't count as well. Clear one of the two awards first.`,
        };
      }
    }
    await tx.prize.updateMany({ where: { id: prizeId, eventId }, data: { countsForOnePrize: want } });
    return { ok: true, category: prize.category };
  });
  if (!outcome.ok) return { ok: false, error: outcome.error };
  await logAudit(eventId, "prize.counts", `${"category" in outcome ? outcome.category : "A prize"}: ${want ? "counts" : "does not count"} toward one prize per player`);
  await refresh();
  return { ok: true };
}

export async function removePrize(prizeId: string) {
  const eventId = await requireStaffEvent();
  // Read before it goes, or the line says nothing but an id nobody can look up.
  const gone = await prisma.prize.findFirst({
    where: { id: prizeId, eventId },
    select: { category: true, amount: true },
  });
  // Nothing of this tournament's by that id: nothing is removed, and nothing
  // is written. It used to log "Removed a prize" for a prize it never had.
  if (!gone) return;
  await prisma.prize.deleteMany({ where: { id: prizeId, eventId } });
  await logAudit(eventId, "prize.remove", `Removed ${gone.category}${gone.amount > 0 ? ` — ${gone.amount}` : ""}`);
  await refresh();
}

/**
 * Apply a named prize STRUCTURE — several editable lines in one action, so a
 * committee stops retyping the same list every medal.
 *
 * The lines come from `prizeStructureLines`, the one resolver a preview would
 * read too, so what the button offers and what it adds cannot drift. It adds
 * rows and nothing else: amounts stay at zero for the club to set, no winner is
 * named, and no skins/sweep/settle-up maths is touched — hard rule 7 holds
 * because this is data entry, not money. Audited like every other write to the
 * purse (`addPrize` and friends above), and a flight structure reads the
 * event's actual flights so it scales with the draw rather than assuming three.
 */
export async function applyPrizeStructure(key: string): Promise<{ ok: boolean; error?: string }> {
  const eventId = await requireStaffEvent();
  // An unknown structure is refused by name, not treated as one with no lines.
  if (!prizeStructure(key)) return { ok: false, error: "That isn't one of the prize structures." };
  // Real flights only — a carrier is a structural row, not a division a prize
  // is won in, so `isCarrier: false` exactly as every other flight read does.
  const flights = await prisma.group.findMany({
    where: { eventId, isCarrier: false },
    orderBy: { position: "asc" },
    select: { name: true },
  });
  // Named as every board names the flight — "Flight A — Winner", not the bare
  // stored "A — Winner" — so the Prizes picker can match the prize to its
  // flight and a member reading the prize list recognises their flight.
  const lines = prizeStructureLines(key, { flights: flights.map((f, i) => flightLabel(f.name, i)) });
  // A flight structure on a field with no flights adds nothing — AND SAYS SO.
  // It returned in silence: the button was pressed and nothing appeared, which
  // a secretary cannot tell from the app being broken (2026-10-10).
  if (lines.length === 0) {
    return {
      ok: false,
      error: "This field isn't drawn into flights yet, so there are no flight winners to add. Draw the flights on Flights & groups first.",
    };
  }

  const agg = await prisma.prize.aggregate({ where: { eventId }, _max: { position: true } });
  let position = agg._max.position ?? 0;
  await prisma.prize.createMany({
    data: lines.map((line) => ({
      eventId,
      category: line.category.trim(),
      detail: (line.detail ?? "").trim(),
      amount: 0,
      position: (position += 1),
      countsForOnePrize: line.counts,
    })),
  });
  await logAudit(eventId, "prize.structure", `${key} — added ${lines.length} line${lines.length === 1 ? "" : "s"}`);
  await refresh();
  return { ok: true };
}

/* ── Announcements (player communications) ────────────────────────────── */

export async function addAnnouncement(title: string, body: string, pinned = false) {
  const eventId = await requireStaffEvent();
  const clean = title.trim();
  if (!clean) return;
  await prisma.announcement.create({
    data: { eventId, title: clean, body: body.trim(), pinned },
  });
  await refresh();
}

export async function toggleAnnouncementPin(announcementId: string, pinned: boolean) {
  const eventId = await requireStaffEvent();
  await prisma.announcement.updateMany({ where: { id: announcementId, eventId }, data: { pinned } });
  await refresh();
}

export async function removeAnnouncement(announcementId: string) {
  const eventId = await requireStaffEvent();
  await prisma.announcement.deleteMany({ where: { id: announcementId, eventId } });
  await refresh();
}

/**
 * Choose how the knockout is arranged.
 *
 * Organizer-only and blocked once the tournament is locked: changing the shape
 * of a bracket mid-event would redraw who plays whom, which is a rule change
 * rather than a setting.
 */
export async function setBracketMode(mode: string): Promise<{ ok: boolean; error?: string }> {
  const eventId = await requireAdminEvent();
  await assertUnlocked(eventId);
  if (!isBracketMode(mode)) return { ok: false, error: "Unknown bracket arrangement." };
  /**
   * INTO OR OUT OF FLIGHTS, ONLY BEFORE A RESULT (2026-10-12).
   *
   * Between the three older arrangements a change with results on the board has
   * always been allowed, and a result that no longer fits its tie is simply not
   * shown (`claimedWinner`). A knockout in flights keeps its results under one
   * key word per flight, so the same change would leave a flight's results
   * sitting under ties of a different draw altogether. So that one change waits
   * until the results are cleared — and takes the stored draw with it either
   * way: a division into flights means nothing to one bracket, and a flat
   * list means nothing to flights.
   */
  const current = await prisma.event.findUnique({ where: { id: eventId }, select: { bracketMode: true } });
  if (current && current.bracketMode !== mode && (mode === "flights" || current.bracketMode === "flights")) {
    if ((await prisma.bracketWinner.count({ where: { eventId } })) > 0) {
      return { ok: false, error: "This knockout has results. Clear them before changing how the field is divided." };
    }
    await prisma.event.update({ where: { id: eventId }, data: { bracketMode: mode, bracketDraw: "" } });
    await logAudit(eventId, "knockout.arrangement", `Knockout arrangement set to ${mode}`);
    await refresh();
    return { ok: true };
  }
  await prisma.event.update({ where: { id: eventId }, data: { bracketMode: mode } });
  await refresh();
  return { ok: true };
}

/* ── A knockout in several flights ────────────────────────────────────── */

/**
 * WHAT EVERY ONE OF THE FLIGHT ACTIONS ASKS NEXT, in one place — after its own
 * first line has asked for the primary organizer: a tournament that is not
 * finished, the arrangement set to flights, and no result yet recorded in any
 * flight. The last is the Rules' own line — the draw is fixed once play in it
 * has begun (Committee Procedures 5F(1)) — and it is asked HERE rather than by
 * each action, which is how one of five would come to forget it.
 *
 * NOT THE SETUP LOCK, and deliberately. Launching locks a tournament's SETUP,
 * and the arrangement — one bracket or several flights — is setup, so
 * `setBracketMode` is locked with it. Dividing the field is not setup: it is
 * the DRAW, and a draw is made when the field is known. For the club
 * championship this is built for, that is after a qualifying round — which is
 * played after launch, always. The first cut of this asked for an unlocked
 * tournament, so the one act a qualifying knockout can only do after launch
 * was the one launch forbade; the organizer's next move would have been to
 * unlock the thing they had just locked (see `launchTournament`). One bracket
 * needs no such act and never had the lock either: its draw makes itself.
 */
async function flightsOpenForChange(eventId: string): Promise<
  | { ok: true; eventId: string; state: NonNullable<Awaited<ReturnType<typeof loadEventState>>>; stored: string }
  | { ok: false; error: string }
> {
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { bracketMode: true, bracketDraw: true, status: true } });
  if (!event || event.bracketMode !== "flights") {
    return { ok: false, error: "This knockout is not arranged in flights. Choose \"Several flights\" first." };
  }
  if (isFinished(event.status)) {
    return { ok: false, error: "This tournament is completed, so its flights are as they finished. Reopen it to change them." };
  }
  if ((await prisma.bracketWinner.count({ where: { eventId } })) > 0) {
    return { ok: false, error: "This knockout has results, so its flights are fixed. Clear the results to change them." };
  }
  const state = await loadEventState(eventId);
  if (!state) return { ok: false, error: "This tournament could not be read." };
  return { ok: true, eventId, state, stored: event.bracketDraw };
}

/** The field as the dividing rules see it: who, their handicap if they have one, and the flight they are already in. */
function flightEntrants(state: NonNullable<Awaited<ReturnType<typeof loadEventState>>>): FlightEntrant[] {
  const flightNames = new Map(state.groups.map((g, i) => [g.id, flightLabel(g.name, i)]));
  const rows = new Map(state.players.map((p) => [p.id, p]));
  // A draw fed by a qualifying round is already in qualifying order; a straight knockout has no such order.
  const qualified = !isStraightKnockout(state.stages);
  return state.qualifiers.map((q, i) => {
    const row = rows.get(q.id);
    return {
      id: q.id,
      name: q.name,
      handicapIndex: !row || row.handicapSource === "none" ? null : row.handicap,
      flight: row?.groupId ? (flightNames.get(row.groupId) ?? null) : null,
      qualifyingRank: qualified ? i + 1 : null,
    };
  });
}

async function keepFlights(eventId: string, result: FlightPlanResult, said: (plan: FlightPlan) => string): Promise<{ ok: boolean; error?: string }> {
  if (!result.ok) return { ok: false, error: result.error };
  await prisma.event.update({ where: { id: eventId }, data: { bracketDraw: serializeFlightPlan(result.plan) } });
  await logAudit(eventId, "knockout.flights", said(result.plan));
  await refresh();
  return { ok: true };
}

const shapeOf = (plan: FlightPlan) => plan.brackets.map((b) => `${b.name} ${b.playerIds.length}`).join(", ");

/**
 * Divide the field into flights by one of the offered criteria, in the shape
 * chosen: how many players each flight holds, top flight first. `counts` is
 * ignored for "flights", where the tournament's own flights are the shape.
 *
 * A draw at random is drawn afresh each time it is asked for, on a seed made
 * here: what the organizer is shown afterwards is the stored result, which
 * does not change until they ask again.
 */
export async function divideIntoFlights(criterion: unknown, counts: unknown): Promise<{ ok: boolean; error?: string }> {
  const eventId = await requireAdminEvent();
  const open = await flightsOpenForChange(eventId);
  if (!open.ok) return open;
  if (typeof criterion !== "string" || !isFlightCriterion(criterion)) return { ok: false, error: "Choose how to divide the field." };
  const sizes = Array.isArray(counts) ? counts.filter((c): c is number => typeof c === "number" && Number.isInteger(c)) : [];
  if (Array.isArray(counts) && sizes.length !== counts.length) return { ok: false, error: "Say how many players each bracket holds." };
  if (sizes.length > 64) return { ok: false, error: "That is more brackets than a field can be divided into." };
  const result = planFlights(flightEntrants(open.state), criterion, sizes, randomUUID());
  return keepFlights(open.eventId, result, (plan) => `Field divided into ${plan.brackets.length} flights (${criterion}): ${shapeOf(plan)}`);
}

/** Undo the division: the field is one undivided field again, and the ways to divide it are offered afresh. */
export async function clearFlights(): Promise<{ ok: boolean; error?: string }> {
  const eventId = await requireAdminEvent();
  const open = await flightsOpenForChange(eventId);
  if (!open.ok) return open;
  await prisma.event.update({ where: { id: open.eventId }, data: { bracketDraw: "" } });
  await logAudit(open.eventId, "knockout.flights", "Flights cleared: the field is undivided");
  await refresh();
  return { ok: true };
}

/**
 * Move one player to another flight, or put a late entrant into one.
 *
 * The player is named by id and the flight by its place in the list, and both
 * are checked against THIS tournament: the plan (for a move) or its own field
 * (for somebody not yet in a flight). A player id from anywhere else matches
 * neither and is refused.
 */
export async function moveFlightPlayer(playerId: unknown, toFlight: unknown): Promise<{ ok: boolean; error?: string }> {
  const eventId = await requireAdminEvent();
  const open = await flightsOpenForChange(eventId);
  if (!open.ok) return open;
  const plan = parseFlightPlan(open.stored);
  if (!plan) return { ok: false, error: "Divide the field into flights first." };
  if (typeof playerId !== "string" || typeof toFlight !== "number" || !Number.isInteger(toFlight)) {
    return { ok: false, error: "Choose a player and the flight to move them to." };
  }
  const inPlan = plan.brackets.some((b) => b.playerIds.includes(playerId));
  const person = open.state.qualifiers.find((p) => p.id === playerId);
  if (!inPlan && !person) return { ok: false, error: "That player is not in this tournament's field." };
  const result = inPlan ? planWithPlayerMoved(plan, playerId, toFlight) : planWithPlayerAdded(plan, playerId, toFlight);
  const name = person?.name ?? open.state.players.find((p) => p.id === playerId)?.name ?? "A player";
  return keepFlights(open.eventId, result, (next) => `${name} ${inPlan ? "moved to" : "added to"} ${next.brackets[toFlight]?.name ?? "a flight"}`);
}

/** Set a flight's seeding by hand: the same players, in the order given. */
export async function reseedFlight(flight: unknown, order: unknown): Promise<{ ok: boolean; error?: string }> {
  const eventId = await requireAdminEvent();
  const open = await flightsOpenForChange(eventId);
  if (!open.ok) return open;
  const plan = parseFlightPlan(open.stored);
  if (!plan) return { ok: false, error: "Divide the field into flights first." };
  if (typeof flight !== "number" || !Number.isInteger(flight) || !Array.isArray(order) || order.some((id) => typeof id !== "string")) {
    return { ok: false, error: "A seeding has to list the same players, each once." };
  }
  return keepFlights(open.eventId, planReseeded(plan, flight, order as string[]), (next) => `${next.brackets[flight]?.name ?? "A flight"} reseeded by hand`);
}

/** Give a flight the club's own name for it. */
export async function renameFlight(flight: unknown, name: unknown): Promise<{ ok: boolean; error?: string }> {
  const eventId = await requireAdminEvent();
  const open = await flightsOpenForChange(eventId);
  if (!open.ok) return open;
  const plan = parseFlightPlan(open.stored);
  if (!plan) return { ok: false, error: "Divide the field into flights first." };
  if (typeof flight !== "number" || !Number.isInteger(flight) || typeof name !== "string") return { ok: false, error: "Give the bracket a name." };
  const was = plan.brackets[flight]?.name ?? "A flight";
  return keepFlights(open.eventId, planRenamed(plan, flight, name.slice(0, 40)), (next) => `${was} renamed ${next.brackets[flight]?.name ?? ""}`);
}

/* ── Manual flights: naming and sign-off ──────────────────────────────── */

/**
 * Rename a flight.
 *
 * `Group.name` has existed since the beginning and the screen ignored it,
 * rendering "Flight 1", "Flight 2" from the index. Clubs don't call them that:
 * they run an A Flight and a B Flight, or Championship and Handicap, or name
 * them after the four courses a society is playing.
 */
export async function renameGroup(groupId: string, name: string): Promise<{ ok: boolean; error?: string }> {
  const eventId = await requireStaffEvent();
  const locked = await lockedRefusal(eventId, "change the flights");
  if (locked) return { ok: false, error: locked };
  const clean = name.trim().slice(0, 40);
  if (!clean) return { ok: false, error: "Give the flight a name." };

  // A flight, not a match carrier — see `Group.stageId`. Renaming a carrier
  // from a flights control is meaningless now that no screen offers one, and
  // the name was load-bearing until this release.
  const group = await prisma.group.findFirst({
    where: { id: groupId, eventId, isCarrier: false },
    select: { id: true },
  });
  if (!group) return { ok: false, error: "Flight not found in this tournament." };

  await prisma.group.update({ where: { id: groupId }, data: { name: clean } });
  await refresh();
  return { ok: true };
}

/**
 * Sign off — or reopen — a hand-built draw.
 *
 * Only meaningful for the manual rule. The computed rules derive the whole
 * allocation from a policy and are regenerated on demand, so there is nothing
 * to confirm; a manual draw is finished work, and this is the point where it
 * stops being one stray drag away from changing.
 *
 * Reopening is deliberately just as easy. A lock an organizer cannot undo is a
 * lock they will route around by regenerating, which loses the draw entirely.
 */
export async function setFlightsConfirmed(confirmed: boolean): Promise<{ ok: boolean; error?: string }> {
  const eventId = await requireStaffEvent();
  const locked = await lockedRefusal(eventId, "change the flights");
  if (locked) return { ok: false, error: locked };
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { formationRule: true } });
  if (event?.formationRule !== "manual") {
    return { ok: false, error: "Only a manual draw is confirmed by hand — the other rules regenerate." };
  }
  await prisma.event.update({ where: { id: eventId }, data: { flightsConfirmed: confirmed } });
  await refresh();
  return { ok: true };
}


/**
 * How an all-square match is decided.
 *
 * Stored as an ordered list rather than a single choice, because the countback
 * IS a sequence — last nine, then last six, then last three, then the last
 * hole — and a committee that has to justify a result will be quoting the
 * whole ladder, not one rung of it.
 */
export async function setMatchTiebreakers(keys: string[]): Promise<{ ok: boolean; error?: string }> {
  const eventId = await requireStaffEvent();
  await assertUnlocked(eventId);
  // Cleaned rather than trusted: this is a public endpoint, and an unknown key
  // reaching the engine would silently skip instead of failing loudly.
  const clean = cleanMatchTiebreakers(keys).filter((k) => OFFERED_MATCH_TIEBREAKS.includes(k));
  await prisma.event.update({
    where: { id: eventId },
    data: { matchTiebreakers: JSON.stringify(clean) },
  });
  await refresh();
  return { ok: true };
}

/**
 * Close registration early, or keep it open past the deadline.
 *
 * `null` hands control back to the deadline. `true` closes now. `false` keeps
 * entries open after the date has passed — the common case, because a deadline
 * gets extended by a word at the bar long before anyone edits it in software.
 *
 * Note what this deliberately does NOT do: stop an organizer adding a player.
 * `addSignup` is staff-only and stays available whatever this says. Closing
 * registration is a statement about what members may do, and the organizer
 * adding a late entry by hand is the normal way a closed event still takes one.
 * When a self-service signup flow exists, it is this flag it should read.
 */
export async function setRegistrationOverride(
  override: boolean | null,
): Promise<{ ok: boolean; error?: string }> {
  // Deliberately no assertUnlocked, and the same reasoning as saveCustomCourse:
  // the lock exists to stop a live tournament being RESHAPED, and this changes
  // nothing about the field, the draw or the schedule — it decides whether the
  // door is open. Requiring it locked the organizer out of the one control that
  // stops entries at exactly the moment they need it: assertUnlocked throws for
  // status live|completed, so a running tournament kept taking public entries
  // and the only escape was unlocking the whole configuration of a live event.
  const eventId = await requireStaffEvent();
  await prisma.event.update({
    where: { id: eventId },
    data: { registrationOverride: override },
  });
  await refresh();
  return { ok: true };
}

/* ── Open (self-service) registration ─────────────────────────────────────
 *
 * The switch, the mode, and the two actions that clear a pending queue. The
 * public sign-up flow (src/app/actions/register.ts) reads the state these set;
 * these are the organizer's side of the same feature and are staff-only.
 */

/**
 * Turn the public registration link on or off.
 *
 * Minting the token lazily — on first open, never before — is deliberate. Every
 * event that predates this feature has an empty token and no public page; only
 * an organizer choosing to open registration brings one into existence. The
 * token is then kept forever, so a link already shared keeps working across an
 * off/on cycle: closing registration must not silently invalidate a URL that's
 * already in fifty inboxes.
 */
export async function setRegistrationOpen(open: boolean): Promise<{ ok: boolean; error?: string }> {
  // No assertUnlocked, for the reason given on setRegistrationOverride: turning
  // the public link off is how an organizer stops entries, and a lock that
  // fires on `live` made that impossible precisely when it was needed.
  const eventId = await requireStaffEvent();
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { registrationToken: true },
  });
  if (!event) return { ok: false, error: "Event not found." };
  const data: { registrationOpen: boolean; registrationToken?: string } = { registrationOpen: open };
  if (open && !event.registrationToken) data.registrationToken = generateShareToken();
  await prisma.event.update({ where: { id: eventId }, data });
  await refresh();
  return { ok: true };
}

/** auto — fill to capacity, overflow to the waitlist. approve — every entry
 *  lands pending for the organizer. Anything else is coerced to auto rather
 *  than stored, since an unknown mode would decide where every entry goes. */
export async function setRegistrationApproval(mode: string): Promise<{ ok: boolean; error?: string }> {
  const eventId = await requireStaffEvent();
  await assertUnlocked(eventId);
  await prisma.event.update({
    where: { id: eventId },
    data: { registrationApproval: mode === "approve" ? "approve" : "auto" },
  });
  await refresh();
  return { ok: true };
}

/**
 * Accept a pending self-service entry into the field.
 *
 * Placement is decided here, at accept time — confirmed if there's room, else
 * the waitlist — which is the whole reason approve mode holds entries as pending
 * rather than placing them on arrival. Scoped to the caller's event, and a no-op
 * on anything that isn't actually pending, so this can only ever move an entry
 * forward.
 */
export async function approveSignup(playerId: string): Promise<{ ok: boolean; error?: string }> {
  const eventId = await requireStaffEvent();
  await assertUnlocked(eventId);
  const player = await prisma.player.findFirst({ where: { id: playerId, eventId } });
  if (!player) return { ok: false, error: "Entry not found." };
  if (player.status !== "pending") return { ok: true };
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { capacity: true, playerCountMode: true, manualPlayerCount: true, organizationId: true },
  });
  const confirmedCount = await prisma.player.count({ where: { eventId, status: "confirmed" } });
  // The field's own limit under the plan's cap — see `fieldLimitFor`.
  const capacity = event ? await fieldLimitFor(event) : 0;
  const status = placementOnApproval(capacity, confirmedCount);
  await prisma.player.update({ where: { id: playerId }, data: { status } });
  // On the record beside the entry itself — see FIELD_ACTIONS.
  await logAudit(
    eventId,
    "approved",
    status === "confirmed"
      ? `${player.name}'s entry was approved.`
      : `${player.name}'s entry was approved; the field is full, so they are on the waiting list.`,
  );
  await refresh();
  return { ok: true };
}

/** Whether a round's cut is taken across the field or within each flight. */
export async function setStageCutScope(stageId: string, scope: string): Promise<void> {
  const eventId = await requireStaffEvent();
  await assertUnlocked(eventId);
  await prisma.stage.updateMany({
    where: { id: stageId, eventId },
    data: { cutScope: isCutScope(scope) ? scope : "overall" },
  });
  await refresh();
}

/**
 * Close a round early, or extend it past its deadline.
 *
 * The same rule as registration, and for the same reason: the completion
 * deadline was a label that enforced nothing, so a round could be "due
 * Saturday" and still accept a card on Wednesday with nothing to say so.
 */
export async function setStageDeadlineOverride(
  stageId: string,
  override: boolean | null,
): Promise<void> {
  const eventId = await requireStaffEvent();
  // Not behind the lock: closing a round's scoring early or reopening it is
  // decided on the day, by definition while the event is live (2026-09-27).
  await prisma.stage.updateMany({
    where: { id: stageId, eventId },
    data: { deadlineOverride: override },
  });
  await refresh();
}

export interface ScoreImportOutcome {
  ok: boolean;
  written: number;
  error?: string;
  /** Rows the server itself refused, on top of anything the parser caught. */
  problems?: string[];
}

/**
 * Apply a parsed bulk import.
 *
 * The file was parsed and checked in the browser, but this is a `"use server"`
 * export — whatever arrives here is arbitrary caller input, so every row is
 * re-resolved against this event's own field and this round's own matches.
 * A row naming a player from another tournament, or a match from another
 * round, is dropped and reported rather than written.
 *
 * Staff only. Bulk-writing a field's scores is not something a player does,
 * whatever the tournament's score-entry setting says.
 */
export async function importScores(
  stageId: string,
  shape: string,
  rows: Array<{
    playerId?: string;
    strokes?: (number | null)[];
    aId?: string;
    bId?: string;
    holes?: HoleResult[];
    winner?: "A" | "B" | "H";
    margin?: string;
  }>,
): Promise<ScoreImportOutcome> {
  const eventId = await requireStaffEvent();
  // Whoever ran the import is who the field will ask about these scores.
  const importedBy = (await getSession())?.name ?? "";

  const stage = await prisma.stage.findFirst({ where: { id: stageId, eventId } });
  if (!stage) return { ok: false, written: 0, error: "That round isn't in this tournament." };

  if (!Array.isArray(rows) || rows.length === 0) {
    return { ok: false, written: 0, error: "Nothing to import." };
  }
  // A field is hundreds at most; anything beyond this is not a tee sheet.
  if (rows.length > 1000) {
    return { ok: false, written: 0, error: "That file has too many rows to be a single round." };
  }

  /**
   * ONLY A SHAPE THIS ROUND WAS OFFERED — `importShapesFor`, the list the
   * screen draws its choices from. Nothing checked, so a net file sent to a
   * match round was converted and written where nothing read it.
   */
  if (!(importShapesFor(stage.format) as string[]).includes(shape)) {
    return { ok: false, written: 0, error: "This round can't be scored from that kind of file." };
  }
  // A round whose results are MATCHES files a card on the player's fixture —
  // see the stroke branch below.
  const matchRound = lookupFormat(stage.format)?.family === "match";
  // And only in the way this round keeps its matches (`matchKeptBy`).
  const keptOtherwise = await keptByRefusal(stage.id, isStrokeShape(shape as ScoreImportShape) ? "cards" : "holes");
  if (keptOtherwise) return { ok: false, written: 0, error: keptOtherwise };

  const fieldRows = await prisma.player.findMany({ where: { eventId, status: "confirmed" }, select: { id: true, name: true } });
  const field = new Set(fieldRows.map((p) => p.id));
  const nameOf = new Map(fieldRows.map((p) => [p.id, p.name]));
  /** Matches whose cards changed, re-derived once after the file. */
  const rescore = new Set<string>();

  // Net cards are converted back to gross HERE, not in the browser: the
  // authoritative Playing Handicap depends on the round's allowance, the
  // player's tees and the holes being played, and the client knows none of
  // those. gross = net + shots received on that hole, so nothing is lost and
  // the card re-scores if the round's basis or allowance later changes.
  //
  // Refused rather than guessed when there is no stroke index: without one
  // there is nowhere to put the shots, and spreading them evenly would invent
  // a card nobody played.
  const isNet = shape === "net-strokes";
  let netHcp = new Map<string, number>();
  let netSi: number[] = [];
  if (isNet) {
    const [event, players, tees] = await Promise.all([
      prisma.event.findUnique({ where: { id: eventId }, include: COURSE_REF }),
      prisma.player.findMany({
        where: { eventId, status: "confirmed" },
        select: FIELD_PLAYER,
      }),
      prisma.tee.findMany({
        // Scoped to this tournament's courses. Unscoped, this returned every
        // organization's tees, so a stray teeId resolved to another club's
        // rating — and the course handicap it produced was simply wrong.
        where: { course: playedOnBy(eventId) },
        orderBy: [{ position: "asc" }],
      }),
    ]);
    if (!event) return { ok: false, written: 0, error: "Tournament not found." };
    const holes = holesPlayed(stage.holes);
    /**
     * A file of NET scores converts back to gross off these strokes, and the
     * result is STORED — so reading the wrong tees here bakes the error in.
     *
     * The line this replaces said exactly that and then read
     * `roundTeeId(tees, event?.defaultTeeId)`, which is the TOURNAMENT's set.
     * Importing a card for a round played at another venue therefore converted
     * off the home club's slope and wrote the gross down, and nothing
     * recomputes a stored stroke — CLAUDE.md names this as one of the two
     * net-to-gross paths where a wrong resolution stops being recoverable.
     */
    const importFlightTee = await flightTeeByPlayer(eventId);
    const ch = roundCourseHandicaps({
      tees,
      players,
      field: players,
      flightTeeOf: importFlightTee,
      stage,
      event,
      holes,
    });
    // Through the round's own handicaps, so a file of net scores converts back
    // to the same gross the board would have derived. Converting off the roster
    // where the round holds an override would bake the difference into stored
    // strokes — the one place an error stops being recomputable. And priced as
    // the board prices it (allowance of the unrounded figure, then the strokes
    // for the pars), or the gross this stores is a stroke from the board's.
    const importRound = await roundHandicapRows(eventId, stageId);
    netHcp = new Map(
      [...ch].map(([id, v]) => [
        id,
        playingHandicapInRound(stage, importRound.get(id), { whole: v, exact: ch.exact(id) ?? v, parStrokes: ch.parStrokes(id) }),
      ]),
    );
    // The nine actually played, re-ranked. Converting a file of NET scores
    // back to gross allocates strokes hole by hole, so reading the raw
    // eighteen-hole indexes here would bake the wrong holes into stored
    // strokes — and stored strokes are the one thing that cannot be recomputed.
    /**
     * THE ROUND'S OWN CARD, not the tournament's.
     *
     * This read `resolveCourse(event)` — the tournament's venue — so a round
     * played anywhere else converted its net scores against the wrong stroke
     * index and STORED the result. The two comments above already say why that
     * is the worst place for it: a stored gross cannot be recomputed, and it is
     * indistinguishable from a gross somebody actually shot.
     *
     * Measured with two cards whose stroke indexes are mirror images: a player
     * off one shot had it added to hole 1, the tournament's hardest, when the
     * round was played somewhere hole 1 is the easiest. See
     * `net-import-uses-the-round-card.audit.test.ts`.
     *
     * `courseForRound` falls back to the event when the round names no venue,
     * so a single-venue club is scored exactly as before.
     */
    const roundVenue = stage.courseId
      ? await prisma.course.findFirst({
          where: { id: stage.courseId, ...playedOnBy(eventId) },
        })
      : null;
    netSi = roundCard(stage, event, roundVenue).strokeIndex;
    if (netSi.length === 0) {
      return {
        ok: false,
        written: 0,
        error:
          "This round has no stroke index, so net scores can't be converted back to gross. Add the course card first, or import gross scores.",
      };
    }
  }
  const matches = await prisma.match.findMany({
    where: { eventId, stageId },
    select: { id: true, playerAId: true, playerBId: true, holes: true },
  });

  const problems: string[] = [];
  let written = 0;
  // Whether any imported card carried a stroke, rather than merely a row —
  // an import of blank cards is a field, not a round that has been played.
  let returned = false;
  /**
   * A FILE OF CARDS IS THE ROUND'S RETURNED CARDS (2026-10-10).
   *
   * Rule 3.3b: the player returns the signed card, and the committee records
   * it. A secretary importing the night's cards is that second step, so a
   * FINISHED card arrives returned (certified, by whoever imported it). It sat
   * as "entered", and the committee's one-click acceptance takes only returned
   * cards — a 120-player league night left 119 "Approve anyway" clicks and a
   * round that never read ready to close. An unfinished card stays entered,
   * and a disputed one keeps its dispute.
   *
   * And a file that CHANGES an accepted card sends it back to returned. The
   * strokes were overwritten under an "approved" status, so a result moved
   * without the committee seeing it move.
   */
  const stored = new Map(
    (
      await prisma.scorecard.findMany({ where: { eventId, stageId }, select: { playerId: true, status: true, strokes: true } })
    ).map((c) => [c.playerId, c]),
  );
  const cardHoles = holesPlayed(stage.holes);
  const returnedBy = { certifiedBy: `${importedBy || "The committee"} (from a file)`, certifiedAt: new Date() };

  for (const row of rows) {
    // Both stroke shapes, gross and net: they arrive as the same per-player
    // card and differ only in whether the shots get added back below. Testing
    // for the literal "strokes" here sent every net row down the match branch,
    // where it had no pairing to match and was rejected as "a match this round
    // doesn't have" — with the conversion above it built and never used.
    if (isStrokeShape(shape as ScoreImportShape)) {
      if (!row.playerId || !field.has(row.playerId)) {
        problems.push("A row named someone who isn't in this tournament's field.");
        continue;
      }
      // Coerced hole by hole, never stored as-given: this is a public endpoint
      // and the parser's checks ran in the caller's browser, which proves
      // nothing here. A stroke is an integer a golf hole can produce or null;
      // the card is capped at the sizes a card can be.
      const raw = (Array.isArray(row.strokes) ? row.strokes : [])
        .slice(0, 18)
        .map((v) => (isStroke(v) ? v : null));
      // And the gross it converts back to is a stroke too: a net 30 off two
      // shots is a 32 no card could hold, so it is a blank like any other.
      const strokes = isNet
        ? raw.map((v, i) => {
            if (v === null) return null;
            const gross = v + holeStrokesReceived(netHcp.get(row.playerId!) ?? 0, netSi[i] ?? 18, allocationHoles(netSi.length));
            return isStroke(gross) ? gross : null;
          })
        : raw;
      /**
       * A MATCH ROUND FILES ITS CARDS ON THE FIXTURE (2026-10-10).
       *
       * This wrote every card to `Scorecard` — the table a stroke round files
       * in. A match reads its two cards off `MatchScorecard`, so a file of
       * cards for a match-play night was "written" in full and scored no
       * match at all. Filed where the match looks, and the match derived from
       * them after the file by the code a typed card goes through.
       *
       * A file has one card per player and no way to say which match it is
       * for, so somebody with two matches in the round is named rather than
       * guessed at; so is somebody the round has not drawn at all.
       */
      if (matchRound) {
        const theirs = matches.filter((m) => m.playerAId === row.playerId || m.playerBId === row.playerId);
        const who = nameOf.get(row.playerId) ?? "A player";
        if (theirs.length !== 1) {
          problems.push(
            theirs.length === 0
              ? `${who} isn't drawn in a match in this round, so there is no match for the card to score.`
              : `${who} plays more than one match in this round, and a card can't say which it is for — import who won each hole, or the results, for those.`,
          );
          continue;
        }
        const card = strokes.slice(0, cardHoles);
        while (card.length < cardHoles) card.push(null);
        const slot = theirs[0].playerAId === row.playerId ? "A" : "B";
        await prisma.matchScorecard.upsert({
          where: { matchId_slot: { matchId: theirs[0].id, slot } },
          update: { strokes: JSON.stringify(card) },
          create: { eventId, matchId: theirs[0].id, slot, strokes: JSON.stringify(card) },
        });
        rescore.add(theirs[0].id);
        if (isReturnedCard(card)) returned = true;
        written += 1;
        continue;
      }
      const before = stored.get(row.playerId);
      const json = JSON.stringify(strokes);
      const finished = filledHoles(strokes, cardHoles) >= cardHoles;
      const status =
        before?.status === "disputed"
          ? null
          : before?.status === "approved"
            ? before.strokes === json
              ? null
              : "certified"
            : finished && before?.status !== "certified"
              ? "certified"
              : null;
      await prisma.scorecard.upsert({
        where: { stageId_playerId: { stageId, playerId: row.playerId } },
        update: { strokes: json, ...(status ? { status, ...returnedBy } : {}) },
        create: { eventId, stageId, playerId: row.playerId, strokes: json, ...(status ? { status, ...returnedBy } : {}) },
      });
      if (isReturnedCard(strokes)) returned = true;
      written += 1;
      continue;
    }

    // Match shapes: the pairing has to be one this round actually has, in
    // either direction — a file listing B before A is still the same match.
    const found = matches.find(
      (m) =>
        (m.playerAId === row.aId && m.playerBId === row.bId) ||
        (m.playerAId === row.bId && m.playerBId === row.aId),
    );
    if (!found) {
      problems.push("A row described a match this round doesn't have.");
      continue;
    }
    // Flipped rows have their result flipped with them, or the winner lands
    // on the wrong player.
    const flipped = found.playerAId === row.bId;
    const flip = (r: HoleResult): HoleResult => (r === "A" ? "B" : r === "B" ? "A" : r);

    if (shape === "hole-results") {
      // Same rule as the strokes shape: a hole result is A, B, H or null, and
      // a card has at most eighteen of them — anything else from the caller is
      // dropped rather than stored.
      // Sized to the ROUND, as a typed result is: an empty row was stored as
      // [], which reads as a finished match, and stamped as scored.
      const holes =
        cleanHoleResults(
          (Array.isArray(row.holes) ? row.holes : []).map((h) =>
            h === "A" || h === "B" || h === "H" ? (flipped ? flip(h) : h) : null,
          ),
          holesPlayed(stage.holes),
        ) ?? [];
      await prisma.match.updateMany({
        where: { id: found.id, eventId },
        data: { holes: JSON.stringify(holes), forfeitedBy: "", scoreStatus: "pending", scoredAt: matchIsOver(holes) ? new Date() : null, confirmedById: null, confirmedBy: "", enteredBy: importedBy },
      });
      written += 1;
      continue;
    }

    if (shape === "match-results") {
      const w: "A" | "B" | "H" =
        row.winner === "A" || row.winner === "B"
          ? flipped
            ? row.winner === "A"
              ? "B"
              : "A"
            : row.winner
          : "H";
      // A match has no winner column — the result lives in holes[], and
      // marginToHoles is what the single-match screen already uses to turn
      // "3&2" into a card. Reusing it keeps an imported result and a typed one
      // identical downstream, rather than creating a second kind of result the
      // leaderboard has to know about.
      // A row whose winner is none of the three was read as halved, and a
      // winner with no margin as halved too: refused, like every other door.
      if (row.winner !== "A" && row.winner !== "B" && row.winner !== "H") {
        problems.push("A row named a winner that isn't one of the two players, or halved.");
        continue;
      }
      const rowMargin = String(row.margin ?? "");
      const refusal = marginRefusal(w, rowMargin, matchHoleCount(found.holes));
      if (refusal) {
        problems.push(refusal);
        continue;
      }
      const synth = marginToHoles(w, rowMargin, matchHoleCount(found.holes));
      await prisma.match.updateMany({
        where: { id: found.id, eventId },
        data: { holes: JSON.stringify(synth), scoreStatus: "pending", scoredAt: new Date(), confirmedById: null, confirmedBy: "", enteredBy: importedBy },
      });
      written += 1;
      continue;
    }

    problems.push("Unknown import shape.");
  }

  // Each match whose cards came in, derived once from BOTH its cards — after
  // the file, so a match with two rows in it is scored on the pair rather
  // than twice on one and a half.
  for (const matchId of rescore) {
    const match = await prisma.match.findFirst({ where: { id: matchId, eventId } });
    if (match) await deriveMatchFromItsCards(eventId, match, { name: `${importedBy || "The committee"} (from a file)`, playerId: "" });
  }

  // An imported card is a returned card. Once, after the file rather than per
  // row: freezing is a fact about the round, and the first row already decided
  // it.
  if (returned) await freezeRoundHandicaps(eventId, stageId);

  await refresh();
  return { ok: written > 0, written, problems: problems.length ? problems : undefined };
}

/**
 * A TEAM ROUND'S CARDS FROM A FILE (2026-10-10).
 *
 * A 120-player four-ball comes back as a spreadsheet the same as a medal does,
 * and the import refused it: `importScores` writes `Scorecard`, which a team
 * round never reads, so the only route was typing sixty sides by hand. Every
 * club system imports a team round the same way it imports a medal — one row
 * per card — and so does this:
 *
 *   - a format where each partner plays their own ball (four-ball, best-ball):
 *     a row per PLAYER, filed on that player's side;
 *   - a shared ball (scramble, foursomes, greensomes): a row per SIDE, named
 *     by the side or by any one of its players — one card for the side.
 *
 * Gross only. A net figure converts back through the round's team allowance,
 * which differs by format and, on a shared ball, is the side's handicap rather
 * than anybody's own — a conversion that would be stored and could not be
 * recomputed. The importer offers only the gross shape on a team round.
 *
 * Staff only, and a public endpoint like every `"use server"` export: each row
 * is re-resolved against this round's own sides, and anything else is reported
 * rather than written. A side in a team match files its card on that match,
 * which is then re-scored from both sides' cards, as a typed card is.
 */
export async function importTeamScores(
  stageId: string,
  rows: Array<{ playerId?: string; teamId?: string; strokes?: (number | null)[] }>,
): Promise<ScoreImportOutcome> {
  const eventId = await requireStaffEvent();
  const stage = await prisma.stage.findFirst({ where: { id: stageId, eventId } });
  if (!stage) return { ok: false, written: 0, error: "That round isn't in this tournament." };
  if (!needsTeams(stage.format)) {
    return { ok: false, written: 0, error: "This round isn't played in sides." };
  }
  if (!Array.isArray(rows) || rows.length === 0) return { ok: false, written: 0, error: "Nothing to import." };
  if (rows.length > 1000) {
    return { ok: false, written: 0, error: "That file has too many rows to be a single round." };
  }

  const format = findFormat(stage.format);
  // One card per side on a shared ball, and on a two-ball round the committee
  // entered that way — the shape the board reads (`oneCardPerSide`).
  const shared = oneCardPerSide(stage.format, stage.scoreInput, stage.scoringBasis);
  // A side's cards for a match round kept by tapping would rebuild its matches.
  const keptByHoles = await keptByRefusal(stage.id, "cards");
  if (keptByHoles) return { ok: false, written: 0, error: keptByHoles };
  const holes = holesPlayed(stage.holes);
  const teams = await prisma.team.findMany({
    where: { eventId, OR: [{ stageId }, { stageId: null }] },
    select: { id: true, members: { select: { playerId: true } } },
  });
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const sideOf = new Map<string, string>();
  for (const t of teams) for (const m of t.members) sideOf.set(m.playerId, t.id);
  const matches = await prisma.match.findMany({
    where: { eventId, stageId },
    select: { id: true, stageId: true, teamAId: true, teamBId: true },
  });
  const matchOf = (teamId: string) => matches.find((m) => m.teamAId === teamId || m.teamBId === teamId);

  const problems: string[] = [];
  const done = new Set<string>();
  const touched = new Map<string, (typeof matches)[number]>();
  let written = 0;
  let returned = false;

  for (const row of rows) {
    // Narrowed to this round's own sides: an id from anywhere else is not in
    // either map, and the row is reported below rather than written.
    const playerId = typeof row?.playerId === "string" && sideOf.has(row.playerId) ? row.playerId : "";
    const teamId =
      typeof row?.teamId === "string" && teamById.has(row.teamId) ? row.teamId : (sideOf.get(playerId) ?? "");
    if (!teamId) {
      problems.push("A row named someone who isn't on a side in this round.");
      continue;
    }
    if (!shared && !playerId) {
      problems.push(`${format.name} needs a card for each partner — a row per player, not per side.`);
      continue;
    }
    const cardPlayer = shared ? "" : playerId;
    const key = `${teamId}:${cardPlayer}`;
    if (done.has(key)) {
      problems.push(shared ? "Two rows were for the same side; the first was kept." : "Two rows were for the same player; the first was kept.");
      continue;
    }
    // Coerced hole by hole, exactly as `importScores` does it.
    const strokes = (Array.isArray(row.strokes) ? row.strokes : [])
      .slice(0, holes)
      .map((v) => (isStroke(v) ? v : null));
    const match = matchOf(teamId);
    const matchId = match?.id ?? "";
    await prisma.teamScorecard.upsert({
      where: { stageId_matchId_teamId_playerId: { stageId, matchId, teamId, playerId: cardPlayer } },
      update: { strokes: JSON.stringify(strokes) },
      create: { eventId, stageId, matchId, teamId, playerId: cardPlayer, strokes: JSON.stringify(strokes) },
    });
    done.add(key);
    if (match) touched.set(match.id, match);
    if (isReturnedCard(strokes)) returned = true;
    written += 1;
  }

  if (returned) await freezeRoundHandicaps(eventId, stageId);
  for (const m of touched.values()) await recomputeTeamMatch(eventId, m, stage.format, holes);

  await refresh();
  return { ok: written > 0, written, problems: problems.length ? problems : undefined };
}

export interface ClearScoresOutcome {
  ok: boolean;
  cleared: number;
  error?: string;
}

/**
 * Clear scores for a round — one card, a selection, or the whole round.
 *
 * Deleting a score is not the same as deleting a player, and this only ever
 * touches the former: the scorecard rows and the match cards for one round.
 * Registrations, flights, pairings and tee times all survive, so a round can
 * be re-scored from scratch without rebuilding the draw.
 *
 * Match cards are blanked rather than deleted. The pairing is part of the
 * draw, not part of the score — removing the row would take the fixture with
 * it and leave the tee sheet pointing at a match that no longer exists.
 *
 * Staff only, and never on a locked event.
 */
export async function clearRoundScores(
  stageId: string,
  /** Empty = the whole round. Otherwise only these players' cards and any
   *  match they appear in. */
  playerIds: string[] = [],
): Promise<ClearScoresOutcome> {
  /**
   * ADMIN, not staff.
   *
   * This deletes results. `reopenScorecard` — which only moves ONE card from
   * approved back to entered, and destroys nothing — is admin-only, and so is
   * every other door near it. This one erased a whole round and was open to an
   * assistant, which is the wrong way round.
   */
  const eventId = await requireAdminEvent();
  await assertUnlocked(eventId);

  const stage = await prisma.stage.findFirst({ where: { id: stageId, eventId } });
  if (!stage) return { ok: false, cleared: 0, error: "That round isn't in this tournament." };

  const scoped = playerIds.filter((id) => typeof id === "string" && id.length > 0);

  /**
   * A COMMITTEE-APPROVED CARD IS A RESULT, and this refuses to erase one.
   *
   * `status: "approved"` means the committee has accepted the card — the schema
   * says "only now is it a result" — and `approvedBy`/`approvedAt` record who
   * did it. All of that went with the row, silently, on a control whose own
   * copy says the round "can simply be scored again". It cannot: re-entering
   * the strokes does not restore who approved them or when.
   *
   * Refused outright rather than skipped. Clearing the unapproved cards and
   * leaving the approved ones would produce a half-erased round — some players
   * with results, some without, no record of which — and that is a state a
   * committee cannot defend to the people in it. Reopening a card is one click
   * and is already audited, so the way through is explicit rather than
   * incidental.
   */
  const approved = await prisma.scorecard.count({
    where: {
      eventId,
      stageId,
      status: "approved",
      ...(scoped.length ? { playerId: { in: scoped } } : {}),
    },
  });
  if (approved > 0) {
    return {
      ok: false,
      cleared: 0,
      error:
        approved === 1
          ? "One card here has been approved by the committee. Reopen it first — clearing an approved card would delete the result and the record of who signed it off."
          : `${approved} cards here have been approved by the committee. Reopen them first — clearing an approved card would delete the result and the record of who signed it off.`,
    };
  }

  let cleared = 0;

  // ── Stroke cards ────────────────────────────────────────────────────────
  const cards = await prisma.scorecard.deleteMany({
    where: { eventId, stageId, ...(scoped.length ? { playerId: { in: scoped } } : {}) },
  });
  cleared += cards.count;

  // ── Match cards ─────────────────────────────────────────────────────────
  const matches = await prisma.match.findMany({
    where: {
      eventId,
      stageId,
      ...(scoped.length
        ? { OR: [{ playerAId: { in: scoped } }, { playerBId: { in: scoped } }] }
        : {}),
    },
    select: { id: true, holes: true },
  });

  for (const m of matches) {
    // Same hole count back, so the card keeps its shape — a nine-hole match
    // must not silently become eighteen empty holes.
    const empty = new Array(matchHoleCount(m.holes)).fill(null);
    await prisma.match.updateMany({
      where: { id: m.id, eventId },
      data: {
        holes: JSON.stringify(empty),
        scoreStatus: "pending",
        scoredAt: null,
        confirmedById: null,
      },
    });
    cleared += 1;
  }

  // Per-player gross cards behind a net match, which would otherwise re-derive
  // the result the moment anything recalculated.
  /**
   * THE STROKE CARDS OF THE MATCHES JUST CLEARED — both of each one's cards,
   * since the whole match was emptied above, and a card left behind would
   * rebuild its holes. A match card is keyed by match and slot, not by player:
   * this asked it for a `playerId` it does not have, so clearing chosen
   * players threw AFTER deleting their cards and emptying their matches — no
   * audit line, and "Something went wrong" over a clear that had half
   * happened (found 2026-10-21 by the first test to tick a name).
   */
  await prisma.matchScorecard.deleteMany({
    where: scoped.length
      ? { matchId: { in: matches.map((m) => m.id) } }
      : { match: { eventId, stageId } },
  });

  // Clearing the WHOLE round un-plays it, so the handicaps it froze are
  // released and the round can be fixed and scored again. A frozen number
  // whose round has no cards left protects nothing and reads as a refusal
  // ("cards are in") on a round that is visibly empty.
  //
  // Only for the whole round. Clearing one player's card leaves the rest
  // standing, and the round they were scored against must not move under
  // them. The override is a committee decision and survives either way.
  if (!scoped.length) {
    await prisma.roundHandicap.updateMany({
      where: { eventId, stageId },
      data: { frozen: null, frozenExact: null, frozenParStrokes: null, frozenAt: null },
    });
  }

  /**
   * Recorded, because nothing else will be.
   *
   * Deleting a round's scores leaves no trace of itself — the rows are simply
   * gone, and the screen afterwards looks exactly like a round nobody has
   * played yet. Every neighbouring destructive action writes an audit line;
   * this one wrote nothing, so "the scores have vanished" had no answer.
   *
   * Written after the deletes so the count is what actually happened rather
   * than what was intended, and only when something was cleared: an audit log
   * that records no-ops is one people stop reading.
   */
  if (cleared > 0) {
    await logAudit(
      eventId,
      "clear-round-scores",
      scoped.length
        ? `Cleared ${cleared} score${cleared === 1 ? "" : "s"} for ${scoped.length} player${scoped.length === 1 ? "" : "s"} in round "${roundKicker(stage.description, stage.type)}"`
        : `Cleared ${cleared} score${cleared === 1 ? "" : "s"} from round "${roundKicker(stage.description, stage.type)}"`,
    );
  }

  await refresh();
  return { ok: true, cleared };
}

/* ── Scorecard certification and approval ──────────────────────────────────
   Rule 3.3b in two steps: the marker and player certify the hole scores, then
   the committee accepts the card. Stroke play had neither until now — a card
   went from a text box to the leaderboard with nothing in between, which
   mattered far more once one person in a fourball could enter three other
   people's rounds. See lib/domain/card-approval.ts for what a blanket
   approval may and may not take. */

/**
 * The marker's step: these hole scores are right.
 *
 * Allowed to anyone who may enter this card — including the player, who under
 * the Rules certifies their own — so it follows requireScoreEntry and
 * assertOwnCard rather than staff-only. Certifying is not accepting; it makes
 * no result.
 */
export async function certifyScorecard(stageId: string, playerId: string) {
  const { eventId, session } = await requireScoreEntryForStage(stageId);
  await assertEventStage(eventId, stageId);
  await assertEventPlayer(eventId, playerId);
  await assertOwnCard(session, eventId, playerId);

  /**
   * The signature itself, in `services/scorecard-write.ts`.
   *
   * Lifted out for the reason the comment here already gave — "the three doors
   * into this row cannot drift apart again" — the day a FOURTH arrived: the
   * Round Code surface, which had no way to sign at all.
   *
   * The guards above are what did not move. Who may sign is this action's
   * question and the play surface asks a different one.
   */
  await certifyCard({ eventId, stageId, playerId, by: session.email });
  await refresh();
  return { ok: true };
}

/**
 * Someone says this card is wrong. Never silently approved afterwards.
 *
 * Open to whoever may enter the card, like certification — flagging a card is
 * how a marker or a player raises a problem, and a flag blocks approval rather
 * than deciding anything. What it may NOT do is reach past an approval: this
 * had the same guards as `certifyScorecard` three lines above, minus the
 * approved-card check, so it was an unaudited `reopenScorecard` open to
 * anyone in the field — an assistant could take a whole round's accepted cards
 * back out of the results, and nothing recorded that they had.
 */
export async function disputeScorecard(stageId: string, playerId: string) {
  const { eventId, session } = await requireScoreEntryForStage(stageId);
  await assertEventStage(eventId, stageId);
  await assertEventPlayer(eventId, playerId);
  await assertOwnCard(session, eventId, playerId);
  // Nobody accepts a casual card, so nobody can be asked not to.
  await assertSignsCards(eventId);

  const card = await prisma.scorecard.findFirst({
    where: { eventId, stageId, playerId },
    select: { id: true, status: true },
  });
  if (!card) throw new Error("There's no card to dispute yet.");
  if (isCardLocked(card.status)) throw new Error(LOCKED_CARD_REFUSAL);
  if (card.status === "disputed") return { ok: true };

  await prisma.scorecard.update({ where: { id: card.id }, data: { status: "disputed" } });
  // `logAudit` records who; the detail has to record which, because a card has
  // no matchId to hang the row on. The match-play counterpart has logged its
  // disputes since it existed and stroke play logged nothing at all — the
  // format where one person enters three other people's rounds.
  // The player by id — `recentChanges` turns it back into their name — and the
  // round by its words, since any other id reads as a departed player.
  await logAudit(eventId, "card.dispute", `${playerId}'s ${await roundWordsFor(eventId, stageId)} card disputed`);
  await refresh();
  return { ok: true };
}

/**
 * The committee's step, on one card. Staff only — this is the act that turns
 * strokes into a result.
 */
export async function approveScorecard(stageId: string, playerId: string) {
  const eventId = await requireStaffEvent();
  const session = await getSession();
  if (!session) throw new Error("Not authenticated");
  await assertEventStage(eventId, stageId);
  await assertEventPlayer(eventId, playerId);

  const card = await prisma.scorecard.findFirst({
    where: { eventId, stageId, playerId },
    select: { id: true },
  });
  if (!card) throw new Error("There's no card to approve yet.");

  await prisma.scorecard.update({
    where: { id: card.id },
    data: { status: "approved", approvedBy: session.email, approvedAt: new Date() },
  });
  // The act that turns strokes into a result goes on the record — see
  // `holesChanged` for the walk that found it never did.
  await logAudit(eventId, "card.approve", `${playerId}'s ${await roundWordsFor(eventId, stageId)} card approved`);
  await refresh();
  return { ok: true };
}

/**
 * Accept a whole round — but only the cards that are clean.
 *
 * The exception list is computed here rather than trusted from the caller.
 * A client that sent its own list of ids would be the rubber stamp this was
 * written to prevent: the one control that is supposed to be unable to sweep
 * a disputed or half-finished card would sweep whatever it was handed.
 *
 * Returns what it did and what it left, so the screen can say so.
 */
export async function approveRound(stageId: string) {
  const eventId = await requireStaffEvent();
  const session = await getSession();
  if (!session) throw new Error("Not authenticated");
  await assertEventStage(eventId, stageId);

  const stage = await prisma.stage.findFirst({
    where: { id: stageId, eventId },
    select: { holes: true },
  });
  const holes = holesPlayed(stage?.holes);

  const rows = await prisma.scorecard.findMany({
    where: { eventId, stageId },
    select: { id: true, playerId: true, strokes: true, status: true },
  });
  const names = new Map(
    (
      await prisma.player.findMany({
        where: { eventId, id: { in: rows.map((r) => r.playerId) } },
        select: { id: true, name: true },
      })
    ).map((p) => [p.id, p.name]),
  );

  const review = reviewCards(
    rows.map((r) => {
      let strokes: (number | null)[] = [];
      try {
        strokes = JSON.parse(r.strokes) as (number | null)[];
      } catch {
        // Unparseable strokes cannot be complete, so this card lands in the
        // exception list rather than being approved on a technicality.
        strokes = [];
      }
      return {
        id: r.id,
        playerId: r.playerId,
        playerName: names.get(r.playerId) ?? "Unknown player",
        status: r.status,
        strokes,
        holes,
      };
    }),
  );

  if (review.ready.length) {
    await prisma.scorecard.updateMany({
      where: { id: { in: review.ready.map((c) => c.id) } },
      data: { status: "approved", approvedBy: session.email, approvedAt: new Date() },
    });
    const n = review.ready.length;
    await logAudit(
      eventId,
      "card.approve",
      `${n} ${n === 1 ? "card" : "cards"} approved for ${await roundWordsFor(eventId, stageId)}`,
    );
  }

  await refresh();
  return {
    ok: true,
    approved: review.ready.length,
    exceptions: review.exceptions,
  };
}

/**
 * Put an approved card back for correction.
 *
 * Organizer only, and deliberately keeps approvedBy/approvedAt: "who signed
 * this off" has to survive the card changing, or the audit trail is only ever
 * as good as the last edit.
 */
export async function reopenScorecard(stageId: string, playerId: string) {
  const eventId = await requireAdminEvent();
  await assertEventStage(eventId, stageId);
  await assertEventPlayer(eventId, playerId);

  const card = await prisma.scorecard.findFirst({
    where: { eventId, stageId, playerId },
    select: { id: true },
  });
  if (!card) throw new Error("There's no card to reopen.");

  await prisma.scorecard.update({ where: { id: card.id }, data: { status: "entered" } });
  await logAudit(eventId, "card.reopen", `${playerId}'s ${await roundWordsFor(eventId, stageId)} card reopened for correction`);
  await refresh();
  return { ok: true };
}

/**
 * Whether this tournament's sign-up form demands a mobile number.
 *
 * Per tournament, and off by default. A phone number is not needed to run a
 * competition — email is identity here and the app reaches people in the app —
 * so a required field that costs entries belongs to the organizer of the event
 * that actually needs one, rather than being imposed on every club.
 *
 * ON EVERY PLAN (decisions review A7, 2026-10-21). The free plan used to force
 * the mobile on and lock this switch; it no longer does, so nothing here asks
 * the plan. See `phoneRequiredFor`.
 */
export async function setRequirePhone(required: boolean): Promise<{ ok: boolean; error?: string }> {
  const eventId = await requireStaffEvent();
  await assertUnlocked(eventId);
  await prisma.event.update({ where: { id: eventId }, data: { requirePhone: !!required } });
  await refresh();
  return { ok: true };
}

/**
 * Mint a new public link, and kill the old one.
 *
 * P3 of the 2026-08-12 audit: `shareToken` was minted once at creation and
 * `registrationToken` once on first open, and **nothing anywhere replaced
 * either**. A link forwarded to the wrong WhatsApp group, or posted somewhere
 * public, could only be dealt with by switching the whole feature off — and
 * per D2 an organizer often could not even do that. A secret with no way to
 * change it is a secret you keep until it stops being one.
 *
 * Admin only, and audited. Rotating is destructive in the way that matters:
 * every copy of the old URL stops working the moment this runs, including the
 * ones in fifty inboxes and on the noticeboard. That is the point, but it is
 * not something an assistant should be able to do by mis-tapping, and it is
 * something a committee will want a name against afterwards.
 *
 * The registration link is only rotated when one already exists. Minting a
 * token here for a tournament that has never opened registration would create
 * a live public URL as a side effect of asking to invalidate one.
 */
export async function rotatePublicToken(
  which: "share" | "registration",
): Promise<{ ok: boolean; token?: string; error?: string }> {
  const eventId = await requireAdminEvent();
  const session = await getSession();
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { shareToken: true, registrationToken: true },
  });
  if (!event) return { ok: false, error: "Event not found." };

  const token = generateShareToken();

  if (which === "share") {
    await prisma.event.update({ where: { id: eventId }, data: { shareToken: token } });
    await logAudit(
      eventId,
      "rotate-share-token",
      `${session?.name ?? "An organizer"} replaced the live leaderboard link`,
    );
  } else {
    if (!event.registrationToken) {
      return { ok: false, error: "There's no sign-up link yet — open registration to create one." };
    }
    await prisma.event.update({ where: { id: eventId }, data: { registrationToken: token } });
    await logAudit(
      eventId,
      "rotate-registration-token",
      `${session?.name ?? "An organizer"} replaced the sign-up link`,
    );
  }

  await refresh();
  return { ok: true, token };
}

/**
 * Choose how a Single Match Stage picks its two players.
 *
 * Validated through the domain parser rather than trusted, because an
 * unreadable rule resolves to no match at all — and a rule stored in a shape
 * nothing can read would leave an organizer with a round that never fills and
 * no way to see why.
 */
export async function setSingleMatchRule(
  stageId: string,
  rule: { kind: string; a: string | number; b: string | number },
): Promise<{ ok: boolean; error?: string }> {
  const eventId = await requireStaffEvent();
  await assertUnlocked(eventId);

  const parsed = parseSingleMatchRule(JSON.stringify(rule ?? {}));
  if (!parsed) {
    return { ok: false, error: "That pairing doesn't make sense — pick two different players or rounds." };
  }

  // And made of things that are IN this tournament, of the kind the rule says
  // — see `singleMatchRuleRefusal`. Read here, never taken from the caller.
  const [stages, players] = await Promise.all([
    prisma.stage.findMany({ where: { eventId }, select: { id: true } }),
    prisma.player.findMany({ where: { eventId, status: "confirmed" }, select: { id: true } }),
  ]);
  if (!stages.some((s) => s.id === stageId)) return { ok: false, error: "That round isn't in this tournament." };
  const refusal = singleMatchRuleRefusal(parsed, {
    stageId,
    otherStageIds: stages.map((s) => s.id).filter((id) => id !== stageId),
    playerIds: players.map((p) => p.id),
  });
  if (refusal) return { ok: false, error: refusal };

  // Stored as PARSED, so nothing a caller added to the object rides along.
  const r = await prisma.stage.updateMany({
    where: { id: stageId, eventId },
    data: { singleMatchRule: JSON.stringify(parsed) },
  });
  if (r.count === 0) return { ok: false, error: "That round isn't in this tournament." };

  await refresh();
  return { ok: true };
}

/**
 * Create the match a Single Match Stage's rule resolves to.
 *
 * Explicit rather than automatic. The pairing is derived, so it can change
 * right up until somebody commits it — and creating the match is the moment a
 * committee says "this is the final", which is a decision rather than a
 * consequence of loading a page.
 *
 * Refuses when the rule cannot be satisfied yet, passing the domain's own
 * explanation back, and refuses to create a second match for a stage that
 * already has one.
 */
export async function createSingleMatch(stageId: string): Promise<{ ok: boolean; error?: string }> {
  const eventId = await requireStaffEvent();
  // Not behind the lock: the match is made once the rule resolves, which is
  // during the event. Additive and refuses a second one below (2026-09-27).
  // Choosing the RULE stays setup — `setSingleMatchRule` keeps its lock.

  const view = await singleMatchFor(eventId, stageId);
  if (!view) return { ok: false, error: "That round isn't in this tournament." };
  if (view.matchId) return { ok: false, error: "This round already has its match." };
  if (!view.resolution.pairing) return { ok: false, error: view.resolution.problem };

  const stage = await prisma.stage.findFirst({
    where: { id: stageId, eventId },
    select: { id: true, holes: true, format: true, position: true },
  });
  if (!stage) return { ok: false, error: "That round isn't in this tournament." };

  const { playerAId, playerBId } = view.resolution.pairing;
  // Both ids came from the resolver, which only ever returns players in this
  // tournament's field — but the where clause says so anyway rather than
  // trusting a value that travelled through three functions to get here.
  const both = await prisma.player.findMany({
    where: { eventId, id: { in: [playerAId, playerBId] } },
    select: { id: true },
  });
  if (both.length !== 2) return { ok: false, error: "Those players aren't both in this tournament." };

  const groupId = await matchCarrierGroup(eventId, stage.id, `${stage.format} — Round ${stage.position + 1}`);
  // Sized to the round, like every other match this app creates. An empty
  // array is not "no holes yet" to the entry screen — it falls back to
  // `holes.length || 18`, which would offer eighteen holes on a nine-hole round.
  const emptyHoles = JSON.stringify(new Array(holesPlayed(stage.holes)).fill(null));

  await prisma.match.create({
    data: { eventId, stageId, groupId, round: 1, playerAId, playerBId, holes: emptyHoles },
  });
  await logAudit(eventId, "single-match", `Created the match for this round: ${view.aName} v ${view.bName}`);
  await refresh();
  return { ok: true };
}

/** Whether this knockout plays off for third. Off by default. */
export async function setThirdPlace(stageId: string, on: boolean): Promise<{ ok: boolean; error?: string }> {
  const eventId = await requireStaffEvent();
  await assertUnlocked(eventId);

  // A knockout in several flights is a pure knockout in each: there is no one pair of beaten
  // semi-finalists to play off, and finishing order does not read a play-off there.
  if (on) {
    const arranged = await prisma.event.findUnique({ where: { id: eventId }, select: { bracketMode: true } });
    if (arranged?.bracketMode === "flights") {
      return { ok: false, error: "A knockout in several flights has no play-off for third: in each flight the two beaten semi-finalists share third." };
    }
  }
  const r = await prisma.stage.updateMany({
    where: { id: stageId, eventId },
    data: { thirdPlace: !!on },
  });
  if (r.count === 0) return { ok: false, error: "That round isn't in this tournament." };

  await refresh();
  return { ok: true };
}

/**
 * DECLARE A ROUND FINISHED, OR RE-OPEN IT.
 *
 * The one thing a round could not say about itself. Everything that needed to
 * know whether a round was OVER had to guess — `roundMoneyIsFinal` from "every
 * hole returned", `chargedHoles` from "not the round on the board" — and a
 * stroke aggregate could not tell "has not played those holes yet" from "did
 * not turn up", so one round at +4 out-ranked two rounds at +6.
 *
 * NOT `assertUnlocked`, deliberately. Every other stage setting here is a
 * structural change and is refused once a tournament is launched; this is the
 * opposite kind of thing — an organizer closes a round in the moments after
 * the last card comes in, on a tournament that is by definition under way.
 * `setBracketWinner` is gated the same way and for the same reason.
 *
 * RE-OPENING IS SUPPORTED because a committee correcting a card after the fact
 * is ordinary. That is why the column is a timestamp rather than a flag: the
 * useful question afterwards is when it was closed, not merely whether.
 *
 * What it changes: on a STROKE board a player with no card for a closed round
 * holds no position, which is the standard answer for somebody who has not
 * completed the competition. A points board is untouched — a missed week
 * already costs a Stableford player the points it was worth. See
 * `missedAClosedRound` in `services/tournament.ts`.
 */
export async function setRoundClosed(
  stageId: string,
  closed: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const eventId = await requireStaffEvent();

  const stage = await prisma.stage.findFirst({
    where: { id: stageId, eventId },
    select: { id: true, description: true, position: true },
  });
  if (!stage) return { ok: false, error: "That round isn't in this tournament." };

  // Closing a round that a cut is taken out of IS approving the cut, and a cut
  // is only made on final cards (Ajay, 2026-10-05). Refused before anything is
  // written, so a round is never closed without its cut. See `strokeCutRefusal`.
  if (closed) {
    const refusal = await strokeCutRefusal(eventId, stage.id);
    if (refusal) return { ok: false, error: refusal };
  }

  await prisma.stage.update({
    where: { id: stage.id },
    data: { closedAt: closed ? new Date() : null },
  });

  const which =
    stage.description ||
    roundLabel(
      await prisma.stage.findMany({
        where: { eventId },
        orderBy: { position: "asc" },
        select: { id: true, type: true, position: true },
      }),
      stage.id,
    );
  await logAudit(
    eventId,
    "round-closed",
    closed
      ? `Closed ${which}. Anybody without a card for it no longer holds a place on a stroke board.`
      : `Re-opened ${which}.`,
  );
  /**
   * AND CLOSING A ROUND MAKES THE CUT OUT OF IT — Ajay's call, 2026-09-26.
   * If the next round is cut into ("top 16"), the survivors, with ties, get
   * its cards and nobody else does. See `applyStrokeCut`. Only on closing:
   * re-opening a round leaves the field as it is, and closing it again after a
   * correction re-applies the cut to the corrected standings.
   */
  if (closed) await applyStrokeCut(eventId, stage.id);
  await refresh();
  return { ok: true };
}

/**
 * Create the third-place match from the beaten semi-finalists.
 *
 * Explicit, like the Single Match Stage's own create and for the same reason:
 * the pairing is derived and can still change, and "we are playing this" is a
 * committee's decision rather than a consequence of a semi-final finishing.
 *
 * The pairing comes from `resolveThirdPlace`, which refuses on an unfinished
 * semi-final rather than naming two players who might both still reach the
 * Final — so this only ever has a real pair to write.
 */
export async function createThirdPlaceMatch(stageId: string): Promise<{ ok: boolean; error?: string }> {
  const eventId = await requireStaffEvent();
  // Not behind the lock: the beaten semi-finalists are only known during the
  // event. Additive, and refuses a second play-off below (2026-09-27).
  // WHETHER there is one stays setup — `setThirdPlace` keeps its lock.

  const stage = await prisma.stage.findFirst({
    where: { id: stageId, eventId },
    select: { id: true, thirdPlace: true, holes: true, position: true },
  });
  if (!stage) return { ok: false, error: "That round isn't in this tournament." };
  if (!stage.thirdPlace) return { ok: false, error: "This knockout isn't playing off for third." };

  const state = await loadEventState(eventId);
  const resolved = resolveThirdPlace(state?.brackets.winners ?? null);
  if (!resolved.pairing) return { ok: false, error: resolved.problem };

  const { a, b } = resolved.pairing;
  if (!a.playerId || !b.playerId) return { ok: false, error: resolved.problem || "No beaten semi-finalists yet." };

  /**
   * One third-place match per knockout.
   *
   * Marked by its round number so it cannot be confused with a bracket match
   * and cannot be created twice — `round: 0` is used by nothing else, and a
   * second play-off for third is not a thing.
   */
  const existing = await prisma.match.findFirst({
    where: { eventId, stageId, round: 0 },
    select: { id: true },
  });
  if (existing) return { ok: false, error: "The play-off for third has already been made." };

  // Both ids came from the bracket, which is built from this event's field —
  // the where clause says so anyway rather than trusting a value that arrived
  // through three functions.
  const both = await prisma.player.findMany({
    where: { eventId, id: { in: [a.playerId, b.playerId] } },
    select: { id: true },
  });
  if (both.length !== 2) return { ok: false, error: "Those players aren't both in this tournament." };

  const groupId = await matchCarrierGroup(eventId, stage.id, `Play-off for third — Round ${stage.position + 1}`);
  const emptyHoles = JSON.stringify(new Array(holesPlayed(stage.holes)).fill(null));

  await prisma.match.create({
    data: { eventId, stageId, groupId, round: 0, playerAId: a.playerId, playerBId: b.playerId, holes: emptyHoles },
  });
  await logAudit(eventId, "third-place", `Created the play-off for third: ${a.name} v ${b.name}`);
  await refresh();
  return { ok: true };
}

/**
 * THIS TOURNAMENT'S OWN DATE AND MONEY CONVENTIONS, overriding the club's.
 *
 * Empty for either means follow the club, which is what almost every
 * tournament wants and what every existing row holds. They are two separate
 * values rather than one "run this in American" switch, because they are two
 * questions: a club in Osaka pricing an invitational in dollars still writes
 * its dates the Japanese way.
 *
 * ANY ISO CURRENCY, checked against `Intl`'s real list of about three hundred
 * rather than a shape test — `Intl` formats any three letters happily, so
 * "ABC" would otherwise land in the column looking deliberate.
 *
 * NOTHING IS CONVERTED, EVER. A tournament's currency is what its players pay
 * in and settle in; the app applies no exchange rate and holds no rate to
 * apply — the same line CLAUDE.md draws when it says this app calculates and
 * records money and never moves it.
 *
 * What follows from that, and is the one sharp edge here: amounts are stored
 * in MINOR UNITS, so changing the currency after money has been entered
 * re-labels those amounts rather than converting them. 123400 stored is
 * $1,234.00 and is also ¥123,400, and switching between the two is a
 * hundredfold change in what the number means with no arithmetic involved.
 * The control says so in as many words, and says to set it before taking any
 * money.
 *
 * Deliberately NOT guarded against here. Refusing the change once a pot exists
 * would need this action to know about every surface that records an amount —
 * pots, prizes, expenses, buy-ins — which is a second definition of "has money"
 * to keep in step with the real one, and the wrong shape for a setting an
 * organizer may legitimately be correcting.
 *
 * NOT GATED BY `assertUnlocked`, unlike the rest of this screen's settings,
 * and that is a decision rather than an oversight. The lock exists because
 * changing the field, the rounds or the format after a tournament has started
 * changes what is being played and what the standings mean. This changes
 * neither: it decides whether a date is written 14 May or May 14. The moment
 * an organizer most needs it is precisely after the field has arrived and
 * somebody has misread a date — which is exactly when the lock would be on.
 */
export async function setEventFormatting(
  localeOverride: string,
  currencyOverride: string,
): Promise<{ ok: boolean; error?: string }> {
  const eventId = await requireAdminEvent();

  const tag = (localeOverride ?? "").trim();
  if (tag && !isSupportedLocale(tag)) {
    return { ok: false, error: "Pick a region from the list, or leave it following the club." };
  }

  const code = (currencyOverride ?? "").trim().toUpperCase();
  if (code && !isCurrencyCode(code)) {
    return { ok: false, error: "Pick a currency from the list, or leave it following the club." };
  }

  await prisma.event.update({
    where: { id: eventId },
    data: { localeOverride: tag, currencyOverride: code },
  });
  // The layout resolves this once for the whole tree — see formattingForEvent.
  revalidatePath("/", "layout");
  return { ok: true };
}
