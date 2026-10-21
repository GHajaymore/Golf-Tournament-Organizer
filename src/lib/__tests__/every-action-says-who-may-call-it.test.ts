import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { readSource } from "./source";

/**
 * EVERY SERVER ACTION SAYS WHO MAY CALL IT, BEFORE IT WRITES (2026-10-11).
 *
 * A `"use server"` export is a public HTTP endpoint. Two things were true of
 * all 264 of them on the day this was written, and nothing held either:
 *
 *   1. An action for STAFF asks for staff before it writes anything. 157 do,
 *      through one of the `require…` gates below, and in every one the gate
 *      comes before the first write.
 *   2. Every OTHER action is somebody's own business — signing in, entering,
 *      their own card, their own answer — or is held by a narrower check than
 *      a staff gate (a pot's own access rule, the players in a match, a club
 *      role, the platform owner). 107 of them, read one by one, and listed
 *      here with which it is.
 *
 * It was found by breaking the app on purpose: with the role check deleted
 * from one action, every guard stayed green. The every-action sweep
 * (`e2e/every-action-vs-a-stranger.spec.ts`) calls all of these as a stranger
 * and as a member — but with made-up arguments, so an action that validates
 * before it authorizes refuses them either way and looks the same with or
 * without its gate.
 *
 * So a NEW action cannot arrive ungated quietly: it either carries a staff
 * gate ahead of its writes, or somebody adds it to the list below and says
 * who may call it. What this does NOT prove is that a listed action's own
 * check is right — that is what the audit tests and the sweep are for.
 *
 * Read through `readSource` (comments stripped): these files' doc blocks name
 * their gates in prose, and prose must not satisfy the rule.
 */

/** A gate that refuses anybody who is not staff of the tournament or the club. */
const STAFF_GATES = [
  "requireStaffEvent(",
  "requireStaff(",
  "requireAdminEvent(",
  "requireOrganizerOrg(",
  "requireOrganizer(",
  "requireStaffSession(",
  "requireStaffOrg(",
  "requireRosterOrg(",
  "requireOrg(",
  "requireClub(",
];

const WRITES = [".create(", ".createMany(", ".update(", ".updateMany(", ".upsert(", ".delete(", ".deleteMany(", "$executeRaw", "$transaction("];

/**
 * The actions with no staff gate, and who may call each.
 *
 *   anyone        no session: the front door, and a public entry form
 *   round code    the phone that redeemed a round's code (`getPlaySession`)
 *   themselves    a signed-in person acting on their own row
 *   their match   the players in it, or staff — the action asks which
 *   the pot       whoever that money game's own rule lets write it
 *   club role     a Commissioner or Admin of the club (`canEdit`), or its owner
 *   organizer     admin of that tournament, checked inline rather than by a gate
 *   the business  the platform's owner (`isOwner`)
 */
