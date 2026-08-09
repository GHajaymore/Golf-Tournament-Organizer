import { describe, it, expect } from "vitest";
import {
  RATE_LIMITS,
  bucketKeyFor,
  decideRateLimit,
  retryAfterText,
  throttleMessage,
  unavailableDecision,
  windowFor,
  type RateLimitKind,
} from "../domain/rate-limit";

/**
 * The attempt limits on the endpoints anybody on the internet can reach.
 *
 * What these protect: a Round Code redeemed successfully returns a whole
 * field's names, and from there their scores. The code is short enough to be
 * read out on a first tee, so nothing about its length stops a machine trying
 * codes all afternoon — the cap on attempts is the only thing that does. The
 * same is true of a password, and of "email me a reset link", which spends the
 * app's sending reputation on somebody else's inbox.
 *
 * Two properties run through every test below and neither is optional: a
 * person who is refused is told how long to wait, and being refused reveals
 * nothing about whether what they typed exists.
 */

const KINDS: RateLimitKind[] = ["signin", "claim-password", "password-reset", "round-code"];

/** Well inside a window, so "the window turns over" is never accidentally true. */
const MID_WINDOW = (kind: RateLimitKind) => {
  const { windowMs } = RATE_LIMITS[kind];
  return windowMs * 1000 + windowMs / 2;
};

describe("counting attempts against a limit", () => {
  it("allows exactly the stated number of attempts and refuses the next", () => {
    // The off-by-one that matters in both directions: refusing at the limit
    // costs a legitimate person their last try, and allowing one past it is a
    // free guess on every window forever.
    for (const kind of KINDS) {
      const { limit } = RATE_LIMITS[kind];
      const now = MID_WINDOW(kind);
      expect(decideRateLimit(kind, limit, now).allowed, `${kind} at the limit`).toBe(true);
      expect(decideRateLimit(kind, limit + 1, now).allowed, `${kind} past the limit`).toBe(false);
    }
  });

  it("keeps refusing however far past the limit an attacker goes", () => {
    // A limiter that only refuses the one attempt that crossed the line would
    // be no limiter at all.
    const now = MID_WINDOW("round-code");
    expect(decideRateLimit("round-code", 5_000, now).allowed).toBe(false);
  });

  it("gives a round code a roomier allowance than a password", () => {
    // Codes are typed off a printed card by people standing on a tee in the
    // rain. Ten wrong entries is a group that needs help, not an attack; five
    // wrong passwords is somebody who does not know the password.
    expect(RATE_LIMITS["round-code"].limit).toBeGreaterThan(RATE_LIMITS.signin.limit);
  });

  it("still caps a round code far below what guessing one needs", () => {
    // The point of the number, stated as a rate: the code alphabet is 27
    // symbols over 8 characters, and this turns "a thousand guesses a second"
    // into fewer than a hundred an hour.
    const { limit, windowMs } = RATE_LIMITS["round-code"];
    expect((limit * 3_600_000) / windowMs).toBeLessThan(100);
  });
});

