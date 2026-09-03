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
  // Carried with the name beside it. A tournament cloned from last year is
  // played at the same course until somebody says otherwise, and the club
  // still owns that course — the id stays valid.
  "courseId",
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
  // Carried, unlike registrationOpen/registrationApproval above. Those are
  // about the state a copy starts in; this is a standing decision about what
  // the club asks its members for. A society that runs a shotgun every year
  // and needs a number to ring wants that on next year's form too, and having
  // to remember it after the entries are in is when it is too late.
  "requirePhone",
  // How this tournament handles money. Carried, because next year's running of
  // the same outing runs its money the same way — and an empty value here
  // means "follow the club", which is exactly what a copy should inherit too.
  "moneyMode",
  "scoreApproval",
  // Travels with scoreApproval — a club that wants every player in the match
  // to sign off wants that next year too.
  "attestBy",
  // A weekly league copied for next season is still a weekly league.
  "attendanceMode",
  /**
   * Travels with the course, which IS copied.
   *
   * The opposite of teePolicy, and for a reason: that says who DECIDES, and a
   * new committee decides again. This says WHICH SET, and it belongs to the
   * course the copy inherits. Left behind, the copy falls back to whichever
   * tee sorts first by position — silently, which is the exact wrongness this
   * column was added to end.
   */
  "defaultTeeId",
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
  courseRef:
    "the relation object for courseId, which IS carried — a relation is navigated, never written, so copying it is not a thing that can be done",
  defaultTee:
    "the relation object for defaultTeeId, which IS carried — same rule as courseRef above. It was listed as clonable on the reasoning that the id and the relation should travel together, which reads sensibly and is a category error: there is nothing to travel. Nothing caught it while the copy was a hand-written field list that wrote neither; deriving the write from this policy made the compiler reject it immediately.",
  createdAt: "set on insert",
  updatedAt: "set on insert",
  name: "supplied by the organizer",
  teePolicy:
    "a condition of THIS competition, decided for the tees and the field it had — a copy is a new competition and its committee sets it again rather than inheriting a restriction nobody in the room chose",
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
  // What last year's rounds were played off, and the committee's decisions
  // about them. Both are facts about rounds that have been played, on entries
  // this copy does not carry — and a handicap is the one number that must be
  // read fresh, since the whole point of the feature is that a round takes the
  // handicap in force when it is played. A copy has played nothing yet.
  "roundHandicaps",
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
  /**
   * What was sent to a handicapping association, for rounds this copy has not
   * played.
   *
   * The most consequential entry on this list. A HandicapPost is the record
   * that one golfer's round HAS been written to their official index, and it
   * is what stops a second attempt — so copying it forward would tell the new
   * tournament its rounds were already posted, and those rounds would then
   * never reach the association at all. A whole competition would quietly go
   * unrecorded, and nobody would find out until a member queried their index
   * in October.
   */
  "handicapPosts",
  // The kitty's own lines, for the same reason: last year's entry fees were
  // collected from last year's entrants and last year's trophy is bought.
  // The MODE carries forward (see the allowlist above) so the new tournament
  // runs its money the same way; the money itself does not.
  "fundLines",
  // Side bets are cash on the table, exactly like a skins pot: copying last
  // year's closest-to-the-pin forward would enter players who staked nothing
  // and award a pot that was already paid out.
  "contests",
  // Same reasoning again: a birdie pot is players' cash on a night that has
  // been played. A copy starts with the bets switched off, and an organizer
  // who runs the same ones weekly turns them on for the round in front of them.
  "sideGames",
  // Conversations belong to the tournament they were had in. Copying them
  // forward would carry last year's messages into this year's event and show
  // them to a field that has changed — including, in a direct thread, to
  // people who were never in it. A new tournament starts quiet.
  "threads",
];

/**
 * What carries across on each ROUND of a copied tournament.
 *
 * The Event policy above existed and the copy honoured 30 of its 43 entries.
 * The Stage loop had no policy at all, so nothing could notice that it copied
 * `cutEnabled`, `cutMode`, `cutCount` and `cutPercent` but not `cutScope` — a
 * per-flight cut became an overall one and a different set of players
 * advanced — and dropped `handicapAllowance`, `allowanceWeights` and
 * `countBest`, so a committee's 60/40 greensomes split or its best-2-of-4
 * count reverted to the format default on every copied round.
 *
 * Same allowlist reasoning as the Event: forgetting to classify a new column
 * drops it, which is a papercut, where a denylist would copy it, which for a
 * credential is a breach.
 */
export const CLONED_STAGE_FIELDS = [
  "position",
  "type",
  "description",
  "format",
  "holes",
  "scoringBasis",
  // How the round is RECORDED travels with its shape, the same as how it is
  // scored. A club that asks for cards from its match-play day is running that
  // tournament again next year for the same reason.
  "scoreInput",
  /**
   * Carried, but TRANSLATED — the one field on this list that cannot be copied
   * as it stands. See `cloneSingleMatchRule`.
   *
   * A "1 v 2" rule is about positions and copies straight across. The other two
   * kinds are made of ids belonging to the tournament they were written in: a
   * `stage-winners` rule names Stage ids, and copying those verbatim gave the
   * new tournament a final waiting on two rounds in the OLD one — "Waiting on
   * the earlier rounds", forever, however completely this year's were played.
   * A `named` rule names Player ids from a field that is never copied, so it
   * reported a withdrawal that had not happened.
   *
   * The stage-winners ids are remapped onto the copy's own rounds and the
   * named rule is dropped, which leaves the round asking to be set rather than
   * blaming something.
   */
  "singleMatchRule",
  "thirdPlace",
  "carryForwardEnabled",
  "carryForwardPct",
  "cutEnabled",
  // The one the copy silently changed: a cut "per flight" became "overall",
  // which advances a different set of players entirely.
  "cutScope",
  "cutMode",
  "cutCount",
  "cutPercent",
  "courseId",
  "nine",
  // The committee's own arithmetic. A round copied without these is scored on
  // the format's defaults instead of what the club actually plays.
  "handicapAllowance",
  "allowanceWeights",
  "countBest",
] as const;

/** Round fields the copy must set for itself, each for a stated reason. */
export const NOT_CLONED_STAGE_FIELDS: Record<string, string> = {
  id: "the copy is a different round",
  eventId: "points at the new tournament",
  event: "the relation object for eventId",
  course: "the relation object for courseId, which IS carried",
  playedOn: "last year's date is never this year's",
  deadline: "same — a copied deadline is always in the past",
  deadlineOverride: "belongs to the deadline that was not copied",
  carryForwardAsked:
    "records that an organizer was ASKED about carry-forward on the original; the copy asks again",
  accessCode: "a credential — a new tournament gets new Round Codes, and only if it turns them on",
  optDeadline: "a date, like the others",
  teeSheet: "last year's draw, made from last year's field",
  teeSheetPublished: "belongs to the tee sheet that was not copied",
  matches: "results and pairings are never copied",
  teams: "made from the field, which is not copied",
  attendance: "who turned up last year",
  skinsPots: "money — see the Event policy",
};
