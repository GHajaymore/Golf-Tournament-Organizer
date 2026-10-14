import { describe, it, expect } from "vitest";
import { TEE_POLICY, playerTeeCounts } from "../tournament-settings";
import { teeIdFor } from "../domain/handicap";
import { readSource } from "./source";

/**
 * A PLAYER'S OWN TEES ARE OFFERED ONLY WHERE THEY COUNT (sweep 1, b5,
 * 2026-10-10).
 *
 * Under "Each flight plays its own tees" the Registration screen still drew a
 * Tees dropdown beside every player. It saved — the action accepted it and
 * stored it — and scoring then ignored it, because by division "the flight
 * may [differ] and a player may not" (`teeIdFor`). An organizer who moved one
 * senior to the forward tees saw the choice kept on the screen and that
 * player's strokes unchanged on the card.
 *
 * The screen asked `policy !== "one"`. The scorer asks something narrower,
 * and the two are pinned to each other here on every policy there is, so a
 * fifth policy cannot be offered a control the scorer will not read.
 */
describe("a player's own set", () => {
  const everywhere = () => true;

  for (const policy of TEE_POLICY) {
    it(`under "${policy}": the control is offered exactly when scoring would read it`, () => {
      const read = teeIdFor(policy, "players", "flights", "rounds", everywhere, null) === "players";
      expect(playerTeeCounts(policy)).toBe(read);
    });
  }

  it("CONTROL: the policies do not all answer alike", () => {
    const answers = new Set(TEE_POLICY.map((p) => playerTeeCounts(p)));
    expect(answers.size).toBe(2);
  });

  it("the Registration screen draws the dropdown by that rule", () => {
    const src = readSource("src/components/RegistrationClient.tsx");
    expect(src).toContain("playerTeeCounts(");
    expect(src, "still shows a per-player set under every policy but one").not.toContain('teePolicy !== "one"');
  });

  it("and the action refuses to store a set the scorer will not read", () => {
    const src = readSource("src/app/actions/courses.ts");
    const body = src.slice(src.indexOf("export async function setPlayerTee"), src.indexOf("export async function verifyCourseCard"));
    expect(body).toContain("playerTeeCounts(");
  });
});

/**
 * AND A FLIGHT'S TEES ARE SHOWN WHEREVER THEY COUNT (sweep 1, c1).
 *
 * The other direction of the same disagreement. Flights & groups drew the
 * per-flight Tees control only under "each flight plays its own tees", on the
 * stated ground that "under any other policy nothing reads a flight's claim".
 * The scorer does: when players are assigned individually, anyone left
 * unassigned "plays their flight's, or the round's" — which is also what the
 * Tees help says. So a set put on a flight, followed by a change of policy,
 * went on pricing every unassigned player in it with no control anywhere to
 * see it or take it off.
 */
describe("a flight's set", () => {
  const everywhere = () => true;

  for (const policy of TEE_POLICY) {
    it(`under "${policy}": the control is shown exactly when scoring would read it`, async () => {
      const { flightTeeCounts } = await import("../tournament-settings");
      // A player with no set of their own, in a flight that claims one.
      const read = teeIdFor(policy, null, "flights", "rounds", everywhere, null) === "flights";
      expect(flightTeeCounts(policy)).toBe(read);
    });
  }

  it("Flights & groups draws the control by that rule", () => {
    const src = readSource("src/app/(app)/grouping/page.tsx");
    expect(src).toContain("flightTeeCounts(");
    expect(src).not.toContain('teePolicy === "flight"');
  });
});

/**
 * AND WHERE THEY ARE OFFERED, THEY ARE SHOWN (2026-10-11).
 *
 * The Registration screen draws ONE table three times — the field, the waiting
 * list, the entries waiting for approval — and the table has a Tees dropdown
 * on every row. Only the field's rows were handed their tee. So on a
 * waiting-list row the dropdown saved (the action stores it, properly: the
 * player may be promoted tomorrow) and then showed the round's set again, on
 * a row whose tee had just been changed.
 *
 * Found by the control crawl once tee saves stopped being refused: nine
 * choices on the scramble's waiting list, each "lost".
 *
 * The three lists are built by ONE mapper, so a field one of them is given is
 * a field all of them are given.
 */
describe("the Registration table's three lists", () => {
  const page = readSource("src/app/(app)/registration/page.tsx");

  it("are each built by the same mapper", () => {
    for (const list of ["confirmed", "waitlist", "pendingEntries"]) {
      const at = page.indexOf(`${list}={`);
      expect(at, `the page no longer hands the table a ${list} list`).toBeGreaterThan(-1);
      // The one line that hands it over.
      const handed = page.slice(at, page.indexOf("\n", at));
      expect(handed, `${list} is built by hand, apart from the others`).toContain(".map(asRow)}");
    }
  });

  it("and that mapper carries the tee", () => {
    const at = page.indexOf("const asRow");
    expect(at, "there is no one mapper for the table's rows").toBeGreaterThan(-1);
    const mapper = page.slice(at, page.indexOf("});", at));
    expect(mapper).toContain("teeId: p.teeId");
    // And what the field's rows have always had, so merging lost nothing.
    for (const field of ["id: p.id", "name: p.name", "handicap: p.handicap", "email: p.email", "phone: p.phone", "promotedAt"]) {
      expect(mapper, field).toContain(field);
    }
  });
});
