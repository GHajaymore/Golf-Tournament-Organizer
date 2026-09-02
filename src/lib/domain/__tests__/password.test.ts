import { describe, it, expect } from "vitest";
import {
  MIN_PASSWORD_LENGTH,
  passwordProblem,
  passwordHint,
  hintIsProblem,
} from "@/lib/domain/password";

/**
 * The password rule, and — more importantly — what it must NOT refuse.
 *
 * CLAUDE.md's course-card section exists because four plausible-looking guards
 * would each have thrown away a real golf course. A password rule fails the
 * same way and hurts more: someone locked out of their own account cannot see
 * why, cannot appeal, and has no second route in. So the accepting cases below
 * are not padding — they are the half of the specification that catches an
 * over-eager rule, and they are written first on purpose.
 */
describe("passwordProblem", () => {
  describe("accepts passwords that are actually fine", () => {
    it.each([
      ["a passphrase", "correcthorsebattery"],
      ["a passphrase with punctuation", "misty-fjord-samovar"],
      ["a passphrase with spaces", "seven amber lanterns"],
      ["exactly the minimum length", "quixotebay"],
      ["mixed case and digits", "Trebuchet77Marmalade"],
      ["a long one ending in digits", "correcthorsebattery42"],
    ])("accepts %s", (_label, password) => {
      expect(passwordProblem(password)).toBeNull();
    });

    it("accepts a password that merely CONTAINS a blocklisted word", () => {
      /**
       * The blocklist matches whole normalised passwords, never substrings.
       * `master` is on it; `mastermind-galleon` is a perfectly good password
       * and refusing it would be the guard eating something real.
       */
      expect(passwordProblem("mastermind-galleon")).toBeNull();
      expect(passwordProblem("golfcartsandwich")).toBeNull();
      expect(passwordProblem("dragonfly-orchard")).toBeNull();
    });

    it("accepts a password containing a short run, as long as it is not ONE run", () => {
      // "abc" appears; the password is not a sequence.
      expect(passwordProblem("abcarnation-vessel")).toBeNull();
    });

    it("accepts a name fragment that is not what the password is made of", () => {
      /**
       * The trap this rule is guarded against. Anna's name appears inside
       * `bananarama`, and refusing it would lock her out of a password that has
       * nothing to do with her. The rule asks whether the password is MOSTLY
       * her name, not whether her name can be found in it.
       */
      const anna = { name: "Anna Fielding", email: "anna@example.invalid" };
      expect(passwordProblem("bananaramaquest", anna)).toBeNull();
    });

    it("accepts when a one-letter email local part would otherwise match everything", () => {
      // The guard on the guard: tokens under four characters are ignored, or
      // an address like a@b.example would refuse every password containing "a".
      expect(passwordProblem("watermelon-tuesday", { email: "a@b.example" })).toBeNull();
    });
  });

  describe("refuses what gets guessed first", () => {
    it("refuses anything under the minimum", () => {
      expect(passwordProblem("short")).toBe(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
      expect(passwordProblem("a".repeat(MIN_PASSWORD_LENGTH - 1))).toContain("at least");
    });

    it("refuses one character repeated", () => {
      expect(passwordProblem("aaaaaaaaaa")).toContain("one character repeated");
    });

    it.each([
      ["the alphabet", "abcdefghij"],
      ["the alphabet backwards", "jihgfedcba"],
      ["the digits", "1234567890"],
      ["a keyboard row", "qwertyuiop"],
      ["a keyboard row backwards", "poiuytrewq"],
    ])("refuses %s", (_label, password) => {
      expect(passwordProblem(password)).toContain("straight run");
    });

    it("refuses the digit run, which leet-mapping would have hidden", () => {
      /**
       * Regression on a bug in the first draft of this module. Structure was
       * checked on the leet-normalised form, where 1234567890 becomes
       * i2eas6t89o — not a run, not a keyboard row, and therefore accepted.
       * The most obvious bad password in existence passed.
       */
      expect(passwordProblem("1234567890")).not.toBeNull();
    });

    it.each([
      ["the word itself", "password12"],
      ["with a digit tail", "password123"],
      ["leet-substituted", "P@ssw0rd123"],
      ["the classic that satisfies every composition rule", "Password1!"],
      ["a golf one", "birdie1234"],
      ["the product name", "tourneyhq1"],
    ])("refuses %s", (_label, password) => {
      expect(passwordProblem(password)).toContain("first passwords anyone guesses");
    });

    it("refuses a password that is mostly the person's own name", () => {
      const anna = { name: "Anna Smith", email: "anna.smith@example.invalid" };
      expect(passwordProblem("annasmith1", anna)).toContain("your own name");
      expect(passwordProblem("smithanna99", anna)).toContain("your own name");
    });

    it("refuses a password that is mostly the email local part", () => {
      expect(passwordProblem("fieldington", { email: "fieldington@example.invalid" })).toContain(
        "your own name",
      );
    });
  });

  describe("says the most useful thing first", () => {
    it("reports length before anything else", () => {
      // "password" is both too short and blocklisted. Being told it is common
      // answers a question they were not yet asking.
      expect(passwordProblem("password")).toContain("at least");
    });
  });

  it("applies with no context at all", () => {
    // Reset used to be unable to pass context; every other rule must still work
    // for a caller that knows nothing about the person.
    expect(passwordProblem("password123")).not.toBeNull();
    expect(passwordProblem("correcthorsebattery")).toBeNull();
  });
});

/**
 * The hint is the same rule spoken aloud, and it must not be able to disagree
 * with the gate — a form that says "Looks good" over a password the server then
 * refuses is worse than one that says nothing.
 */
describe("passwordHint", () => {
  it("states the requirement before anything is typed", () => {
    expect(passwordHint("")).toBe(`At least ${MIN_PASSWORD_LENGTH} characters`);
  });

  it("counts down rather than restating the rule", () => {
    // "4 more characters" answers what a stuck person is actually asking.
    expect(passwordHint("abcdef")).toBe("4 more characters");
    expect(passwordHint("abcdefghi")).toBe("1 more character");
  });

  it("carries the problem once the password is long enough to have one", () => {
    expect(passwordHint("password123")).toContain("first passwords anyone guesses");
  });

  it("confirms a password that would be accepted", () => {
    expect(passwordHint("correcthorsebattery")).toBe("Looks good");
  });

  it("never says Looks good over a password the gate would refuse", () => {
    /**
     * The invariant that matters. Both are derived from passwordProblem, so
     * this cannot drift — but it is asserted rather than assumed, because the
     * whole reason this module exists is that a form and a server action had
     * two copies of one rule and disagreed.
     */
    const samples = [
      "short",
      "aaaaaaaaaa",
      "1234567890",
      "password123",
      "P@ssw0rd123",
      "correcthorsebattery",
      "misty-fjord-samovar",
      "quixotebay",
    ];
    for (const s of samples) {
      const refused = passwordProblem(s) !== null;
      expect(passwordHint(s) === "Looks good").toBe(!refused);
      expect(hintIsProblem(s)).toBe(refused);
    }
  });

  it("reports no problem for an empty field", () => {
    // Nothing typed is not a fault, and colouring it red would be nagging.
    expect(hintIsProblem("")).toBe(false);
  });
});
