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

`/owner` shows one AI card: on or off, the label, and the model per job. It never
shows the key or any part of it.

## To switch accounts

1. In the new account's console, create an API key, and **set a monthly spend
   limit** on the account (Console → Settings → Limits) so a fault cannot run up
   a bill.
2. In Vercel, replace `ANTHROPIC_API_KEY` (Production and Preview) with the new
   key, and set `AI_ACCOUNT_LABEL` to the new account's name.
3. Redeploy (Vercel reads environment values at deploy time).
4. Open `/owner` and check the AI card names the new label and says On.
5. Revoke the old key in the old account.

Locally: change the same two lines in `.env.local` and restart the dev server.

## Moving one job to another provider later

Every job runs on the one Anthropic account today, so one key switches them all.
Provider and model are set per job in `JOBS`, so moving one job is a setting
there, plus, once, an entry in `PROVIDERS` (its `keyVariable`, `labelVariable`,
`readsImages`) and a caller for that provider's API. A provider the build cannot
call (`callable: false`) leaves its jobs off, and they say so.
