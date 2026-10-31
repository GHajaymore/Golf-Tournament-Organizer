import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { readSource } from "./source";

/**
 * EVERY DOOR THAT EDITS A TOURNAMENT ASKS THE ARCHIVE (2026-10-21).
 *
 * A lapsed paid club's tournaments are a read-only archive for twelve months
 * (`domain/club-archive.ts`). The rule is one function, and it holds only if
 * every server action that changes a tournament asks it — directly
 * (`assertEventWritable`, `archiveRefusalFor`), or through a gate that does: the
 * staff gates of each action file, `requireScoreEntry`, and the pot gate
 * `requirePotAccess` in services.
 *
 * So every action is either such a door or named below with why it is not one:
 * it changes nothing of a tournament (a read, a draft, a preview), it is about
 * the club or a person rather than a tournament, or it MAKES a tournament,
 * which after a lapse is an ordinary Par one. A new action cannot edit an
 * archived tournament by being forgotten: it fails here until it is one or the
 * other.
 *
 * What this does NOT prove is that the refusal is right — the audit test
 * `a-lapsed-club-keeps-a-read-only-archive.audit.test.ts` presses the real
 * actions against real rows for that.
 *
 * Read through `readSource` (comments stripped): the doc blocks name the gates
 * in prose, and prose must not satisfy the rule.
 */

/** A call that asks the archive itself. */
const ASKS = ["assertEventWritable(", "archiveRefusalFor("];

/** Gates outside the action files that ask it — proved below, not trusted. */
const SERVICE_GATES: Array<{ call: string; file: string[] }> = [
  { call: "requirePotAccess(", file: ["src", "lib", "services", "game-access.ts"] },
];

/**
 * Why an action is not a door into a tournament.
 *
 *   person    a person's own account, sign-in or device — not a tournament
 *   club      the club itself (its settings, roster, staff, courses found in the
 *             directory, seasons, plan) — an archived club still runs its club
 *   business  the platform owner's console
 *   new       MAKES a tournament; after a lapse that is an ordinary Par one
 *   own data  deleting a tournament outright: the club's own data is the club's
 *             to remove, archived or not (the privacy policy promises it)
 *   reads     changes nothing in a tournament: a read, a preview, a draft, a
 *             read marker, getting in to look
 */
const NOT_A_DOOR: Record<string, string> = {
  // person
  deleteMyAccount: "person", signInWithPassword: "person", claimPassword: "person", requestPasswordReset: "person",
  resetPassword: "person", signUp: "person", signOutAction: "person", signOutEverywhereAction: "person",
  verifyEmailCode: "person", resendEmailCode: "person",
  savePushSubscription: "person", removePushSubscription: "person", getVapidPublicKey: "person",
  setMyMessagesOptOut: "person", setMySmsOptIn: "person", registerInterest: "person", askToJoinNamesake: "person",
  // club
  checkDiscountCode: "club", startCheckout: "club", openBillingPortal: "club", deleteClub: "club",
  saveHandicapPolicy: "club", saveScoreReporting: "club", approveJoinRequest: "club", declineJoinRequest: "club",
  setOrgMoneyMode: "club", addOrganizationMember: "club", setOrganizationMemberRole: "club",
  removeOrganizationMember: "club", saveOrganizationBranding: "club", saveOrganizationTheme: "club",
  saveOrganizationCurrency: "club", saveOrganizationSeason: "club", saveOrganizationLocale: "club",
  saveOrganizationTimeZone: "club", adoptClubTimeZone: "club", saveOrganizationKind: "club",
  saveOrganizationNoun: "club", saveOrganizationGolfTerms: "club", leaveOrganization: "club",
  saveOrganizationDefaults: "club", addMember: "club", importCsvMembers: "club", updateMember: "club",
  setMemberStatus: "club", deleteMember: "club", addFieldToRoster: "club", memberHandicapSuggestion: "club",
  acceptClubHandicap: "club", confirmChampion: "club", removeFromHonours: "club", createSeries: "club",
  updateSeries: "club", deleteSeries: "club", searchCourseDirectory: "club", importCourseFromDirectory: "club",
  readCourseCardPhoto: "club",
  // business
  setAccountsOpen: "business", setClubPlan: "business", saveTierPrices: "business", saveTierLimits: "business",
  createDiscountCode: "business", setDiscountCodeActive: "business", sendEarlyListCodes: "business",
  // new
  createEvent: "new", cloneEvent: "new", createMatch: "new",
  // own data
  deleteEvent: "own data",
  // reads
  enterTournament: "reads", switchEvent: "reads", setPreviewAction: "reads", redeemRoundCode: "reads",
  claimPlayerSlot: "reads", leavePlay: "reads", currentPlayStatus: "reads", readThread: "reads",
  markThreadRead: "reads", previewSmsBroadcast: "reads", draftMessage: "reads",
};

