import { canAccessScreen, type Role } from "../roles";
import { LIFECYCLE_STEPPER_ON, STEPPER_PREVIEW } from "./lifecycle-track";

/**
 * THE CONSOLE REDESIGN'S SWITCH, AND THE ONE MAP FROM AN OLD DOOR TO ITS NEW ROOM (redesign phase 2,
 * PR R0; the step 3 design of 13 Nov, amended 14 Nov, §7; phase 1's screen list, §2).
 *
 * The redesign rebuilds the console as fourteen screens, one per job (phase 1, §2.1–2.2). Each is
 * built SWITCHED OFF, and Ajay previews it before any of it goes on. This file is the switch for
 * each, and nothing else knows one exists:
 *
 *   which screens show  `mergesShown(search, viewer)`: a screen's state says where it is drawn. Server
 *                       only (`console-merges.test.ts` holds every caller to it): a client receives
 *                       the answer as a prop, because this function reads the server's environment
 *   where an old door   `relocate(link, shown)`: the state machine, What's next, the checklists and
 *   now leads           the menu keep emitting TODAY's addresses; at the edge each passes through
 *                       here. With nothing shown it is the identity, so switched off nothing moves
 *   when a door may     a door is re-pointed only when EVERY job it holds today has a home among the
 *   move at all         screens shown (`DOOR_JOBS`, `unhousedJobs`), and every room it leads a person
 *                       into is one their role may open (`roomRefusals`)
 *
 * EVERY KEY AND EVERY MOVE IS REGISTERED HERE NOW (R0), each screen "building". A screen's PR changes
 * ONE line of this file — its key to "preview" — so three lanes never edit it at once. The rooms the
 * moves lead into are built by those PRs; until then they are drawn only to the engineer
 * (`?stepper=1&build=1`, never in production). At retirement (R17) the machine's addresses take the
 * new values and this map is deleted: a dead twin of a live rule is a second copy waiting to be used.
 */

/** The redesign's screens, one per job (phase 1, §2.1 This event and §2.2 the club). */
export const SCREEN_KEYS = [
  "home",
  "event",
  "rounds",
  "players",
  "prizes",
  "teeTimes",
  "scoreEntry",
  "leaderboard",
  "results",
  "money",
  "events",
  "members",
  "courses",
  "clubSettings",
] as const;
export type ScreenKey = (typeof SCREEN_KEYS)[number];

/**
 * Where a screen is drawn:
 *   building  only with `?stepper=1&build=1`, for the engineer and the specs while it is half-built —
 *             and NEVER in production, where a half-built screen would use real actions on a real
 *             event (Hard rule 1)
 *   preview   with `?stepper=1` — in production only to an owner on `OWNER_EMAILS` (Ajay: no partial
 *             previews; a pilot club's staff run real events and must never see one)
 *   on        everywhere — allowed only while the stepper itself is on (`LIFECYCLE_STEPPER_ON`),
 *             because the new rooms are reached only through the lifecycle menu
 */
export type ScreenState = "building" | "preview" | "on";

export const CONSOLE_SCREENS: Readonly<Record<ScreenKey, ScreenState>> = {
  home: "building",
  event: "building",
  rounds: "building",
  players: "building",
  prizes: "building",
  teeTimes: "building",
  scoreEntry: "building",
  leaderboard: "building",
  results: "building",
  money: "building",
  events: "building",
  members: "building",
  courses: "building",
  clubSettings: "building",
};

/** The engineer's query, beside the preview's own (`STEPPER_PREVIEW`). */
export const BUILD_PREVIEW = "build";

/** Nothing shown: the console as it is. */
export const NO_MERGES: ReadonlySet<ScreenKey> = new Set();

/** Who is asking: the one fact about the person the switch needs. */
export interface Viewer {
  /** On `OWNER_EMAILS` (`isOwner`). Only an owner sees a preview in production. */
  owner: boolean;
}

/**
 * WHICH SCREENS THIS REQUEST SHOWS, from its query (`x-search` in the layout, `searchParams` on a
 * page) and who is asking. `deployment` is Vercel's environment, read from the process unless a test
 * says it — which is why this is called on the SERVER only: in a browser bundle the variable is
 * undefined and production would read as a preview deploy. A key left "on" while the stepper is off
 * is drawn as a preview only (`mergeStateRefusals`); the build is red over it besides.
 */
