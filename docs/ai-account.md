# The AI account: where it lives and how to switch it

Ajay, 2026-11-03: run the app's AI on his own Claude account for now, and replace
it with the app's own account before or after launch. Switching is **environment
values only, never code**.

## The one place

`src/lib/ai-config.ts` decides, for every AI job, which provider runs it and on
which model. A caller names the JOB (`askClaude({ job: "cardReading", … })`) and
never a model, a provider or a key. `src/lib/__tests__/ai-config-is-the-one-place.test.ts`
refuses a model id, a provider key variable or the account label anywhere else
in `src/` or `scripts/`.

| Job | Provider | Model | Where it is used |
| --- | --- | --- | --- |
| Card reading (reads a photograph) | Anthropic | `claude-haiku-5-5` | `actions/card-photo.ts` — one card, a group's card, a course card |
| Commentary | Anthropic | `claude-sonnet-5-5` | `actions/commentary.ts` |
| Message drafts | Anthropic | `claude-sonnet-5-5` | `actions/draft-message.ts` |
| Setup suggestions | Anthropic | `claude-sonnet-5-5` | `actions/setup-suggest.ts` |
| Report drafts | Anthropic | `claude-sonnet-5-5` | configured; no screen asks for it yet |

Card reading needs a model that reads photographs. A provider without vision
cannot serve it; the config refuses that pairing.

## Where the key lives

- **Vercel → Project → Settings → Environment Variables**, for **Production and
  Preview**.
- The developer's own **`.env.local`** (never committed — the repository is public).
- **Nowhere else**: not in a document, a screenshot, a chat, or GitHub secrets
  (the deploy runner never needs it).

| Variable | What it holds |
| --- | --- |
| `ANTHROPIC_API_KEY` | the Anthropic account's API key. Unset = the Anthropic jobs are off and each screen says so. |
| `AI_ACCOUNT_LABEL` | a plain name for the account, e.g. `Ajay's personal account`. Shown on `/owner`. Never the key. |

`/owner` shows one AI card: on or off, the label, and the model per job, plus the
**Check AI** button (owner-only, once a minute; `actions/owner-ai.ts`) and the
monthly AI budget (below). It never
shows the key or any part of it. After any swap of account, press Check AI.

## The monthly AI budget (in the app)

Ajay, 2026-11-03: "let's set the budget to $20 / month. make it configurable in
owner's console".

- **Default $20.00 a month** when it has never been set.
- **Where to change it:** `/owner` → the AI card → *Monthly AI budget (US dollars)*
  → **Save budget**. Owner-only (`setAiBudget` in `actions/owner-ai.ts`). Any figure
  from $0 to $1,000.00; a negative, a non-number or more than $1,000 is refused in
  words. Stored as whole cents in `PlatformSetting` `ai-budget-cents`.
- **$0 means AI is off for everyone.**
- **What the card shows:** this month's spend, the budget, what is left, and the
  spend per job (calls and cost).
- **How it is counted:** after every model call, including each line of Check AI,
  the cost is worked out from the `usage` the API reports and the rate card in
  `src/lib/ai-config.ts` (`RATE_CARD`: Haiku 5.5 $0.10/$0.50 per million tokens up
  to a 100K-token prompt and $0.50/$2.50 above; Sonnet 5.5 $2/$10; cache reads
  0.1x and cache writes 1.25x the input price), and recorded in the `AiSpend`
  table in whole micro-dollars. A model the rate card does not price is counted
  at the dearest rate on it, never at zero. A failed call that reports usage is
  recorded; one that reports none is not.
- **The stop:** before every call, if this month's recorded spend has reached the
  budget, the call is not made and the feature says so: "This month's AI budget is
  used up; it starts again on Dec 1, 2026 (UTC)." The month is **UTC**, because
  the bill is the account's, not any club's day. The gate is in one place, `post`
  in `src/lib/services/claude.ts`, which every job and Check AI go through.
- **It is not exact to the cent:** the check happens before a call and the cost is
  known only after it, so calls already in flight when the line is crossed still
  finish — at these jobs' token ceilings, a few cents at most.
- **The Anthropic console's own spend limit is a separate HARD cap** (Console →
  Settings → Limits) that the owner sets there. Set it a little above the in-app
  budget: the app stops itself first, and the console's cap catches anything the
  app's record missed.
- It is a record and a stop, nothing else: the app never pays, tops up or moves
  any money.

## To switch accounts

1. In the new account's console, create an API key, and **set a monthly spend
   limit** on the account (Console → Settings → Limits) so a fault cannot run up
   a bill.
2. In Vercel, replace `ANTHROPIC_API_KEY` (Production and Preview) with the new
   key, and set `AI_ACCOUNT_LABEL` to the new account's name.
3. Redeploy (Vercel reads environment values at deploy time).
4. Open `/owner`. Check the AI card shows the new label and says On, then
   **press Check AI**. It sends each job one tiny real request (a fixed sentence,
   and a drawn red square for card reading; never a real card or person). For
   each job it shows OK with the model and the time taken, or the API's own
   status and error message. It never shows the key. You can press it once a
   minute. Every line should say OK before you go on.
5. Revoke the old key in the old account.

Locally: change the same two lines in `.env.local` and restart the dev server.

## Moving one job to another provider later

Every job runs on the one Anthropic account today, so one key switches them all.
Provider and model are set per job in `JOBS`, so moving one job is a setting
there, plus, once, an entry in `PROVIDERS` (its `keyVariable`, `labelVariable`,
`readsImages`) and a caller for that provider's API. A provider the build cannot
call (`callable: false`) leaves its jobs off, and they say so.
