/**
 * What carries across when a tournament is copied.
 *
 * This is an allowlist, not a denylist, and deliberately so: if someone adds a
 * field to Event next month and forgets this file, an allowlist quietly drops
 * it — a denylist would quietly copy it. Dropping a new setting is a papercut.
 * Copying a new credential is a breach. The accompanying test fails on any
 * unclassified field, so "forgets this file" should not survive review either.
 */

/** Configuration worth carrying from one year's tournament to the next. */
export const CLONED_EVENT_FIELDS = [
  "organizationId",
  "format",
  "course",
  "city",
  "address",
  "customPars",
  "customYards",
  "customStrokeIndex",
  "capacity",
  "playerCountMode",
  "manualPlayerCount",
  "formationRule",
  "flightMode",
  "flightValue",
  "qualifyPerGroup",
  "qualifyMode",
  "qualifyOverall",
  // A club that runs a plate every year wants the plate again.
  "bracketMode",
  // A copy of last year's knockout is a knockout. Dropping this would silently
  // reopen every control the shape exists to hide.
  "shape",
  "winPts",
  "tiePts",
  "lossPts",
  "holeRatioPts",
  "bonusPts",
  "tiebreakers",
  "matchTiebreakers",
  "inviteMessage",
  "leaderboardVisibility",
  "scoreEntryBy",
  "scoreEntryWindow",
  "voiceEntry",
  "playerAccess",
  "scoreApproval",
  // Travels with scoreApproval — a club that wants every player in the match
  // to sign off wants that next year too.
  "attestBy",
] as const;

/**
 * Fields the copy must set for itself, each for a stated reason. Anything here
 * is a conscious exclusion; anything in neither list is an oversight.
 */
export const NOT_CLONED_EVENT_FIELDS: Record<string, string> = {
  id: "the copy is a different tournament",
  createdAt: "set on insert",
  updatedAt: "set on insert",
  name: "supplied by the organizer",
  dates: "always wrong on a copy — last year's dates are not this year's",
  regDeadline: "same reason as dates",
  registrationOverride:
    "a decision about last year's deadline — a copy has a new deadline and starts following it",
  status: "a copy starts as a draft, however far along the original got",
  configUnlocked: "an unlock is granted to one tournament, not inherited",
  launchedAt: "the copy has not been launched",
  flightsConfirmed:
    "a copy has no flights yet — inheriting the sign-off would mark an empty draw as finished, and lock it",
  retainUntil:
    "a hold is granted to one tournament for a reason; a copy inherits neither the reason nor the reprieve",
  seriesId:
    "copying last season's Spring Medal to run this season's would silently enter the new tournament into the old order of merit — a corrupted league table nobody would trace back to a copy. Joining a season is one click; joining the wrong one is a bug",
  completedAt:
    "the copy has not finished — and inheriting it would start the retention clock in the past, making a brand-new tournament immediately eligible for deletion",
  shareToken:
    "unique, so copying collides — and it would hand the copy the original's public link",
};

/**
 * Event's relations. None are copied wholesale.
 *
 * `stages` and `courses` are recreated field by field in cloneEvent — rounds
 * without their Round Codes, venues as plain links. Everything else here is a
 * record of what actually happened at a tournament: players, matches, cards,
 * prizes, announcements, audit trail. A copy has none of that yet.
 *
 * Teams are on that list for a reason worth stating: a team is made of
 * players, and a copy carries no players. Copying the sides would leave every
 * one of them pointing at entries in last year's tournament.
 */
export const CLONE_IGNORED_RELATIONS = [
  "organization",
  "series",
  "accounts",
  "players",
  "groups",
  "stages",
  "matches",
  "bracketWinners",
  "commentary",
  "scorecards",
  "matchScorecards",
  "teams",
  "teamScorecards",
  "prizes",
  "announcements",
  "auditLogs",
  "courses",
];
