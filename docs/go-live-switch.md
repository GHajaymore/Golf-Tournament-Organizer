# The go-live switch

Ajay, 2026-10-23: "I just need one switch to say let's go live and that should change coming soon
or any blockades to online."

**One press — Go live, on the Accounts card of `/owner` — takes every held place below live at
once. One press — Hold again — holds them all again.** Each is asked once more in a dialog that
names the effect. Before the press the card lists what it will change; after it, it says
"Live since …" on the owner's own club clock (UTC, said so, when no club of theirs has a zone).

- The answer is `launchState()` in `src/lib/services/signins-switch.ts`: `"held"` or `"live"`.
  It is the deploy's rule (`signInsClosed` / `holdRule` in `src/lib/sign-in-gate.ts`: production
  with somebody on `OWNER_EMAILS`, or any deployment with `SIGNIN_ALLOW_EMAILS`), unless the owner
  has pressed Go live (the `PlatformSetting` row `signins` = `open`). A database fault keeps the
  hold. `SIGNINS=open` in Vercel still opens it too, at the next deploy — and the card says so when
  it is overriding the switch.
- Every word that differs held and live is in ONE module, `src/lib/go-live.ts`, both ways. Each
  screen takes the state as a REQUIRED argument (`landingNav`, `LandingAuth`, `InterestForm`,
  `FaqContext.launch`, `frontDoorWords`, `interestWords`, `faqWords`), so a new caller is found by
  the compiler.
- The table below is `LAUNCH_SURFACES` in that module. The owner card's list is built from it, and
  `e2e/go-live-switch.spec.ts` walks every place in it that has a page, both ways.
  `go-live-switch.test.tsx` holds this table to the module, id for id.

Measured on 2026-10-23, from the code: **16 places differ while held. 8 already asked the switch**
(they held their live words inline, which are now in the module); **8 were wired that day** — the
free plan in "Compare the plans" and beside the two club platforms, what search engines are told
about the plans (no $0 offer while held: Ajay, "I dont want it until go live"), two answers on
/faq, /faq's last button, the /interest page, its form (and the copy to inquiries@), /interest's
description, and the owner card, rebuilt around the list. Every line the card draws from the
inventory is in plain words — the test refuses a function name, a variable or a bracket.

