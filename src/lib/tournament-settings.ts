import { ATTENDANCE_MODES, type AttendanceMode } from "./domain/attendance";
/**
 * Per-tournament settings for how players see standings and report scores.
 *
 * These exist because there is no single right answer. A club championship
 * runs blind with the committee entering every card; a Tuesday society wants
 * players scoring live on their phones; a member-guest wants a link the whole
 * clubhouse can watch. The same community often has several organizers who
 * each run their events differently, so the tournament — not the app, and not
 * the organization — is where the choice lives.
 *
 * Organizations set house defaults that new tournaments copy. The copy is
 * deliberate: changing a default must never alter the rules of a tournament
 * that is already under way.
 *
 * Pure module — no database, no request context — so the rules can be unit
 * tested and shared by the server guards, the actions and the UI alike.
 */

import type { Role } from "./roles";

/* ── Leaderboard visibility ───────────────────────────────────────────── */

/** Cumulative: each level includes everyone in the level above it. */
export const LEADERBOARD_VISIBILITY = ["staff", "participants", "public"] as const;
export type LeaderboardVisibility = (typeof LEADERBOARD_VISIBILITY)[number];

export const LEADERBOARD_VISIBILITY_LABEL: Record<LeaderboardVisibility, string> = {
  staff: "Organizers only",
  participants: "Organizers and players",
  public: "Anyone with the link",
};

export const LEADERBOARD_VISIBILITY_HELP: Record<LeaderboardVisibility, string> = {
  staff: "A blind event — players can't see standings until you publish results.",
  participants: "Signed-in players see live standings. Nothing is public.",
  public: "A read-only link anyone can open, no sign-in. Shows player names and scores.",
};

/* ── Tees ─────────────────────────────────────────────────────────────── */

/**
 * Which tees the competition is played from.
 *
 * This is a CONDITION OF COMPETITION, not a display preference. Rule 6.1b
 * makes playing from outside the teeing area a penalty, so "everyone off the
 * whites" is a rule the club has set, and an app that quietly honours a
 * player's stored preference instead is scoring a round nobody played.
 *
 * Handicapping needs no help either way: the Course Handicap formula is
 * index x (slope / 113) + (CR - par), and that last term already gives the
 * longer, higher-rated tee its extra strokes. Mixed tees are FAIR by
 * arithmetic — the question here is only whether they are ALLOWED.
 */
/**
 * Four answers, because the real question is AT WHAT LEVEL tees are decided.
 *
 * The policy is the FLOOR of what may override, and specificity wins above
 * it — a player beats their flight, a flight beats the round. So `one` lets
 * neither differ, `flight` lets a division differ but not an individual, and
 * the last two let individuals differ too.
 *
 * `own` and `player` score identically and differ in PERMISSION: whether the
 * organizer assigns the tee or the golfer picks it. That is the same shape as
 * scoreEntryBy, which asks who may write a score rather than what a score is.
 *
 * "own" is kept as a stored value rather than renamed, so no tournament
 * already running needs its column rewritten to mean what it already meant.
 */
export const TEE_POLICY = ["one", "flight", "own", "player"] as const;
export type TeePolicy = (typeof TEE_POLICY)[number];

export const TEE_POLICY_LABEL: Record<TeePolicy, string> = {
  one: "One set of tees for everyone",
  flight: "Each flight plays its own tees",
  own: "The organizer assigns each player's tees",
  player: "Players choose their own tees",
};

export const TEE_POLICY_HELP: Record<TeePolicy, string> = {
  one: "The whole field plays the round's tees, whatever a player's record says. This is the ordinary club medal, and what a condition of competition means by Rule 6.1b.",
  flight:
    "Set the tees once per flight and everyone in it follows. This is how a club championship runs three divisions off three sets — championship, seniors, ladies — without assigning anybody individually. A flight you leave alone plays the round's tees.",
  own: "You put each player on a set; anyone you haven't assigned plays their flight's, or the round's. Handicaps account for the difference, so a mixed field is still fair.",
  player: "Each golfer picks their own set, and may change it until they have returned a card. Same scoring as assigning them yourself — it just saves you doing it for a field that already knows.",
};

/**
 * Whether a player may set their OWN tee.
 *
 * Only under `player`. Under `own` the assignment is the organizer's, and
 * under `one` there is nothing to choose — letting a golfer opt themselves
 * onto another set would quietly break the condition of competition the
 * committee set, which is the whole reason `one` exists.
 */
export function canChooseOwnTee(policy: TeePolicy): boolean {
  return policy === "player";
}

/* ── Score entry ──────────────────────────────────────────────────────── */

/**
 * Who may report scores.
 *
 * Only two options, because organizers and assistants can always enter and
 * correct scores — an organizer who can't fix a wrong number can't run an
 * event. The real question is whether players may *also* enter their own.
 */
