/**
 * How many attempts an identifier gets, and what the person who runs out is told.
 *
 * Three endpoints in this app are reachable with no session at all, and each
 * one of them checks a secret that a computer can simply try over and over:
 *
 *   - a Round Code, which is 8 characters from a 27-symbol alphabet
 *   - a password
 *   - an email address, for "send me a reset link"
 *
 * 27^8 is about 282 billion, which sounds like plenty until you notice that
 * only a handful of those codes are live at any moment and that nothing was
 * stopping an attacker from trying a thousand a second. A redeemed code hands
 * over the whole field's names and scores, so the code's length is not the
 * control here — the limit on attempts is. That is the entire security story
 * for /play, which is why this module exists.
 *
 * Everything below is arithmetic and wording, with no storage and no clock of
 * its own: `now` is passed in. The counting itself lives in src/lib/rate-limit.ts,
 * which keeps the counters in Postgres. That split is deliberate — the rules
 * are the part worth testing, and they are untestable if they are welded to a
 * database.
 *
 * WHAT IS KEYED ON, AND WHY IT IS NOT THE IP ADDRESS
 * --------------------------------------------------
 * Every limit here is keyed on the secret being guessed — the round code, or
 * the email address — never on the caller's IP. An IP is the wrong key twice
 * over:
 *
 *   - It is trivially spoofable at the edge. `x-forwarded-for` is a header an
 *     attacker writes, so a per-IP budget is a budget an attacker resets by
 *     changing a string.
 *   - It is shared. A golf club's wifi puts an entire field behind one NAT
 *     address, so a per-IP limit would lock out a fourball because the group
 *     ahead of them fumbled the code on the first tee.
 *
 * Keying on the code means guesses against a given code are capped however
 * they arrive and from wherever. Keying on the email means one account's login
 * budget is one account's, and a stranger hammering somebody else's address
 * cannot spend yours. The cost of that choice, stated plainly: a distributed
 * attacker trying one guess against each of a million *different* codes is not
 * slowed down by this at all. That is a different attack from the one that
 * actually threatens a round code, and it wants a different control.
 */

/** The throttled entry points. One budget per kind, per identifier. */
export type RateLimitKind = "signin" | "claim-password" | "password-reset" | "round-code";

export interface RateLimitPolicy {
  /** Attempts allowed inside one window. The (limit + 1)th is refused. */
  readonly limit: number;
  readonly windowMs: number;
}

const MINUTE = 60_000;

export const RATE_LIMITS: Record<RateLimitKind, RateLimitPolicy> = {
  /** Password guessing. Five is well above what a person who knows their own
   *  password ever needs, and far below what guessing one requires. */
  signin: { limit: 5, windowMs: 15 * MINUTE },
  /** Setting a first password on a pre-provisioned email. Same shape of risk
   *  as signin — it is reachable without a session and it names an account. */
  "claim-password": { limit: 5, windowMs: 15 * MINUTE },
  /** Reset requests send mail. Unlimited, they are a way to have this app
   *  bomb somebody's inbox and burn the sending domain's reputation, so the
   *  window is longer even though the limit is the same. */
  "password-reset": { limit: 5, windowMs: 60 * MINUTE },
  /** Round codes are typed off a printed card by people standing on a tee in
   *  the rain, so the allowance is deliberately roomier than a password's —
   *  ten wrong entries is a group that needs to ask, not an attack. It still
   *  turns "a thousand guesses a second" into "forty an hour". */
  "round-code": { limit: 10, windowMs: 15 * MINUTE },
};

/**
 * The counting period an instant falls in.
 *
 * Fixed windows aligned to the epoch, not a window that starts at the first
 * attempt. The reason is storage, not taste: a bucket derived from the clock
 * can be computed identically by any number of serverless instances without
 * their having to agree on anything first, so the database write is a bare
 * "add one to this row" with no read, no transaction and no lock. A window
 * anchored to the first attempt needs read-then-write, and two instances doing
 * that at once both read zero.
 *
 * The known cost of a fixed window: attempts straddling a boundary can reach
 * 2 × limit inside one window-length — the tail of one bucket plus the head of
 * the next. That is a constant factor on a small number, not an open door, and
 * it is the same property the in-memory limiter this replaced had.
 */
export interface CountingWindow {
  /** Window index since the epoch. Part of the storage key. */
  bucket: number;
  startsAt: number;
  endsAt: number;
}

