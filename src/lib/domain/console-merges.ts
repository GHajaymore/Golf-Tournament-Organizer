import type { Role } from "../roles";
import { LIFECYCLE_STEPPER_ON, STEPPER_PREVIEW } from "./lifecycle-track";

/**
 * THE CONSOLE'S MERGES, AND THE ONE MAP FROM AN OLD DOOR TO ITS NEW ROOM (the console structure
 * review, 9 Nov 2026, step 3; the Principal Engineer's design of 13 Nov, amended 14 Nov, §7).
 *
 * Step 3 folds screens together: the draw on one screen per round, the boards in Leaderboard, money
 * split by when, staff in Club settings, a Courses screen for the club. Each is built SWITCHED OFF,
 * and Ajay previews it before any of it goes on. This file is the switch for each, and nothing else
 * knows one exists:
 *
 *   which merges show   `mergesShown(search)`: a merge's state says where it is drawn
 *   where an old door   `relocate(link, shown)`: the state machine, What's next, the checklists and
 *   now leads           the menu keep emitting TODAY's addresses; at the edge each passes through
 *                       here. With nothing shown it is the identity, so switched off nothing moves
 *   when a door may     a door is re-pointed only when EVERY job it holds today has a home among the
 *   move at all         merges shown (`DOOR_JOBS`, `MOVES`): the bracket leaves a staff member's
 *                       menu only once the draw holds its arrangement and Score entry its results,
 *                       not the day the board grows a Bracket view
 *
 * PR 0 BUILDS NO ROOM. `MOVES` is empty, so `relocate` is the identity in every state and no door
 * moves; the only thing a shown merge changes is how the lifecycle menu groups today's screens
 * (`nav-lifecycle.ts`). Each later PR adds the rows for the room it builds — here, not in the nav
 * files — and the menu follows. At retirement (PR 8) the machine's addresses take the new values and
 * this map is deleted: a dead twin of a live rule is a second copy waiting to be used.
 */

/** The decided merges. "announcements" (into Messages) is decided and held until #1133 is live. */
export const MERGE_KEYS = ["draw", "boards", "money", "staff", "courses"] as const;
export type MergeKey = (typeof MERGE_KEYS)[number];

/**
 * Where a merge is drawn:
 *   building  only with `?stepper=1&build=1`, for the engineer and the preview specs while a series
 *             is half-landed — and NEVER in production, where a half-built screen would use real
 *             actions on a real event (Hard rule 1)
 *   preview   with `?stepper=1`, which is what Ajay sees
 *   on        everywhere — allowed only while the stepper itself is on (`LIFECYCLE_STEPPER_ON`),
 *             because the merged rooms are reached only through the lifecycle menu
 */
export type MergeState = "building" | "preview" | "on";

export const CONSOLE_MERGES: Readonly<Record<MergeKey, MergeState>> = {
  draw: "building",
  boards: "building",
  money: "building",
  staff: "building",
  courses: "building",
};

/** The engineer's query, beside the preview's own (`STEPPER_PREVIEW`). */
export const BUILD_PREVIEW = "build";

/** Nothing shown: the console as it is. */
export const NO_MERGES: ReadonlySet<MergeKey> = new Set();

/**
 * WHICH MERGES THIS REQUEST SHOWS, from its query (`x-search` in the layout, `searchParams` on a
 * page). `deployment` is Vercel's environment, read from the process unless a test says it. A key
 * left "on" while the stepper is off is drawn as a preview only (`mergeStateRefusals`), so the
 * mistake cannot reach a person without the preview's query; the build is red over it besides.
 */
export function mergesShown(
  search: string,
  deployment: string | undefined = process.env.VERCEL_ENV,
  states: Readonly<Record<MergeKey, MergeState>> = CONSOLE_MERGES,
  stepperOn: boolean = LIFECYCLE_STEPPER_ON,
): ReadonlySet<MergeKey> {
  const q = new URLSearchParams(search);
  const previewing = q.get(STEPPER_PREVIEW) === "1";
  const building = previewing && q.get(BUILD_PREVIEW) === "1" && deployment !== "production";
  const refused = new Set(mergeStateRefusals(states, stepperOn));
  const shown = MERGE_KEYS.filter((k) => {
    const state = refused.has(k) ? "preview" : states[k];
    if (state === "on") return true;
    if (state === "preview") return previewing;
    return building;
  });
  return shown.length === 0 ? NO_MERGES : new Set(shown);
}

/**
 * The keys whose state may not stand: "on" while the stepper is off would put a merged room where
 * no menu leads to it. Empty is the only answer the build may ship with (`console-merges.test.ts`).
 */
export function mergeStateRefusals(
  states: Readonly<Record<MergeKey, MergeState>> = CONSOLE_MERGES,
  stepperOn: boolean = LIFECYCLE_STEPPER_ON,
): MergeKey[] {
  return stepperOn ? [] : MERGE_KEYS.filter((k) => states[k] === "on");
}

/* ------------------------------------------------------------------ the old doors */

