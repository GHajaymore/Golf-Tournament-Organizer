/**
 * THE OWNER OF THE TEST SERVER — an invented address, given to `OWNER_EMAILS`
 * by `playwright.config.ts` and by a round's own server (`scripts/qa/round.mjs`),
 * and signed in as by `e2e/owner-console.spec.ts`. One place, so the three
 * cannot drift apart. Production's owners are set in Vercel and are not this.
 */
export const E2E_OWNER_EMAIL = "zz-owner-console@example.invalid";
