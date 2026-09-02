/**
 * What makes a password acceptable, and what to tell someone while they type.
 *
 * Lives here rather than beside the actions because `"use server"` files may
 * only export async functions, so a rule defined in one can never be read by
 * the form that has to obey it — which is how the two drifted. The server
 * refused short passwords with a clear message; the reset form disabled its
 * button and said nothing, and the only statement of the rule was a
 * PLACEHOLDER that vanished the moment anyone typed. Same fault the sign-up
 * form had, fixed there and left standing here.
 *
 * So: one rule, two readers. `passwordProblem` is the gate, on the server where
 * it counts. `passwordHint` is the same rule spoken aloud as someone types, and
 * it is DERIVED from `passwordProblem` rather than restating it — a second copy
 * of the rule is a second thing to forget to update.
 *
 * ## Why there is no "must contain a symbol"
 *
 * Deliberately absent, and it should stay absent. Composition rules do not buy
 * strength: they push people toward predictable substitutions (`Password1!`
 * satisfies every classic rule and is among the first thousand guesses anyone
 * makes), and they cost real usability. NIST SP 800-63B recommends against them
 * and recommends exactly what is here instead — length, plus refusing passwords
 * already known to be common.
 *
 * The rules below therefore refuse passwords that are GUESSABLE, not passwords
 * that are unfashionably formatted. `correcthorsebattery` passes. `Password1!`
 * does not.
 *
 * ## A guard that refuses a good password is worse than no guard
 *
 * The course-card rules in CLAUDE.md were written from exactly this mistake, and
 * the risk here is the same shape: an over-eager check quietly locks someone out
 * of their own account, and they cannot tell you why because the form only says
 * "no". Two specific traps are guarded against below and asserted in the tests:
 *
 * - The blocklist matches WHOLE normalised passwords, never substrings. A
 *   passphrase containing "golf" or "master" is fine; being "golf" is not.
 * - The personal-token check requires the matched parts to make up more than
 *   half the letters. Someone called Anna may use `bananarama` — her name is in
 *   it, but it is not what the password is.
 */

/**
 * Minimum length.
 *
 * Longer beats complex: length is what actually resists guessing. Ten is the
 * floor rather than the goal, and the hint says so.
 */
export const MIN_PASSWORD_LENGTH = 10;

/**
 * What we know about the person, so their password cannot simply be their name.
 *
 * Optional throughout: `resetPassword` knows the account, sign-up knows the
 * name and email being typed, and a caller that knows neither still gets every
 * other rule. Nothing here is required for the gate to be useful.
 */
export interface PasswordContext {
  email?: string | null;
  name?: string | null;
}

/**
 * The passwords that get tried first.
 *
 * Deliberately short. This is not a breach corpus — a real one is tens of
 * millions of entries and belongs behind an API, not in a bundle a browser
 * downloads. It is the handful that a length rule alone lets straight through:
 * every one of these is at least ten characters and would otherwise pass.
 *
 * Matched against the NORMALISED password (see `normalise`), so `P@ssw0rd123`
 * and `password` collapse to the same entry and neither needs its own line.
 */
const COMMON = new Set([
  "password",
  "passwords",
  "passw",
  "letmein",
  "welcome",
  "iloveyou",
  "princess",
  "sunshine",
  "football",
  "baseball",
  "basketball",
  "superman",
  "batman",
  "trustno",
  "whatever",
  "qwerty",
  "qwertyuiop",
  "asdfghjkl",
  "zxcvbnm",
  "monkey",
  "dragon",
  "master",
  "shadow",
  "michael",
  "jennifer",
  "jordan",
  "hunter",
  "harley",
  "ranger",
  "buster",
  "soccer",
  "hockey",
  "killer",
  "george",
  "andrew",
  "charlie",
  "thomas",
  "robert",
  "daniel",
  "starwars",
  "computer",
  "internet",
  "samsung",
  "google",
  // The ones this app will actually see.
  "golf",
  "golfer",
  "golfing",
  "birdie",
  "eagle",
  "bogey",
  "albatross",
  "fairway",
  "putter",
  "caddie",
  "caddy",
  "tourney",
  "tournament",
  "tourneyhq",
  "clubhouse",
  "handicap",
  "scorecard",
]);

/** Keyboard runs, checked whole-string rather than as substrings. */
const ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm", "1234567890"];

/**
 * Lowercase, letters and digits only. NO leet substitution.
 *
 * Kept separate from the blocklist forms below, because leet-mapping destroys
 * the very structure the run checks look for: `1234567890` maps to
 * `i2eas6t89o`, which is neither a digit run nor a keyboard row, so the most
 * obvious bad password in existence would sail through. Structure is checked on
 * the characters actually typed.
 */
