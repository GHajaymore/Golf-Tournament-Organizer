import { initBotId } from "botid/client/core";
import { isLandingPost, makeGuardedFetch } from "@/lib/bot-check-fetch";

/**
 * The browser half of the sign-up bot check (2026-10-03; the server half and
 * why are in `lib/services/bot-check.ts`).
 *
 * Sign-up is a server action on the landing page, and a server action posts to
 * the page it was called from — so the protected request is `POST /`. Signing
 * in posts there too and simply ignores the extra headers; only `signUp` asks.
 *
 * AND ONLY `signUp` WAITS (2026-10-13). BotID works by taking `fetch` over and
 * holding every protected request until its own script has answered, so for
 * ten days every sign-in, reset link and first password waited on a check none
 * of them uses — and with that script blocked nobody could sign in at all.
 * `makeGuardedFetch` puts BotID's `fetch` behind one that hands it only the
 * request that asked (`askForBotCheck`, called by the sign-up form), for a
 * bounded time. See `lib/bot-check-fetch.ts`.
 *
 * The order of the four lines is the mechanism: BotID keeps whatever `fetch`
 * it finds when it starts as its way out, so `send` goes in first; then BotID
 * takes over; then its `fetch` is put behind the guard.
 */
const { send, guard } = makeGuardedFetch({
  plain: window.fetch.bind(window),
  isProtected: (input, init) => isLandingPost(input, init, window.location.origin),
});
window.fetch = send;
initBotId({
  protect: [{ path: "/", method: "POST" }],
});
const checked = window.fetch;
window.fetch = guard(() => checked);
