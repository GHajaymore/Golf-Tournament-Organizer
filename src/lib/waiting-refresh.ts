/**
 * THE WAITING SCREEN'S CHECK (J39/J40 PR 3B; C3.1, C3.2). A plain `router.refresh()` of the guest's Today, resolved
 * from their own cookie: it takes NO argument and is no new guest action, so there is no id to tamper with.
 *
 * It runs only while the page is VISIBLE (a phone in a pocket asks nothing), once at once when the page comes back,
 * and every `everyMs` while it stays visible; `stop()` ends it for good (the entry is confirmed or dead, or the screen
 * is gone). Written against a small `Doc` so a test can drive it without a browser.
 */
export interface WaitingDoc {
  visibilityState: string;
  addEventListener(type: "visibilitychange", fn: () => void): void;
  removeEventListener(type: "visibilitychange", fn: () => void): void;
}

export const WAITING_CHECK_MS = 20_000;

export function startWaitingRefresh(deps: {
  doc: WaitingDoc;
  refresh: () => void;
  everyMs?: number;
  setIntervalFn?: (fn: () => void, ms: number) => unknown;
  clearIntervalFn?: (handle: unknown) => void;
}): () => void {
  const every = deps.everyMs ?? WAITING_CHECK_MS;
  const set = deps.setIntervalFn ?? ((fn, ms) => setInterval(fn, ms));
  const clear = deps.clearIntervalFn ?? ((h) => clearInterval(h as ReturnType<typeof setInterval>));
  let handle: unknown = null;
  let stopped = false;

  const visible = () => deps.doc.visibilityState === "visible";
  const begin = () => {
    if (handle === null) handle = set(() => (visible() ? deps.refresh() : undefined), every);
  };
  const end = () => {
    if (handle !== null) {
      clear(handle);
      handle = null;
    }
  };
  const onChange = () => {
    if (stopped) return;
    if (visible()) {
      // Back on the page: one check at once, then the pace.
      deps.refresh();
      begin();
    } else {
      end();
    }
  };

  deps.doc.addEventListener("visibilitychange", onChange);
  if (visible()) begin();

  return () => {
    stopped = true;
    end();
    deps.doc.removeEventListener("visibilitychange", onChange);
  };
}
