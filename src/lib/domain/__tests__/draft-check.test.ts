import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkDraft, draftPrompt } from "../draft-check";

/**
 * Catching the one kind of invention that can be caught.
 *
 * No program can read prose and decide whether it is true, and this does not
 * pretend to. What it does is find a name in a draft that belongs to nobody in
 * the tournament — the most likely invention and the most damaging, because a
 * recap congratulating a player who was never in the field ends a club's trust
 * in every other number the app produces.
 *
 * The second job of these tests is to keep it QUIET. A check that cries wolf
 * gets switched off, and then the one genuinely invented player sails through.
 */

const field = ["Aj More", "Marcus Webb", "Priya Nair", "Sang-woo Kim", "Renée Dubois"];

describe("catching an invented player", () => {
  it("flags a name nobody in the field has", () => {
    const d = checkDraft("A fine round from Aj More, chased hard by Tom Fletcher.", field);
    expect(d.unknownNames).toContain("Fletcher");
    expect(d.clean).toBe(false);
  });

  it("passes a draft that only names real players", () => {
    const d = checkDraft("Aj More led from the front, with Priya Nair second.", field);
    expect(d.unknownNames).toEqual([]);
    expect(d.clean).toBe(true);
  });
});

describe("staying quiet where it should", () => {
  it("accepts a surname on its own", () => {
    // A roster holds "Marcus Webb" and a sentence says "Webb". Same person.
    expect(checkDraft("Webb closed with a birdie.", field).clean).toBe(true);
  });

  it("accepts a first name on its own", () => {
    expect(checkDraft("Priya was four under through nine.", field).clean).toBe(true);
  });

  it("accepts a hyphenated or accented name however it is written", () => {
    expect(checkDraft("Sang-woo held on. Renee took the skins.", field).clean).toBe(true);
  });

  it("does not flag ordinary sentence openers", () => {
    const d = checkDraft("The cut fell at two over. After that, nobody moved.", field);
    expect(d.clean).toBe(true);
  });

  it("does not flag golf vocabulary or days and months", () => {
    const d = checkDraft(
      "Round 2 of the Club Championship. Wednesday's Stableford. Birdies on the Front nine. Skins carried.",
      field,
    );
    expect(d.clean).toBe(true);
  });

  it("reports each unknown name once, however often it appears", () => {
    const d = checkDraft("Fletcher birdied. Fletcher then bogeyed. Fletcher won.", field);
    expect(d.unknownNames.filter((n) => n === "Fletcher")).toHaveLength(1);
  });
});

describe("degenerate input", () => {
  it("copes with an empty draft and an empty field", () => {
    expect(checkDraft("", field).clean).toBe(true);
    expect(checkDraft("Aj More won.", []).clean).toBe(false);
    expect(() => checkDraft("", [])).not.toThrow();
  });

  it("ignores punctuation stuck to a name", () => {
    expect(checkDraft("The winner: Aj More, at last.", field).clean).toBe(true);
  });
});

/**
 * The promise that the drafting feature cannot send anything is the whole
 * reason it is safe to let a model write to a club's membership. A comment
 * saying so protects nobody — someone wires a "Draft and send" button in six
 * months because it is obviously convenient, and every guarantee made to the
 * user quietly stops being true.
 *
 * So it is checked. If the action ever gains a path to the mailer, this fails
 * and whoever did it has to argue with a test rather than a comment.
 */
describe("drafting cannot send", () => {
  const actionSrc = readFileSync(
    join(process.cwd(), "src/app/actions/draft-message.ts"),
    "utf8",
  );

  it("never imports the mailer", () => {
    expect(actionSrc).not.toMatch(/from\s+["']@\/lib\/email["']/);
    expect(actionSrc).not.toMatch(/\bsendRegistrationEmail\b|\bsendPasswordResetEmail\b/);
  });

  it("exports nothing that sounds like sending", () => {
    const exported = [...actionSrc.matchAll(/export\s+async\s+function\s+(\w+)/g)].map((m) => m[1]);
    expect(exported).toEqual(["draftMessage"]);
  });

  it("writes nothing to the database", () => {
    // Reading the event is the point; a create/update/delete here would mean
    // the model's output reached storage without a person in between.
    expect(actionSrc).not.toMatch(/prisma\.\w+\.(create|update|delete|upsert)/);
  });
});

describe("the instruction to the model", () => {
  it("hands over the real facts and says they are the only ones", () => {
    const p = draftPrompt("a results email", "Spring Medal", "1. Aj More 68", "");
    expect(p).toContain("Spring Medal");
    expect(p).toContain("Aj More 68");
    expect(p).toContain("ONLY facts");
  });

  it("forbids inventing a player or a score outright", () => {
    const p = draftPrompt("a recap", "X", "", "");
    expect(p).toContain("Never mention a player who is not listed");
    expect(p).toContain("Never invent a score");
  });

  it("tells it to be short rather than dramatic when the results are thin", () => {
    // The failure this prevents: "a thrilling back nine" about a round where
    // nobody broke 80.
    const p = draftPrompt("a recap", "X", "", "");
    expect(p).toContain("write something short");
    expect(p.toLowerCase()).toContain("no hype");
  });
});