describe("what a refused person is told", () => {
  it("always says how long to wait", () => {
    // A lockout with no end time is indistinguishable from the app being
    // broken, and the person it happens to is usually on a first tee with a
    // group waiting behind them.
    for (const kind of KINDS) {
      const d = decideRateLimit(kind, RATE_LIMITS[kind].limit + 1, MID_WINDOW(kind));
      expect(d.message, kind).toMatch(/\d+ (second|minute|hour)/);
      expect(d.retryAfterSeconds, kind).toBeGreaterThan(0);
    }
  });

  it("never says whether the account or the code exists", () => {
    // The limit is applied before anything is looked up, so the wording has
    // to be identical for a real address and a made-up one. Any hint here
    // turns the throttle itself into the enumeration oracle the rest of the
    // auth code carefully avoids being.
    for (const kind of KINDS) {
      const d = decideRateLimit(kind, RATE_LIMITS[kind].limit + 1, MID_WINDOW(kind));
      expect(d.message, kind).not.toMatch(/exist|found|unknown|no account|not registered|invalid/i);
    }
  });

  it("says nothing at all while attempts are still allowed", () => {
    // An allowed attempt must not leak its own remaining budget: "2 tries
    // left" tells an attacker how far into a window they are.
    const d = decideRateLimit("signin", 1, MID_WINDOW("signin"));
    expect(d.message).toBe("");
    expect(d.retryAfterSeconds).toBe(0);
  });

  it("points a locked-out group at the organizer rather than at a wall", () => {
    // A fourball that has burnt the code's allowance has a person standing
    // fifty yards away who can read it out. Waiting fifteen minutes is the
    // wrong answer and they should not have to work that out themselves.
    expect(throttleMessage("round-code", 600)).toMatch(/organizer/);
  });

  it("never counts down to zero", () => {
    // "Try again in 0 seconds" is a message that reads as a bug.
    const { windowMs } = RATE_LIMITS.signin;
    const lastMillisecond = windowMs * 1000 - 1;
    const d = decideRateLimit("signin", 99, lastMillisecond);
    expect(d.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });
});

describe("phrasing the wait", () => {
  it("uses seconds under a minute and minutes above", () => {
    expect(retryAfterText(1)).toBe("1 second");
    expect(retryAfterText(30)).toBe("30 seconds");
    expect(retryAfterText(60)).toBe("1 minute");
    expect(retryAfterText(600)).toBe("10 minutes");
  });

  it("switches to hours before the number gets silly", () => {
    // The reset window is an hour, so a stacked wait can run past the point
    // where "150 minutes" is a number anybody parses.
    expect(retryAfterText(7200)).toBe("2 hours");
  });

  it("always rounds up", () => {
    // Rounding down earns a second refusal from somebody who did exactly what
    // they were told, which reads as the app lying to them.
    expect(retryAfterText(61)).toBe("2 minutes");
    expect(retryAfterText(3601)).toBe("61 minutes");
  });
});

describe("the counting window", () => {
  it("derives the same window from the clock alone", () => {
    // This is why the window is aligned to the epoch rather than started at
    // the first attempt: several serverless instances have to agree on which
    // bucket "now" belongs to without talking to each other first, which is
    // what lets the counter be a single atomic increment with no read to race
    // against.
    const policy = RATE_LIMITS.signin;
    // Aligned to a window boundary, so "still the same bucket" is a real
    // claim about the whole window rather than about where the clock happened
    // to be.
    const start = Math.floor(1_700_000_000_000 / policy.windowMs) * policy.windowMs;
    const a = windowFor(policy, start);
    const b = windowFor(policy, start + policy.windowMs - 1);
    expect(b.bucket).toBe(a.bucket);
    expect(windowFor(policy, a.endsAt).bucket).toBe(a.bucket + 1);
  });

  it("expires the count by moving to a new bucket, not by anyone tidying up", () => {
    // A key nobody touches again is simply never read again. Nothing has to
    // run on a schedule for a lockout to end, so a stuck cron job can't leave
    // a member locked out of their own tournament.
    const hash = "deadbeef";
    const first = bucketKeyFor("signin", hash, 0);
    const later = bucketKeyFor("signin", hash, RATE_LIMITS.signin.windowMs);
    expect(later).not.toBe(first);
  });

  it("keeps the four budgets separate", () => {
    // Running out of password-reset requests must not lock somebody out of
    // signing in with the password they already know.
    const hash = "deadbeef";
    const keys = new Set(KINDS.map((k) => bucketKeyFor(k, hash, 1_700_000_000_000)));
    expect(keys.size).toBe(KINDS.length);
  });

  it("keeps one identifier's budget away from another's", () => {
    // Otherwise anybody could lock any member out of their own account by
    // typing their email address wrong five times on purpose.
    expect(bucketKeyFor("signin", "aaaa", 0)).not.toBe(bucketKeyFor("signin", "bbbb", 0));
  });

  it("stores only the hashed identifier", () => {
    // The counter table would otherwise be a plaintext list of live round
    // codes and of every address that tried to sign in today, sitting next to
    // the tournament data those unlock.
    const key = bucketKeyFor("round-code", "hashed-not-raw", 0);
    expect(key).not.toMatch(/@/);
    expect(key).toContain("hashed-not-raw");
  });
});

describe("when the counter store itself is unreachable", () => {
  it("refuses rather than waving the attempt through", () => {
    // Fail closed. An endpoint whose only protection is a limit that just
    // failed has no protection, and "make the database hiccup" is something an
    // attacker can attempt on purpose. It costs no uptime: every caller
    // queries the same database on its next line anyway.
    expect(unavailableDecision().allowed).toBe(false);
  });

  it("still explains itself and gives a short, honest wait", () => {
    // The one thing a fail-closed limiter must not do is fail silently — a
    // blank refusal is indistinguishable from the app being broken, which in
    // this case it partly is.
    const d = unavailableDecision();
    expect(d.message).not.toBe("");
    expect(d.retryAfterSeconds).toBeGreaterThan(0);
    expect(d.retryAfterSeconds).toBeLessThanOrEqual(60);
  });
});