export function mergesShown(
  search: string,
  viewer: Viewer,
  deployment: string | undefined = process.env.VERCEL_ENV,
  states: Readonly<Record<ScreenKey, ScreenState>> = CONSOLE_SCREENS,
  stepperOn: boolean = LIFECYCLE_STEPPER_ON,
): ReadonlySet<ScreenKey> {
  const q = new URLSearchParams(search);
  const production = deployment === "production";
  const previewing = q.get(STEPPER_PREVIEW) === "1" && (!production || viewer.owner);
  const building = previewing && q.get(BUILD_PREVIEW) === "1" && !production;
  const refused = new Set(mergeStateRefusals(states, stepperOn));
  const shown = SCREEN_KEYS.filter((k) => {
    const state = refused.has(k) ? "preview" : states[k];
    if (state === "on") return true;
    if (state === "preview") return previewing;
    return building;
  });
  return shown.length === 0 ? NO_MERGES : new Set(shown);
}

/**
 * The keys whose state may not stand: "on" while the stepper is off would put a new room where no
 * menu leads to it. Empty is the only answer the build may ship with (`console-merges.test.ts`).
 */
export function mergeStateRefusals(
  states: Readonly<Record<ScreenKey, ScreenState>> = CONSOLE_SCREENS,
  stepperOn: boolean = LIFECYCLE_STEPPER_ON,
): ScreenKey[] {
  return stepperOn ? [] : SCREEN_KEYS.filter((k) => states[k] === "on");
}

/* ------------------------------------------------------------------ the rooms */

/**
 * EACH NEW SCREEN: the addresses it answers at (its tabs are its own: Players is Entries, Flights,
 * Teams and Cup teams; Members opens a member's history), and the `SCREEN_ACCESS` rule it is held to.
 * Two are new routes with no key of their own yet, so each is held to the rule the design gives it:
 * Winners & money to Prizes' (staff; step 3 §4.2), Courses to Event's (an organizer; step 3 §6).
 * The PR that builds one adds its key to `SCREEN_ACCESS` and names it here.
 */
export const ROOMS: Readonly<Record<ScreenKey, { paths: readonly string[]; access: string }>> = {
  home: { paths: ["/dashboard"], access: "dashboard" },
  event: { paths: ["/event"], access: "event" },
  rounds: { paths: ["/stages"], access: "stages" },
  players: { paths: ["/registration", "/grouping", "/teams", "/cup"], access: "registration" },
  prizes: { paths: ["/prizes"], access: "prizes" },
  teeTimes: { paths: ["/foursomes"], access: "foursomes" },
  scoreEntry: { paths: ["/entry"], access: "entry" },
  leaderboard: { paths: ["/leaderboard"], access: "leaderboard" },
  results: { paths: ["/reports"], access: "reports" },
  money: { paths: ["/money"], access: "prizes" },
  events: { paths: ["/tournaments"], access: "tournaments" },
  members: { paths: ["/roster", "/member"], access: "roster" },
  courses: { paths: ["/courses"], access: "event" },
  clubSettings: { paths: ["/organization"], access: "organization" },
};

/** The room an address is in, or null for a screen carried as it is (Messages, Help, …). */
export function roomOf(href: string): ScreenKey | null {
  const path = doorOf(href).path;
  return SCREEN_KEYS.find((k) => ROOMS[k].paths.includes(path)) ?? null;
}

/* ------------------------------------------------------------------ the old doors */

/**
 * What a person does behind each door that moves, TODAY, by role (step 3 design §1–§6; phase 1 §2).
 * Read from the screens as they are, never from the rooms they are going to: it is the list a new
 * room must hold all of before the old door may lead there.
 */
export type DoorJob =
  | "read-the-bracket"
  | "arrange-the-knockout"
  | "record-a-knockout-result"
  | "approve-a-reported-result"
  | "read-the-cup-board"
  | "set-up-cup-teams"
  | "set-a-lineup"
  | "award-another-point"
  | "read-the-week"
  | "keep-the-groups-games"
  | "manage-this-events-helpers"
  | "keep-the-clubs-courses"
  | "pick-this-events-course"
  | "offer-prizes"
  | "offer-side-games"
  | "award-prizes"
  | "draw-a-round"
  | "print-the-days-paper"
  | "read-a-members-history";

const BRACKET_STAFF: readonly DoorJob[] = ["read-the-bracket", "arrange-the-knockout", "record-a-knockout-result", "approve-a-reported-result"];
const CUP_STAFF: readonly DoorJob[] = ["read-the-cup-board", "set-up-cup-teams", "set-a-lineup", "award-another-point"];
const PRIZES_STAFF: readonly DoorJob[] = ["offer-prizes", "offer-side-games", "award-prizes"];

