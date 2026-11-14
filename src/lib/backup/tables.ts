/**
 * WHICH TABLES THE PRODUCTION BACKUP COPIES (B21, 2026-11-14).
 *
 * Every table in the database is in exactly one of these two lists. A table in
 * neither is a table that would silently go unbacked, so two things refuse it:
 *
 *   - `backup-tables.test.ts` reads `prisma/schema.prisma` and fails when a
 *     model is in neither list (or in both);
 *   - the restore drill (`backup-restore-drill.audit.test.ts`) migrates an
 *     empty database and fails when a table the migrations made is in neither
 *     list — which also catches a table no model names, such as
 *     `_prisma_migrations` or an implicit many-to-many join.
 *
 * And at run time the export reports any table in neither list to Sentry by
 * name (a table name is schema, never a person), so a model added by a
 * migration that reached production before this file did is still heard of.
 *
 * Table names equal the model names: the schema has no `@@map`.
 */

/**
 * Copied every night. `_prisma_migrations` comes FIRST: the restore reads the
 * migration history before any data, so it can refuse a backup whose schema
 * differs from the checkout it is restoring with before loading anything.
 */
export const BACKED_UP_TABLES = [
  "_prisma_migrations",
  "Account",
  "Announcement",
  "AuditLog",
  "BracketReport",
  "BracketWinner",
  "Commentary",
  "Contest",
  "ContestEntry",
  "Course",
  "CourseCatalog",
  "CupPoint",
  "DiscountCode",
  "EarlyListSend",
  "EmailFailure",
  "Event",
  "EventCourse",
  "Expense",
  "ExpensePayment",
  "ExpenseShare",
  "Group",
  "HandicapPost",
  "HonoursEntry",
  "Integration",
  "InterestRequest",
  "JoinRequest",
  "KnownDevice",
  "LeaguePlayoffHole",
  "Match",
  "MatchScorecard",
  "Member",
  "Message",
  "NamesakeNotice",
  "Organization",
  "OrganizationMember",
  "PlatformSetting",
  "Player",
  "Prize",
  "PushSubscription",
  "RoundAttendance",
  "RoundHandicap",
  "ScoringKeeper",
  "Scorecard",
  "Series",
  "Settlement",
  "SideGame",
  "SideGameEntry",
  "SkinsEntry",
  "SkinsPot",
  "SmsDelivery",
  "Stage",
  "Subscription",
  "Team",
  "TeamMember",
  "TeamScorecard",
  "Tee",
  "Thread",
  "ThreadParticipant",
  "ThreadRead",
  "TournamentFund",
  "User",
] as const;

/**
 * Left out ON PURPOSE, each with its reason. All three hold short-lived
 * secrets or counters that expire within the hour: a copy of them is a copy of
 * something an attacker could use and nobody could miss, and a database
 * restored without them simply asks the person for a fresh code.
 */
export const EXCLUDED_TABLES: Readonly<Record<string, string>> = {
  PasswordResetToken: "a reset link's secret; expires within the hour",
  EmailCode: "a sign-in or verification code; expires within minutes",
  RateLimitHit: "a throttle's counter; expires on its own",
};

/** A table name the export and the restore will put into SQL: letters, digits and underscores only. */
export function isPlainTableName(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(name);
}
