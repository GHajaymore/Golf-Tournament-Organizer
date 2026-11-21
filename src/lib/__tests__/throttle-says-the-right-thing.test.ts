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
  "signin-client": /sign-ins/i,
  "claim-password": /attempts/i,
  "password-reset": /reset/i,
  "email-code-send": /sent three codes/i,
  "entry-code-send": /several codes/i,
  "code-send-client": /several codes/i,
  // One code box (2026-11-17): every code budget says one sentence, naming no kind.
  "round-code": /code attempts/i,
  "round-code-client": /code attempts/i,
  "player-link-client": /code attempts/i,
  "player-link-alarm": /code attempts/i,
  "player-link-slow": /code attempts/i,
  "eight-char-alarm": /code attempts/i,
  "eight-char-slow": /code attempts/i,
  "link-slips": /printed slips/i,
  // J39 PR 3B: the guest branch's ONE limit sentence, which names no kind and ends in a way on.
  "guest-entry-device": /see the organizer at the desk/i,
  "guest-entry-cookieless": /see the organizer at the desk/i,
  "discount-check": /discount code/i,
  "register-token": /entry form/i,
  "register-email": /registration/i,
  "card-photo": /card reading/i,
  "join-request": /join/i,
  interest: /your note/i,
  "course-search": /course search/i,
  "course-search-staff": /course search/i,
  "ai-check": /AI check/i,
  "guest-post": /too many messages/i,
  "push-device": /alert changes/i,
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
