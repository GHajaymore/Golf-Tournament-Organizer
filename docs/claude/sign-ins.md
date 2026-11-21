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
go live"). The CODE is never printed; it is emailed at launch. The form's labels are in
`src/lib/domain/interest.ts`; the notes are listed on `/owner` and copied to inquiries@. Round
codes and public boards are not touched. Previews, dev, CI and e2e are not production and stay
open (a list on `SIGNIN_ALLOW_EMAILS` closes any of them, to try the closed state). **TO LAUNCH:
Go live, on the Accounts card of `/owner` — one press takes EVERYTHING held for launch live at
once, one press (Hold again) holds it all again** (Ajay, 2026-10-23: "I just need one switch to
say let's go live"; `services/signins-switch.ts`, a `PlatformSetting` row; a database fault leaves
the hold standing). `SIGNINS=open` in Vercel still opens it too, and the card says when it is
overriding the switch. **What it covers is `src/lib/go-live.ts`, and `docs/go-live-switch.md` is
the same table**: the sign-in doors, every front-door word, the nav on every public page, two /faq
answers and its last button, the whole of /interest (live: "Now open", no 25%) and the copy to
inquiries@, the free plan in "Compare the plans" and in the search data (no $0 offer while held),
and the owner card — 16 places — plus what deliberately does NOT move (app-store badges, prices,
plan limits). Once live the card also SENDS THE EARLY-LIST CODES, only on the owner's own press of
Send (`services/early-list.ts`, recorded in `EarlyListSend`, never more than `RESEND_DAILY_LIMIT`
in 24 hours — the rest wait for his next press). The card's lines from the inventory are plain
words: no function or variable names. Every held/live
word is in that one module and each screen takes `LaunchState` as a REQUIRED argument;
`go-live-switch.test.tsx` refuses a held phrase anywhere else, and `e2e/go-live-switch.spec.ts`
flips it both ways on a server that holds (its header says how to start one). Every door asks
`maySignInNow` / `signInsHeld` / `launchState` — `createSession`, `getSession`, the sign-in
actions, the public pages — so a new door is shut without knowing the rule. A new held place goes
in `LAUNCH_SURFACES` with a probe. Never the word "closed" on screen. The early list ITSELF is
"free, no card needed" wherever it is offered (Ajay, 31 Oct, #975) — that is joining the list,
not the free plan, whose "No card" stays down while held.

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

## Security sweep, mediums (2026-11-13)

- **The platform owner is staff for the device rule** (`isClubStaff` is true for an `OWNER_EMAILS`
  address): a password alone on a browser not seen before earns a `device` code. Sign a fixture in with
  `signedInNow`, as for staff.
- **One answer per address.** Signing in answers an address that is nobody, invited, or has no password
  exactly as a wrong password ("Wrong email or password."), spending one hash either way; an invited person
  uses the panel's "Invited, and never set a password?" link to `claimPassword`. Claim and sign-up answer
  `needsCode` for every address; only an address that can use a code is mailed one (an account that already
  exists is sent a `device` code, a roster address a `claim` code). A spec that expects "invited" on the
  code step must now expect "If … was invited … we've emailed it a 6-digit code".
- **Two sign-in limits.** `signin`: 5 per address in 15 minutes, counted before the lookup; over it the
  RIGHT password from a browser this person already signed in on still gets in (the cookie is not something a
  stranger holds), every other browser is refused and its password is not compared. `signin-client`: 20 FAILED
  sign-ins per client in 15 minutes through `clientGuessGate` (fingerprinted, IPv6 /64, atomic); a right
  password gives its attempt back, so a clubhouse's wifi is never refused for members who sign in correctly.
- **An entry on the public link proves its address first.** `registerForEvent` for anybody not signed in as
  that address sends a `purpose: "entry"` code and enters nobody; `confirmEntryCode` takes the code back
  (same browser, single use) and then places the entry. No Account, place, or confirmation email before that,
  and "already registered" is said only after the code. A spec enters through the link with
  `verifyByCode(page, email)` after pressing Register. A guest the organizer adds by hand needs no email.
- **Codes sent per connection: 60 in 15 minutes (`code-send-client`), and a PROVED code gives its send
  back** (`giveBackClientAttempt`, called once in `checkEmailCode`). Only the inbox's owner can type a code,
  so a clubhouse wifi where a whole society enters on one morning is never refused, while a client making
  codes go to addresses it cannot read keeps every send counted. Found by round G623-1: scenario a's field,
  entered from one machine, was refused at its 61st entrant. A walk that enters more than sixty people
  without typing their codes back will still be refused — that is the limit working.
- **Content-Security-Policy**: four nonce-free directives enforced, the origin lists Report-Only
  (`next.config.mjs`, `csp.test.ts`); the nonce for `script-src`/`style-src` is the follow-up.

## A guest's personal player link (J39/J40 PR 1, 2026-11-13)

Ajay, 7 Nov: members and organizers need an email; a **guest** needs no email and no app. A guest
entry gets a personal player link — `/p#<12-character code>` (Crockford base32, 60 bits), or the code
typed into any code box (`/p` or `/play`, one code box, 2026-11-17) — opening that one entry in that one event: Today, My card (where the event lets a player
keep their own), the board, Help. Design: `TourneyHQ Documents/Design - Guest player link (J39-J40) 12 Nov.md`.

- **Not a sign-in, and not held.** The one door for a typed code (`openAnyCode`, `services/code-door.ts`,
  pressed through `actions/code-box.ts`) never calls `createSession`; `guest-auth.ts` never
  asks `maySignInNow` / `signInsHeld` — links work before launch, like round codes (`NOT_SWITCHED`
  `player-links`, pinned by `go-live-switch.test.tsx`).
- **A tap opens it, never a load (S1).** `/p` reads and strips the fragment and waits for "Open my card";
  only that POST records a browser (`PlayerPassDevice`, hashed under the link's own key) and sets
  `ng_guest` = `sign("guest1~<passId>:<version>:<issued>")` — exact prefix, 180 days held server-side,
  version-checked, re-verified against the row on every request (`getGuestSession`).
- **Guessing (S2):** the budget is CHOSEN BY THE CODE'S SHAPE in `openAnyCode`'s `guessGate`, never by the box it
  was typed in (a 12-character code never reaches the round code's per-code key). `player-link-client`, 20 FAILED
  opens per client in 15 minutes through `clientGuessGate`
  (never keyed on the code, never cleared; a real open gives back one); one shared bucket where no client
  address can be read; past 200 failed opens an hour platform-wide (counted only for requests the client's
  own limit let through) every client is held to three failed opens in 15 minutes and one error is logged
  per window (one code box PR B gave the 8-character round code the same two steps with its own figures: `eight-char-alarm`, 300 failed lookups an hour platform-wide, then `eight-char-slow`, 12 failed per client in 15 minutes while it stands, set for a code a whole field TYPES off a card; and where no address can be read the round code now shares one bucket too, where it had none). Twenty stays the per-client figure (Security Lead review N-1: 60 bits carries it; the cost of a
  tighter one falls on a clubhouse wifi or a carrier's shared address).
- **Stored hashed:** `PlayerPass.lookup` (HMAC under `derivedKey("player-link-lookup")`) and `sealed`
  (AES-256-GCM, bound to `passId:version`), so the organizer can show the same link again (re-sending is
  not rotating). Rotating `AUTH_SECRET` ends every link as well as every session: organizers re-share.
- **Expiry:** 90 club days after the event's last day of golf; an event with no day at all, 180 club days
  after the code was made or last replaced (review SF-4). Staff can Turn off a link even in a lapsed club's
  archive (SF-5); showing or making one there is refused.
- **Per event (S4):** `playerViewSwitch` — beside a sign-in, the link answers for its own event (unless
  the account is staff there) and the other is offered on a line above, never merged; the WRITES follow the
  same choice (`guestActorFor` asks `playerViewChosen`, SF-1). **Writes are a
  confirmed entrant's (S5):** `myPlayerIdsFor` gives a guest its pass's entry only while `confirmed`;
  a pending or waitlisted guest's link opens the waiting card only — refused by each event page itself
  (`requirePlayingViewer`), not only by the layout (SF-3).
- **Closed list:** `GUEST_ACTIONS` (`domain/player-link.ts`) — the four stroke-card actions, forget this
  phone, choose view. Every other action still calls `getSession()` and refuses a guest.
- **Analytics and reports (S3):** `/p` renders no analytics and `pageViewFor` drops a view of it;
  `scrubText` redacts the code in a fragment, a `/p/` path, a query or its printed dashed form.
- A spec reaches a guest by the real door (a tap at `/p`, or the code typed in any code box), never a hand-made `ng_guest`.
- **One code box (plan row 4c, 2026-11-17):** a round code typed at `/p` goes on to `/play#ABCD-EFGH` (after the `#`,
  no extra press); a personal code typed at `/play` opens the guest's Today. Every code of the right shape that opens
  nothing says one sentence (`CODE_WORDS.opensNothing`) and every code throttle another (`CODE_WORDS.tooMany`);
  `PLAYER_LINK_WORDS.dead` is said only on `/p?ended=1`, of a link this phone held. `e2e/one-code-box.spec.ts`.
- **A link's messages and notices (PR 2):** a guest is `guest:<playerId>` in messaging (never an address),
  reads and posts in the threads its entry puts it in (never the club's), writes to the organizers
  (`desk:<playerId>`), and starts no direct thread (D7: `startDirectThread` is account-only). Every messaging
  action asks `messagingContextFor(target)`, which picks the link only for the target's own event, by PR 1's
  precedence. Its notices go by push only, to `PlayerPassPush` rows bound to the pass's VERSION: New link,
  Turn off, withdrawal and expiry stop them at once (`sendPushTo` asks `livePass`). **Forget me on this phone**
  changes no version, so it deletes the held pass's row for this browser's endpoint itself (`forgetPassHere`;
  #1133 review SEC-1). The player's **Turn off** deletes the caller's OWN row on its endpoint and nobody
  else's (`turnOffHere`; the #1133 security review F-3 replaced SEC-2's every-row delete), then unsubscribes
  the browser, so the push service's 410 clears any other row on that phone at the next send. Turn on and
  Turn off are budgeted per pass or address (`push-device`, 10 in 15 minutes), a link holds at most
  `GUEST_PUSH_ROWS` (5) phones with the oldest dropped, and every send has `PUSH_SEND_TIMEOUT_MS` (3 s), so
  one dead host cannot hold a "play suspended" press (F-1). A link-only browser asking about another event's
  thread is answered in its own event, exactly as for a missing id (F-2). The organizer can Mute a guest in
  messages from their link (the link stays live; a mute is on the pass, F-4). The installed app starts at
  `/start`: an account goes home, a live link to Today, anybody else to `/p` with "Have an account? Sign in".
- **Slips (PR 3, 2026-11-14):** the Print kit prints one slip per CONFIRMED guest (`slipsFor`,
  `domain/player-link-slips.ts`, which asks `passRefusal`), the guest's one link made on first use exactly as
  Show QR makes it. The codes leave the server only as the answer to a staff press (`printPlayerLinkSlips`,
  budgeted `link-slips`, 6 an hour per staff member per event, audited by who and how many, never a code); the
  page renders counts only and the sheet is dropped after printing. `PlayerPass.slipPrintedVersion` says a
  printed slip went stale on New link; `newPlayerLinksFor` rotates a lost sheet in one press. No shared print
  (tee sheet, signs, cards, posters) builds a link (`a-player-link-is-never-on-a-shared-print.test.ts`).
  Today names who the link is for ("Not you? Hand this back to the desk."). Guest self-entry, the typed entry
  code (`Event.registrationCode`, `guestEntryOpen`: columns in A047, unused until PR 3B) and the stand-in's
  link are not built yet.

## Moved from CLAUDE.md (20 Nov 2026): Test fixtures: signing a fixture in

**A fixture that signs itself in signs `signedInNow(user.id)`**, from
`scripts/session-cookie.mjs` — never the bare user id. Since 2026-10-11 a session cookie
carries when it was issued (`src/lib/domain/session-token.ts`): the server holds a sign-in to
seven days itself, and a password reset ends every earlier one. A cookie made the old way is
refused, and a refused fixture does not fail loudly — every screen answers 307 to the sign-in
page, which a route walk reads as the app working. `session-token.test.ts` sweeps `e2e/` and
`scripts/` for the old spellings.

## Moved from CLAUDE.md (20 Nov 2026): Sign-ins until launch

Ajay, 2026-10-17 and 2026-10-21: block sign-up and sign-in until he says launch. `src/lib/sign-in-gate.ts`.
**Production holds itself:** only the owners on `OWNER_EMAILS` (and anybody on `SIGNIN_ALLOW_EMAILS`) may
sign in, set or reset a password, sign up, or keep a session; everybody else sees the "opens soon" front
door (sign-in only, `/play` for a player, every button to `/interest`). Previews, dev, CI and e2e are not
production and stay open. **To launch:** Go live on the Accounts card of `/owner` (`services/signins-switch.ts`),
or `SIGNINS=open` in Vercel — ONE press takes every held place live, Hold again holds them all; the places are
`LAUNCH_SURFACES` in `src/lib/go-live.ts` (= `docs/go-live-switch.md`), each screen takes `LaunchState` as a
REQUIRED argument, and once live the card sends the early-list codes on the owner's press (`services/early-list.ts`).
**Every door asks `maySignInNow` / `signInsHeld` / `launchState`** (`createSession`, `getSession`,
the sign-in actions, the public pages), so a new door must too. The held page's words are
`HELD_FRONT_DOOR` / `SIGNINS_CLOSED_NOTICE`: sign-ups "paused" (never "under development"), never the word
"closed" on screen, and the free plan's "Free for fields of up to 10" and "No card" stay down until launch.
It is held only while `OWNER_EMAILS` names somebody, so it can never lock everyone out.

**Signing in (2026-10-21):** no session for an address nobody has proved (`createSession` refuses a null
`emailVerifiedAt`; a fixture that signs in through it sets `emailVerifiedAt: new Date()`, a spec that signs
up or claims through the form calls `verifyByCode(page, email)` from `e2e/verify-by-code.ts`); every new
password goes through `passwordRefusal` (`services/password-breach.ts`); club staff on a browser not seen
before are sent a code (`KnownDevice`) — sign a STAFF fixture in with `signedInNow`, not the password form.
Long form: `docs/claude/sign-ins.md`.


## A guest enters themselves on the one sign-up link (J39/J40 PR 3B, 2026-11-20)

Ajay, 7 Nov: guests need no email and no app; they enter themselves only when the organizer switches it on, and ALWAYS
with approval. The organizer ticks **Let guests enter themselves** on Entries (`Event.guestEntryOpen`, off by default,
never cloned). The sign-up page (`/register/<token>`) then carries **Enter as a guest** FIRST, above the member form;
the member form keeps one line under it, guests on or off ("Not a member of the club? Ask the organizer: they can add
you.").

- **A waiting entry and nothing else.** `registerAsGuest(token, form, nonce)` (`actions/guest-entry.ts`) writes a
  `Player` with `standing: guest`, `status: "pending"` WHATEVER the approval mode, no email, no phone, no `teeId`, no
  roster `Member` and no `Account`, plus its `PlayerPass`; it sets `ng_guest` and returns the guest's own code once.
  It never calls `createSession`, `syncPlayerAccount`, `sendRegistrationEmail`, `getSession` or the hold: the guest door
  is NOT held (`NOT_SWITCHED` `guest-entry`, `the-guest-door-makes-no-sign-in.test.ts`).
- **The token only.** `registerAsGuest` takes the 114-bit `registrationToken`, never the 8-character code (C1.1). The
  code is the link's typed form (`Event.registrationCode`, 38 bits), printed under the poster's QR, typed at `/register`,
  and redeemed ONLY by the one door for a typed code (`openAnyCode`; `guestEntryFor` is the press). On success the
  browser is redirected to `/register/<token>`: the token IS revealed to a code holder, on purpose (C1.2), because the
  poster's QR carries it beside the code. A code at an event whose entries have closed is the one neutral sentence, counted
  like an unknown code and never redirected to a page that names it (C1.3, C4.4); only a TOKEN names a closed event, and
  only the event and the day (C4.1).
- **One lifecycle (C1.4).** The code is made lazily by a staff press (Show QR code, the first guest turn-on), only while a
  token exists, checked against both `Stage.accessCode` and `Event.registrationCode`; it rotates with the token in ONE
  write (New link, C2.1) and is never cloned. Turning the guest switch off does not end it.
- **Limits (D3).** `register-token` (grows with the field), `guest-entry-device` 3 an hour per browser + event,
  `guest-entry-cookieless` 10 an hour per network + event counting ONLY requests with no device cookie (the cookie is set
  by pressing Enter as a guest, before the submit), and the waiting cap `max(24, the field's limit)`. There is NO per-network
  budget on successful entries (a clubhouse is one address). Residue, stated: `ng_device` is an unsigned random value, so a
  script that sets a well-formed one of its own per request is not held by the device or cookieless budget; it is held by the
  token's budget, the cap, the switch and New link, and earns only rows staff remove.
- **Approval** (`approveSignup(playerId, figure?)`): a guest is approved AS A GUEST (`upsertMember(…, { guest: true })`),
  counted and placed under `withEventIntakeLock`; where ANY round is scored net the committee's figure ("Handicap for
  today") is required (`figureRefusal`, the same gate Replace uses) and is stored as the entry's index; a gross-only event asks none and stores
  "none". The figure is validated as a payload (`figurePayload`).
- **The waiting screen** is the layout's waiting card (`GuestWaitingCard`): `router.refresh()` of Today with no argument
  (no new guest action), only while the page is visible (`waiting-refresh.ts`), with **Check now**. The guest's code is held
  in client memory only (`guest-code-memory.ts`) and is never server-rendered.
- **A retry returns the same entry (C3.5):** a nonce of at least 128 bits, its keyed hash stored with the pass, bound to
  the event and the device, for 15 minutes; never matched on the name.
