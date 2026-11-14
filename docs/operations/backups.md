# Production backups: how they work, and how to restore one

Owner: Operations Lead. Built 2026-11-14 (B21) from the Operations Lead's design. This repository is
public: no secret, address or name appears here; settings are named, never given.

**Why this exists.** Production is Prisma Postgres on the Free plan, which keeps **no backup of any
kind**. A bad migration, a wrong delete, a hand-run SQL write or the loss of the provider were, until
this, permanent. This is a free daily copy, kept outside the database's provider, that only the Owner
can read.

## What runs, and when

| When | What | Where it lives |
|---|---|---|
| Every night, 02:00 UTC (±59 min, Vercel Hobby) | `GET /api/cron/backup` (Vercel Cron, `vercel.json`) takes a full copy | `src/app/api/cron/backup/route.ts` |
| Every hour **on a day a real club is playing** | `backup-event-day.yml` (GitHub) presses `POST /api/backup/run`; the app decides | `src/app/api/backup/run/route.ts` |
| Every hour | `canary.yml` asks `GET /api/backup/status`: is there a copy from the last 30 hours? | `src/app/api/backup/status/route.ts` |

02:00 is an hour before `expire-rounds` (03:00) deletes expired rounds and lapsed archives, so every
night's deletes have a copy from just before them.

**One copy, step by step** (`src/lib/backup/run.ts`):

1. One connection on `DATABASE_URL` — the direct connection Vercel already holds — and one transaction,
   `REPEATABLE READ` and `READ ONLY`. Every table comes from the same instant; nothing can be written.
2. Every table in `src/lib/backup/tables.ts` is read in primary-key order, a page at a time, as
   Postgres's own `row_to_json` — so a column added tomorrow is copied tomorrow.
3. Three tables are **left out on purpose**: `PasswordResetToken`, `EmailCode`, `RateLimitHit` —
   short-lived secrets and counters. A restored database simply asks people for a fresh code.
4. The text is gzipped and sealed (`src/lib/backup/sealed.ts`): a fresh AES-256-GCM key per copy,
   wrapped with RSA-OAEP to the Owner's **public** key (`BACKUP_PUBLIC_KEY`). The private key is never on
   Vercel, GitHub or this repository. A stolen Blob token or a stolen Vercel environment yields ciphertext.
5. Filed in a **private** Vercel Blob store as `backups/YYYY-MM-DD/HHMMSS-daily.thqbak` (or
   `-event-day`) beside a `.manifest.json` (table names, row counts, SHA-256 per table, the migration
   head and the commit — no names), and `backups/latest.json` (the newest manifest again).
6. Old copies are pruned (`src/lib/backup/retention.ts`): everything from the last 48 hours, the newest
   copy of each of the last 14 days, the newest of each Sunday to 35 days. **Nothing older than 35
   days**, and never the newest copy.
7. The answer, which reaches Vercel's logs, is counts: tables, rows, bytes, seconds.