const WHO: Record<string, string> = {
  // anyone
  signInWithPassword: "anyone", claimPassword: "anyone", requestPasswordReset: "anyone", resetPassword: "anyone",
  signUp: "anyone", signOutAction: "anyone", registerForEvent: "anyone", getVapidPublicKey: "anyone",
  redeemRoundCode: "anyone", claimPlayerSlot: "anyone", leavePlay: "anyone", registerInterest: "anyone",
  // Sets a cookie and nothing else, and the cookie can only ever show an
  // organizer LESS (the player's view of their own tournament): `getSession`
  // ignores it for anybody who is not an admin.
  setPreviewAction: "anyone",
  // round code
  savePlayMatchHoles: "round code", savePlayMatchResult: "round code", savePlayCard: "round code", certifyPlayCard: "round code", savePlayMatchCard: "round code",  // themselves
  deleteMyAccount: "themselves", signOutEverywhereAction: "themselves", leaveOrganization: "themselves", setOwnAttendance: "themselves", enterTournament: "themselves", switchEvent: "themselves",
  enterThisTournament: "themselves", withdrawMyEntry: "themselves", askToJoinNamesake: "themselves",
  requestContestEntry: "themselves", requestSideGameEntry: "themselves", requestSkinsEntry: "themselves",
  savePushSubscription: "themselves", removePushSubscription: "themselves", currentPlayStatus: "themselves",
  setMyMessagesOptOut: "themselves", setMySmsOptIn: "themselves", setMyPlayWith: "themselves", setPairingRequest: "themselves",
  readThread: "themselves", sendMessage: "themselves", markThreadRead: "themselves", startDirectThread: "themselves",
  createMatch: "themselves", createEvent: "themselves", keepRound: "themselves",
  searchCourseDirectory: "themselves", importCourseFromDirectory: "themselves", readCourseCardPhoto: "themselves",
  setMatchCourse: "themselves", nameMatchVenue: "themselves", setPlayerTee: "themselves", draftMessage: "themselves",
  // their match, their card
  setAttendance: "their match", saveMatchHoles: "their match", applyMatchResult: "their match", clearMatch: "their match",
  // The player app's match card (2026-10-18): the same two saves, with the refusal said in words.
  keepMyMatchHoles: "their match", keepMyMatchResult: "their match", keepMyMatchCard: "their match",
  saveScorecard: "their match", saveScorecards: "their match", saveMatchScorecard: "their match",
  saveTeamScorecard: "their match", saveTeamScorecards: "their match", confirmMatch: "their match",
  confirmMatches: "their match", disputeMatch: "their match", reportBracketResult: "their match",
  certifyScorecard: "their match", disputeScorecard: "their match",
  // the pot
  renameBet: "the pot", addExpense: "the pot", updateExpense: "the pot", removeExpense: "the pot",
  recordSettlement: "the pot", removeSettlement: "the pot", saveSideGame: "the pot", setSideGameEntrants: "the pot",
  confirmSideGameEntry: "the pot", removeSideGame: "the pot", saveSkinsPot: "the pot", setSkinsEntrants: "the pot",
  removeSkinsPot: "the pot", confirmSkinsEntry: "the pot",
  // club role
  startCheckout: "club role", openBillingPortal: "club role", checkDiscountCode: "club role", deleteClub: "club role", approveJoinRequest: "club role",
  declineJoinRequest: "club role", setOrgMoneyMode: "club role", addOrganizationMember: "club role",
  setOrganizationMemberRole: "club role", removeOrganizationMember: "club role", saveOrganizationBranding: "club role",
  saveOrganizationTheme: "club role", saveOrganizationCurrency: "club role", saveOrganizationSeason: "club role",
  saveOrganizationLocale: "club role", saveOrganizationTimeZone: "club role", adoptClubTimeZone: "club role",
  saveOrganizationKind: "club role", saveOrganizationNoun: "club role", saveOrganizationGolfTerms: "club role",
  saveOrganizationDefaults: "club role",
  // organizer, checked inline
  setLeagueSettings: "organizer", cloneEvent: "organizer", deleteEvent: "organizer",
  broadcastToScope: "organizer", previewSmsBroadcast: "organizer", broadcastWithText: "organizer",
  // the business
  setClubPlan: "the business", saveTierPrices: "the business", saveTierLimits: "the business",
  createDiscountCode: "the business", setDiscountCodeActive: "the business", setAccountsOpen: "the business",
};

/** What must appear in the body of an action of each kind. Not proof the check is right — proof it is there. */
const NEEDS: Record<string, string[]> = {
  anyone: [],
  "round code": ["getPlaySession("],
  themselves: ["getSession(", "requireEventSession(", "requireMembership(", "requireSession("],
  "their match": ["getSession(", "requireScoreEntry", "requireEventSession("],
  "the pot": ["requirePotAccess(", "requireGameAccess(", "canChangeExpense(", "canAddExpense(", "canUndoSettlement(", "callerPlayer(", "getSession("],
  "club role": [".canEdit", "isOwner", "clubDeletionRefusal(", ".role"],
  organizer: ['role !== "admin"', 'role === "admin"', "isStaff", "requireMembership("],
  "the business": ["isOwner("],
};