interface Fn {
  file: string;
  name: string;
  body: string;
}

/** A top-level function's body: up to its own closing brace at column 0. */
function bodyOf(piece: string): string {
  const end = piece.indexOf("\n}\n");
  return end >= 0 ? piece.slice(0, end) : piece;
}

function functionsIn(file: string, src: string, marker: string): Fn[] {
  return src
    .split(marker)
    .slice(1)
    .map((piece) => ({ file, name: piece.slice(0, piece.indexOf("(")).trim(), body: bodyOf(piece) }));
}

const DIR = join(process.cwd(), "src", "app", "actions");
const FILES = readdirSync(DIR).filter((f) => f.endsWith(".ts"));
const SOURCES = FILES.map((file) => ({ file, src: readSource("src", "app", "actions", file).replace(/\r\n/g, "\n") }));

const serviceDoors = SERVICE_GATES.filter((g) => ASKS.some((a) => readSource(...g.file).includes(a))).map((g) => g.call);

/** The local helpers in a file that ask the archive, directly or through another that does. */
function askingHelpers(src: string, file: string): string[] {
  const helpers = [
    ...functionsIn(file, "\n" + src, "\nasync function "),
    ...functionsIn(file, "\n" + src, "\nfunction "),
  ];
  const asking = new Set<string>();
  const direct = (body: string) => [...ASKS, ...serviceDoors].some((a) => body.includes(a));
  for (const h of helpers) if (direct(h.body)) asking.add(h.name);
  // One more pass, for a helper that goes through another (`adminEventOrRefusal` → `requireAdminEvent`).
  for (const h of helpers) if ([...asking].some((n) => h.body.includes(`${n}(`))) asking.add(h.name);
  return [...asking];
}

const ACTIONS = SOURCES.flatMap(({ file, src }) => {
  const helpers = askingHelpers(src, file);
  return functionsIn(file, src, "export async function ").map((a) => ({
    ...a,
    asks: [...ASKS, ...serviceDoors, ...helpers.map((h) => `${h}(`)].some((n) => a.body.includes(n)),
  }));
});

describe("the archive is asked at every door", () => {
  it("every action asks it, or says why it is not a door into a tournament", () => {
    const silent = ACTIONS.filter((a) => !a.asks && !(a.name in NOT_A_DOOR)).map((a) => `${a.file}: ${a.name}`);
    expect(silent, "ask `assertEventWritable` / `archiveRefusalFor`, or add it to NOT_A_DOOR with why").toEqual([]);
  });

  it("the list names only actions that exist and still do not ask", () => {
    const stale = Object.keys(NOT_A_DOOR).filter((n) => !ACTIONS.some((a) => a.name === n && !a.asks));
    expect(stale, "gone, renamed, or a door now — take it off the list").toEqual([]);
  });

  it("CONTROL: the actions are found, the pot gate really asks, and the staff gates are doors", () => {
    expect(ACTIONS.length).toBeGreaterThanOrEqual(260);
    expect(serviceDoors).toEqual(["requirePotAccess("]);
    const names = (n: string) => ACTIONS.find((a) => a.name === n);
    for (const n of ["saveScorecard", "setBracketWinner", "addExpense", "saveSkinsPot", "setEventStatus", "savePlayCard", "registerForEvent"]) {
      expect(names(n)?.asks, `${n} should be a door`).toBe(true);
    }
  });

  it("CONTROL: an action that writes a tournament and asks nothing is seen", () => {
    const src = [
      "async function requireStaff() {",
      "  const session = await getSession();",
      "  return session.eventId;",
      "}",
      "export async function renameRound(stageId: string, name: string) {",
      "  const eventId = await requireStaff();",
      "  await prisma.stage.update({ where: { id: stageId }, data: { name } });",
      "}",
      "",
    ].join("\n");
    const helpers = askingHelpers(src, "x.ts");
    expect(helpers).toEqual([]);
    const [a] = functionsIn("x.ts", src, "export async function ");
    expect([...ASKS, ...helpers.map((h) => `${h}(`)].some((n) => a.body.includes(n))).toBe(false);
    // …and the same gate, asking, makes it a door.
    const asking = src.replace("  return session.eventId;", "  await assertEventWritable(session.eventId);\n  return session.eventId;");
    expect(askingHelpers(asking, "x.ts")).toEqual(["requireStaff"]);
  });
});
