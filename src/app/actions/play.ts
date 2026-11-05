"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { boardChanged } from "@/lib/services/board-refresh";
import { prisma } from "@/lib/db";
import { normalizeAccessCode, looksLikeAccessCode } from "@/lib/code-format";
import { createPlaySession, destroyPlaySession, getPlaySession } from "@/lib/play-auth";
import { settingsOf } from "@/lib/services/tournament";
import { usesAccessCodes, canPlayerSavePartial, allowsAutoConfirm } from "@/lib/tournament-settings";
import { playerEntryRefusal, roundScoring } from "@/lib/domain/round-scoring";
import { isInMatch, mayWriteMatch, playersInMatch } from "@/lib/services/match-membership";
import { keeperGate, claimGroup, handOverKeeping, roundTeeSheet, otherRoundsTeeGroups } from "@/lib/services/group-keeping";
import { attestMatch, matchSidesOf, endCheckRule } from "@/lib/services/attestation";
import { effectiveScoreStatus } from "@/lib/services/tournament";
import { isCardLocked, isPartnerCardSigned, LOCKED_CARD_REFUSAL, SIGNED_PARTNER_REFUSAL } from "@/lib/domain/card-approval";
import { assertSignsCards } from "@/lib/services/scorecard-write";
import { checkRateLimit, clearRateLimit } from "@/lib/rate-limit";
import { playRefusalFor } from "@/lib/services/action-shared";
import { archiveRefusalFor } from "@/lib/services/club-archive";
import { cleanHoleResults, cleanStrokes, strokeFault } from "@/lib/domain/score-payload";
import { matchIsOver } from "@/lib/domain/match";
import { roundCodeName } from "@/lib/domain/round-label";
import { marginRefusal, marginToHoles } from "@/lib/domain";
import { writeScorecard, certifyCard, assertRoundOpen, storedCard } from "@/lib/services/scorecard-write";
import { holesPlayed } from "@/lib/domain/handicap";
import { logAudit } from "@/lib/services/action-shared";
import { lineupHidden, LINEUP_HIDDEN } from "@/lib/domain/cup-lineup";
import { keptByRefusal } from "@/lib/services/match-kept-by";
import { deriveMatchFromItsCards, recomputeTeamMatch } from "@/lib/services/match-from-cards";
import { freezeRoundHandicaps } from "@/lib/services/round-handicap";
import { isReturnedCard } from "@/lib/domain/round-handicap";
import { oneCardPerSide } from "@/lib/domain/team-entry";
import { type TeeSheetGroup } from "@/lib/domain/tee-sheet";
import { groupsOfRound, withBorrowedTeeTimes, type PlayGroup, type PlayTarget } from "@/lib/domain/play-groups";
import { matchKeptBy } from "@/lib/domain/match-kept-by";

/**
 * Redeeming a Round Code.
 *
 * The code is a shared secret announced to a field, so the security here rests
 * on rate limiting rather than on the code's length: 27^8 is a large space,
 * but only if an attacker can't sit there trying it.
 *
 * The allowance and the wording live in src/lib/domain/rate-limit.ts; the
 * counters live in Postgres, because until recently they lived in the memory
 * of a serverless instance and an attacker got a fresh budget every time they
 * landed on a cold one.
 */

export interface RedeemResult {
  ok: boolean;
  error?: string;
  /**
   * The field for that round: the list a scorer picks from where the round has
   * no groups, and what "find your group by a name" searches.
   */
  players?: Array<{ id: string; name: string }>;
  /**
   * The round's GROUPS, which the scorer picks from instead of a name
   * (`play-groups.ts`): its matches, when it draws them and their lineup is
   * public, or its published tee sheet's groups. Empty for a round with
   * neither, which keeps the list of names.
   */
  groups?: PlayGroup[];
  stageId?: string;
  /**
   * The tournament, so a phone can remember its group across the rounds of it
   * (`rememberedGroup`). An id, not a name or a secret: it is what the page's
   * own session already carries.
   */
  eventId?: string;
  eventName?: string;
  roundLabel?: string;
  /**
   * The round is kept by ONE SCORER PER GROUP (2026-11-05, phase 2): the phone
   * keeps the whole group's card, so "whose card" in a group of stroke cards is
   * asked as "which one are you".
   */
  keepsGroups?: boolean;
}

