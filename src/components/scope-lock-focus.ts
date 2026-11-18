/**
 * WHERE A REFUSED PRESS ENDS: AT THE WAY OUT (state machine PR 9b, design §4f; test plan B20).
 *
 * A press refused by a scope's lock (`refuseIfLocked`) was drawn on a page from before the lock,
 * and `useCaughtUp` redraws the screen so the banner arrives. After 9b a tournament that held
 * the retired blanket unlock meets that lock for the first time, and the banner's button — Make
 * a committee correction, with the refused part already chosen — is the way on. So the screen
 * does not leave the person looking at a sentence that names a button somewhere above them:
 * focus moves to the banner (`tabIndex={-1}`, so a screen reader reads its words) and it is
 * scrolled into view, on a phone too.
 *
 * A BEAT FIRST. The refusal is said beside the press (CLAUDE.md: "a refusal is said where the
 * press was") and is read there; the page moves to the way out no sooner than `notBeforeMs`
 * after the press was answered, and only once the banner is drawn — it arrives with the redraw.
 * A screen that draws none (Clear scores on Score entry draws its button beside the control) is
 * left where it is.
 *
 * Its own module, so `useAction` (in nearly every client screen) does not import the banner and,
 * through it, the correction's server actions.
 */
export const SCOPE_LOCK_BANNER_ID = "scope-lock-banner";

export function focusScopeLockBanner({ notBeforeMs = 1200, waitMs = 10_000 }: { notBeforeMs?: number; waitMs?: number } = {}): void {
  if (typeof document === "undefined") return;
  const answeredAt = Date.now();
  const watch: { observer: MutationObserver | null; giveUp: number | null; done: boolean } = { observer: null, giveUp: null, done: false };

  const moveThere = () => {
    // Asked again: the redraw may have put a new element in its place meanwhile.
    const banner = document.getElementById(SCOPE_LOCK_BANNER_ID);
    if (!banner) return;
    banner.focus({ preventScroll: true });
    banner.scrollIntoView({ block: "start", behavior: "auto" });
  };

  const whenDrawn = () => {
    if (watch.done || !document.getElementById(SCOPE_LOCK_BANNER_ID)) return;
    watch.done = true;
    watch.observer?.disconnect();
    if (watch.giveUp !== null) window.clearTimeout(watch.giveUp);
    window.setTimeout(moveThere, Math.max(0, answeredAt + notBeforeMs - Date.now()));
  };

  watch.observer = new MutationObserver(whenDrawn);
  watch.observer.observe(document.body, { childList: true, subtree: true });
  watch.giveUp = window.setTimeout(() => watch.observer?.disconnect(), waitMs);
  // Drawn already (another of this screen's parts was locked): the redraw keeps the element.
  whenDrawn();
}