export function windowFor(policy: RateLimitPolicy, now: number): CountingWindow {
  const bucket = Math.floor(now / policy.windowMs);
  return {
    bucket,
    startsAt: bucket * policy.windowMs,
    endsAt: (bucket + 1) * policy.windowMs,
  };
}

/**
 * The storage key for one identifier's current window.
 *
 * Takes an already-hashed identifier, and this module never sees the raw one.
 * The counter table would otherwise be a log of every email address that tried
 * to sign in and every round code anybody guessed — a readable list of live
 * secrets sitting next to the data they unlock. Hashing costs nothing here
 * because the key only ever has to match itself.
 *
 * `kind` is in the key so the four budgets stay separate: being locked out of
 * password reset must not lock you out of signing in with the password you
 * already know.
 */
export function bucketKeyFor(kind: RateLimitKind, hashedIdentifier: string, now: number): string {
  const { bucket } = windowFor(RATE_LIMITS[kind], now);
  return `${kind}:${hashedIdentifier}:${bucket}`;
}

export interface RateLimitDecision {
  allowed: boolean;
  /** Whole seconds until the window turns over. 0 when allowed. */
  retryAfterSeconds: number;
  /** What to show the caller. Empty when allowed. Never mentions whether the
   *  account or code exists — see `throttleMessage`. */
  message: string;
}

const ALLOWED: RateLimitDecision = { allowed: true, retryAfterSeconds: 0, message: "" };

/**
 * Allow or refuse, given how many attempts this identifier has now made.
 *
 * `attempts` counts the attempt being decided, so the limit is reached at
 * `attempts === limit` and the next one is refused. Counting the current
 * attempt is what makes this safe under a race: the store increments first and
 * asks afterwards, so two instances that both write get two different numbers
 * back and at most one of them is under the line.
 */
export function decideRateLimit(kind: RateLimitKind, attempts: number, now: number): RateLimitDecision {
  const policy = RATE_LIMITS[kind];
  if (attempts <= policy.limit) return ALLOWED;
  const { endsAt } = windowFor(policy, now);
  // At least a second, so the message never reads "try again in 0 seconds".
  const retryAfterSeconds = Math.max(1, Math.ceil((endsAt - now) / 1000));
  return { allowed: false, retryAfterSeconds, message: throttleMessage(kind, retryAfterSeconds) };
}

/**
 * What to do when the counter store itself cannot be reached.
 *
 * Refuse. An endpoint whose only protection is a limit that just failed is an
 * endpoint with no protection, and the alternative — waving attempts through
 * whenever the database hiccups — is a hole an attacker can cause on purpose.
 *
 * This costs nothing in availability: all three callers query the same
 * database on their very next line, so a store that cannot be reached is a
 * request that was going to fail anyway. What it must not do is fail silently,
 * hence a real message and a short, honest retry time rather than a generic
 * error.
 */
export function unavailableDecision(): RateLimitDecision {
  return {
    allowed: false,
    retryAfterSeconds: 30,
    message: "We couldn't check that just now. Wait 30 seconds and try again.",
  };
}

/**
 * "5 minutes", "30 seconds" — the bit of the message a person acts on.
 *
 * Rounds up, always. Telling somebody to wait 4 minutes when the window has
 * 4 minutes 50 seconds left earns a second refusal and a worse impression than
 * the honest number would have.
 */
export function retryAfterText(seconds: number): string {
  if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"}`;
  const mins = Math.ceil(seconds / 60);
  if (mins < 120) return `${mins} minute${mins === 1 ? "" : "s"}`;
  const hours = Math.ceil(mins / 60);
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

/**
 * The refusal, in words.
 *
 * Two rules hold for every one of these. It says how long to wait, because a
 * lockout with no end time is indistinguishable from the app being broken and
 * the person on the first tee has no way to tell which it is. And it says
 * nothing about whether the account or the code exists — the limit is applied
 * before anything is looked up and the wording is identical either way, so
 * running into it teaches an attacker only that they have been counting.
 */
export function throttleMessage(kind: RateLimitKind, retryAfterSeconds: number): string {
  const wait = retryAfterText(retryAfterSeconds);
  switch (kind) {
    case "signin":
      return `Too many sign-in attempts. Try again in ${wait}.`;
    case "claim-password":
      return `Too many attempts. Try again in ${wait}.`;
    case "password-reset":
      return `Too many reset requests. Try again in ${wait}.`;
    case "round-code":
      return `Too many code attempts. Wait ${wait} and try again, or ask your organizer to read the code out.`;
  }
}