/**
 * What a person does behind each door a merge re-points, TODAY, by role (design §1–§6). Read from
 * the screens as they are at `25fce89d`, never from the rooms they are going to: it is the list a
 * new room must hold all of before the old door may lead there.
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
  | "award-prizes"
  | "draw-a-round";

const BRACKET_STAFF: readonly DoorJob[] = ["read-the-bracket", "arrange-the-knockout", "record-a-knockout-result", "approve-a-reported-result"];
const CUP_STAFF: readonly DoorJob[] = ["read-the-cup-board", "set-up-cup-teams", "set-a-lineup", "award-another-point"];

/**
 * The old doors, by the address the machine and the menu emit today (`#place` where it is one), and
 * by `SCREEN_ACCESS`'s roles for that screen. An assistant is given the organizer's whole list: the
 * actions decide which presses are theirs, and a list that asks too much only holds a door back.
 * `door@job` is the door as ONE job's link opens it (What's next's `draw` sends a round to Rounds &
 * formats, whose other jobs stay there): only that job moves, so only it must be housed.
 */
export const DOOR_JOBS: Readonly<Record<string, Partial<Record<Role, readonly DoorJob[]>>>> = {
  "/bracket": { admin: BRACKET_STAFF, assistant: BRACKET_STAFF, player: ["read-the-bracket"] },
  "/cup": { admin: CUP_STAFF, assistant: CUP_STAFF, player: ["read-the-cup-board"] },
  "/week": { admin: ["read-the-week"], assistant: ["read-the-week"], player: ["read-the-week"] },
  // A player's own door to their group's games is not moved (design §4.4): no row may take it.
  "/group-games": { admin: ["keep-the-groups-games"], assistant: ["keep-the-groups-games"] },
  "/access": { admin: ["manage-this-events-helpers"] },
  "/event#courses": { admin: ["keep-the-clubs-courses", "pick-this-events-course"] },
  "/prizes": { admin: ["award-prizes"], assistant: ["award-prizes"] },
  "/stages@draw": { admin: ["draw-a-round"], assistant: ["draw-a-round"] },
  "/bracket@knockouts": { admin: ["approve-a-reported-result"], assistant: ["approve-a-reported-result"] },
  "/cup@lineup": { admin: ["set-a-lineup"], assistant: ["set-a-lineup"] },
};

/** A link as the machine or the menu made it, and who is about to press it. */
export interface OldLink {
  href: string;
  /** The job key that made it (What's next, the checklist), when one did. */
  job?: string;
  /** The round it is about, when the job is one round's. */
  roundId?: string;
  role: Role;
}

/**
 * ONE MOVE: an old door, for the roles named, to a new room — and where EACH of that door's jobs
 * lives after it. The move happens only when every merge named in `homes` is shown, so a door
 * whose jobs are split across rooms (the bracket: the draw, Score entry, the board) moves only
 * once all of them are built and shown. `move-table` in `console-merges.test.ts` holds every row
 * to housing every job its door holds for every role it names.
 */
export interface Move {
  /** The door: a pathname, with `#place` when the door is a place on a screen. */
  from: string;
  roles: readonly Role[];
  /** Only for links made by this job, when one door serves several (absent: every link). */
  job?: string;
  homes: Partial<Record<DoorJob, MergeKey>>;
  /** The room, from the old link (keeps what it must of its query). */
  to: (link: OldLink) => string;
}

/** PR 0 builds no room, so no door moves. Each later PR adds its rows here. */
export const MOVES: readonly Move[] = [];

function doorOf(href: string): { path: string; place: string } {
  const at = href.indexOf("#");
  const place = at === -1 ? "" : href.slice(at);
  const beforePlace = at === -1 ? href : href.slice(0, at);
  return { path: beforePlace.split("?")[0], place };
}

/** Does this row's door match the link's address (`/event#courses` needs the place too)? */
function opens(from: string, href: string): boolean {
  const door = doorOf(from);
  const link = doorOf(href);
  return door.path === link.path && (door.place === "" || door.place === link.place);
}

/** The merges a move needs shown: the one each of its jobs moves into. */
export function mergesNeeded(move: Move): MergeKey[] {
  return [...new Set(Object.values(move.homes) as MergeKey[])];
}

/**
 * WHERE THIS LINK LEADS NOW. The first move whose door it opens, for this role and job, with every
 * merge it needs shown; otherwise the link exactly as it was made. With nothing shown it is the
 * identity — switched off, every address in the app is today's. A move that leaves one of its
 * door's jobs without a home is never taken (`unhousedJobs`): the door stays where it is.
 */
export function relocate(link: OldLink, shown: ReadonlySet<MergeKey>, moves: readonly Move[] = MOVES): string {
  if (shown.size === 0) return link.href;
  for (const move of moves) {
    if (!opens(move.from, link.href)) continue;
    if (!move.roles.includes(link.role)) continue;
    if (move.job !== undefined && move.job !== link.job) continue;
    if (!mergesNeeded(move).every((m) => shown.has(m))) continue;
    if (unhousedJobs(move).length > 0) continue;
    return move.to(link);
  }
  return link.href;
}

/**
 * The jobs a move leaves without a home, for each role it names: empty for every row, or the door
 * would lead a person to a room that no longer holds what they came to do.
 */
export function unhousedJobs(move: Move): string[] {
  const door = doorOf(move.from);
  const key = door.path + door.place + (move.job === undefined ? "" : `@${move.job}`);
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
