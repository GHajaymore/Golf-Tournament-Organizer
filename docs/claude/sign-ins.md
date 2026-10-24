# Sign-ins and the production hold

> Moved out of `CLAUDE.md` on 2026-10-24, verbatim, so that the file every session reads stays short. Read this when your task touches: sign-in, sign-up, sessions, passwords, codes, known devices, launching accounts. Index: `CLAUDE.md`.

## Sign-ins until launch: production is held

Ajay, 2026-10-17: "block the signins until I say so or when we launch … app is not ready yet";
and 2026-10-21: "block/hold the signup/signin until when we say let's Launch".
`src/lib/sign-in-gate.ts`. PRODUCTION IS HELD BY ITSELF: only the owners on `OWNER_EMAILS` (and
anybody on `SIGNIN_ALLOW_EMAILS`) may sign in, set or reset a password, sign up, or keep a
session; everybody else is told the app "opens soon" above the front door, which then offers
SIGNING IN ONLY (no Sign up tab, no account form) and `/play` for a player. Held, the page's
words are the marketing panel's (`HELD_FRONT_DOOR`, `SIGNINS_CLOSED_NOTICE` — the manager wrote
them, the ad director checked them as an ad's landing page): sign-ups "paused" (never "under
development"), the 25% early-list offer with its terms beside it (the first month if they pay
monthly, the first year if yearly — Ajay's ruling, and what billing does), "Join the early list"
in place of "Start free" and every button pointed at `/interest`, and the free plan's
"Free for fields of up to 10" and "No card" taken down until launch (Ajay: "I dont want it until
go live"). The CODE is never printed; it is emailed at launch. The form's own words are in
`src/lib/domain/interest.ts`; the notes are listed on `/owner` and copied to inquiries@. Round
codes and public boards are not touched. Previews, dev, CI and e2e are not production and stay
open (a list on `SIGNIN_ALLOW_EMAILS` closes any of them, to try the closed state). **TO LAUNCH:
the Accounts card on `/owner` — one press opens accounts to everybody at once, one press holds
them again** (`services/signins-switch.ts`, a `PlatformSetting` row; a database fault leaves the
hold standing). `SIGNINS=open` in Vercel still opens it too. Every door asks `maySignInNow` /
`signInsHeld` — `createSession`, `getSession`, the sign-in actions, the front door — so a new
door is shut without knowing the rule. Never the word "closed" on screen.

It is held only while `OWNER_EMAILS` names somebody, so it can never lock everyone out. The
first draft held production with the owners let through on 2026-10-17 and was withdrawn: `/owner`
answered 404 to the owner then, so production's list did not hold his address. On 2026-10-21 it
answered 200 to his session, and the hold went in. Until then the list was the only switch and
production's was never set, so the front door stood open — measured from the page, which drew
no notice.

## Signing in: a proved address, a password nobody leaked, a device that is known

Ajay, 2026-10-21: "go with your recommendations". Three rules, each held at one place.

- **No session for an address nobody has proved.** `createSession` refuses a User whose
  `emailVerifiedAt` is null; a six-digit code typed back from the inbox (`services/email-code.ts`)
  or a finished password reset sets it. Sign-up and claim set no password and make no session:
  what was typed waits, hashed, on the `EmailCode` row and `verifyEmailCode` applies it. A code
  belongs to the browser that asked for it (`browserHash`), five wrong tries spend it, and twenty
  wrong tries on one address in a day stop all of them until tomorrow. A fixture that signs in
  through `createSession` sets `emailVerifiedAt: new Date()`; a spec that signs up or claims
  through the form calls `verifyByCode(page, email)` from `e2e/verify-by-code.ts`.
  `the-session-asks-for-a-proved-address.test.ts` lists every caller of `createSession`.
- **Every new password goes through `passwordRefusal`** (`services/password-breach.ts`): the
  rules in `password.ts`, then Have I Been Pwned's range API (five characters of the SHA-1,
  padded). Only on Vercel, and a check that cannot answer lets the password through and logs it.
  `a-new-password-asks-about-leaks.test.ts` holds every action that hashes a password to it.
- **Club staff confirm a new device** (`services/known-device.ts`, `KnownDevice`). A browser
  keeps a random value in a year-long `ng_device` cookie. Staff — a seat at a club, or admin or
  assistant on a tournament — signing in with a password on a browser not seen before are sent a
  code (purpose `device`) first; anybody else is let in and sent a "new sign-in" email. A code
  typed back, a reset finished, or a first sign-in remembers the browser. A spec that signs a
  STAFF member in through the password form in a fresh context gets the code step: pass it with
  `verifyByCode`, or sign in with `signedInNow` instead.
