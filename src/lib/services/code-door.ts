import "server-only";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { looksLikeAccessCode } from "@/lib/code-format";
import { CODE_WORDS, codeShapeOf } from "@/lib/domain/code-shape";
import { RATE_LIMITS, windowFor } from "@/lib/domain/rate-limit";
import { checkRateLimit, clearRateLimit, clientGuessGate } from "@/lib/rate-limit";
import { settingsOf } from "@/lib/services/tournament";
import { usesAccessCodes } from "@/lib/tournament-settings";
import { roundScoring } from "@/lib/domain/round-scoring";
import { roundCodeName } from "@/lib/domain/round-label";
import { lineupHidden } from "@/lib/domain/cup-lineup";
import { matchKeptBy } from "@/lib/domain/match-kept-by";
import { type TeeSheetGroup } from "@/lib/domain/tee-sheet";
import { groupsOfRound, withBorrowedTeeTimes, type PlayGroup } from "@/lib/domain/play-groups";
import { roundTeeSheet, otherRoundsTeeGroups } from "@/lib/services/group-keeping";
import { passForCode, recordOpen } from "@/lib/services/player-link";
import { choosePlayerViewCookie, setGuestCookie } from "@/lib/guest-auth";
import { deviceValueHere } from "@/lib/services/known-device";
import { logAudit } from "@/lib/services/action-shared";

/**
 * THE ONE DOOR FOR A TYPED CODE (plan row 4c, simplicity cut 1; design "One
 * code box" §3.2, Security verdict SAFE-WITH items 1-7).
 *
 * Every box that takes a code a player was handed — /play's, /p's — hands it
 * here (`actions/code-box.ts`), and so does the round's own second step
 * (`claimPlayerSlotForm`). In order, every count before every lookup:
 *
 *   1. the SHAPE of the whole input (`codeShapeOf`); no shape costs nothing
 *      and is told `CODE_WORDS.notACode`;
 *   2. the client's guess budget, CHOSEN BY THE SHAPE (`guessGate`), never by
 *      the box: nothing exported here takes a box, so the answer cannot depend
 *      on which page asked;
 *   3. for an `eight` only, the per-code budget (`round-code`). A `twelve` is
 *      NEVER a per-code key: an unkeyed hash of a 60-bit secret is never stored;
 *   4. the shape's ONE lookup: `lookupEight` (the only reader of
 *      `Stage.accessCode` for redemption) or `passForCode`;
 *   5. nothing found, of either shape and for every reason: the one sentence
 *      `CODE_WORDS.opensNothing`, counted, nothing given back;
 *   6. found: the client's attempt given back, and the door opens — a round's
 *      groups and names (the play session is still made by `claimPlayerSlot`,
 *      after the one confirmation), or the guest's link on this browser.
 *
 * It never calls `createSession`, and asks no sign-in hold: neither door is
 * held (`NOT_SWITCHED` `round-codes`, `player-links`), and neither makes an
 * account's session. The limit FIGURES and KEYS are `RATE_LIMITS`' own, named
 * once in `LANES`. Since PR B both shapes take the same steps: the client's
 * budget (one shared bucket where no address can be read), the platform alarm
 * and the slow pace while it stands (the eight's are `eight-char-alarm` and
 * `eight-char-slow`, the Security Lead's 300 an hour and 12 per 15 minutes).
 */

/** A round code's answer: the field and groups a scorer picks from (as `redeemRoundCode` answered). */
export interface RedeemedRound {
  /** The field for that round: the list a scorer picks from where the round has no groups. */
  players: Array<{ id: string; name: string }>;
  /** The round's GROUPS (`play-groups.ts`): its matches, or its published tee sheet's groups. */
  groups: PlayGroup[];
  stageId: string;
  /** The tournament, so a phone can remember its group across its rounds (`rememberedGroup`). */
  eventId: string;
  eventName: string;
  roundLabel: string;
  /** Kept by ONE SCORER PER GROUP: "whose card" in a group is asked as "which one are you". */
  keepsGroups: boolean;
}

