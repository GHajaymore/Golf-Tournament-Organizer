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
  // Last year's member-guest was played in pairs and this year's is too. It
  // describes how the club runs the event, not anything that happened at one
  // — and since it only picks a default and reveals a screen, inheriting it
  // costs nothing even where the organizer changes their mind.
  "sideStyle",
  "winPts",
  "tiePts",
  "lossPts",
  "holeRatioPts",
  "bonusPts",
  // The appearance point is part of how a league rewards turning up, and a
  // league copied for next season rewards it the same way.
  "playPts",
  // A cap is part of how the club decided its flights should feel, and it
  // belongs with the rest of the scoring rules: last year's member-guest
  // copied forward should still be capped.
  "maxPerMatch",
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
  // A weekly league copied for next season is still a weekly league.
  "attendanceMode",
  // A society that plays a different course every week does so next season
  // too. The venue itself is not copied — see the exclusion below — but the
  // decision not to have one is part of what the tournament is.
  "courseMode",
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
  registrationToken:
    "the public sign-up link. Unique (partial index), so copying collides, and it would point last year's shared URL at this year's field — the copy mints its own when its organizer opens registration",
  registrationOpen:
    "a copy starts with sign-ups closed, whatever the original ended at — opening a brand-new draft to the public the moment it's created is never what a copy wants",
  registrationApproval:
    "travels with registrationOpen: a closed copy has no entries to auto-confirm or approve, so it starts at the default and the organizer chooses when they open it",
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
  // Weekly in/out answers are the record of who played which week — a copy
  // for next season starts with nobody asked.
  "attendance",
  // A skins pot is cash: real people who really paid, and a carry someone is
  // owed. Copying last season's pots forward would enter players who have
  // handed over nothing and assert debts nobody agreed to. A new season starts
  // with an empty pot and, deliberately, no carry.
  "skinsPots",
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
  // Money that real people really spent, and handovers that really happened.
  // Copying last year's outing forward would open the new one with a dinner
  // bill nobody has eaten and a debt nobody agreed to — the same reasoning as
  // skinsPots, and worse here because an expense ledger is settled between
  // friends rather than out of a pot.
  "expenses",
  "settlements",
  // Side bets are cash on the table, exactly like a skins pot: copying last
  // year's closest-to-the-pin forward would enter players who staked nothing
  // and award a pot that was already paid out.
  "contests",
  // Same reasoning again: a birdie pot is players' cash on a night that has
  // been played. A copy starts with the bets switched off, and an organizer
  // who runs the same ones weekly turns them on for the round in front of them.
  "sideGames",
];