/**
 * The old doors, by the address the machine and the menu emit today, and by `SCREEN_ACCESS`'s roles
 * for that screen. The forms a door takes:
 *   `/path`          the screen
 *   `/path#place`    a place on it (Courses on Event details)
 *   `/path?param`    the screen opened with that query (`/event?course=` opens one course)
 *   `door@job`       the door as ONE job's link opens it (What's next's `draw` sends a round to
 *                    Rounds & formats, whose other jobs stay there): only that job moves
 * An assistant is given the organizer's whole list: the actions decide which presses are theirs, and
 * a list that asks too much only holds a door back.
 */
export const DOOR_JOBS: Readonly<Record<string, Partial<Record<Role, readonly DoorJob[]>>>> = {
  "/bracket": { admin: BRACKET_STAFF, assistant: BRACKET_STAFF, player: ["read-the-bracket"] },
  "/bracket@knockouts": { admin: ["approve-a-reported-result"], assistant: ["approve-a-reported-result"] },
  "/cup": { admin: CUP_STAFF, assistant: CUP_STAFF, player: ["read-the-cup-board"] },
  "/cup@lineup": { admin: ["set-a-lineup"], assistant: ["set-a-lineup"] },
  "/week": { admin: ["read-the-week"], assistant: ["read-the-week"], player: ["read-the-week"] },
  // A player's own door to their group's games is not moved (step 3 §4.4): no row may take it.
  "/group-games": { admin: ["keep-the-groups-games"], assistant: ["keep-the-groups-games"] },
  "/access": { admin: ["manage-this-events-helpers"] },
  "/event#courses": { admin: ["keep-the-clubs-courses", "pick-this-events-course"] },
  "/event?course": { admin: ["keep-the-clubs-courses"] },
  "/prizes": { admin: PRIZES_STAFF, assistant: PRIZES_STAFF },
  "/prizes@payout": { admin: ["award-prizes"], assistant: ["award-prizes"] },
  "/stages@draw": { admin: ["draw-a-round"], assistant: ["draw-a-round"] },
  "/print": { admin: ["print-the-days-paper"], assistant: ["print-the-days-paper"] },
  "/member": { admin: ["read-a-members-history"], assistant: ["read-a-members-history"] },
};

/** A link as the machine or the menu made it, and who is about to press it. */
export interface OldLink {
  href: string;
  /** The job key that made it (What's next, the checklist, the menu's Money & payouts), when one did. */
  job?: string;
  /** The round it is about, when the job is one round's. */
  roundId?: string;
  role: Role;
  /** A casual round's link: its one screen is not moved (Ajay, 6 Oct). */
  casual?: boolean;
  /**
   * The screens this person may open in THIS event (`navForRole`'s keys), when the edge knows them.
   * A door never moves into a room whose screen is withheld here: a player on a blind event reads the
   * cup's board on `/cup` and has no Leaderboard, so their cup door stays where it is.
   */
  screens?: ReadonlySet<string>;
}

/**
 * ONE MOVE: an old door, for the roles named, to a new room — and where EACH of that door's jobs
 * lives after it. The move happens only when its room and every screen named in `homes` are shown,
 * so a door whose jobs are split across rooms (the bracket: Tee times & draw, Score entry, the
 * board) moves only once all of them are built and shown.
 */
export interface Move {
  /** The door, in one of `DOOR_JOBS`' forms (without its `@job`, which is `job` below). */
  from: string;
  roles: readonly Role[];
  /** Only for links made by this job, when one door serves several (absent: every link). */
  job?: string;
  /** Never for a casual round's link. */
  notCasual?: true;
  homes: Partial<Record<DoorJob, ScreenKey>>;
  /** The room the door opens now; `to` must lead into it (`roomRefusals`). */
  room: ScreenKey;
  /** The room's address, from the old link (keeps what it must of its query). */
  to: (link: OldLink) => string;
}

/** The old link's query, carried onto a new address (`round=` and the like); never the preview's. */
function queryOf(href: string, drop: readonly string[] = []): URLSearchParams {
  const at = href.indexOf("#");
  const before = at === -1 ? href : href.slice(0, at);
  const q = new URLSearchParams(before.includes("?") ? before.slice(before.indexOf("?") + 1) : "");
  for (const k of [STEPPER_PREVIEW, BUILD_PREVIEW, ...drop]) q.delete(k);
  return q;
}