export type OpenedCode =
  | { ok: true; kind: "round"; code: string; round: RedeemedRound }
  | { ok: true; kind: "player-link"; href: "/me" }
  /** J39 PR 3B: an entry code opens its event's form, `/register/<token>`. Not answered yet. */
  | { ok: true; kind: "entry"; href: string }
  | { ok: false; error: string };

/** Every client whose address cannot be read shares one bucket, for either shape (S2a; the eight's since PR B). */
const NO_ADDRESS = "no-client-address";

/**
 * THE TWO SHAPES' LANES, the only place a guess budget's keys are named. Each
 * shape has its client's budget, a platform alarm and the slow pace every client
 * is held to while the alarm stands. The FIGURES are `RATE_LIMITS`' own.
 */
const LANES = {
  eight: { client: "round-code-client", alarm: "eight-char-alarm", slow: "eight-char-slow", platform: "eight-char-platform" },
  twelve: { client: "player-link-client", alarm: "player-link-alarm", slow: "player-link-slow", platform: "player-link-platform" },
} as const;
/** The alarm's window last reported by this instance, per shape: one error line a window, not one a request (SF-2). */
const alarmReportedIn: Record<"eight" | "twelve", number> = { eight: -1, twelve: -1 };

const nothingToGiveBack = async () => {};

/**
 * THE ONE PLACE A GUESS BUDGET IS CHOSEN: by shape, never by box. Both shapes
 * take the same steps (one code box PR B gave the eight what the twelve had):
 * the client's budget (one shared bucket where no address can be read), then the
 * platform alarm, counted only for a request the client's own limit let through
 * (SF-2), and while it stands each client is held to the slow pace. The eight's
 * per-code budget (`round-code`) is the door's own, never the gate's.
 * `opened()` gives the attempt back once something real has been found.
 */
export async function guessGate(
  shape: "eight" | "twelve",
  client: string | null,
): Promise<{ refused: string | null; opened: () => Promise<void> }> {
  const lane = LANES[shape];
  const who = client ?? NO_ADDRESS;
  const guess = await clientGuessGate(lane.client, who);
  if (!guess.decision.allowed) return { refused: guess.decision.message, opened: nothingToGiveBack };

  const alarm = await clientGuessGate(lane.alarm, lane.platform);
  const slow = alarm.decision.allowed ? null : await clientGuessGate(lane.slow, who);
  if (!alarm.decision.allowed) {
    const window = windowFor(RATE_LIMITS[lane.alarm], Date.now()).bucket;
    if (window !== alarmReportedIn[shape]) {
      alarmReportedIn[shape] = window;
      console.error(`[${lane.alarm}] platform alarm: failed opens are above the hourly threshold; opens are slowed`);
    }
    if (slow && !slow.decision.allowed) {
      // Refused by the slow limit: it neither counts toward the alarm nor spends the client's budget twice.
      await alarm.succeeded();
      return { refused: slow.decision.message, opened: nothingToGiveBack };
    }
  }
  return {
    refused: null,
    opened: async () => {
      await Promise.all([guess.succeeded(), alarm.succeeded(), slow?.succeeded()]);
    },
  };
}

/**
 * THE ONE READER of `Stage.accessCode` for redemption (after J39 PR 3B, of
 * `Event.registrationCode` too, unique across both). A round whose tournament
 * has since turned code access off reads as no round: there is no reason to
 * confirm that a code was once real. A string that is not a code at all is
 * never looked up (an empty `accessCode` is a stage with no code).
 */
export async function lookupEight(code: string) {
  if (!looksLikeAccessCode(code)) return null;
  const stage = await prisma.stage.findFirst({
    where: { accessCode: code },
    include: { event: true },
  });
  if (!stage || !usesAccessCodes(settingsOf(stage.event))) return null;
  return { kind: "round" as const, stage };
}