interface Action {
  file: string;
  name: string;
  body: string;
}

function actionsIn(file: string, src: string): Action[] {
  return src
    .split("export async function ")
    .slice(1)
    .map((piece) => ({ file, name: piece.slice(0, piece.indexOf("(")), body: piece }));
}

const first = (body: string, needles: string[]) => {
  const at = needles.map((n) => body.indexOf(n)).filter((i) => i >= 0);
  return at.length ? Math.min(...at) : -1;
};

const ACTIONS = readdirSync(join(process.cwd(), "src", "app", "actions"))
  .filter((f) => f.endsWith(".ts"))
  .flatMap((file) => actionsIn(file, readSource("src", "app", "actions", file)));

const gated = ACTIONS.filter((a) => first(a.body, STAFF_GATES) >= 0);
const ungated = ACTIONS.filter((a) => first(a.body, STAFF_GATES) < 0);

describe("who may call a server action", () => {
  it("a staff action asks for staff BEFORE its first write", () => {
    const late = gated
      .filter((a) => {
        const write = first(a.body, WRITES);
        return write >= 0 && write < first(a.body, STAFF_GATES);
      })
      .map((a) => `${a.file}: ${a.name}`);
    expect(late, "writes, and only then asks who is calling").toEqual([]);
  });

  it("an action with no staff gate is on the list, with who may call it", () => {
    const unlisted = ungated.filter((a) => !(a.name in WHO)).map((a) => `${a.file}: ${a.name}`);
    expect(unlisted, "give it a staff gate ahead of its writes, or add it to WHO and say who may call it").toEqual([]);
  });

  it("and carries the check its kind needs", () => {
    const missing = ungated
      .filter((a) => a.name in WHO)
      .filter((a) => {
        const needs = NEEDS[WHO[a.name]];
        return needs.length > 0 && !needs.some((n) => a.body.includes(n));
      })
      .map((a) => `${a.file}: ${a.name} — listed as "${WHO[a.name]}" and holds none of its checks`);
    expect(missing).toEqual([]);
  });

  it("the list names only actions that exist and still have no staff gate", () => {
    const names = new Set(ungated.map((a) => a.name));
    const stale = Object.keys(WHO).filter((n) => !names.has(n));
    expect(stale, "gone, renamed, or given a staff gate since — take it off the list").toEqual([]);
  });

  it("CONTROL: the actions are found, and both kinds are well represented", () => {
    expect(ACTIONS.length).toBeGreaterThanOrEqual(260);
    expect(gated.length).toBeGreaterThanOrEqual(150);
    expect(ungated.length).toBeGreaterThanOrEqual(100);
    expect(gated.map((a) => a.name)).toContain("setBracketWinner");
    expect(ungated.map((a) => a.name)).toContain("saveOrganizationTimeZone");
  });

  it("CONTROL: a write ahead of the gate, and a new ungated action, are both seen", () => {
    const [late] = actionsIn(
      "x.ts",
      [
        "export async function renameRound(stageId: string, name: string) {",
        "  await prisma.stage.update({ where: { id: stageId }, data: { name } });",
        "  await requireStaffEvent();",
        "}",
      ].join("\n"),
    );
    expect(first(late.body, WRITES)).toBeGreaterThanOrEqual(0);
    expect(first(late.body, WRITES) < first(late.body, STAFF_GATES)).toBe(true);

    const [open] = actionsIn(
      "x.ts",
      ["export async function wipeEverything() {", "  await prisma.event.deleteMany({});", "}"].join("\n"),
    );
    expect(first(open.body, STAFF_GATES)).toBe(-1);
    expect(open.name in WHO).toBe(false);
  });
});
