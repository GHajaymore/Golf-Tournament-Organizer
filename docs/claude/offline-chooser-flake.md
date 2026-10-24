# The offline.spec card-chooser flake

> Moved out of `CLAUDE.md` on 2026-10-24, verbatim, so that the file every session reads stays short. Read this when your task touches: `offline.spec.ts`, the card conflict chooser. Index: `CLAUDE.md`.

**And a THIRD, which is a click that never lands.** `offline.spec.ts:245` — "taking their
card clears the queue without sending anything" — times out on the desktop project trying to
press the card chooser's button:

```
Error: locator.click: Test timeout of 30000ms exceeded.
  - locator resolved to <button ...>Use theirs</button>
  - element is not stable ... element is outside of the viewport
  - <a href="/me/board">…</a> from <nav aria-label="Sections">…</nav> intercepts pointer events
  - element was detached from the DOM, retrying
```

Note what it is NOT: the dialog is found and visible, so this is not a screen that failed to
render, and there is no expected-versus-received anywhere in it. It is the click.

**NOT desktop only**, which this entry claimed for a day. It was written off two desktop
samples where `phone` and `small-phone` passed in the same run, and the obvious reading — a
1280x900 viewport problem — was wrong. It has now been seen on **all three projects**:
`small-phone` on 2026-09-11 and `phone` on 2026-09-12, both with the identical signature, both
passing on a re-run. The viewport is not the variable; do not go looking for a layout fault at
any particular width on the strength of this note.

**It is on `main`**, measured 2026-09-11 rather than assumed: five runs of that spec at the
desktop viewport, three green and two red, across `main` and a branch whose new files nothing
in `src/app` or `src/components` imports.

That last bit is why it is written down. The first sample said branch-fails / main-passes, and
on one sample each that reads exactly like a regression you just introduced — it took two more
runs on `main` to see the coin land the other way. **One run of each is not a comparison.** If
this fails on a change that cannot reach the player card, re-run the same spec on `main` two or
three times before believing it.

Unlike the SEGV, this one may still be worth fixing rather than tolerating — but the reason has
changed with the evidence. It used to read "pointer events intercepted by the section nav at
1280x900, so it may be a real desktop layout fault". Failures at 375px kill that theory: the
section nav and the viewport are both different there and it happens anyway.

What every log DOES share is the sequence `element is not stable` → `outside of the viewport` →
`element was detached from the DOM, retrying`. That is a dialog still animating or re-rendering
under the click, at any width — so the thing to look at is what re-renders the card chooser
after it opens, not where the nav sits.

**Somebody has now looked, and there WAS something re-rendering it** (2026-09-12).
`usePendingCard` ran a `setInterval` every five seconds that called `tick()`
unconditionally — a forced re-render of the whole scoring screen, including the
open chooser — for the life of the page. It did two jobs and in this state
neither applied: `shouldRetry` already refuses a `held` card, and `syncStatus`
reads the clock in exactly one branch, which `held` never reaches. So while the
dialog sat waiting on a person, its subtree re-rendered under their finger every
five seconds.

That is removed — the timer now runs only when `shouldPoll` says a send is
outstanding — and it is the mechanism the log describes. **It is not a confirmed
fix.** The failure is intermittent and was never reproduced on demand, so
"60 consecutive passes of `offline.spec` across all three projects" is evidence
and not proof. If it recurs, the next thing to look at is what else changes
identity under the chooser: the two `CardConflict` call sites in `PlayerCard`
sit at different JSX positions, so a `conflict`/`recovered` flip unmounts one
and mounts the other, which would explain "element was detached from the DOM"
exactly.

**AND THE CHOOSER IS NOT A DIALOG, which everything above this line assumes it
is.** `CardConflict` is a `<section className="card">` rendered INLINE in
`PlayerCard`'s page flow. No backdrop, nothing fixed, not centred — the only
thing making it a dialog is `role="alertdialog"`, which is what
`page.getByRole("alertdialog")` binds to.

That matters for one symptom in particular. A centred overlay cannot BE
"outside of the viewport"; an inline card two thirds of the way down a
scorecard can, and Playwright has to scroll to it before it can click. So the
middle line of that three-line signature is explained by the shape of the
thing, not by animation — which is what the paragraphs above reach for.

Its GEOMETRY is now measured, inside `offline.spec` where it is already open,
and it is clean at 320, 393 and 1280 with a 59-character tournament name. So
"the chooser is too wide" is off the table as a cause; what remains is that it
is inline, in a page that re-renders, at two different JSX positions.

**And that is measured DURING a failure, not merely alongside one.** The
assertion sits immediately before the click. On 2026-09-15 the flake recurred
at `small-phone` with the full signature — and the geometry assertion two lines
above it had just passed. So at the moment the chooser was measured the box was
correct, and the click still could not land: whatever moves it, moves it
between the measurement and the press. That is the strongest evidence yet that
the cause is re-render timing rather than layout, and it is the reason to look
at what changes identity under the chooser rather than at its CSS.

