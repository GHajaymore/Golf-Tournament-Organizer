import { describe, it, expect } from "vitest";
import { RATE_LIMITS, throttleMessage, type RateLimitKind } from "@/lib/domain/rate-limit";

/**
 * EVERY THROTTLE SPEAKS ABOUT ITS OWN THING (2026-10-03).
 *
 * `register-token` fell through to the card-photo case, so somebody entering a
 * tournament through a busy public link was told "Too many card readings just
 * now … type the scores in". Enumerated over every kind rather than that one,
 * so a kind added later cannot borrow a stranger's sentence by falling through.
 */
const ABOUT: Record<RateLimitKind, RegExp> = {
  signin: /sign-in/i,
  "claim-password": /attempts/i,
  "password-reset": /reset/i,
  "round-code": /code/i,
  "register-token": /entry form/i,
  "register-email": /registration/i,
  "card-photo": /card reading/i,
  "join-request": /join/i,
  "course-search": /course search/i,
};

describe("throttle messages", () => {
  for (const kind of Object.keys(RATE_LIMITS) as RateLimitKind[]) {
    it(`${kind} says what it is about`, () => {
      expect(throttleMessage(kind, 120)).toMatch(ABOUT[kind]);
    });
  }

  it("no message but the card reader's talks about card readings", () => {
    for (const kind of Object.keys(RATE_LIMITS) as RateLimitKind[]) {
      if (kind === "card-photo") continue;
      expect(throttleMessage(kind, 120), kind).not.toMatch(/card reading/i);
    }
  });
});