export const SCORE_ENTRY_BY = ["staff", "players"] as const;
export type ScoreEntryBy = (typeof SCORE_ENTRY_BY)[number];

export const SCORE_ENTRY_BY_LABEL: Record<ScoreEntryBy, string> = {
  staff: "Organizers and assistants only",
  players: "Players may enter their own scores",
};

/**
 * When a player may submit.
 *
 * `during` saves each hole as it is played, so the leaderboard moves live.
 * `after` collects the whole card and takes it in one submission, so nothing
 * reaches the leaderboard until the player has finished the round. This is a
 * real behavioural difference, not a label — organizers who ask for
 * "scores after the round" mean they don't want a live feed of partial cards.
 */
export const SCORE_ENTRY_WINDOW = ["during", "after"] as const;
export type ScoreEntryWindow = (typeof SCORE_ENTRY_WINDOW)[number];

export const SCORE_ENTRY_WINDOW_LABEL: Record<ScoreEntryWindow, string> = {
  during: "During the round, hole by hole",
  after: "After the round, as a completed card",
};

/* ── Score approval ───────────────────────────────────────────────────── */

/**
 * Who locks a result.
 *
 * `staff` holds every submitted card as pending review until an organizer or
 * assistant approves it. `players` keeps the two-player confirmation, where
 * the opponent agrees the result and anything left pending auto-confirms after
 * a day.
 *
 * Defaults to `staff`. The app previously auto-confirmed unreviewed scores
 * after 24 hours, which quietly locks results nobody checked — not a
 * behaviour an organizer should inherit without choosing it.
 */
export const SCORE_APPROVAL = ["staff", "players"] as const;
export type ScoreApproval = (typeof SCORE_APPROVAL)[number];

export const SCORE_APPROVAL_LABEL: Record<ScoreApproval, string> = {
  staff: "An organizer approves each card",
  players: "Players confirm between themselves",
};

export const SCORE_APPROVAL_HELP: Record<ScoreApproval, string> = {
  staff: "Submitted cards wait as pending review. Nothing counts until you approve it.",
  players: "The players agree the result between themselves. Anything still pending locks itself after 24 hours.",
};

/* ── How much agreement a card needs ──────────────────────────────────── */

/**
 * When players confirm between themselves, how many of them have to.
 *
 * Only consulted when scoreApproval is "players" — with staff approval there
 * is nobody to configure. Kept as its own setting rather than folded into
 * scoreApproval because the two questions are genuinely separate: who signs
 * off, and how many of them.
 *
 * "Playing together" means the players bound into one result — see
 * scoringGroup in domain/attest.ts. In match play that is the match, not the
 * foursome, so two pairs sharing a tee time never approve each other's cards.
 */
export const ATTEST_BY = ["marker", "opponent", "all"] as const;
export type AttestBy = (typeof ATTEST_BY)[number];

export const ATTEST_BY_LABEL: Record<AttestBy, string> = {
  marker: "One playing partner",
  opponent: "Someone from the other side",
  all: "Everyone in the match",
};

export const ATTEST_BY_HELP: Record<AttestBy, string> = {
  marker: "The marker system every club medal already runs on. Fastest, and enough for most tournaments.",
  opponent:
    "The people with a reason to check it. In stroke play, where there is no other side, this behaves as one playing partner.",
  all: "Every other player bound into the result must confirm. Slowest, and worth it when the result will be argued about.",
};

/* ── Player sign-in ───────────────────────────────────────────────────── */

/**
 * How a player gets in.
 *
 * `code` exists because email is the wrong key for a lot of real fields: a
 * society roster is often names and nothing else, and chasing 60 people for
 * an address before anyone can score is not a workable ask.
 */
export const PLAYER_ACCESS = ["email", "code", "both"] as const;
export type PlayerAccess = (typeof PLAYER_ACCESS)[number];

export const PLAYER_ACCESS_LABEL: Record<PlayerAccess, string> = {
  email: "Email and password",
  code: "Access code on their scorecard",
  both: "Either email or access code",
};

/* ── The settings bundle ──────────────────────────────────────────────── */

export interface TournamentSettings {
  leaderboardVisibility: LeaderboardVisibility;
  scoreEntryBy: ScoreEntryBy;
  scoreEntryWindow: ScoreEntryWindow;
  voiceEntry: boolean;
  playerAccess: PlayerAccess;
  scoreApproval: ScoreApproval;
  /** How many playing partners must confirm, when players approve. */
  attestBy: AttestBy;
  /** Weekly-league sign-up: everyone | opt-out | opt-in. See domain/attendance. */
  attendanceMode: AttendanceMode;

  /** own | one - which tees the competition is played from. */
  teePolicy: TeePolicy;
}