**TWO SUSPECTS ARE NOW ELIMINATED, both of them named above.** Neither was the
cause, and knowing that is worth more than the guesses were:

- **The two call sites.** They were collapsed into ONE `<CardConflict>` fed by
  a `chooser` value on 2026-09-15, so a `conflict`/`recovered` flip can no
  longer unmount one and mount the other. The flake then recurred TWICE in the
  next full run — `phone` and `small-phone` — with `element was detached from
  the DOM` still in both logs. Whatever detaches it, it is not that.
- **The five-second timer.** `shouldPoll` refuses a `held` card, and a conflict
  DOES set `held`: `send` returns `"held"` for a conflict and `setHeld(true)`
  runs before the chooser appears. So the interval is already stopped while
  this chooser is open, and the 2026-09-12 fix cannot be what is still
  re-rendering it.

**AND THEN IT WAS FOUND, and it is in neither the app nor the test.** The order
in every log is the clue that pays off: `not stable` comes FIRST, before
`outside of the viewport`. That is the page still moving when the scroll was
attempted.

`globals.css` sets `html { scroll-behavior: smooth }`, overridden to `auto`
only inside `@media (prefers-reduced-motion: reduce)` — and **Playwright does
not emulate that preference by default**, so every test ran with animated
scrolling. Playwright scrolls an element into view before clicking, then checks
the box is stable across two consecutive animation frames. The chooser sits
~215px below the fold, so every click on it scrolls, and the box was still
animating when it was measured. Sampled per frame after a `scrollIntoView` at
320px:

```
t=0   y=783    t=93  y=669    t=143 y=369
t=27  y=781    t=110 y=574    t=160 y=303
t=60  y=755    t=127 y=460    t=176 y=253
```

114 pixels between two consecutive frames, for about 300ms. With
`contextOptions: { reducedMotion: "reduce" }` in `playwright.config.ts` the
same measurement is a single jump — `t=0 y=783`, `t=14 y=40` — and flat after.

That accounts for every part of it: intermittent because it is a race between a
~300ms animation and a stability check; all three viewports because the
property is on the document; only that test because it is the only click far
enough below the fold to need a real scroll; and `detached from the DOM` on the
retries, which is React re-rendering during the retry window — which is exactly
why the two suspects above looked so plausible. They were downstream of the
scroll, not the cause of it.

**The lesson is the method, not the CSS.** Three hypotheses were argued from
source and all three were wrong. The answer came from instrumenting the gap
between "the chooser is visible" and "the click lands" and sampling the box
every frame — the first thing done to this bug that was a measurement rather
than a guess.

In Playwright 1.62 `reducedMotion` lives on `contextOptions`, NOT among the
`PlaywrightTestOptions` that sit directly on `use` — `colorScheme` does, which
makes it easy to write in the wrong place. Put it at the top level and it is a
type error surfaced by `next build` type-checking the config, not by Playwright.

**AND IT HAS A SECOND SIGNATURE, WHICH IS NOT THE ONE ABOVE.** Everything from
`offline.spec.ts:245` down to here describes a click that cannot LAND on a
chooser that is on screen. On 2026-09-16 the same test failed on `phone` with the
chooser never appearing at all:

```
Error: expect(locator).toBeVisible() failed
  Locator: getByRole('alertdialog')
  Timeout: 20000ms
  Error: element(s) not found
  at e2e/offline.spec.ts:259
```

Read the difference rather than filing it as the same thing: `not stable` /
`outside of the viewport` / `detached` is the scroll race the `reducedMotion`
fix addresses, and this is twenty seconds of nothing. The `reducedMotion` fix
cannot help a dialog that was never rendered.

What it is NOT: a broken chooser. `offline.spec.ts:218` — "a card changed while
you were offline asks instead of overwriting" — opens the same chooser four
tests earlier and PASSED in the same run. So the mechanism works and this
specific test's setup did not produce a conflict that time.

Confirmed intermittent the usual way: green on a re-run of the same commit, on a
branch whose only change was a CI SCRIPT — no app code at all, which is as close
to proof as this gets that it is not the author's change. Worth watching for
whether it is the shared e2e fixture being raced (see
`e2e-fixture-collides-across-worktrees`), because "the conflict never got set
up" is exactly what a wiped fixture looks like from here.

Still not worth `retries`. The reasoning above about hiding a real regression
has not changed. The other
two dialogs in the app are measured in `e2e/dialog.spec.ts`, and
`src/lib/__tests__/dialogs-are-swept.test.ts` pins which of the three is which
kind — so a later change making this one a proper modal would resolve the
scroll-to and should be noticed rather than discovered.
