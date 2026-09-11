import { describe, it, expect } from "vitest";
import { repairOne, planRepair, type RepairPlayer, type RepairMember } from "../identity-repair";

/**
 * The awkward cases, pinned here rather than discovered against a club's real
 * roster — the same reason `registration-intake.ts` keeps its decision pure.
 *
 * Every fixture uses invented names. Two clubs are present in most of them on
 * purpose: matching across tenants is the failure that would attach one club's
 * entry to another club's record of the same person, and a single-club fixture
 * cannot express it.
 */

const ORG = "org-ashfield";
const OTHER = "org-brackley";

const player = (over: Partial<RepairPlayer> = {}): RepairPlayer => ({
  id: "p1",
  name: "Ada Finch",
  email: "ada@example.invalid",
  memberId: null,
  organizationId: ORG,
  ...over,
});

const member = (over: Partial<RepairMember> = {}): RepairMember => ({
  id: "m1",
  name: "Ada Finch",
  email: "ada@example.invalid",
  organizationId: ORG,
  ...over,
});

describe("an entry that is already linked", () => {
  it("is left alone", () => {
    const out = repairOne(player({ memberId: "m1" }), [member()]);
    expect(out.kind).toBe("ok");
  });

  it("is repaired anyway when the link points at a member of another club", () => {
    /**
     * Nothing in the schema constrains `memberId` to the event's own
     * organization, so a dangling or cross-tenant id reads as "linked" to
     * every caller that only checks for non-null. Treated as unlinked so it
     * gets fixed, rather than as fine so it survives.
     */
    const out = repairOne(player({ memberId: "m-elsewhere" }), [
      member({ id: "m-elsewhere", organizationId: OTHER }),
      member({ id: "m1" }),
    ]);
    expect(out.kind).toBe("link");
    if (out.kind === "link") expect(out.memberId).toBe("m1");
  });

  it("is repaired when the link points at nothing at all", () => {
    const out = repairOne(player({ memberId: "m-deleted" }), [member({ id: "m1" })]);
    expect(out.kind).toBe("link");
  });
});

describe("matching by address", () => {
  it("links on the address, case and spacing ignored", () => {
    const out = repairOne(player({ email: "  ADA@Example.Invalid " }), [member()]);
    expect(out.kind).toBe("link");
    if (out.kind === "link") {
      expect(out.memberId).toBe("m1");
      expect(out.matchedOn).toBe("email");
    }
  });

  it("never reaches across clubs", () => {
    // The same person, on another club's roster. Linking would put this
    // entry under the wrong tenant's record.
    const out = repairOne(player(), [member({ id: "m-other", organizationId: OTHER })]);
    expect(out.kind).toBe("create");
  });

  it("refuses when two roster rows share the address", () => {
    // `addMember` refuses to create this, so it predates the check or was
    // imported around it — and it may be a couple sharing an inbox, which is
    // not one person.
    const out = repairOne(player(), [member({ id: "m1" }), member({ id: "m2", name: "Bram Finch" })]);
    expect(out.kind).toBe("ambiguous");
    if (out.kind === "ambiguous") expect(out.candidates).toEqual(["m1", "m2"]);
  });
});

describe("matching by name, only when there is no address", () => {
  it("links an address-less entry to the member of that name", () => {
    const out = repairOne(player({ email: "" }), [member({ email: "" })]);
    expect(out.kind).toBe("link");
    if (out.kind === "link") expect(out.matchedOn).toBe("name");
  });

  it("does NOT match on name when the entry has an address", () => {
    /**
     * THE CASE THAT MAKES THIS A RULE RATHER THAN A PREFERENCE.
     *
     * Same name, different address, is evidence of two people — a father and
     * son at the same club, most obviously. `upsertMember` reads it the same
     * way: it matches by email when there is one and only falls back to name
     * when there is not.
     *
     * Asserted as `create`, which is the safe answer: a new member for this
     * address, rather than quietly filing one man's card under the other's
     * identity.
     */
    const out = repairOne(player({ email: "ada.finch@example.invalid" }), [
      member({ email: "a.finch@example.invalid" }),
    ]);
    expect(out.kind).toBe("create");
  });

  it("refuses two members of the same name when the entry has no address", () => {
    const out = repairOne(player({ email: "" }), [
      member({ id: "m1", email: "" }),
      member({ id: "m2", email: "" }),
    ]);
    expect(out.kind).toBe("ambiguous");
    if (out.kind === "ambiguous") {
      expect(out.candidates).toEqual(["m1", "m2"]);
      expect(out.reason).toContain("Ada Finch");
    }
  });

  it("refuses an entry with neither a name nor an address", () => {
    const out = repairOne(player({ name: "   ", email: "" }), [member()]);
    expect(out.kind).toBe("ambiguous");
  });
});

describe("the plan as a whole", () => {
  it("groups every entry exactly once", () => {
    const players: RepairPlayer[] = [
      player({ id: "a", memberId: "m1" }),
      player({ id: "b", email: "bram@example.invalid", name: "Bram Cole" }),
      player({ id: "c", email: "", name: "Cass Ireland" }),
      player({ id: "d", email: "", name: "Dev Naru" }),
    ];
    const members: RepairMember[] = [
      member({ id: "m1" }),
      member({ id: "m2", name: "Cass Ireland", email: "" }),
      member({ id: "m3", name: "Dev Naru", email: "" }),
      member({ id: "m4", name: "Dev Naru", email: "" }),
    ];
    const plan = planRepair(players, members);
    expect(plan.ok.map((o) => o.player.id)).toEqual(["a"]);
    expect(plan.create.map((o) => o.player.id)).toEqual(["b"]);
    expect(plan.link.map((o) => o.player.id)).toEqual(["c"]);
    expect(plan.ambiguous.map((o) => o.player.id)).toEqual(["d"]);
    // Nothing lost and nothing counted twice.
    const total = plan.ok.length + plan.link.length + plan.create.length + plan.ambiguous.length;
    expect(total).toBe(players.length);
  });

  it("is idempotent in the only sense that matters: a linked field plans nothing", () => {
    /**
     * What the script relies on to be safe to re-run. If a second pass over
     * already-repaired rows produced any work, running the repair twice would
     * duplicate members.
     */
    const players = [player({ id: "a", memberId: "m1" }), player({ id: "b", memberId: "m2", email: "b@example.invalid" })];
    const members = [member({ id: "m1" }), member({ id: "m2", email: "b@example.invalid", name: "Bram Cole" })];
    const plan = planRepair(players, members);
    expect(plan.link).toEqual([]);
    expect(plan.create).toEqual([]);
    expect(plan.ambiguous).toEqual([]);
    expect(plan.ok).toHaveLength(2);
  });

  it("decides each entry against the roster as it was, not as the plan would leave it", () => {
    /**
     * Two address-less entries for one person nobody has on the roster both
     * plan a CREATE, because a member invented for the first is not visible
     * to the second. That is deliberate — threading provisional members
     * through the planner would make the outcome depend on the order rows
     * came back from the database.
     *
     * The caller's answer is to apply and re-run: the second pass sees the
     * created member and links the second entry to it. Pinned so that
     * property is a decision on the record rather than an accident.
     */
    const players = [
      player({ id: "a", email: "", name: "Elin Roche" }),
      player({ id: "b", email: "", name: "Elin Roche" }),
    ];
    const plan = planRepair(players, []);
    expect(plan.create).toHaveLength(2);
  });
});