function plainOf(password: string): string {
  return password.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** The leet substitutions a cracking tool undoes before it starts guessing. */
function unleet(s: string): string {
  return s
    .replace(/[@]/g, "a")
    .replace(/[$5]/g, "s")
    .replace(/[0]/g, "o")
    .replace(/[1!|]/g, "i")
    .replace(/[3]/g, "e")
    .replace(/[4]/g, "a")
    .replace(/[7]/g, "t");
}

/**
 * The forms of a password worth checking against the blocklist.
 *
 * Four of them, because one is not enough and the ORDER of operations inside
 * each matters. `P@ssw0rd123` needs its trailing digits removed BEFORE leet
 * substitution — map first and the `1` in `123` becomes an `i`, leaving
 * `passwordi23`, which matches nothing. Strip first and it reduces to
 * `password`, which is the point.
 *
 * The untrimmed forms are kept too, so an all-digit password is not trimmed
 * away to the empty string before anything can look at it.
 */
function blocklistForms(password: string): string[] {
  const lower = password.toLowerCase();
  // Trailing digits and punctuation — the "add a 1 to satisfy the rule" tail.
  const trimmed = lower.replace(/[^a-z]+$/, "");
  const out = new Set<string>();
  for (const form of [lower, trimmed]) {
    out.add(form.replace(/[^a-z0-9]/g, ""));
    out.add(unleet(form).replace(/[^a-z0-9]/g, ""));
  }
  out.delete("");
  return [...out];
}

/** Letters only — what the personal-token rule measures against. */
function lettersOf(s: string): string {
  return s.toLowerCase().replace(/[^a-z]/g, "");
}

/** Whether the whole string is one character repeated. */
function allOneCharacter(s: string): boolean {
  return s.length > 0 && [...s].every((c) => c === s[0]);
}

/**
 * Whether the whole string is a single run along the alphabet or the digits.
 *
 * Whole-string only. A passphrase that happens to contain "abc" is not a
 * sequence; `abcdefghij` is.
 */
function isRun(s: string): boolean {
  if (s.length < 3) return false;
  const step = s.charCodeAt(1) - s.charCodeAt(0);
  if (step !== 1 && step !== -1) return false;
  for (let i = 2; i < s.length; i++) {
    if (s.charCodeAt(i) - s.charCodeAt(i - 1) !== step) return false;
  }
  return true;
}

/** Whether the whole string is a stretch of one keyboard row. */
function isKeyboardRun(s: string): boolean {
  if (s.length < 4) return false;
  const back = [...s].reverse().join("");
  return ROWS.some((row) => row.includes(s) || row.includes(back));
}

/**
 * The parts of someone's own identity worth refusing.
 *
 * Four characters minimum, which is the guard on the guard: an address like
 * `a@b.com` has a one-character local part, and refusing every password
 * containing "a" would lock out the entire club.
 */
function personalTokens(ctx?: PasswordContext): string[] {
  const out: string[] = [];
  const add = (raw: string | null | undefined) => {
    for (const part of (raw ?? "").split(/[^A-Za-z]+/)) {
      const token = part.toLowerCase();
      if (token.length >= 4) out.push(token);
    }
  };
  add(ctx?.name);
  add((ctx?.email ?? "").split("@")[0]);
  return [...new Set(out)];
}

/**
 * Whether the password is mostly just who they are.
 *
 * MORE THAN HALF the letters, not "contains" — the difference between refusing
 * `annasmith` from Anna Smith, which is right, and refusing `bananarama` from
 * her too, which would be the guard eating a perfectly good password and is
 * exactly the failure mode CLAUDE.md warns about.
 */
function isMostlyPersonal(password: string, ctx?: PasswordContext): boolean {
  const letters = lettersOf(password);
  if (!letters) return false;
  const tokens = personalTokens(ctx);
  if (tokens.length === 0) return false;

  let matched = 0;
  for (const token of tokens) {
    if (letters.includes(token)) matched += token.length;
  }
  return matched * 2 > letters.length;
}

/**
 * What is wrong with this password, or null if nothing is.
 *
 * The single gate. Every path that sets a password calls this — sign-up,
 * claiming a provisioned account, and reset — so there is one answer to "is
 * this allowed" rather than three that can disagree.
 *
 * Order matters and is deliberate: length first, because it is the rule people
 * hit most and the one they can act on without thinking. Telling someone their
 * password is "too common" when it is also four characters short answers a
 * question they were not asking yet.
 */
export function passwordProblem(password: string, ctx?: PasswordContext): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }

  // Structure, on the characters actually typed — see plainOf.
  const plain = plainOf(password);

  if (allOneCharacter(plain)) {
    return "That is one character repeated — try a few words instead.";
  }
  if (isRun(plain) || isKeyboardRun(plain)) {
    return "That is a straight run across the keyboard — try a few words instead.";
  }
  // Whole-string match only, never a substring: `mastermind` is not `master`,
  // and `golfcartsandwich` is not `golf`.
  if (blocklistForms(password).some((form) => COMMON.has(form))) {
    return "That is one of the first passwords anyone guesses. Try a few unrelated words.";
  }
  if (isMostlyPersonal(password, ctx)) {
    return "That is mostly your own name or email — try something unrelated to your account.";
  }
  return null;
}

/**
 * The same rule, said while someone is still typing.
 *
 * Derived from `passwordProblem` rather than reimplementing it, so a rule added
 * above is spoken here for free and the two can never disagree.
 *
 * Below the minimum it COUNTS DOWN instead of restating the requirement,
 * because "4 more characters" answers what a stuck person is actually asking —
 * the same wording the sign-up form settled on. Above it, the hint carries any
 * remaining problem, so a blocked password explains itself as it is typed
 * rather than after a round trip to the server.
 */
export function passwordHint(password: string, ctx?: PasswordContext): string {
  if (password.length === 0) return `At least ${MIN_PASSWORD_LENGTH} characters`;

  if (password.length < MIN_PASSWORD_LENGTH) {
    const left = MIN_PASSWORD_LENGTH - password.length;
    return `${left} more ${left === 1 ? "character" : "characters"}`;
  }

  return passwordProblem(password, ctx) ?? "Looks good";
}

/** Whether the hint is reporting a fault, so the UI can colour it. */
export function hintIsProblem(password: string, ctx?: PasswordContext): boolean {
  return password.length > 0 && passwordProblem(password, ctx) !== null;
}