/**
 * Defaults reproduce the behaviour the app had before these settings existed,
 * so adding them changes nothing for a tournament already running.
 */
export const DEFAULT_SETTINGS: TournamentSettings = {
  leaderboardVisibility: "participants",
  scoreEntryBy: "players",
  scoreEntryWindow: "during",
  voiceEntry: true,
  playerAccess: "email",
  // The one default that deliberately does not match prior behaviour — see
  // SCORE_APPROVAL above.
  scoreApproval: "staff",
  // One partner is what a club medal has always required, so a tournament
  // switching to player approval behaves the way its members expect.
  attestBy: "marker",
  // "everyone" is the feature switched off — exactly how every tournament
  // behaved before leagues could ask the weekly question.
  attendanceMode: "everyone",
  // "own" is the behaviour the app already had: a player tee wins, falling
  // back to the round. Adding the setting changes nothing until asked.
  teePolicy: "own",
};

/** Coerce stored strings into valid settings, falling back per field. A bad
 *  value in one column must not invalidate the rest of the tournament. */
export function cleanSettings(raw: Partial<Record<keyof TournamentSettings, unknown>>): TournamentSettings {
  const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
    allowed.includes(value as T) ? (value as T) : fallback;

  return {
    leaderboardVisibility: pick(
      raw.leaderboardVisibility,
      LEADERBOARD_VISIBILITY,
      DEFAULT_SETTINGS.leaderboardVisibility,
    ),
    scoreEntryBy: pick(raw.scoreEntryBy, SCORE_ENTRY_BY, DEFAULT_SETTINGS.scoreEntryBy),
    scoreEntryWindow: pick(raw.scoreEntryWindow, SCORE_ENTRY_WINDOW, DEFAULT_SETTINGS.scoreEntryWindow),
    voiceEntry: typeof raw.voiceEntry === "boolean" ? raw.voiceEntry : DEFAULT_SETTINGS.voiceEntry,
    playerAccess: pick(raw.playerAccess, PLAYER_ACCESS, DEFAULT_SETTINGS.playerAccess),
    scoreApproval: pick(raw.scoreApproval, SCORE_APPROVAL, DEFAULT_SETTINGS.scoreApproval),
    attestBy: pick(raw.attestBy, ATTEST_BY, DEFAULT_SETTINGS.attestBy),
    attendanceMode: pick(raw.attendanceMode, ATTENDANCE_MODES, DEFAULT_SETTINGS.attendanceMode),
    teePolicy: pick(raw.teePolicy, TEE_POLICY, DEFAULT_SETTINGS.teePolicy),
  };
}

/* ── Rules ────────────────────────────────────────────────────────────── */

const IS_STAFF: Record<Role, boolean> = { admin: true, assistant: true, player: false };

/** Whether a signed-in role may open the leaderboard for this tournament. */
export function canSeeLeaderboard(settings: TournamentSettings, role: Role): boolean {
  if (IS_STAFF[role]) return true;
  return settings.leaderboardVisibility !== "staff";
}

/** Whether the public share link should resolve at all. */
export function isLeaderboardPublic(settings: TournamentSettings): boolean {
  return settings.leaderboardVisibility === "public";
}

/** Whether a signed-in role may report scores. Staff always may. */
export function canEnterScores(settings: TournamentSettings, role: Role): boolean {
  if (IS_STAFF[role]) return true;
  return settings.scoreEntryBy === "players";
}

/**
 * Whether a *player* may save a partially filled card.
 *
 * Staff are never restricted this way — they enter scores as groups come in.
 * A player in `after` mode must submit a complete round in one go.
 */
export function canPlayerSavePartial(settings: TournamentSettings): boolean {
  return settings.scoreEntryWindow === "during";
}

/**
 * Whether a result may lock without a staff member looking at it.
 *
 * Under `staff` approval nothing auto-confirms: a card sits pending until an
 * organizer approves it, however long that takes.
 */
export function allowsAutoConfirm(settings: TournamentSettings): boolean {
  return settings.scoreApproval === "players";
}

/** Whether a signed-in role may approve a submitted card. */
export function canApproveScores(settings: TournamentSettings, role: Role): boolean {
  if (IS_STAFF[role]) return true;
  // Under player confirmation the opponent agrees the result — but only for
  // their own match, which the action checks separately; this answers the
  // narrower "is this role ever allowed to approve" question.
  return settings.scoreApproval === "players";
}

/** Whether access codes are in use — the only case where they get generated. */
export function usesAccessCodes(settings: TournamentSettings): boolean {
  return settings.playerAccess === "code" || settings.playerAccess === "both";
}

/** Whether a player may sign in with an email and password. */
export function usesEmailSignIn(settings: TournamentSettings): boolean {
  return settings.playerAccess === "email" || settings.playerAccess === "both";
}
