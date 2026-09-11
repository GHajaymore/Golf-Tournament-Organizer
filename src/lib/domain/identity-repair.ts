/**
 * MAKING THE DATA AGREE WITH THE IDENTITY DESIGN.
 *
 * The identity of a person in this app is `Member.id` inside an organization
 * and `Player.id` inside an event — not their email address. `Player.memberId`
 * is the link between the two, and the schema says so: "Roster record this
 * entry belongs to. Optional only so that entries made before the roster
 * existed remain valid; every path that creates a player now goes through a
 * Member."
 *
 * "Optional only so that…" is the whole problem. Every path creates the link
 * TODAY; rows written before that do not have it, and nothing has ever gone
 * back for them. Those entries are identified by an email address — a
 * CREDENTIAL — or, once entries without one became possible, by nothing at all.
 * They are the rows that cannot be messaged as a person, cannot be recognised
 * next season, and cannot take part in any future change that keys on member
 * identity.
 *
 * So this works out, for each unlinked entry, which member it IS. It decides
 * and never writes: the caller does the IO, the same split
 * `registration-intake.ts` uses and for the same reason — the awkward cases
 * are worth pinning in a unit test rather than discovering against a club's
 * real roster.
 *
 * THE ORDER IS THE ONE THE APP ALREADY USES, not a new one. `unlinkedPlayers`
 * matches "by member id first and by email second". `upsertMember` falls back
 * to a case-insensitive name within the organization when a member has no
 * address. This follows both, in that order, so a repair cannot decide
 * something different from what the live code would have decided.
 *
 * WHAT IT REFUSES TO GUESS. Two members of one club with the same name and no
 * address between them are not separable, and picking either is a coin toss
 * that silently attaches somebody's scores to somebody else. Those are
 * reported, never resolved — the same instinct as the course-card rules, where
 * "a guard that refuses a real golf course is worse than no guard" and the
 * remedy was always to look at the refusals by name before believing a count.
 */

export interface RepairPlayer {
  id: string;
  name: string;
  email: string;
  memberId: string | null;
  /** Which organization the entry's event belongs to. */
  organizationId: string;
}

export interface RepairMember {
  id: string;
  name: string;
  email: string;
  organizationId: string;
}

/** One entry that already points at a member of its own club: nothing to do. */
export type RepairOutcome =
  /** Already linked, or linked to a member of the right club. */
  | { kind: "ok"; player: RepairPlayer }
  /** Link it to this existing member. */
  | { kind: "link"; player: RepairPlayer; memberId: string; matchedOn: "email" | "name" }
  /** No member exists for this person; create one and link it. */
  | { kind: "create"; player: RepairPlayer }
  /** Cannot be decided safely — a human has to look. */
  | { kind: "ambiguous"; player: RepairPlayer; reason: string; candidates: string[] };

const key = (email: string): string => email.trim().toLowerCase();
const nameKey = (name: string): string => name.trim().toLowerCase();

/**
 * What to do with one entry.
 *
 * `members` must already be the members of that entry's own organization —
 * the caller scopes it, so a club's roster can never be matched against
 * another club's entry. That is a correctness boundary rather than an
 * efficiency one: two clubs commonly share a member, and matching across them
 * would link an entry to the wrong tenant's record of the same person.
 */
export function repairOne(player: RepairPlayer, members: readonly RepairMember[]): RepairOutcome {
  const mine = members.filter((m) => m.organizationId === player.organizationId);

  /**
   * A LINK THAT POINTS SOMEWHERE ELSE IS NOT A LINK.
   *
   * `memberId` is nullable and nothing enforces that it belongs to the event's
   * own club, so a dangling id — a member deleted, or a row copied between
   * tenants — reads as "linked" to every caller that only checks for
   * non-null. Treated here as unlinked so it gets repaired, rather than as
   * fine so it survives.
   */
  if (player.memberId && mine.some((m) => m.id === player.memberId)) {
    return { kind: "ok", player };
  }

  const email = key(player.email);
  if (email) {
    const byEmail = mine.filter((m) => key(m.email) === email);
    if (byEmail.length === 1) return { kind: "link", player, memberId: byEmail[0].id, matchedOn: "email" };
    if (byEmail.length > 1) {
      /**
       * Two roster rows sharing an address. `addMember` refuses to create
       * that, so it comes from data written before the check or imported
       * around it — and the two rows may be a couple sharing an inbox, which
       * is not one person.
       */
      return {
        kind: "ambiguous",
        player,
        reason: `${byEmail.length} roster members share the address ${email}`,
        candidates: byEmail.map((m) => m.id),
      };
    }
  }

  /**
   * Name is the fallback ONLY for an entry with no address, exactly as
   * `upsertMember` has it: with an address in hand, a name match against a
   * DIFFERENT address is evidence of two people, not one.
   */
  if (!email) {
    const n = nameKey(player.name);
    if (!n) {
      return { kind: "ambiguous", player, reason: "the entry has neither a name nor an address", candidates: [] };
    }
    const byName = mine.filter((m) => nameKey(m.name) === n);
    if (byName.length === 1) return { kind: "link", player, memberId: byName[0].id, matchedOn: "name" };
    if (byName.length > 1) {
      return {
        kind: "ambiguous",
        player,
        reason: `${byName.length} roster members are called "${player.name.trim()}" and the entry has no address to tell them apart`,
        candidates: byName.map((m) => m.id),
      };
    }
  }

  /**
   * Nobody on the roster is this person, so the roster is missing them —
   * which is what "the field was built before the club had a roster" means.
   * Creating the member is what every entry path does today; this is that,
   * applied late.
   */
  return { kind: "create", player };
}

export interface RepairPlan {
  ok: RepairOutcome[];
  link: RepairOutcome[];
  create: RepairOutcome[];
  ambiguous: RepairOutcome[];
}

/**
 * The whole plan, grouped for a report.
 *
 * Entries are decided independently and in the order given. Members CREATED by
 * an earlier decision are not visible to a later one, deliberately: the caller
 * applies the plan and re-runs, and the second run links anything the first
 * created. Threading provisional members through here would make the outcome
 * depend on the order rows came back from the database, which is not a
 * property a repair should have.
 */
export function planRepair(
  players: readonly RepairPlayer[],
  members: readonly RepairMember[],
): RepairPlan {
  const plan: RepairPlan = { ok: [], link: [], create: [], ambiguous: [] };
  for (const p of players) {
    const outcome = repairOne(p, members);
    plan[outcome.kind].push(outcome);
  }
  return plan;
}