/** `path`, with `view` first and then the old link's own query. */
function withView(path: string, view: string, href: string): string {
  const q = queryOf(href, ["view"]);
  const rest = q.toString();
  return `${path}?view=${view}${rest ? `&${rest}` : ""}`;
}

function withQuery(path: string, href: string, place = ""): string {
  const rest = queryOf(href).toString();
  return `${path}${rest ? `?${rest}` : ""}${place}`;
}

const roundOf = (path: string) => (l: OldLink) => (l.roundId ? `${path}?round=${encodeURIComponent(l.roundId)}` : path);

/**
 * EVERY MOVE THE REDESIGN MAKES, registered now and taken only while its screens show (each is
 * "building"). Rows naming a job come before the door's general row: the first row that fits wins.
 */
export const MOVES: readonly Move[] = [
  // The draw is made on Tee times & draw, one round at a time (step 3 §2; phase 1 §2.1 row 6).
  { from: "/stages", job: "draw", roles: ["admin", "assistant"], homes: { "draw-a-round": "teeTimes" }, room: "teeTimes", to: roundOf("/foursomes") },
  // A reported knockout result is approved on its tie, on Score entry (step 3 §2.4).
  { from: "/bracket", job: "knockouts", roles: ["admin", "assistant"], homes: { "approve-a-reported-result": "scoreEntry" }, room: "scoreEntry", to: roundOf("/entry") },
  // The bracket is a view of the board for everybody; staff's other jobs went to the draw and Score
  // entry, reached from the view's Record result (step 3 §3, the 14 Nov re-walk J11).
  { from: "/bracket", roles: ["player"], homes: { "read-the-bracket": "leaderboard" }, room: "leaderboard", to: (l) => withView("/leaderboard", "bracket", l.href) },
  {
    from: "/bracket",
    roles: ["admin", "assistant"],
    homes: { "read-the-bracket": "leaderboard", "arrange-the-knockout": "teeTimes", "record-a-knockout-result": "scoreEntry", "approve-a-reported-result": "scoreEntry" },
    room: "leaderboard",
    to: (l) => withView("/leaderboard", "bracket", l.href),
  },
  // A session's lineup is set on Tee times & draw; staff's /cup is Players' Cup teams tab (it stays).
  { from: "/cup", job: "lineup", roles: ["admin", "assistant"], homes: { "set-a-lineup": "teeTimes" }, room: "teeTimes", to: roundOf("/foursomes") },
  { from: "/cup", roles: ["player"], homes: { "read-the-cup-board": "leaderboard" }, room: "leaderboard", to: (l) => withView("/leaderboard", "cup", l.href) },
  { from: "/week", roles: ["admin", "assistant", "player"], homes: { "read-the-week": "leaderboard" }, room: "leaderboard", to: (l) => withView("/leaderboard", "week", l.href) },
  // A group's own games are paid out on Winners & money; a casual round keeps its one screen (§4.4).
  { from: "/group-games", roles: ["admin", "assistant"], notCasual: true, homes: { "keep-the-groups-games": "money" }, room: "money", to: (l) => withQuery("/money", l.href, "#groups") },
  // Money split by when: the payout is Winners & money; Prizes & side games keeps the offer (§4).
  { from: "/prizes", job: "payout", roles: ["admin", "assistant"], homes: { "award-prizes": "money" }, room: "money", to: (l) => withQuery("/money", l.href) },
  // An event's helpers are a section of Club settings (§5).
  { from: "/access", roles: ["admin"], homes: { "manage-this-events-helpers": "clubSettings" }, room: "clubSettings", to: () => "/organization#access" },
  // The club's courses have a screen of their own; Event keeps this event's course (§6).
  {
    from: "/event#courses",
    roles: ["admin"],
    homes: { "keep-the-clubs-courses": "courses", "pick-this-events-course": "event" },
    room: "courses",
    to: () => "/courses",
  },
  { from: "/event?course", roles: ["admin"], homes: { "keep-the-clubs-courses": "courses" }, room: "courses", to: (l) => withQuery("/courses", l.href) },
  // The morning's paper is printed from Tee times & draw (phase 1 §2.1 row 6).
  { from: "/print", roles: ["admin", "assistant"], homes: { "print-the-days-paper": "teeTimes" }, room: "teeTimes", to: (l) => withQuery("/foursomes", l.href, "#print") },
];

interface Door {
  path: string;
  /** `#place`, or "" */
  place: string;
  /** A query parameter the door needs present, or "" */
  param: string;
}