export async function redeemRoundCode(input: string): Promise<RedeemResult> {
  const code = normalizeAccessCode(input);

  // Shape-check before touching the database, so junk costs nothing.
  if (!looksLikeAccessCode(code)) {
    return { ok: false, error: "That doesn't look like a round code. It's 8 characters, like ABCD-EFGH." };
  }

  // Keyed on the code rather than on a caller identity, which we don't have
  // here — this caps how fast any one code can be guessed at.
  const limit = await checkRateLimit("round-code", code);
  if (!limit.allowed) return { ok: false, error: limit.message };

  const stage = await prisma.stage.findFirst({
    where: { accessCode: code },
    include: { event: true },
  });
  // Same message whether the code is wrong or the tournament has since turned
  // code access off — no reason to confirm that a code was once real.
  if (!stage || !usesAccessCodes(settingsOf(stage.event))) {
    return { ok: false, error: "That code isn't valid. Check it with your organizer." };
  }

  const players = await prisma.player.findMany({
    where: { eventId: stage.eventId, status: "confirmed" },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  // `type` as well as `id` — see play-auth: the number counts rounds, not rows,
  // and a cut is a row that is not a round.
  const stages = await prisma.stage.findMany({
    where: { eventId: stage.eventId },
    orderBy: { position: "asc" },
    select: { id: true, type: true, format: true, holes: true, nine: true },
  });

  await clearRateLimit("round-code", code);
  return {
    ok: true,
    players,
    groups: await playGroups(stage, players),
    stageId: stage.id,
    eventId: stage.eventId,
    eventName: stage.event.name,
    // Which round and which holes, so the wrong nine's code shows on the
    // first screen after it is typed.
    roundLabel: roundCodeName(stages, stages.find((s) => s.id === stage.id) ?? stage),
    keepsGroups: roundScoring(stage).scoreKeeping === "group",
  };
}

/**
 * THE ROUND'S MATCHES, AS THE PLAYERS STAND ON THE TEE (2026-10-16).
 *
 * Ajay, setting up a real cup: one code for the whole round, then a name to
 * tap out of twenty — "can you keep it to the foursome?". The code stays one
 * per round; what changes is the list, which is the round's matches, in draw
 * order. A four-ball match IS the foursome. Only the players the code already
 * lists are named, so it reveals nothing the flat list did not, beyond who is
 * drawn against whom.
 *
 * THE TEE SHEET: the round's OWN published one (`roundTeeSheet`), the same
 * reader the keeper takes its groups from, so the list and the keeper cannot
 * disagree. It once fell back to the tournament's other published sheet ("a
 * cup's second nine is the same four"); the Golf Pro ruled on 2026-11-05 that
 * a round's groups come from that round's sheet only — a four-ball session
 * with no sheet of its own lists its matches, each its own group. Null when
 * there is none.
 */
async function publishedSheet(stageId: string, eventId: string): Promise<TeeSheetGroup[] | null> {
  const sheet = await roundTeeSheet(eventId, stageId);
  return sheet && sheet.groups.length > 0 ? sheet.groups : null;
}

/**
 * THE GROUPS A SCORER PICKS FROM (2026-11-04) — see `play-groups.ts`. A round
 * that draws matches, announced: each match, with its tee time where there is
 * a sheet. Otherwise the published sheet's groups. Otherwise none, and the
 * page keeps the names. A cup lineup the organizer has not announced is never
 * shown as matches: that is who is drawn against whom.
 */
async function playGroups(
  stage: { id: string; eventId: string; type: string; format: string; scoreInput: string | null; matchKeptBy: string | null; lineupPublished: boolean | null },
  players: Array<{ id: string; name: string }>,
): Promise<PlayGroup[]> {
  const names = new Map(players.map((p) => [p.id, p.name]));
  const sheet = await publishedSheet(stage.id, stage.eventId);
  const hidden = lineupHidden(stage);
  const matches = hidden
    ? []
    : await prisma.match.findMany({
        where: { stageId: stage.id },
        orderBy: [{ round: "asc" }, { id: "asc" }],
        select: { id: true, playerAId: true, playerBId: true, teamAId: true, teamBId: true },
      });
  const teamIds = matches.flatMap((m) => [m.teamAId, m.teamBId]).filter((id) => id !== "");
  const members = teamIds.length
    ? await prisma.teamMember.findMany({
        where: { teamId: { in: teamIds } },
        orderBy: { position: "asc" },
        select: { teamId: true, playerId: true },
      })
    : [];
  const side = (playerId: string, teamId: string) =>
    playerId !== "" ? [playerId] : members.filter((m) => m.teamId === teamId).map((m) => m.playerId);
  // The one answer, shared with the print kit's signs (`groupsOfRound`).
  const groups = groupsOfRound({
    lineupHidden: hidden,
    matches: matches.map((m) => ({ id: m.id, a: side(m.playerAId, m.teamAId), b: side(m.playerBId, m.teamBId) })),
    names,
    sheet,
    // A match kept on stroke cards is four people's own cards; one kept by
    // tapping is one card, the same whoever opens it.
    oneMatch: matchKeptBy(stage) !== "cards",
  });
  if (sheet) return groups;
  /**
   * A ROUND WITH NO SHEET OF ITS OWN MAY STILL HAVE A TEE TIME (Ajay,
   * 2026-10-16: "we already have foursome for this tournament" — a cup's second
   * nine is the same four). Borrowed from another round's published group, the
   * TIME ONLY and only when that group is exactly this match's players
   * (`withBorrowedTeeTimes` / `samePlayers`); never its grouping or its name,
   * which come from this round alone (`roundTeeSheet`).
   */
  return withBorrowedTeeTimes(groups, await otherRoundsTeeGroups(stage.eventId, stage.id), new Set(names.keys()));
}

export interface ClaimResult {
  ok: boolean;
  error?: string;
  /**
   * What a save left on the server, read back from the row it wrote — the
   * honest card's "Sent" is measured against this, never against the card
   * that was sent (2026-10-25). A stroke card's strokes; a match's holes,
   * A-relative as stored.
   */
  card?: (number | null)[];
  holes?: Array<"A" | "B" | "H" | null>;
  /**
   * On a round kept by ONE SCORER PER GROUP: the epoch this phone now holds
   * as its group's scorer, to send with its next save (`keeperGate`). Absent
   * on a round where each player keeps their own.
   */
  epoch?: number;
  /**
   * A save REFUSED because the group's card is kept on another phone: whose
   * (2026-11-05, phase 2). The screen then stops claiming progress — the pad
   * read "18/18 holes" under the refusal — and follows the group instead.
   */
  keptBy?: string;
}

/**
 * What a save from the round-code surface may carry beyond the score itself
 * (2026-11-04, sprint 2 part B). Optional, so a screen written before it goes
 * on working: it sends neither, and is held to its own card or match.
 *
 *   epoch     the epoch the phone holds as its group's scorer; a stale one is
 *             refused in words (the card moved to another phone).
 *   playerId  WHOSE card or ball, when the scorer keeps a groupmate's. Only on
 *             a round kept by one scorer per group, and only for somebody in
 *             the group whose card this phone keeps.
 */
export interface PlaySaveOptions {
  epoch?: number;
  playerId?: string;
}

/** The epoch as sent, or undefined — a `"use server"` argument is whatever was posted. */
function sentEpoch(opts: PlaySaveOptions | undefined): number | undefined {
  const e = opts?.epoch;
  return typeof e === "number" && Number.isInteger(e) && e > 0 ? e : undefined;
}

/**
 * MAY A PLAYER ENTER SCORES ON THE ROUND THIS CODE OPENED — the one gate
 * (`playerEntryRefusal`): the tournament's "staff" setting wins, and a round
 * the organizer keeps from paper cards refuses players on its own.
 */
async function entryRefusal(session: { eventId: string; stageId: string }, settings: { scoreEntryBy: string }): Promise<string | null> {
  const stage = await prisma.stage.findFirst({
    where: { id: session.stageId, eventId: session.eventId },
    select: { scoreKeeping: true, endCheck: true },
  });
  return playerEntryRefusal(settings, stage);
}

/** A match's stored holes, read back: A-relative, one per hole of the round. */
function storedHoles(json: string): Array<"A" | "B" | "H" | null> {
  let raw: unknown = [];
  try {
    raw = JSON.parse(json);
  } catch {
    raw = [];
  }
  return (Array.isArray(raw) ? raw : []).map((h) => (h === "A" || h === "B" || h === "H" ? h : null));
}

/**
 * Say which player you are, and start the play session.
 *
 * Re-checks the code rather than trusting the stageId the browser sends back:
 * without that, someone who once saw a valid code could keep claiming slots
 * after it was reissued.
 */
export async function claimPlayerSlot(rawCode: string, playerId: string): Promise<ClaimResult> {
  const code = normalizeAccessCode(rawCode);
  if (!looksLikeAccessCode(code)) return { ok: false, error: "That code isn't valid." };

  // Rate limited on the same key as redeemRoundCode, and it must be: this
  // performs the identical accessCode lookup, so without a limit here an
  // attacker simply guesses codes through this action instead and the limit on
  // the other one counts for nothing. Sharing the key means attempts against a
  // code are capped however they arrive.
  const limit = await checkRateLimit("round-code", code);
  if (!limit.allowed) return { ok: false, error: limit.message };

  const stage = await prisma.stage.findFirst({
    where: { accessCode: code },
    include: { event: true },
  });
  if (!stage || !usesAccessCodes(settingsOf(stage.event))) {
    return { ok: false, error: "That code isn't valid." };
  }

  const player = await prisma.player.findFirst({
    where: { id: playerId, eventId: stage.eventId, status: "confirmed" },
    select: { id: true, name: true },
  });
  // Same message as a bad code. Saying "pick your name from the list" here
  // would confirm that the code was real — turning a failed claim into a
  // reliable oracle for which codes exist.
  if (!player) return { ok: false, error: "That code isn't valid." };

  // A genuine claim resets the budget, so a fourball fumbling the code on the
  // first tee doesn't lock the group out of the round they're about to play.
  await clearRateLimit("round-code", code);
  // The stored code, not the typed one, so the session is bound to the row a
  // reissue will overwrite.
  await createPlaySession(stage.id, player.id, stage.accessCode);
  /**
   * THE ONE CONFIRMATION IS THE CLAIM (2026-11-05, phase 2). "You're keeping
   * Group 3: …" was said and answered yes, so on a round kept by one scorer per
   * group this phone keeps the group's card — unless somebody already does, in
   * which case nothing moves and the card opens following theirs ("Group 3 is
   * being kept on Ann's phone"), with Take over one press away. Never a
   * take-over: a second phone confirming the same group must not cut the first
   * one off. An upsert (`claimGroup`), so two phones confirming at once leave
   * one scorer. Only where a player may enter at all.
   */
  if (roundScoring(stage).scoreKeeping === "group" && playerEntryRefusal(settingsOf(stage.event), stage) === null) {
    await claimGroup({ eventId: stage.eventId, stageId: stage.id, actorId: player.id, actorName: player.name, takeOver: false });
  }
  revalidatePath("/play");
  return { ok: true };
}

/**
 * THE ROUND CODE WORKS BEFORE THE PAGE'S SCRIPT HAS ARRIVED (2026-10-25).
 *
 * Measured on slow 3G (`e2e/round-code-on-3g.spec.ts`): the code box was drawn
 * at 1.8 s and Continue could not be pressed until 7.8 s, because it waited for
 * the page's whole script, 193 KB of it, sharing one bar of signal with 105 KB
 * of fonts. So the box and the names are real forms now. A press made before
 * the script is held until it arrives (`HeldBeforeLoad`), and the page calls
 * `redeemRoundCode` and `claimPlayerSlot` itself, as it always did. With no
 * script — or none ten seconds after the press — the forms are posted to
 * these two the plain way and the server draws the next step. These call the
 * same two, so the answer — the names, the refusal in words, the session — is
 * one answer whichever way the press went.
 *
 * Shaped for `useActionState` (the state before, then the form), because that
 * is how the server hands the result of a plain post to the page it draws.
 */
export interface RedeemFormState extends RedeemResult {
  /** The code as it goes on to the name step, or as it was typed when refused. */
  code: string;
}

export async function redeemRoundCodeForm(_before: RedeemFormState | null, form: FormData): Promise<RedeemFormState> {
  const typed = String(form.get("code") ?? "").slice(0, 64);
  const res = await redeemRoundCode(typed);
  return { ...res, code: res.ok ? normalizeAccessCode(typed) : typed };
}

/**
 * A group or a name tapped with no script: the steps the page takes, drawn by
 * the server instead (2026-11-04). The one confirmation first ("You're keeping
 * Group 3 …" — `keepingSentence`), then, in a group of somebody's own cards,
 * whose card; then the session starts and the card is drawn, or the refusal is.
 * The same groups the page draws (`redeemRoundCode`), so the same answer.
 */
export interface ClaimFormState extends ClaimResult {
  /** The step to draw next: the confirmation, or whose card in the group. */
  step?: { kind: "confirm"; target: PlayTarget } | { kind: "pick"; group: PlayGroup };
  code?: string;
  stageId?: string;
  eventId?: string;
  eventName?: string;
  roundLabel?: string;
  keepsGroups?: boolean;
}

export async function claimPlayerSlotForm(_before: ClaimFormState | null, form: FormData): Promise<ClaimFormState> {
  const code = String(form.get("code") ?? "").slice(0, 64);
  const playerId = String(form.get("playerId") ?? "").slice(0, 64);
  const groupKey = String(form.get("group") ?? "").slice(0, 128);
  const confirmed = form.get("confirmed") === "yes";
  let res: ClaimResult;
  if (!confirmed || (groupKey && !playerId)) {
    const round = await redeemRoundCode(code);
    if (!round.ok) return { ok: false, error: round.error };
    const context = {
      code: normalizeAccessCode(code),
      stageId: round.stageId,
      eventId: round.eventId,
      eventName: round.eventName,
      roundLabel: round.roundLabel,
      keepsGroups: round.keepsGroups,
    };
    const group = groupKey ? round.groups?.find((g) => g.key === groupKey) : undefined;
    const player = playerId ? round.players?.find((p) => p.id === playerId) : undefined;
    if (!group && !player) return { ok: false, error: "That code isn't valid.", ...context };
    if (!confirmed) {
      const target: PlayTarget = group ? { kind: "group", group } : { kind: "player", id: player!.id, name: player!.name };
      return { ok: false, step: { kind: "confirm", target }, ...context };
    }
    // Confirmed, a group: its one match, or whose card in it.
    if (group!.oneMatch || group!.players.length === 1) res = await claimPlayerSlot(code, group!.players[0]?.id ?? "");
    else return { ok: false, step: { kind: "pick", group: group! }, ...context };
  } else {
    res = await claimPlayerSlot(code, playerId);
  }
  // Outside any try: `redirect` works by throwing.
  if (res.ok) redirect("/play");
  return res;
}

export async function leavePlay(): Promise<void> {
  await destroyPlaySession();
  revalidatePath("/play");
}

/**
 * Save the signed-in play session's own match card.
 *
 * A separate action from the console's `saveMatchHoles` because the
 * authorization is completely different: this trusts a Round Code rather than
 * an account, so it re-derives everything from the session and refuses to
 * touch any match the holder isn't playing in.
 */
export async function savePlayMatchHoles(
  matchId: string,
  holes: Array<"A" | "B" | "H" | null>,
  opts?: PlaySaveOptions,
): Promise<ClaimResult> {
  const session = await getPlaySession();
  if (!session) return { ok: false, error: "Your session expired. Enter the round code again." };
  // Paused in a lapsed club's read-only archive (2026-10-21), said beside the press.
  const archived = await archiveRefusalFor(session.eventId, "player");
  if (archived) return { ok: false, error: archived };

  const [event, match] = await Promise.all([
    prisma.event.findUnique({ where: { id: session.eventId } }),
    prisma.match.findUnique({ where: { id: matchId } }),
  ]);
  if (!event || !match) return { ok: false, error: "Match not found." };

  const settings = settingsOf(event);
  // The tournament decides who reports scores, and this surface has to ask the
  // same question the console does — see requireScoreEntry in
  // actions/tournament.ts and the same check in actions/courses.ts.
  //
  // A round code identifies a player and never staff, so a committee-scored
  // tournament must refuse it outright. Without this, an organizer who handed
  // out round codes purely so the field could sign in believed nobody but the
  // committee could touch a result, while any code holder could overwrite a
  // card and — because a score edit always resets approval — send one the
  // committee had already confirmed back to pending with nobody told.
  // And a round the organizer keeps from paper cards refuses it too.
  const refused = await entryRefusal(session, settings);
  if (refused) return { ok: false, error: refused };

  // AND THE TOURNAMENT HAS TO HAVE STARTED. Launch is the transition from
  // setting up to playing and it gated nothing, so a tournament left in draft
  // played a whole round with only a banner to say so. See playRefusal: a
  // tournament already under way is deliberately NOT stopped halfway.
  const notStarted = await playRefusalFor(session.eventId);
  if (notStarted) return { ok: false, error: notStarted };

  // Scoped three ways: the right tournament, the right round, and a match this
  // player may write.
  if (match.eventId !== session.eventId || match.stageId !== session.stageId) {
    return { ok: false, error: "That match isn't in your round." };
  }
  // Not on a round kept on stroke cards (`matchKeptBy`).
  const keptOnCards = await keptByRefusal(match.stageId, "holes");
  if (keptOnCards) return { ok: false, error: keptOnCards };
  // Their own match — on either side, a four-ball partner included — or, on a
  // round kept by one scorer per group, a match in the group whose card this
  // phone keeps (`mayWriteMatch`, services/match-membership.ts).
  const may = await mayWriteMatch({ eventId: session.eventId, match, actorIds: [session.playerId], epoch: sentEpoch(opts) });
  if (!may.ok) return { ok: false, error: may.error, ...(may.keeperName !== undefined ? { keptBy: may.keeperName } : {}) };

  // The payload itself, which nothing checked until now. The signature says
  // Array<"A"|"B"|"H"|null> and that type is erased at runtime, so what
  // arrives is whatever was posted. It is not inert once stored: holes.length
  // decides how nassau segments a match and which holes the tiebreakers read,
  // so a wrong-length array changes the RESULT rather than just the row.
  const stage = await prisma.stage.findUnique({
    where: { id: match.stageId },
    select: { holes: true, type: true, lineupPublished: true },
  });
  // A cup lineup not yet announced is nobody's match to score — the same
  // refusal the console's paths give (`assertOwnMatch`).
  if (stage && lineupHidden(stage)) return { ok: false, error: LINEUP_HIDDEN };
  const clean = cleanHoleResults(holes, holesPlayed(stage?.holes));
  if (!clean) {
    return { ok: false, error: "Those scores aren't valid. Reload the round and try again." };
  }

  // Over when one side is up more holes than are left (Rule 3.2a(3)), as the
  // console's path asks it: "every hole filled" kept a match won 5&4 from ever
  // being submitted whole, or stamped as scored.
  const complete = matchIsOver(clean);
  if (!complete && !canPlayerSavePartial(settings)) {
    return { ok: false, error: "Enter the full round, then submit it." };
  }

  const written = await prisma.match.update({
    where: { id: matchId },
    select: { holes: true },
    data: {
      holes: JSON.stringify(clean),
      scoreStatus: "pending",
      scoredAt: complete ? new Date() : null,
      confirmedById: null,
      // Who wrote it down, by name AND by player id. The id is what stops the
      // author signing their own result off — see services/attestation.ts. The
      // round-code surface recorded neither, so a result entered from a phone
      // on the course had no author at all.
      enteredBy: session.playerName,
      enteredById: session.playerId,
      // A new entry supersedes any signatures already collected: they attested
      // a different scoreline.
      attestedBy: "[]",
    },
  });
  await logAudit(session.eventId, "score", "Entered via round code", { matchId, actor: session.playerName });

  // The standings just moved, so the crowd watching the public board should
  // see it now rather than when its sixty-second backstop expires.
  boardChanged(session.eventId);
  revalidatePath("/", "layout");
  return { ok: true, holes: storedHoles(written.holes), ...(may.epoch !== null ? { epoch: may.epoch } : {}) };
}

/**
 * The result phoned in from the green: winner and margin, nothing else.
 *
 * The most-used quick path in real match play — "3&2" — brought to the
 * round-code surface with exactly the checks the console path has: the same
 * membership guard as savePlayMatchHoles, and the same refusal of margins
 * that describe no possible match. It reconstructs holes via marginToHoles so
 * a phoned-in result and a tapped-in card are identical downstream.
 *
 * No canPlayerSavePartial check here, unlike the hole-by-hole path: a result
 * IS the finished round arriving in one submission, which is precisely what
 * `scoreEntryWindow: "after"` asks for. The nulls marginToHoles leaves for a
 * closed-out "3&2" are holes nobody played, not holes nobody has reached yet,
 * so reading them as a partial card would refuse the most common real result
 * in match play.
 */
/** Hole count from the stored holes array (9 or 18 depending on the round). */
function matchHoleCount(holesJson: string): number {
  try {
    const parsed = JSON.parse(holesJson) as unknown[];
    return Array.isArray(parsed) && parsed.length > 0 ? parsed.length : 18;
  } catch {
    return 18;
  }
}

export async function savePlayMatchResult(
  matchId: string,
  winner: "A" | "B" | "H",
  margin: string,
  opts?: PlaySaveOptions,
): Promise<ClaimResult> {
  const session = await getPlaySession();
  if (!session) return { ok: false, error: "Your session expired. Enter the round code again." };
  // Paused in a lapsed club's read-only archive (2026-10-21), said beside the press.
  const archived = await archiveRefusalFor(session.eventId, "player");
  if (archived) return { ok: false, error: archived };

  const [event, match] = await Promise.all([
    prisma.event.findUnique({ where: { id: session.eventId } }),
    prisma.match.findUnique({ where: { id: matchId } }),
  ]);
  if (!event || !match) return { ok: false, error: "Match not found." };

  // Same entry gate as savePlayMatchHoles. Both write a result, so a guard on
  // only one of them protects nothing: phoning in "3&2" overwrites the card
  // just as completely as tapping eighteen holes.
  const refused = await entryRefusal(session, settingsOf(event));
  if (refused) return { ok: false, error: refused };

  // AND THE TOURNAMENT HAS TO HAVE STARTED. Launch is the transition from
  // setting up to playing and it gated nothing, so a tournament left in draft
  // played a whole round with only a banner to say so. See playRefusal: a
  // tournament already under way is deliberately NOT stopped halfway.
  const notStarted = await playRefusalFor(session.eventId);
  if (notStarted) return { ok: false, error: notStarted };

  if (match.eventId !== session.eventId || match.stageId !== session.stageId) {
    return { ok: false, error: "That match isn't in your round." };
  }
  // A round kept on stroke cards takes strokes, not a phoned-in result.
  const keptOnCards = await keptByRefusal(match.stageId, "holes");
  if (keptOnCards) return { ok: false, error: keptOnCards };

  // Same rule as savePlayMatchHoles (`mayWriteMatch`): their own match, or on
  // a round kept by one scorer per group, a match whose card this phone keeps.
  const may = await mayWriteMatch({ eventId: session.eventId, match, actorIds: [session.playerId], epoch: sentEpoch(opts) });
  if (!may.ok) return { ok: false, error: may.error, ...(may.keeperName !== undefined ? { keptBy: may.keeperName } : {}) };

  const resultStage = await prisma.stage.findUnique({
    where: { id: match.stageId },
    select: { type: true, lineupPublished: true },
  });
  if (resultStage && lineupHidden(resultStage)) return { ok: false, error: LINEUP_HIDDEN };

  if (winner !== "A" && winner !== "B" && winner !== "H") {
    return { ok: false, error: "Pick a winner, or halved." };
  }

  // A winner needs a margin, and one a match can finish on — the one rule every
  // door asks. "I won" with the box left empty was stored as a halved match.
  const total = matchHoleCount(match.holes);
  margin = String(margin ?? "");
  const refusal = marginRefusal(winner, margin, total);
  if (refusal) return { ok: false, error: refusal };

  const holes = marginToHoles(winner, margin, total);
  await prisma.match.update({
    where: { id: matchId },
    data: {
      holes: JSON.stringify(holes),
      scoreStatus: "pending",
      scoredAt: new Date(),
      confirmedById: null,
      /**
       * WHO PHONED IT IN, and a clean slate of signatures (2026-11-04). The
       * hole-by-hole save beside this has set both since it was written; this
       * one set neither, so a phoned-in "3&2" had no author — its author could
       * confirm it — and a signature collected on the OLD scoreline survived
       * the new one. `attestation.audit.test.ts` holds both.
       */
      enteredBy: session.playerName,
      enteredById: session.playerId,
      attestedBy: "[]",
    },
  });
  await logAudit(session.eventId, "score", `Result entered via round code: ${winner === "H" ? "halved" : margin || "1 UP"}`, { matchId, actor: session.playerName });
  boardChanged(session.eventId);
  revalidatePath("/", "layout");
  return { ok: true, ...(may.epoch !== null ? { epoch: may.epoch } : {}) };
}

/**
 * A stroke card, entered with a Round Code.
 *
 * THE HALF THIS SURFACE DID NOT HAVE. Everything above scores a MATCH, so a
 * medal round with code access — which is exactly what the charity-day
 * template sets up, with `scoreEntryBy: "players"` and a Round Code so a
 * roster of names can get in without accounts — sent every player who
 * redeemed their code to "No match for you in Round 1. Check with your
 * organizer." Walked on 2026-09-10. There was nothing wrong with the draw;
 * there is simply no draw in a medal, and this was the only door.
 *
 * IT WRITES THROUGH `writeScorecard`, the same function the console's own
 * entry screen uses. Validation, the partial-card rule, the revision
 * conflict, whether a save retracts a certification and when a round's
 * handicaps freeze are all rules with real subtlety and a bug behind each —
 * a second copy of them here is how two writers of one card come to disagree.
 *
 * THE AUTHORIZATION IS THIS FILE'S OWN, and that is the half that must never
 * be shared. A round code identifies a player and never staff, so it asks the
 * same two questions `savePlayMatchHoles` asks — does the tournament let
 * players report at all, and is this round the one the code opened — and adds
 * nothing about roles, because there is no role here to add.
 */
export async function savePlayCard(strokes: (number | null)[], opts?: PlaySaveOptions): Promise<ClaimResult> {
  const session = await getPlaySession();
  if (!session) return { ok: false, error: "Your session expired. Enter the round code again." };
  // Paused in a lapsed club's read-only archive (2026-10-21), said beside the press.
  const archived = await archiveRefusalFor(session.eventId, "player");
  if (archived) return { ok: false, error: archived };

  const [event, stage] = await Promise.all([
    prisma.event.findUnique({ where: { id: session.eventId } }),
    prisma.stage.findUnique({ where: { id: session.stageId }, select: { id: true, eventId: true } }),
  ]);
  if (!event || !stage) return { ok: false, error: "Round not found." };

  // The round the code opened has to belong to the tournament the session
  // names. Both come off the signed cookie, so this cannot normally differ —
  // and "cannot normally" is not a reason to write a card without asking.
  if (stage.eventId !== session.eventId) return { ok: false, error: "That round isn't in your tournament." };

  const settings = settingsOf(event);
  /**
   * The same refusal the match path gives, for the same reason. A committee-
   * scored tournament must refuse a round code outright: without this, an
   * organizer who handed out codes purely so the field could sign in believed
   * only the committee could touch a result, while any code holder could
   * overwrite a card — and a score edit always resets approval, so one the
   * committee had already confirmed would go back to pending with nobody told.
   * And a round the organizer keeps from paper cards refuses it too.
   */
  const refused = await entryRefusal(session, settings);
  if (refused) return { ok: false, error: refused };

  // AND THE TOURNAMENT HAS TO HAVE STARTED. Launch is the transition from
  // setting up to playing and it gated nothing, so a tournament left in draft
  // played a whole round with only a banner to say so. See playRefusal: a
  // tournament already under way is deliberately NOT stopped halfway.
  const notStarted = await playRefusalFor(session.eventId);
  if (notStarted) return { ok: false, error: notStarted };

  // A closed round takes no more cards from a player — see `assertRoundOpen`.
  try {
    await assertRoundOpen(session.eventId, session.stageId);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "This round is closed." };
  }

  /**
   * The card is written for the player the SESSION names — or, on a round
   * kept by ONE SCORER PER GROUP, for a groupmate whose card this phone keeps
   * (2026-11-04). Never for anybody else: a round code is a shared secret
   * announced to a field, so anybody holding it could otherwise write
   * anybody's card. `keeperGate` decides the second case, and refuses a phone
   * that is not the group's scorer — its own card included.
   */
  const asked = typeof opts?.playerId === "string" && opts.playerId ? opts.playerId : session.playerId;
  const kept = await keeperGate({
    eventId: session.eventId,
    stageId: session.stageId,
    actorIds: [session.playerId],
    targetIds: [asked],
    epoch: sentEpoch(opts),
  });
  if (kept.applies && !kept.ok) return { ok: false, error: kept.error, ...(kept.keeperName !== undefined ? { keptBy: kept.keeperName } : {}) };
  if (asked !== session.playerId) {
    if (!kept.applies) return { ok: false, error: "You can only enter your own card." };
    const target = await prisma.player.findFirst({
      where: { id: asked, eventId: session.eventId, status: "confirmed" },
      select: { name: true },
    });
    if (!target) return { ok: false, error: "That player isn't in this round." };
    // A card its player has signed is the committee's to correct (Rule 3.3b) —
    // the scorer may not step it, as a marker may not on the console.
    const theirs = await prisma.scorecard.findFirst({
      where: { eventId: session.eventId, stageId: session.stageId, playerId: asked },
      select: { status: true },
    });
    if (theirs && isPartnerCardSigned(theirs.status)) return { ok: false, error: SIGNED_PARTNER_REFUSAL(target.name) };
  }
  let stored: (number | null)[] = [];
  try {
    const result = await writeScorecard({
      eventId: session.eventId,
      stageId: session.stageId,
      playerId: asked,
      strokes,
      settings,
      role: "player",
      // The phone is holding the card it just typed, and this surface has no
      // offline queue behind it — the console's conflict path is for a replay
      // arriving minutes late, which cannot happen here.
      expectedRevision: undefined,
    });
    if (!result.ok) {
      return { ok: false, error: "Somebody else has changed this card. Reload and try again." };
    }
    stored = result.stored;
  } catch (e) {
    // `writeScorecard` throws on an invalid payload, a partial card that is
    // not allowed and a locked card, exactly as it did inside the console
    // action. This surface reports rather than crashes: the message is written
    // for a player standing on the 18th green, not for a stack trace.
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't save that card." };
  }

  await logAudit(
    session.eventId,
    "score",
    asked === session.playerId ? "Card entered via round code" : `${asked}'s card entered via round code by the group's scorer`,
    { actor: session.playerName },
  );
  boardChanged(session.eventId);
  revalidatePath("/", "layout");
  // The card as the row holds it, so the phone's "Sent" is the record's word.
  return { ok: true, card: stored, ...(kept.applies && kept.ok ? { epoch: kept.epoch } : {}) };
}

/**
 * Signing that card — Rule 3.3b, from the surface the field actually uses.
 *
 * THE HALF #259 LEFT OUT, and the committee saw all of it. A charity day's
 * field submits with a Round Code, and the code surface had no way to
 * certify — so every card arrived at Score entry reading "Not certified yet"
 * and landed in "needs attention", where the only control is "Approve
 * anyway". Measured on 2026-09-10: the same screen cites Rule 3.3b in the
 * sentence above the button that overrides it.
 *
 * Signs through `certifyCard`, the same function the console's own card
 * screen uses, so what a signature MEANS is one rule rather than two.
 *
 * The signer is the player the SESSION names — no id from the caller, for the
 * reason `savePlayCard` gives at length — and is recorded by name, because a
 * code holder has no account and the record's job is to say who claimed the
 * scores were right.
 */
export async function certifyPlayCard(): Promise<ClaimResult> {
  const session = await getPlaySession();
  if (!session) return { ok: false, error: "Your session expired. Enter the round code again." };
  // Paused in a lapsed club's read-only archive (2026-10-21), said beside the press.
  const archived = await archiveRefusalFor(session.eventId, "player");
  if (archived) return { ok: false, error: archived };

  const [event, stage] = await Promise.all([
    prisma.event.findUnique({ where: { id: session.eventId } }),
    prisma.stage.findUnique({ where: { id: session.stageId }, select: { id: true, eventId: true } }),
  ]);
  if (!event || !stage) return { ok: false, error: "Round not found." };
  if (stage.eventId !== session.eventId) return { ok: false, error: "That round isn't in your tournament." };

  const settings = settingsOf(event);
  // The same question the write asks, and for the same reason: a tournament
  // the committee scores must not have its cards signed by a code holder.
  const refused = await entryRefusal(session, settings);
  if (refused) return { ok: false, error: refused };

  // AND THE TOURNAMENT HAS TO HAVE STARTED. Launch is the transition from
  // setting up to playing and it gated nothing, so a tournament left in draft
  // played a whole round with only a banner to say so. See playRefusal: a
  // tournament already under way is deliberately NOT stopped halfway.
  const notStarted = await playRefusalFor(session.eventId);
  if (notStarted) return { ok: false, error: notStarted };

  try {
    await certifyCard({
      eventId: session.eventId,
      stageId: session.stageId,
      playerId: session.playerId,
      by: session.playerName,
    });
  } catch (e) {
    // Refused rather than crashed — no card yet, or one the committee has
    // already accepted. Both are sentences a player should read.
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't certify that card." };
  }

  await logAudit(session.eventId, "card.certify", "Card certified via round code", { actor: session.playerName });
  boardChanged(session.eventId);
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * A MATCH KEPT ON STROKE CARDS, FROM A ROUND CODE (2026-10-19).
 *
 * Where the organizer has chosen stroke cards for a round (`matchKeptBy`),
 * each player enters their own strokes and the app works out who won each
 * hole, shots included. The match is stored through the SAME functions the
 * console's Score entry uses (`services/match-from-cards.ts`), so a card typed
 * on the course and a card typed at the desk are one result by construction.
 *
 * The card is the holder's own ball: the slot they play in a singles match,
 * their own card in a four-ball, or their side's one card where the side plays
 * one ball (`oneCardPerSide`). Never a ball the caller names — a round code is
 * a shared secret announced to a field, so anybody holding it could otherwise
 * write anybody's card. The same gates as the tap card, plus the round's own:
 * open, and kept on cards.
 */
export async function savePlayMatchCard(matchId: string, strokes: (number | null)[], opts?: PlaySaveOptions): Promise<ClaimResult> {
  const session = await getPlaySession();
  if (!session) return { ok: false, error: "Your session expired. Enter the round code again." };
  // Paused in a lapsed club's read-only archive (2026-10-21), said beside the press.
  const archived = await archiveRefusalFor(session.eventId, "player");
  if (archived) return { ok: false, error: archived };

  const [event, match] = await Promise.all([
    prisma.event.findUnique({ where: { id: session.eventId } }),
    prisma.match.findUnique({ where: { id: matchId } }),
  ]);
  if (!event || !match) return { ok: false, error: "Match not found." };
  const settings = settingsOf(event);
  const refused = await entryRefusal(session, settings);
  if (refused) return { ok: false, error: refused };
  const notStarted = await playRefusalFor(session.eventId);
  if (notStarted) return { ok: false, error: notStarted };
  if (match.eventId !== session.eventId || match.stageId !== session.stageId) {
    return { ok: false, error: "That match isn't in your round." };
  }
  try {
    await assertRoundOpen(session.eventId, session.stageId);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "This round is closed." };
  }
  const keptByHoles = await keptByRefusal(match.stageId, "cards");
  if (keptByHoles) return { ok: false, error: keptByHoles };

  const stage = await prisma.stage.findUnique({
    where: { id: match.stageId },
    select: { holes: true, type: true, lineupPublished: true, format: true, scoreInput: true, scoringBasis: true },
  });
  if (!stage) return { ok: false, error: "Round not found." };
  if (lineupHidden(stage)) return { ok: false, error: LINEUP_HIDDEN };

  // May this phone write this match at all: its own, or on a round kept by one
  // scorer per group, one in the group whose card it keeps (`mayWriteMatch`).
  const may = await mayWriteMatch({ eventId: session.eventId, match, actorIds: [session.playerId], epoch: sentEpoch(opts) });
  if (!may.ok) return { ok: false, error: may.error, ...(may.keeperName !== undefined ? { keptBy: may.keeperName } : {}) };
  // Whose ball this card is: the session's — or, for the group's scorer, the
  // player they name in the match. Never anybody outside it.
  const asked = typeof opts?.playerId === "string" && opts.playerId ? opts.playerId : session.playerId;
  if (asked !== session.playerId && may.epoch === null) return { ok: false, error: "You can only enter your own card." };
  if (!(await playersInMatch(match)).includes(asked)) return { ok: false, error: "You can only enter scores for your own match." };
  const ballOf = asked;
  const sideMatch = match.teamAId !== "" && match.teamBId !== "" && match.playerAId === "" && match.playerBId === "";
  let slot: "A" | "B" | null = null;
  let teamId = "";
  if (!sideMatch) {
    slot = match.playerAId === ballOf ? "A" : match.playerBId === ballOf ? "B" : null;
  } else {
    const mine = await prisma.teamMember.findFirst({
      where: { playerId: ballOf, teamId: { in: [match.teamAId, match.teamBId] } },
      select: { teamId: true },
    });
    teamId = mine?.teamId ?? "";
  }
  if (!slot && !teamId) return { ok: false, error: "You can only enter scores for your own match." };

  const holeCount = holesPlayed(stage.holes);
  const clean = cleanStrokes(strokes, holeCount);
  if (!clean) return { ok: false, error: strokeFault(strokes, holeCount) };
  if (!canPlayerSavePartial(settings)) {
    const filled = clean.filter((s) => typeof s === "number" && s > 0).length;
    if (filled < clean.length) return { ok: false, error: "Enter the full round, then submit it." };
  }

  // The card as its row holds it after the write, read back for the phone's "Sent".
  let stored: (number | null)[] = [];
  try {
    if (slot) {
      const row = await prisma.matchScorecard.upsert({
        where: { matchId_slot: { matchId: match.id, slot } },
        update: { strokes: JSON.stringify(clean) },
        create: { eventId: session.eventId, matchId: match.id, slot, strokes: JSON.stringify(clean) },
        select: { strokes: true },
      });
      stored = storedCard(row.strokes, holeCount);
      if (isReturnedCard(clean)) await freezeRoundHandicaps(session.eventId, match.stageId);
      await deriveMatchFromItsCards(session.eventId, match, { name: session.playerName, playerId: session.playerId });
    } else {
      // A side playing one ball keeps one card between them; otherwise each
      // partner keeps their own — the committee's shape for this round.
      const playerId = oneCardPerSide(stage.format, stage.scoreInput, stage.scoringBasis) ? "" : ballOf;
      const row = await prisma.teamScorecard.upsert({
        where: { stageId_matchId_teamId_playerId: { stageId: match.stageId, matchId: match.id, teamId, playerId } },
        update: { strokes: JSON.stringify(clean) },
        create: {
          eventId: session.eventId,
          stageId: match.stageId,
          matchId: match.id,
          teamId,
          playerId,
          strokes: JSON.stringify(clean),
          pickedUp: "[]",
        },
        select: { strokes: true },
      });
      stored = storedCard(row.strokes, holeCount);
      if (isReturnedCard(clean)) await freezeRoundHandicaps(session.eventId, match.stageId);
      await recomputeTeamMatch(session.eventId, match, stage.format, holeCount, { name: session.playerName, playerId: session.playerId });
    }
  } catch (e) {
    // A net round with no course card, said by the deriver in words.
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't save that card." };
  }

  await logAudit(session.eventId, "score", "Card entered via round code", { matchId: match.id, actor: session.playerName });
  boardChanged(session.eventId);
  revalidatePath("/", "layout");
  return { ok: true, card: stored, ...(may.epoch !== null ? { epoch: may.epoch } : {}) };
}

/* ── Who keeps the card, and who checks it (2026-11-04, sprint 2 part B) ── */

export interface KeepGroupResult {
  ok: boolean;
  error?: string;
  /** The epoch this phone now holds as its group's scorer — send it with every save. */
  epoch?: number;
  /** Who keeps the card now (this phone's player when ok). */
  keeperId?: string;
  /** When refused because somebody else keeps it: their name, for "Take over from …?". */
  keeperName?: string;
  /** Everyone in the group, as player ids. */
  members?: string[];
}

/**
 * "I'LL KEEP SCORE" — this phone keeps its group's card on a round kept by ONE
 * SCORER PER GROUP (`Stage.scoreKeeping: "group"`).
 *
 * Without `takeOver`, it claims a group nobody keeps, or confirms the phone
 * already keeps it; a group somebody else keeps is refused with their name, so
 * the screen can ask "Take over from Ann?". With `takeOver`, the card moves to
 * this phone: the epoch moves on, so the phone that had it is refused from its
 * next save, and the take-over is logged by both names. A claim is an upsert,
 * never a read-then-write (`services/group-keeping.ts`).
 *
 * The group is the session's — the player the round code named — never one
 * the caller sends.
 */
export async function keepGroup(input?: { takeOver?: boolean }): Promise<KeepGroupResult> {
  const session = await getPlaySession();
  if (!session) return { ok: false, error: "Your session expired. Enter the round code again." };
  const archived = await archiveRefusalFor(session.eventId, "player");
  if (archived) return { ok: false, error: archived };
  const event = await prisma.event.findUnique({ where: { id: session.eventId } });
  if (!event) return { ok: false, error: "Round not found." };
  const refused = await entryRefusal(session, settingsOf(event));
  if (refused) return { ok: false, error: refused };
  const notStarted = await playRefusalFor(session.eventId);
  if (notStarted) return { ok: false, error: notStarted };
  const res = await claimGroup({
    eventId: session.eventId,
    stageId: session.stageId,
    actorId: session.playerId,
    actorName: session.playerName,
    takeOver: input?.takeOver === true,
  });
  if (!res.ok) return { ok: false, error: res.error, keeperId: res.keeperId, keeperName: res.keeperName };
  revalidatePath("/play");
  return { ok: true, epoch: res.epoch, keeperId: res.keeperId, members: res.members };
}

/**
 * The scorer hands the group's card to somebody else in the group. Only the
 * phone that keeps it may, and only to a player in the group; the epoch moves
 * on, so this phone is refused from its next save. Logged.
 */
export async function handOverGroup(toPlayerId: string): Promise<KeepGroupResult> {
  const session = await getPlaySession();
  if (!session) return { ok: false, error: "Your session expired. Enter the round code again." };
  const archived = await archiveRefusalFor(session.eventId, "player");
  if (archived) return { ok: false, error: archived };
  const res = await handOverKeeping({
    eventId: session.eventId,
    stageId: session.stageId,
    fromId: session.playerId,
    fromName: session.playerName,
    toId: String(toPlayerId ?? "").slice(0, 64),
  });
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath("/play");
  return { ok: true, epoch: res.epoch, keeperId: res.keeperId, members: res.members };
}

export type PlayCheckResult =
  | { ok: true; status: "confirmed" | "pending" | "disputed"; outstanding: number; agreed: boolean }
  | { ok: false; error: string };

/** The round the session's code opened, with its end-of-round check — or the refusal. */
async function endCheckRound(session: { eventId: string; stageId: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const stage = await prisma.stage.findFirst({
    where: { id: session.stageId, eventId: session.eventId },
    select: { scoreKeeping: true, endCheck: true },
  });
  if (!stage) return { ok: false, error: "Round not found." };
  if (roundScoring(stage).endCheck !== "on") {
    return { ok: false, error: "This round has no end-of-round check. The organizer approves the results." };
  }
  return { ok: true };
}

/**
 * THE OTHER SIDE CONFIRMS — the end-of-round check for a match, from a round
 * code (sprint 2 part B). A play-session twin of `confirmMatch`: a code holder
 * has no account and no email, so the player is the one the SESSION names.
 *
 * The rule is `attestMatch`'s (services/attestation.ts): the author of the
 * result never confirms it, and a scorer outside the match leaves its sides
 * to confirm. "The other side" is the check's promise, so a club's looser
 * "one playing partner" is read as the other side here; "everyone in the
 * match" stays everyone.
 *
 * WHERE THE COMMITTEE APPROVES (`scoreApproval: "staff"`) the agreement is
 * RECORDED and the result stays pending: the committee's queue then says both
 * sides agree. A player's signature never approves a result the committee was
 * given to approve.
 */
export async function confirmPlayMatch(matchId: string): Promise<PlayCheckResult> {
  const session = await getPlaySession();
  if (!session) return { ok: false, error: "Your session expired. Enter the round code again." };
  const archived = await archiveRefusalFor(session.eventId, "player");
  if (archived) return { ok: false, error: archived };
  const [event, match] = await Promise.all([
    prisma.event.findUnique({ where: { id: session.eventId } }),
    prisma.match.findFirst({ where: { id: String(matchId ?? ""), eventId: session.eventId } }),
  ]);
  if (!event || !match || match.stageId !== session.stageId) return { ok: false, error: "That match isn't in your round." };
  // The same gate as every save: a confirmation is a statement about a result.
  const refused = await entryRefusal(session, settingsOf(event));
  if (refused) return { ok: false, error: refused };
  const round = await endCheckRound(session);
  if (!round.ok) return round;
  if (!(await isInMatch(match, [session.playerId]))) return { ok: false, error: "You can only confirm a match you played in." };
  let holes: unknown = [];
  try {
    holes = JSON.parse(match.holes || "[]");
  } catch {
    holes = [];
  }
  if (!matchIsOver(Array.isArray(holes) ? holes : [])) return { ok: false, error: "This match isn't finished yet, so there's no result to confirm." };

  const settings = settingsOf(event);
  const status = effectiveScoreStatus(match, allowsAutoConfirm(settings));
  if (status === "disputed") return { ok: false, error: "This result is disputed. The organizer will settle it." };
  if (status === "confirmed" || status === "auto-confirmed") return { ok: true, status: "confirmed", outstanding: 0, agreed: true };

  const mode = settings.scoreApproval === "staff" ? "record" : "confirm";
  const outcome = attestMatch(await matchSidesOf(match), match, session.playerId, endCheckRule(settings.attestBy), mode);
  if (!outcome.ok) return { ok: false, error: outcome.error };

  await prisma.match.updateMany({
    where: { id: match.id, eventId: session.eventId },
    data: {
      scoreStatus: outcome.status,
      attestedBy: JSON.stringify(outcome.attestedBy),
      ...(outcome.status === "confirmed" ? { confirmedById: null, confirmedBy: session.playerName } : {}),
    },
  });
  await logAudit(
    session.eventId,
    "confirm",
    outcome.status === "confirmed"
      ? `Confirmed by ${session.playerName} via round code`
      : outcome.agreed
        ? `Agreed by ${session.playerName} via round code; waiting for the committee`
        : `Signed by ${session.playerName} via round code; ${outcome.outstanding.length} still to sign`,
    { matchId: match.id, actor: session.playerName },
  );
  boardChanged(session.eventId);
  revalidatePath("/", "layout");
  return { ok: true, status: outcome.status, outstanding: outcome.outstanding.length, agreed: outcome.agreed };
}

/**
 * "THAT'S NOT RIGHT" — a player in the match disputes its result, from a round
 * code. The result is then held off every board (`heldFromBoard`) until the
 * committee settles it (Rule 20.1b: a result is the two sides' business, then
 * the committee's). A confirmed result is not disputed from a phone: the
 * player asks the committee to reopen it, as `disputeMatch` says.
 */
export async function disputePlayMatch(matchId: string): Promise<PlayCheckResult> {
  const session = await getPlaySession();
  if (!session) return { ok: false, error: "Your session expired. Enter the round code again." };
  const archived = await archiveRefusalFor(session.eventId, "player");
  if (archived) return { ok: false, error: archived };
  const [event, match] = await Promise.all([
    prisma.event.findUnique({ where: { id: session.eventId } }),
    prisma.match.findFirst({ where: { id: String(matchId ?? ""), eventId: session.eventId } }),
  ]);
  if (!event || !match || match.stageId !== session.stageId) return { ok: false, error: "That match isn't in your round." };
  const refused = await entryRefusal(session, settingsOf(event));
  if (refused) return { ok: false, error: refused };
  const round = await endCheckRound(session);
  if (!round.ok) return round;
  if (!(await isInMatch(match, [session.playerId]))) {
    return { ok: false, error: "Only the players in a match, or the committee, can dispute its result." };
  }
  if (match.enteredById !== "" && match.enteredById === session.playerId) {
    return { ok: false, error: "You entered this result, so correct it rather than dispute it." };
  }
  const status = effectiveScoreStatus(match, allowsAutoConfirm(settingsOf(event)));
  if (status === "confirmed" || status === "auto-confirmed") {
    return { ok: false, error: "That result has been confirmed. Ask the organizer to reopen it." };
  }
  if (status === "disputed") return { ok: true, status: "disputed", outstanding: 0, agreed: false };
  const moved = await prisma.match.updateMany({ where: { id: match.id, eventId: session.eventId }, data: { scoreStatus: "disputed" } });
  if (moved.count === 0) return { ok: false, error: "That match isn't in your round." };
  await logAudit(session.eventId, "dispute", `Result disputed by ${session.playerName} via round code`, { matchId: match.id, actor: session.playerName });
  boardChanged(session.eventId);
  revalidatePath("/", "layout");
  return { ok: true, status: "disputed", outstanding: 0, agreed: false };
}

/**
 * "MY CARD IS WRONG" — on a stroke round with the end-of-round check, each
 * player confirms their OWN card (`certifyPlayCard`, Rule 3.3b) or disputes
 * it. Their own only: the player the session names, never one the caller
 * sends. A disputed card is held off every board (`heldFromBoard`) until the
 * committee settles it.
 */
export async function disputePlayCard(): Promise<ClaimResult> {
  const session = await getPlaySession();
  if (!session) return { ok: false, error: "Your session expired. Enter the round code again." };
  const archived = await archiveRefusalFor(session.eventId, "player");
  if (archived) return { ok: false, error: archived };
  const event = await prisma.event.findUnique({ where: { id: session.eventId } });
  if (!event) return { ok: false, error: "Round not found." };
  const refused = await entryRefusal(session, settingsOf(event));
  if (refused) return { ok: false, error: refused };
  const round = await endCheckRound(session);
  if (!round.ok) return { ok: false, error: round.error };
  try {
    // Nobody accepts a casual card, so nobody can be asked not to.
    await assertSignsCards(session.eventId);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "This round's cards aren't signed." };
  }
  const card = await prisma.scorecard.findFirst({
    where: { eventId: session.eventId, stageId: session.stageId, playerId: session.playerId },
    select: { id: true, status: true },
  });
  if (!card) return { ok: false, error: "There's no card to dispute yet." };
  if (isCardLocked(card.status)) return { ok: false, error: LOCKED_CARD_REFUSAL };
  if (card.status !== "disputed") {
    await prisma.scorecard.updateMany({ where: { id: card.id, eventId: session.eventId }, data: { status: "disputed" } });
    await logAudit(session.eventId, "card.dispute", `${session.playerId}'s card disputed via round code`, { actor: session.playerName });
    boardChanged(session.eventId);
    revalidatePath("/", "layout");
  }
  return { ok: true };
}