/** THE ONE DOOR. Both arguments required: `client` is `await clientAddress()` (null where none can be read). */
export async function openAnyCode(input: unknown, client: string | null): Promise<OpenedCode> {
  const shape = codeShapeOf(input);
  if (shape.shape === "none") return { ok: false, error: CODE_WORDS.notACode };
  if (shape.shape === "eight") return openEight(shape.code, client);
  return openTwelve(shape.code, client);
}

/** A round code: its budgets, its one lookup, and the round's field and groups. */
async function openEight(code: string, client: string | null): Promise<OpenedCode> {
  const gate = await guessGate("eight", client);
  if (gate.refused) return { ok: false, error: gate.refused };
  // Keyed on the code (an 8-character round code, never a personal one): caps how fast one code is guessed.
  const limit = await checkRateLimit("round-code", code);
  if (!limit.allowed) return { ok: false, error: limit.message };

  const found = await lookupEight(code);
  if (!found) return { ok: false, error: CODE_WORDS.opensNothing };
  const stage = found.stage;

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

  await gate.opened();
  await clearRateLimit("round-code", code);
  return {
    ok: true,
    kind: "round",
    code,
    round: {
      players,
      groups: await playGroups(stage, players),
      stageId: stage.id,
      eventId: stage.eventId,
      eventName: stage.event.name,
      // Which round and which holes, so the wrong nine's code shows on the first screen after it is typed.
      roundLabel: roundCodeName(stages, stages.find((s) => s.id === stage.id) ?? stage),
      keepsGroups: roundScoring(stage).scoreKeeping === "group",
    },
  };
}

/**
 * A guest's personal player link code, typed in any box or tapped on /p. Never
 * a per-code key (S2): only the client's budget and the platform alarm. The
 * open itself is the link's, moved whole from `openPlayerLink`: the browser,
 * the cookie, the view beside a sign-in (S4), the audit line without the code.
 */
async function openTwelve(code: string, client: string | null): Promise<OpenedCode> {
  const gate = await guessGate("twelve", client);
  if (gate.refused) return { ok: false, error: gate.refused };

  const pass = await passForCode(code);
  if (!pass) return { ok: false, error: CODE_WORDS.opensNothing };
  await gate.opened();

  const { newBrowser } = await recordOpen(pass.passId, await deviceValueHere(true));
  await setGuestCookie(pass.passId, pass.version);
  // Beside a sign-in, the link is what this browser just chose to look through (S4).
  if (await getSession()) await choosePlayerViewCookie("guest");
  if (newBrowser) {
    await logAudit(pass.eventId, "player-link.opened", `${pass.playerId}'s player link opened on a new phone or browser`, { actor: pass.name });
  }
  revalidatePath("/me", "layout");
  return { ok: true, kind: "player-link", href: "/me" };
}

/**
 * THE ROUND'S OWN PUBLISHED TEE SHEET (`roundTeeSheet`), the same reader the
 * keeper takes its groups from, so the list and the keeper cannot disagree.
 * The Golf Pro ruled on 2026-11-05 that a round's groups come from that
 * round's sheet only. Null when there is none.
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
    // A match kept on stroke cards is four people's own cards; one kept by tapping is one card.
    oneMatch: matchKeptBy(stage) !== "cards",
  });
  if (sheet) return groups;
  /**
   * A ROUND WITH NO SHEET OF ITS OWN MAY STILL HAVE A TEE TIME (2026-10-16: a
   * cup's second nine is the same four). Borrowed from another round's
   * published group, the TIME ONLY and only when that group is exactly this
   * match's players (`withBorrowedTeeTimes`); never its grouping or its name.
   */
  return withBorrowedTeeTimes(groups, await otherRoundsTeeGroups(stage.eventId, stage.id), new Set(names.keys()));
}