**Who can press it.** Each route refuses anybody without its secret (bearer, compared in constant
time, refused when the secret is missing), and runs only on production's deployment. GitHub holds only
`BACKUP_TRIGGER_SECRET`, which can ask for a copy and ask whether one is recent — **never a database
credential**. The trigger takes a copy only when a real club has a tournament on today in its own time
(the deploy window's `onToday`), and never within 30 minutes of the last copy, so a leaked trigger
cannot run anything up.

## Alerts

- **A copy fails** → reported to Sentry tagged `backup` (when `SENTRY_DSN` is set; scrubbed like every
  report). The Owner's alert rule (below) mails it.
- **No copy is taken at all** (a cron nobody invokes raises nothing) → the hourly canary asks
  `/api/backup/status`, which answers only `{"fresh": true|false}`; `false` fails the canary, and the
  failure email is the alert.
- **The table lists are out of date** (a new table in neither list) or **retention had to shorten**
  (the store is filling) → a Sentry warning tagged `backup`. A unit test (`backup-tables.test.ts`) and
  the restore drill fail before such a change can merge, so this is the belt to their braces.

## What it handles, and what happens past that

Measured on this machine (`sealedExport` against a local Postgres, invented rows): **about 22 MB of
row data a second**; 520 MB of rows sealed to 77 MB in 22 s with the process peaking at 268 MB. Over
the network to Prisma Postgres expect a quarter of that, ~5 MB/s.

| Limit | Where it bites | What happens |
|---|---|---|
| Blob on Hobby: **1 GB**, and the store is BLOCKED for 30 days when over | ~25 MB per sealed copy (≈150–200 MB of rows) is the most that keeps all 35 days | Retention keeps the newest copies under 850 MB and drops the oldest, never the newest two, and **Sentry is told** ("retention was shortened"). Decide then: Prisma Starter's own backups, a paid Blob, or a weekly copy of `CourseCatalog` |
| The export's own limit: **240 s** (Vercel Hobby ends a function at 300 s) | ≈1 GB of rows at network speed | The run fails, **nothing is filed** (no partial copy ever exists), Sentry is told, and the canary goes red within 30 hours |
| The sealed file is held in memory: **256 MB** cap (functions have 2 GB) | ≈1.7 GB of rows | Same: fails loudly, nothing filed |
| Prisma Free: 100k operations a month | about one statement per table per copy, ~70 a copy | ~2,100 a month nightly; an event day's hourly copies add ~70 each |
| Blob operations on Hobby: 2,000 advanced, 10,000 simple a month | 3 puts + 1 list per copy (advanced); 1 head per status check (simple) | ~120 advanced a month nightly; ~720 simple for the hourly status |

The first real copy reports the database's size (`/api/cron/backup`'s answer in Vercel's logs, and the
manifest's `plaintextBytes`): record it on the board.

**What it does not protect against:** the loss of the Vercel account itself (the copies are in its
Blob store). The Owner's monthly offline copy (below) closes that.

## The Owner's steps, once (about 15 minutes, all free)

Nothing runs until these are done; until then the cron answers 500 ("not configured", by name only, to
Sentry) and the canary's and trigger's steps say "SKIPPED".

1. **Connect a Blob store.** Vercel → the TourneyHQ project → **Storage** → if a Blob store is already
   listed, use it; otherwise **Create Database** → **Blob** → name it `tourneyhq-backups` → choose
   **Private** access → **Connect** to the project for the **Production** environment only. That creates
   `BLOB_READ_WRITE_TOKEN` in Production.
2. **Make the key pair on your own machine**, from your TourneyHQ checkout:

   ```powershell
   npx tsx scripts/backup-keygen.ts --out "$HOME\Documents\thq-backup-private.pem"
   ```

   It writes the **private** key to that file (it refuses a path inside the repository) and prints the
   **public** key and its key id.
   - Copy the private key file's whole text into your password manager **and** one offline place (a USB
     stick kept at home). **If it is lost, no backup can ever be read, by anybody.** Then delete the file.
   - The public key is not a secret.
