# Shell and editing traps

> Moved out of `CLAUDE.md` on 2026-10-24, verbatim, so that the file every session reads stays short. Read this when your task touches: editing files via PowerShell, Git Bash or `node -e`; a refusing rebase. Index: `CLAUDE.md`.

**The READ is what corrupts, so no output encoding saves you.** `Get-Content -Raw` decodes with
the system ANSI codepage, not UTF-8, so an em-dash (`E2 80 94`) comes back as three CP1252
characters before anything is written. Round-tripping through
`[System.IO.File]::WriteAllText` — which writes correct, BOM-free UTF-8 — then stores those
three characters faithfully, and the file is double-encoded. On 2026-09-05 that took out three
files and reached three PUSHED branches, because the rule above names `Set-Content` and this is
not `Set-Content`.

The trap is that it looks like the careful way to do it. `$o = Get-Content $f -Raw` … edit …
`WriteAllText($f, $o)` is the obvious shape for "mutate a file, run the test, put it back",
which is exactly the mutation-testing loop this file asks for on every change. Use `git` for
that instead — `git checkout -- <file>` restores far more reliably than a saved copy, and it
cannot re-encode anything.

So: **PowerShell may READ a source file for inspection and never write one back.**
`Select-String`, `Get-Content | Select-Object` and friends are fine; any path where bytes leave
PowerShell and return is not, whatever function does the writing.

Detecting it: `git diff --stat` shows the whole file changed, and
`([regex]::Matches([System.IO.File]::ReadAllText($f),'â€')).Count` is non-zero. Note that
PowerShell's own console rendering shows `â€` for a correct em-dash too, so the terminal is not
evidence either way — check a file with that command, or `git show HEAD:<file>`, before
believing there is a problem or that there isn't.

**A `node -e` string replace on a checked-out file usually does nothing, and says so quietly.**
Files land here with CRLF — git converts on checkout — so a replacement written with `\n` in the
search string matches nothing, `writeFileSync` writes the file back unchanged, and the command
exits 0.

That is a nuisance when editing and a LIE when mutating. The mutation-testing loop this file asks
for on every change is "break it, watch the test go red, put it back", and a replace that silently
did not apply produces a GREEN run that reads exactly like "the test cannot catch this" — the one
outcome that makes you weaken a good test. It happened three times on 2026-09-07, once on a
freshly written guard that was in fact perfectly capable of failing.

So when a script edits a file:

  - **print whether it changed** — `console.log(before !== after)` — and read it;
  - **verify with `grep -c` before AND after**, not just the exit code;
  - or, better, use the Edit tool, which fails loudly when its target is not found.

A mutation you did not confirm applied is not evidence about anything.

**AND THE SAME TRAP EATS REGEX ESCAPES, which is worse, because the result is
a script that runs and lies.** The note above is about `\n` against CRLF. On
2026-09-13 the same shell swallowed three more, each failing differently:

- `\\b` inside a heredoc reached node as `\b`, which in a JS string is a
  BACKSPACE. A sweep of 211 server actions for callers reported **211 of 211
  unreachable** — every regex was `<0x08>name<0x08>` and matched nothing.
  Believed for about a minute, because "nothing is called" is a plausible
  answer to a question you have not asked before.
- The same `\b`, written into a TEST FILE, put literal `0x08` bytes in the
  source. `/\bon\s+at\b/` became `/<0x08>ons+at<0x08>/` — still a valid regex,
  still passing, asserting nothing. It would have shipped as a green dud.
- `\s` and `\(` were stripped outright, producing
  `new RegExp("...(\"...")` — an unclosed group, which at least throws.

Detect the middle one with a control-byte scan; it is invisible in a diff:

```bash
node -e 'const s=require("fs").readFileSync(process.argv[1],"utf8");console.log([...s].filter(c=>c.charCodeAt(0)<9||(c.charCodeAt(0)>13&&c.charCodeAt(0)<32)).length)' <file>
```

The rule that actually works: **anything containing a backslash goes through
the Write or Edit tool, never through a heredoc or `node -e`.** Where a script
must match text, prefer `indexOf` / `includes` / `split` — none of them need an
escape, and a sweep built from them cannot be silently disarmed.

**A REBASE CAN REFUSE OVER A FILE THAT HAS NOT CHANGED, and `git diff` shows
you nothing.** Measured 2026-09-15 in a worktree, during the `Group` migration
work. `git rebase` refused with:

```
error: cannot rebase: You have unstaged changes.
```

naming `prisma/migrations/migration_lock.toml` — a file whose content was
BYTE-IDENTICAL to HEAD. `git diff` showed **no hunks at all**. `prisma migrate`
had rewritten it with different line endings, so the working-tree blob and the
index blob differ while the text does not.

That last part is the whole reason it costs an hour rather than a minute. Every
instinct says a refusal means there is a change to find, and there is nothing to
find — so the time goes on looking for a diff that does not exist rather than on
the line endings.

**Both of the obvious escapes are closed here**, which is worth knowing before
reaching for either:

- `git stash` is hard rule 5 — the stash stack is shared with the main checkout
  and every other worktree;
- `git checkout -- <file>` is the command that on 2026-09-05 took a day's
  uncommitted work along with the experiment it was meant to undo.

The fix is:

```bash
git add --renormalize prisma/migrations/migration_lock.toml
```

It re-stages the file through the repository's EOL rules; when the normalized
blobs match — which is the whole point, since the content never changed — the
entry collapses to nothing and the rebase proceeds. Non-destructive, touches no
other file, and it does not go near the shared stash stack.

Read the shape rather than the filename: **any tool that rewrites a file it
also owns** can do this. Prisma is simply the one that did.
