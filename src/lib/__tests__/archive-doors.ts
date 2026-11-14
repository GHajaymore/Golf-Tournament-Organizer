import { existsSync, readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { readSource } from "./source";

/**
 * THE ARCHIVE'S DOORS, shared by the two tests that hold the archive: every server action,
 * whether it asks the archive, and the ones that are not doors into a tournament (moved here
 * from `the-archive-is-asked-at-every-door.test.ts` on 2026-11-10 so
 * `the-archive-is-read-only-in-one-place.test.ts` derives the screens it leaves unlocked
 * from the SAME list, and the two cannot drift).
 */

/** A call that asks the archive itself. */
export const ASKS = ["assertEventWritable(", "archiveRefusalFor("];

/** Gates outside the action files that ask it — proved below, not trusted. */
export const SERVICE_GATES: Array<{ call: string; file: string[] }> = [
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
export const NOT_A_DOOR: Record<string, string> = {
  // person
  deleteMyAccount: "person", signInWithPassword: "person", claimPassword: "person", requestPasswordReset: "person",
  resetPassword: "person", signUp: "person", signOutAction: "person", signOutEverywhereAction: "person",
  verifyEmailCode: "person", resendEmailCode: "person",
  savePushSubscription: "person", removePushSubscription: "person", getVapidPublicKey: "person",
  setMyMessagesOptOut: "person", setMySmsOptIn: "person", registerInterest: "person", askToJoinNamesake: "person",
  // A guest's player link (J39/J40): opening it, forgetting it on this phone and choosing which of two
  // held credentials to look through set cookies on this browser and change nothing in a tournament.
  // An archived tournament stays open to players to view; every write still meets the scoring gate's archive check.
  openPlayerLink: "person", forgetThisPhone: "person", choosePlayerView: "person",
  // club
  checkDiscountCode: "club", startCheckout: "club", openBillingPortal: "club", deleteClub: "club",
  saveHandicapPolicy: "club", saveScoreReporting: "club", approveJoinRequest: "club", declineJoinRequest: "club", dismissNamesakeNotice: "club",
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
  setAccountsOpen: "business", setClubPlan: "business", saveTierPrices: "business", saveTierLimits: "business", saveOffers: "business",
  createDiscountCode: "business", setDiscountCodeActive: "business", sendEarlyListCodes: "business", refreshDemoClub: "business", loadCourseCatalogue: "business",
  // new
  createEvent: "new", createEventFromAnswers: "new", cloneEvent: "new", createMatch: "new",
  // own data
  deleteEvent: "own data",
  // reads
  enterTournament: "reads", switchEvent: "reads", setPreviewAction: "reads", redeemRoundCode: "reads",
  claimPlayerSlot: "reads", redeemRoundCodeForm: "reads", claimPlayerSlotForm: "reads", leavePlay: "reads", currentPlayStatus: "reads", readThread: "reads",
  markThreadRead: "reads", previewSmsBroadcast: "reads", draftMessage: "reads",
};

export interface Fn {
  file: string;
  name: string;
  body: string;
}

/** A top-level function's body: up to its own closing brace at column 0. */
export function bodyOf(piece: string): string {
  const end = piece.indexOf("\n}\n");
  return end >= 0 ? piece.slice(0, end) : piece;
}

export function functionsIn(file: string, src: string, marker: string): Fn[] {
  return src
    .split(marker)
    .slice(1)
    .map((piece) => ({ file, name: piece.slice(0, piece.indexOf("(")).trim(), body: bodyOf(piece) }));
}

const DIR = join(process.cwd(), "src", "app", "actions");
const FILES = readdirSync(DIR).filter((f) => f.endsWith(".ts"));
export const SOURCES = FILES.map((file) => ({ file, src: readSource("src", "app", "actions", file).replace(/\r\n/g, "\n") }));

export const serviceDoors = SERVICE_GATES.filter((g) => ASKS.some((a) => readSource(...g.file).includes(a))).map((g) => g.call);

/** The local helpers in a file that ask the archive, directly or through another that does. */
export function askingHelpers(src: string, file: string): string[] {
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

export const ACTIONS = SOURCES.flatMap(({ file, src }) => {
  const helpers = askingHelpers(src, file);
  return functionsIn(file, src, "export async function ").map((a) => ({
    ...a,
    asks: [...ASKS, ...serviceDoors, ...helpers.map((h) => `${h}(`)].some((n) => a.body.includes(n)),
  }));
});

/**
 * The local helpers in a file that THROW the archive's refusal: they assert it
 * (directly, or through another helper that does) and do not catch it. An
 * `…OrRefusal` helper calls a throwing gate but catches with `archiveRefusalOf`,
 * so it answers in words and is not one of these.
 */
export function throwingHelpers(src: string, file: string): string[] {
  const helpers = [
    ...functionsIn(file, "\n" + src, "\nasync function "),
    ...functionsIn(file, "\n" + src, "\nfunction "),
  ];
  const catches = (body: string) => body.includes("archiveRefusalOf(");
  const throwing = new Set<string>();
  for (const h of helpers) if (h.body.includes("assertEventWritable(") && !catches(h.body)) throwing.add(h.name);
  for (let pass = 0; pass < 3; pass += 1) {
    for (const h of helpers) {
      if (!catches(h.body) && [...throwing].some((n) => h.body.includes(`${n}(`))) throwing.add(h.name);
    }
  }
  return [...throwing];
}

/** One action, as a screen reaches it. */
export interface Door {
  /** `file.ts:name`. */
  id: string;
  /** Not a door into a tournament (`NOT_A_DOOR`), and its kind; null for a door. */
  notADoor: string | null;
  /** A door that answers an archived tournament with WORDS — never throws its refusal. */
  answersInWords: boolean;
}

/** Does an action's body answer the archive in words? It says the sentence, and calls nothing that throws it. */
export function answersInWords(body: string, throwing: string[]): boolean {
  const callsThrowing = throwing.some((h) => body.includes(`${h}(`)) || body.includes("assertEventWritable(");
  const says = body.includes("archiveRefusalFor(") || /\w+OrRefusal\(/.test(body);
  return says && !callsThrowing;
}

const THROWING = new Map(SOURCES.map(({ file, src }) => [file, throwingHelpers(src, file)]));

/** Every exported action, as a door: what it is, and whether an archive's press gets words from it. */
export const DOORS = new Map<string, Door>(
  ACTIONS.map((a) => {
    const throwing = [...(THROWING.get(a.file) ?? []), ...serviceDoors.map((d) => d.slice(0, -1))];
    const id = `${a.file}:${a.name}`;
    return [id, { id, notADoor: NOT_A_DOOR[a.name] ?? null, answersInWords: answersInWords(a.body, throwing) }];
  }),
);

const IMPORT = /import\s+(type\s+)?([\s\S]*?)\s+from\s+["']([^"']+)["']/g;

function resolveImport(fromFile: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join("src", spec.slice(2));
  else if (spec.startsWith(".")) base = join(fromFile, "..", spec);
  else return null;
  for (const ext of ["", ".tsx", ".ts", "/index.tsx", "/index.ts"]) {
    const p = join(process.cwd(), base + ext);
    if (existsSync(p) && statSync(p).isFile()) return (base + ext).split(sep).join("/");
  }
  return null;
}

/**
 * The server actions a console screen can call: every `@/app/actions/…` name
 * imported by its page and by every component it draws, followed through the
 * screens' and components' own imports (`src/app/(app)`, `src/components`).
 * Named `file.ts:name`, so two actions of one name in two files stay two.
 *
 * `exceptMarked`: leave out the actions a file imports when that file marks its
 * part of the screen with this attribute (`data-this-tournament` — a part the
 * archive locks even on a screen it leaves open). The file's own imports are
 * still followed.
 */
export function actionsReachedBy(page: string, exceptMarked?: string): string[] {
  const seen = new Set<string>();
  const found = new Set<string>();
  const stack = [page];
  while (stack.length > 0) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const src = readSource(file);
    const marked = exceptMarked !== undefined && src.includes(`${exceptMarked}=`);
    for (const m of src.matchAll(IMPORT)) {
      const [, typeOnly, what, spec] = m;
      if (typeOnly) continue;
      if (spec.startsWith("@/app/actions/")) {
        if (marked) continue;
        const names = (what.match(/\{([\s\S]*)\}/)?.[1] ?? "")
          .split(",")
          .map((x) => x.trim())
          .filter((x) => x && !x.startsWith("type "))
          .map((x) => x.split(/\s+as\s+/)[0]);
        for (const n of names) if (/^[a-z]/.test(n)) found.add(`${spec.slice("@/app/actions/".length)}.ts:${n}`);
        continue;
      }
      const next = resolveImport(file, spec);
      if (next && (next.startsWith("src/components/") || next.startsWith("src/app/(app)/"))) stack.push(next);
    }
  }
  return [...found].sort();
}

/**
 * Every console screen a person can land on: its path and its page file. A page
 * that only redirects (kept for old bookmarks — `no-link-lands-on-a-redirect`'s
 * test) draws nothing, so it is no screen to lock or leave open.
 */
export function consoleScreens(): Array<{ path: string; page: string }> {
  const dir = join(process.cwd(), "src", "app", "(app)");
  return readdirSync(dir)
    .filter((d) => existsSync(join(dir, d, "page.tsx")))
    .map((d) => ({ path: `/${d}`, page: `src/app/(app)/${d}/page.tsx` }))
    .filter(({ page }) => {
      const src = readSource(page);
      return !(src.includes("redirect(") && !/return\s*\(/.test(src) && !/<[A-Za-z]/.test(src));
    });
}

/**
 * IS THIS SCREEN THE CLUB'S, NOT THE TOURNAMENT'S? — the archive's lock leaves it
 * open when every action it can call is either not a door into a tournament
 * (`NOT_A_DOOR`), or a door that answers an archive in words; and it calls at
 * least one CLUB action (an archived club still runs its club), or calls no
 * door at all (nothing there writes the tournament). A tournament screen whose
 * doors happen to answer in words — the dashboard — is not a club screen: it
 * calls no club action, so it stays read-only.
 */
export function isClubScreen(actions: string[], doors: Map<string, Door>): boolean {
  const known = actions.map((id) => doors.get(id));
  // An action the sweep does not know is not judged safe.
  if (known.some((d) => d === undefined)) return false;
  const tournamentDoors = known.filter((d) => d!.notADoor === null);
  if (tournamentDoors.length === 0) return true;
  const club = known.some((d) => d!.notADoor === "club");
  return club && tournamentDoors.every((d) => d!.answersInWords);
}

/** The screens the archive should leave open, worked out from their imports and the sweep's list. */
export function openScreens(exceptMarked: string): string[] {
  return consoleScreens()
    .filter((s) => isClubScreen(actionsReachedBy(s.page, exceptMarked), DOORS))
    .map((s) => s.path)
    .sort();
}