3. **Set the variables in Vercel** (Settings → Environment Variables, **Production only**), by name:
   - `BACKUP_PUBLIC_KEY` — the printed public key, all of it, BEGIN and END lines included.
   - `BACKUP_TRIGGER_SECRET` — 64 random hex characters. Make one with
     `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Shorter than 32 is refused.
   - (`DATABASE_URL`, `CRON_SECRET` and `SENTRY_DSN` are already there.)
4. **Redeploy** production (variables reach new deployments only), then Settings → **Cron Jobs** →
   `/api/cron/backup` → **Run**. Its log line should read `{"ok":true,"tables":61,…}`.
5. **Give GitHub the trigger.** Repository → Settings → Secrets and variables → Actions → New secret
   `BACKUP_TRIGGER_SECRET`, the same value as step 3. (Do this after step 4, or the canary goes red until
   the first copy exists.)
6. **Sentry alert rule**: Alerts → Create → Issues → "a new issue is created" with the tag `backup`
   (any value) → email you.
7. **Run the drill once** (next section) on the first real copy.
8. **Every month, on the 1st:** download the newest `.thqbak` and keep it on your own drive. It is
   ciphertext, safe at rest, and it is the copy that survives losing the Vercel account.

**Your call (public text):** `/privacy` should say that deleted data stays in encrypted backups for up
to 35 days. Nothing here changes that page.

## The restore drill (Drill B) — on your machine, counts only, ~15 minutes, then every quarter

Nothing here touches production: the copy goes into a throwaway database on **your** local Postgres,
is checked, and is dropped.

1. Download the newest `backups/…-daily.thqbak`: Vercel → Storage → the Blob store → Browser →
   `backups/` → the newest day → the file → Download. If the browser offers no download for a private
   file, use `vercel blob get <pathname>` from a linked checkout (`vercel blob get --help` says where it
   saves). Keep it outside the repository folder.
2. From your checkout, at the commit the manifest names (usually `main`):

   ```powershell
   Get-Clipboard | npx tsx scripts/backup-restore.ts --verify "$HOME\Downloads\<file>.thqbak" --key -
   ```

   (Copy the private key from your password manager first; `--key -` reads it from the pipe, so it is
   never written to disk. `--key <file>` also works.)
   It makes `tourneyhq_restore_drill_<time>` on the Postgres in your `.env`'s `DATABASE_URL` (localhost
   only — it refuses anything else; `--server` or `RESTORE_SERVER_URL` to choose), migrates it, loads
   the copy as it streams (plaintext is never written to disk), exports it again and compares, then
   **drops it**.
3. It prints **only** table names, counts, `match`/`MISMATCH` and the time taken — never a row. Pass is
   `every table matches (rows and SHA-256)`. Record the date, the result and the minutes on the board.
4. Clear the clipboard; delete the downloaded file unless it is this month's offline copy.

If it says the backup's schema is not the checkout's, check out the commit it names
(`git checkout <commit>`) and run again.

## A real restore (an incident) — Owner's go only

Restoring is never automatic, and nothing here ever writes to a database that has tables.

- **Rows lost, database fine** (a wrong delete): restore the newest copy from **before** the loss into
  a throwaway (the drill command, but stop before the drop: use `--into` with an empty local database
  you made), then copy back only the lost rows with a reviewed script. That is a production write: the
  Owner's go, and it never overwrites the day's newer rows.
- **Database lost or corrupt**: make a new, empty Prisma Postgres database; then from a checkout of the
  backup's commit:

  ```powershell
  npx tsx scripts/backup-restore.ts --into "$env:RESTORE_INTO" "<file>.thqbak" --key -
  ```

  with the new database's **direct** string in a variable you name yourself (`RESTORE_INTO`, never
  `DATABASE_URL`). It refuses a database that has any table, migrates it, loads, and prints the same
  check. Then point Vercel's `DATABASE_URL` / `PRISMA_DATABASE_URL` at the new database (marketplace
  strings cannot be re-scoped: `docs/claude/deploy-history.md`), redeploy, and re-key the day from the
  paper cards and the phones' held cards.
- Expected times: 15–30 minutes to restore; 1–2 hours to put production back on it.

## How it is tested (no production, ever)

- `backup-restore-drill.audit.test.ts` (**Drill A**, in CI's audit job): migrates a throwaway database,
  invents three rows in **every** table from the column types (tabs, newlines, quotes, emoji, U+2028,
  bigints past 2^53, NULLs, arrays, JSON), exports it exactly as the cron does, restores it with the
  owner's command, and requires every table's row count **and** SHA-256 to match, the migrations up to
  date, and the left-out tables empty. Controls: a flipped byte, the wrong key and a cut-short file are
  each refused with nothing loaded; a table emptied or a row changed after the restore is named by the
  check; a write inside the export's transaction is refused; a row written during the export is not in it.
- `backup-sealed.test.ts`, `backup-load.test.ts`, `backup-retention.test.ts`, `backup-tables.test.ts`,
  `backup-blob-store.test.ts`, `backup-routes.test.ts`: the envelope, the loader's refusals, retention,
  the table lists against the schema, the Blob calls, and the three doors.
