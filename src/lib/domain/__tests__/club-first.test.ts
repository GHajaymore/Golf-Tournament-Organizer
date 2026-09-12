import { describe, it, expect } from "vitest";
import { clubFirstRefusal } from "../club-first";
import { readSource } from "../../__tests__/source";

/**
 * A CLUB IS SET UP ONCE; ITS TOURNAMENTS ARE MANY.
 *
 * So naming it comes before the first one. This is the gate, and what it
 * refuses to do matters more than what it refuses.
 */

const facts = (over: Partial<Parameters<typeof clubFirstRefusal>[0]> = {}) => ({
  eventCount: 0,
  named: false,
  kind: "community",
  ...over,
});

describe("naming the club before its first tournament", () => {
  it("asks a brand-new club to name itself", () => {
    const r = clubFirstRefusal(facts());
    expect(r).toContain("name");
    // Names the screen that answers it, in the outfit's own word.
    expect(r).toContain("Society settings");
  });

  it("calls a club a club and a society a society", () => {
    expect(clubFirstRefusal(facts({ kind: "club" }))).toContain("Club settings");
    expect(clubFirstRefusal(facts({ kind: "community" }))).toContain("Society settings");
  });

  it("lets a named club straight through", () => {
    expect(clubFirstRefusal(facts({ named: true }))).toBeNull();
  });
});

describe("who is never asked", () => {
  it("never blocks a club that already runs tournaments", () => {
    /**
     * THE DECISION THAT KEEPS THIS SAFE. One tournament is enough to prove a
     * club is a going concern, and a gate that stopped one mid-season to
     * collect a field it had skipped would be the app interrupting real golf
     * to tidy its own records.
     *
     * `eventCount > 0` needs no dated flag and no migration, and it can never
     * fire twice for anybody: the moment a club has one tournament it is past
     * this for ever.
     */
    expect(clubFirstRefusal(facts({ eventCount: 1, named: false }))).toBeNull();
    expect(clubFirstRefusal(facts({ eventCount: 40, named: false }))).toBeNull();
  });

  it("never blocks somebody running a one-off outing with friends", () => {
    /**
     * "A one-off outing with friends" is a real answer at sign-up and the
     * whole point of the personal kind — there is no club to set up, so there
     * is nothing to require. The standalone escape hatch already existed; it
     * needed wiring rather than inventing.
     */
    expect(clubFirstRefusal(facts({ kind: "personal" }))).toBeNull();
  });

  it("does not ask for members, which it cannot yet reach", () => {
    /**
     * The instinct was to require the roster too. The members screen still
     * reads the ACTIVE EVENT for "who is already in this field", so demanding
     * it before the first tournament would be a deadlock dressed as a
     * checklist: a step that cannot be completed because the thing it needs
     * is the thing it is blocking.
     *
     * Asserted as an absence so that whoever makes `/roster` event-free is
     * told this rule exists and can choose to extend it.
     */
    expect(clubFirstRefusal(facts({ named: true }))).toBeNull();
    expect(clubFirstRefusal(facts())).not.toMatch(/member/i);
  });
});

describe("where it is enforced", () => {
  it("is checked inside the action, not only on the screen", () => {
    // A disabled button stops nobody: a "use server" export is a public HTTP
    // endpoint and will be called with whatever the caller likes.
    const src = readSource("src", "app", "actions", "tournament.ts");
    expect(src).toMatch(/const clubFirst = clubFirstRefusal\(\{/);
    expect(src).toMatch(/if \(clubFirst\) return \{ ok: false, error: clubFirst \}/);
  });

  it("is checked after the organization is resolved, so naming it inline counts", () => {
    /**
     * `organizationForNewEvent` is what CREATES the organization on a first
     * event, and names it from the `orgName` typed on the picker. Checking
     * before that call would refuse somebody for not having done the thing
     * they were doing in the same breath.
     */
    const src = readSource("src", "app", "actions", "tournament.ts");
    const create = src.slice(src.indexOf("export async function createEvent"));
    expect(create.indexOf("organizationForNewEvent")).toBeLessThan(create.indexOf("clubFirstRefusal"));
  });

  it("makes the name a required field rather than sending anybody away", () => {
    const src = readSource("src", "components", "CreateFirstTournament.tsx");
    expect(src).toMatch(/clubNameRequired && !orgName\.trim\(\)/);
    const page = readSource("src", "app", "choose", "page.tsx");
    expect(page).toMatch(/clubNameRequired=\{/);
    expect(page).toMatch(/clubFirstRefusal\(\{/);
  });
});
