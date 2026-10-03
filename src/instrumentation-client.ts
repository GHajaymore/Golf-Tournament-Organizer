import { initBotId } from "botid/client/core";

/**
 * The browser half of the sign-up bot check (2026-10-03; the server half and
 * why are in `lib/services/bot-check.ts`).
 *
 * Sign-up is a server action on the landing page, and a server action posts to
 * the page it was called from — so the protected request is `POST /`. Signing
 * in posts there too and simply ignores the extra headers; only `signUp` asks.
 */
initBotId({
  protect: [{ path: "/", method: "POST" }],
});