function doorOf(href: string): Door {
  const at = href.indexOf("#");
  const place = at === -1 ? "" : href.slice(at);
  const beforePlace = at === -1 ? href : href.slice(0, at);
  const q = beforePlace.indexOf("?");
  const path = q === -1 ? beforePlace : beforePlace.slice(0, q);
  const query = q === -1 ? "" : beforePlace.slice(q + 1);
  return { path, place, param: query.includes("=") ? "" : query };
}

/** Does this row's door match the link's address (`/event#courses` needs the place too)? */
function opens(from: string, href: string): boolean {
  const door = doorOf(from);
  const link = doorOf(href);
  if (door.path !== link.path) return false;
  if (door.place !== "" && door.place !== link.place) return false;
  return door.param === "" || queryOf(href).has(door.param);
}

/** The key a move's door has in `DOOR_JOBS`. */
export function doorKey(move: Pick<Move, "from" | "job">): string {
  return move.from + (move.job === undefined ? "" : `@${move.job}`);
}

/** A link that opens a door, for the checks: its query parameter given a value. */
export function sampleLink(door: string, role: Role): OldLink {
  const [from, job] = door.split("@");
  const d = doorOf(from);
  return { href: `${d.path}${d.param ? `?${d.param}=zz-1` : ""}${d.place}`, job, role, roundId: "zz-round" };
}

/** The screens a move needs shown: its room, and the one each of its jobs moves into. */
export function mergesNeeded(move: Move): ScreenKey[] {
  return [...new Set([move.room, ...(Object.values(move.homes) as ScreenKey[])])];
}

/**
 * WHERE THIS LINK LEADS NOW. The first move whose door it opens, for this role and job, with every
 * screen it needs shown; otherwise the link exactly as it was made. With nothing shown it is the
 * identity — switched off, every address in the app is today's. A move that leaves one of its door's
 * jobs without a home (`unhousedJobs`), or leads a person into a room their role may not open
 * (`roomRefusals`), is never taken: the door stays where it is.
 */
export function relocate(link: OldLink, shown: ReadonlySet<ScreenKey>, moves: readonly Move[] = MOVES): string {
  if (shown.size === 0) return link.href;
  for (const move of moves) {
    if (!opens(move.from, link.href)) continue;
    if (!move.roles.includes(link.role)) continue;
    if (move.job !== undefined && move.job !== link.job) continue;
    if (move.notCasual && link.casual) continue;
    if (link.screens && !link.screens.has(ROOMS[move.room].access)) continue;
    if (!mergesNeeded(move).every((m) => shown.has(m))) continue;
    if (unhousedJobs(move).length > 0 || roomRefusals(move).length > 0) continue;
    return move.to(link);
  }
  return link.href;
}

/**
 * The jobs a move leaves without a home, for each role it names: empty for every row, or the door
 * would lead a person to a room that no longer holds what they came to do.
 */
export function unhousedJobs(move: Move): string[] {
  const key = doorKey(move);
  const jobs = DOOR_JOBS[key];
  if (!jobs) return [`${key}: not a door in DOOR_JOBS`];
  const out: string[] = [];
  for (const role of move.roles) {
    const held = jobs[role];
    if (!held) {
      out.push(`${move.from}: ${role} has no job here today`);
      continue;
    }
    for (const job of held) if (!(job in move.homes)) out.push(`${move.from}: ${role} would lose ${job}`);
  }
  return out;
}

/**
 * The rooms a move would send a person into that their role may not open (`SCREEN_ACCESS` through
 * `ROOMS`): the room the door now opens, and the room each of their jobs lives in. And a row whose
 * address is not its room is named too, so `room` cannot say one thing while `to` does another.
 * Empty for every row, or the door leads somebody to a refusal.
 */
export function roomRefusals(move: Move): string[] {
  const out: string[] = [];
  const jobs = DOOR_JOBS[doorKey(move)] ?? {};
  for (const role of move.roles) {
    const landed = roomOf(move.to(sampleLink(doorKey(move), role)));
    if (landed !== move.room) out.push(`${move.from}: leads to ${landed ?? "no room"}, not ${move.room}`);
    if (!canAccessScreen(role, ROOMS[move.room].access)) out.push(`${move.from}: ${role} may not open ${move.room}`);
    for (const job of jobs[role] ?? []) {
      const home = move.homes[job];
      if (home && !canAccessScreen(role, ROOMS[home].access)) out.push(`${move.from}: ${role} may not open ${home}, where ${job} lives`);
    }
  }
  return out;
}