**Once live, the card also sends the early-list codes** — the owner's own press, never part of Go
live. It shows who is waiting (one per address, notes written before going live, never twice), the
email they will get with a placeholder for the code, and Send; Send asks once more, then gives
each person a single-use 25% code (`DiscountCode`, labelled "Early list · launch") and emails it.
`EarlyListSend` records who was sent which code, written before the email goes so two presses
cannot send one person two, and removed (its code switched off) if the mail service refuses. No
more than `RESEND_DAILY_LIMIT` (default 100, Resend's free plan) go in any 24 hours; over that the
card says how many wait and when the next press can send them.

## What is held, and what goes live

| id | Where | Held | Live | Before 2026-10-23 |
|---|---|---|---|---|
| `accounts` | Every way in — signing in, signing up, setting or resetting a password, staying signed in (in the code: `createSession`, `getSession`, the five sign-in actions) | Only the owners (and `SIGNIN_ALLOW_EMAILS`); everybody else is told TourneyHQ opens soon and signed out | Anybody can, not just the owner | followed |
| `front-door-box` | The front door's sign-up and sign-in box | The "opens soon" notice with the early-list offer and terms; sign-in only, behind "TourneyHQ staff sign-in" | The sign-up form with its two tabs | followed |
| `front-door-buttons` | The hero's and the phone dock's start buttons | "Join the early list", to /interest | "Run an event", to the form | followed (live words inline) |
| `front-door-pill` | The announcement above the headline | "Opening soon: join the early list for 25% off …" | "New: Ryder-style cups, on every player's phone" | followed (live words inline) |
| `front-door-facts` | The facts under the headline | Handicaps by the Rules · No app for players | Free for fields of up to 10 · No card · No app for players | followed (live words inline) |
| `pricing` | The pricing cards and the note under them | Free plan "Opens at launch."; "Join for 25% off …"; "Paid plans start at launch …" | "Free for good", "Start free"; "Choose …"; the note on arranging a paid plan | followed (live words inline) |
| `compare-plans` | The free plan in "Compare the plans" and beside the two club platforms | "opens at launch", no tick | "free for good", a tick: up to 10 players | **wired** |
| `search-data` | What search engines are told about the plans (schema.org offers) | The two paid plans only, no $0 offer | All three, the free plan at $0 | **wired** |
| `front-door-close` | The closing section above the box | "Opening soon. Get in early." | "Run your first event." | followed (live words inline) |
| `nav` | The top bar's button on /faq, /privacy, /terms, /interest | "Join the early list", to /interest | "Start free", to the form | followed (an optional argument that defaulted to live; now required) |
| `faq-answers` | /faq: "Can I try it for free?" and "Do I need a credit card?" | The free plan "opens at launch"; no "no card to start" | "Yes …", "No card to start" | **wired** — said "Yes, free, no card" while the front door had taken both down |
| `faq-cta` | /faq's last call to action (only while the contact address is off) | "Join the early list", to /interest | "Start free" | **wired** — "Start free" whatever the switch said |
| `interest-page` | /interest: kicker, heading, offer | "Opening soon" · "Be first on the tee …" · 25% off at launch | "Now open" · "Tell us about your club" · "Set up your club", to the form | **wired** — said "Opening soon" for ever |
| `interest-form` | /interest: the line under the form, the thanks, the copy to inquiries@ | Promises the 25% code at launch | Promises a reply, no code | **wired** |
| `interest-meta` | /interest's search and link-preview description | "… 25% off your first term when it opens." | "TourneyHQ is open …" | **wired** (was static metadata) |
| `owner-card` | /owner: the Accounts card | "Held until launch", what Go live will change, Go live | "Live since …", what Hold again will change, Hold again | **rebuilt** — read the switch, listed nothing |

The live words on /interest were written for this change (no live wording existed) and go to Ajay
with the landing preview. Every other live word is the one the page already had.

## What does NOT move with the switch, and why

| id | What | Why |
|---|---|---|
| `app-stores` | "Coming soon to the App Store / on Google Play", and those two in the "Coming" strip | True until a store lists the app, which is not launch day. `TOURNEYHQ_IOS_URL` / `TOURNEYHQ_ANDROID_URL` turn each into a store link. |
| `handicap-services` | "Coming soon" beside GHIN / WHS handicap services | A feature not built yet, not a hold. |
| `metered` | Text alerts, card reading, commentary — "not switched on for anybody yet" | Cost per use; top plan first. Unrelated to accounts. |
| `prices` | Every figure: the paid plans' prices on the front door, in the search data, on /faq and in the owner's price editor | Prices are Ajay's; set on the owner console. Going live never moves a figure — it only shows or hides the free plan (`compare-plans`, `search-data`, `pricing`). |
| `plan-limits` | Plan-limit enforcement (the Enforce switch in the owner's limits) | Refusing a club over its plan is money, with its own switch. **Open question for Ajay.** |
| `launch-codes` | Emailing the 25% codes to the early list | His message going out: never by Go live, never automatic. Once live the card shows who is waiting and the email, and sends only on his press of Send, confirmed. |
| `interest-offer` | The 25% offer for somebody who joins after launch | Its terms are for clubs that join before launch, so live /interest makes no offer. **Open question for Ajay.** |
| `round-codes` | /play, round codes, every public board | Never held. |
| `entry-windows` | "Opens soon" on a tournament's entries | A tournament's own entry window. |
| `contact-address` | /faq's "our contact address opens soon" | About mail (`CONTACT_EMAIL_LIVE`), not launch. |
| `sitemap` | /interest in the sitemap and robots.txt | The page answers in both states, so an old post or ad still lands somewhere true. |
| `not-production` | Development, CI, every preview | Never held, whatever the switch says. |

## Open questions for Ajay (money — the defaults stand until he rules)

1. **After launch, should /interest keep the 25% early-list offer for late-comers?** Default: no.
   Its terms say "for clubs that join the early list before launch", so live it says "Now open",
   points at the sign-up form and promises a reply, not a code. The form still records the note.
2. **Should Go live also switch on plan-limit enforcement?** Default: no, they stay separate presses.

Answered (2026-10-23): the free plan in search data and "Compare the plans" is hidden while held
(his earlier ruling, "I dont want it until go live"); and the early-list codes are sent from the
card, by his own press, once live.

## How it is tested

- `src/lib/__tests__/go-live-switch.test.tsx` — the rule (`holdRule`, every case); this file's
  tables against the module; every renderable surface rendered both ways through ONE checker, with
  a control (a component that ignores the state) that the checker must report; the owner card
  listing every place from the inventory; and a source sweep: no held phrase ("opens soon", "early
  list", "at launch", "25% off", …) and no word of the module's own outside `go-live.ts`, read
  through `readSource`, with a control proving it sees one.
- `e2e/go-live-switch.spec.ts` — on a server that HOLDS (start one with `SIGNIN_ALLOW_EMAILS`; see
  its header), every probed page read as its reader held, the owner presses Go live (dialog
  measured on screen), every page read again live, every surface must follow both ways, a control
  surface that ignores the switch must be reported, then Hold again. On any other server it says
  NOT WALKED.
- `the-launch-switch.audit.test.ts` — the row against real rows: a missing row is held, only an
  owner can press it, `SIGNINS=open` overrides it and the card is told why. (A database fault
  keeping the hold is in the unit test.)
- `early-list-codes.test.ts` (who is owed, the daily allowance) and
  `early-list-codes.audit.test.ts` (real rows, the mail sender replaced, @example.invalid only; it
  refuses to run if the database holds a note of interest that is not a fixture): nothing while
  held, only an owner, one single-use 25% code per address, the limit kept and the rest left for
  the next press, a late joiner never sent one, nobody sent twice, a refused send recording nothing
  and switching its code off.
