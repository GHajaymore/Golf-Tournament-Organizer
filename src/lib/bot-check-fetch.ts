/**
 * THE BOT CHECK MAY NOT HOLD THE FRONT DOOR SHUT (2026-10-13).
 *
 * Creating an account is checked by Vercel BotID (`services/bot-check.ts`), and
 * the browser half of that works by taking over `fetch`: every request to a
 * protected address WAITS for a script from the bot-check service, and is sent
 * only once that script has answered. The protected address is `POST /`, and
 * every server action on the landing page posts there — so signing in, asking
 * for a reset link and setting a first password all waited on it too, though
 * none of them is checked.
 *
 * Measured the night it was found, in a browser:
 *
 *   the script BLOCKED (a content blocker)   pressing Log in or Send reset link
 *                                            replaced the whole front door with
 *                                            "Something went wrong — This screen
 *                                            didn't load". Nobody could sign in.
 *   the script NEVER ANSWERED                the button said "Sending…" for ever,
 *                                            and nothing was ever sent.
 *
 * Found by a full round on GitHub: one press of "Send reset link" in several
 * hundred sat on "Sending…" past the test's patience, and the recording showed
 * the request for the script unanswered and the reset request never made.
 *
 * The server half already says what the rule is — "a check that fails lets the
 * person in" — and the browser half did the opposite. So:
 *
 *   - ONLY A REQUEST THAT ASKED FOR THE CHECK WAITS FOR IT. The sign-up form
 *     asks (`askForBotCheck`), just before it sends. Everything else goes
 *     straight out and never touches the bot-check service at all.
 *   - A SIGN-UP WAITS A BOUNDED TIME. If the check errors before the request
 *     has gone, or has not answered in `BOT_CHECK_WAIT_MS`, the request is sent
 *     without it and the SERVER decides — which on Vercel is a refusal in
 *     words, and everywhere else is a sign-up.
 *   - AND IT IS NEVER SENT TWICE. Giving up cancels the waiting copy before the
 *     plain one goes, and a request that has already gone is never given up on,
 *     however slow its answer.
 *
 * Nothing here knows about BotID: it is handed two ways of sending and told
 * which to trust with what, so it can be tested with neither a browser nor a
 * network (`bot-check-fetch.test.ts`).
 */

type Send = typeof fetch;

/** How long a sign-up waits for the bot check before it is sent without it. */
export const BOT_CHECK_WAIT_MS = 8_000;

/** How long an ask stands. A form asks and sends in the same breath; this only stops a stale ask lingering. */
const ASK_STANDS_MS = 15_000;

/**
 * Kept on the page itself, not in this module: the form that asks and the code
 * that took `fetch` over are bundled by different roads, and two copies of a
 * module variable would be an ask nobody hears — a sign-up that is quietly
 * never checked, which no screen would show.
 */
const ASK = "__thqBotCheckAskedUntil";
type Asking = { [ASK]?: number };

/** The next request to a protected address is one the bot check is FOR. Called by the sign-up form. */
export function askForBotCheck(now: number): void {
  (globalThis as Asking)[ASK] = now + ASK_STANDS_MS;
}

function takeAsk(now: number): boolean {
  const page = globalThis as Asking;
  const asked = now < (page[ASK] ?? 0);
  page[ASK] = 0;
  return asked;
}

export interface GuardedFetch {
  /**
   * The way out that says when it is used. Installed as `window.fetch` BEFORE
   * the bot check takes `fetch` over, so that this is what the bot check sends
   * through — which is how a waiting request is known to have gone.
   */
  send: Send;
  /** What `window.fetch` becomes afterwards, given the bot check's own `fetch`. */
  guard: (checked: () => Send) => Send;
}

export function makeGuardedFetch(options: {
  /** The browser's own `fetch`. */
  plain: Send;
  /** Whether a request goes to an address the bot check is set on. */
  isProtected: (input: Parameters<Send>[0], init: Parameters<Send>[1]) => boolean;
  waitMs?: number;
  now?: () => number;
}): GuardedFetch {
  const { plain, isProtected, waitMs = BOT_CHECK_WAIT_MS, now = () => Date.now() } = options;
  const gone = new WeakMap<AbortSignal, () => void>();

  const send: Send = (input, init) => {
    const signal = init?.signal;
    if (signal) gone.get(signal)?.();
    return plain(input, init);
  };

  const guard = (checked: () => Send): Send => (input, init) => {
    if (!isProtected(input, init) || !takeAsk(now())) return send(input, init);

    return new Promise<Response>((resolve, reject) => {
      const gate = new AbortController();
      let sent = false;
      let gaveUp = false;
      let timer: ReturnType<typeof setTimeout> | undefined = undefined;

      const withoutTheCheck = () => {
        if (gaveUp || sent) return;
        gaveUp = true;
        clearTimeout(timer);
        // Before the plain copy goes: a waiting copy that wakes up later finds
        // its signal already aborted and is refused by the browser unsent.
        gate.abort();
        plain(input, init).then(resolve, reject);
      };

      gone.set(gate.signal, () => {
        sent = true;
        clearTimeout(timer);
      });
      timer = setTimeout(withoutTheCheck, waitMs);

      // Whoever called may cancel; the two copies answer to them alike.
      const callers = init?.signal;
      if (callers) {
        const cancel = () => {
          if (gaveUp) return;
          gaveUp = true;
          clearTimeout(timer);
          gate.abort();
          reject(callers.reason);
        };
        if (callers.aborted) return cancel();
        callers.addEventListener("abort", cancel, { once: true });
      }

      let through: Promise<Response>;
      try {
        through = checked()(input, { ...init, signal: gate.signal });
      } catch (err) {
        through = Promise.reject(err);
      }
      through.then(
        (answer) => {
          if (!gaveUp) resolve(answer);
        },
        (err) => {
          if (gaveUp) return;
          // Failed AFTER it went is the request's own failure, and the caller's
          // to hear. Failed BEFORE is the check failing — which lets the person in.
          if (sent) reject(err);
          else withoutTheCheck();
        },
      );
    });
  };

  return { send, guard };
}

/** A same-origin `POST /` — where every server action on the landing page goes, and the one address the bot check is set on. */
export function isLandingPost(input: Parameters<Send>[0], init: Parameters<Send>[1], origin: string): boolean {
  const method = (init?.method ?? (typeof Request !== "undefined" && input instanceof Request ? input.method : "GET")).toUpperCase();
  if (method !== "POST") return false;
  try {
    const url = new URL(typeof Request !== "undefined" && input instanceof Request ? input.url : String(input), origin);
    return url.origin === origin && url.pathname === "/";
  } catch {
    return false;
  }
}
