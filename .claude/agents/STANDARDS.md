# The standard every TourneyHQ agent follows

Every agent definition in this folder opens by pointing here, and this file overrides anything in a definition
or a brief's boilerplate that disagrees with it. `CLAUDE.md` still binds you in full; this is the short list of
what every agent, whatever its role, does the same way. Where a standard is enforced, the enforcer is named.

**a. Never wait on CI and never poll GitHub.** No `gh run watch`, no `gh pr checks --watch`, no loop around any
`gh` command. Push and hand back; the main session reads CI centrally (`.qa/reader.txt` in the main checkout,
written by `node scripts/qa/reader.mjs --watch`). Read branches with `git` (`git fetch`, `git log origin/<b>`), not `gh`.
*Why:* one GitHub API budget (5,000 requests an hour) is shared by every agent, and waiting agents spent it.
*Enforced:* `.claude/hooks/guard.mjs` refuses both watch forms.

**b. Know what the open PRs hold before editing.** List the files every open PR touches (one
`gh pr diff <n> --name-only` per PR, or the list the brief gives). Never edit a file another open PR changes
unless the brief says so; stop and report instead.
*Why:* two PRs editing one file collide at merge, and the second round is wasted.

**c. The repository is public: no real names, ever** — not in examples, help text, comments, tests or docs.
Use invented names: `zz-` fixtures, `@example.invalid` addresses.
*Why:* Hard rule 2; a name once pushed cannot be taken back. *Enforced in part:* the guard refuses a commit
holding a real-looking email or phone number; names are on you.

**d. A failure seen even once and not explained is a finding.** Name the test and the cause. Never
"re-ran and it passed".
*Why:* zero retries is the testing panel's rule; an unexplained red is either the app or a flake with a
signature (`docs/claude/ci-failure-signatures.md`), and both must be named.

**e. Prove each new test can fail.** Commit, revert the fix, watch the test go red, restore.
*Why:* a test that cannot fail guards nothing, and reads exactly like one that does.

**f. Help and docs travel with the change** (`CLAUDE.md`, "Help and docs travel with the change").
*Why:* written help is only worth having while it is true.

**g. Hand back in ≤150 words** (or the brief's limit, if shorter): the PR, the head sha, the checks run with
their counts and exit codes, and anything not done. Longer detail goes to the notes file the brief names.
*Why:* the main session reads every hand-back; long ones cost its context and hide what was not done.

**h. No local Playwright, builds or dev servers on the Windows desktop**; CI runs them. tsc, unit tests, lint
and the audit config are fine.
*Why:* Ajay's ruling. *Enforced:* the guard refuses them on Windows.

**i. Commit with explicit paths; never stash, reset or push to `main`** (`CLAUDE.md` hard rules 3–6).
*Why:* the tree is shared and `main` deploys to production. *Enforced:* the guard refuses `git add -A`/`.`,
any `git stash`, a database reset and a push to `main`.

**j. Only the main session merges or pushes a round.** No `gh pr merge`, no merge through the API, no push to
`round/*`, no `merge.sh` or `chain.sh` from an agent or from any other session. Push your `claude/*` branch and hand back.
*Why:* on 14 Nov a separate session merged a PR with every check green but no QA GO line (process ledger row 17).
*Enforced:* the guard refuses them unless the calling session's id is the one in the untracked `.claude/main-session`
of the main checkout, and always from inside a subagent.
*Claiming it:* only a session the owner or the handover has made the main one writes the file — at its start, or when it
takes over after the previous main session has stopped. It writes its OWN id, one line: the folder name above its
scratchpad (`…/<session-id>/scratchpad`), which is also the name of its transcript (`<session-id>.jsonl`). **Never
overwrite an id you did not write to get past a refusal**: that session may still be running; ask it, or the owner.
*Known gaps* (the hook sees only Bash and PowerShell): a merge through an MCP tool or the app's merge button, a
`gh api graphql` merge mutation, and `git push` with no refspec from a checked-out `round/*` branch.

**k. No local absolute paths in the repository** — no `C:\Users\<you>`, `/c/Users/<you>` or profile `AppData`
folders in a definition, doc, test or comment; write paths relative to the repository or as a placeholder.
*Why:* the repository is public and a path names the Windows user (process ledger row 10). *Enforced:* the guard
refuses such a commit, and `src/lib/__tests__/no-local-paths-in-the-repository.test.ts` sweeps every tracked file.
