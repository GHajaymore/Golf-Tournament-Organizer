"use client";
import type { ComponentType } from "react";

/**
 * A panel that is loaded the moment somebody opens it, not with the screen.
 *
 * Score entry is used on a phone on the course, often on poor signal, and every
 * kilobyte of the first load is paid there. A panel that sits behind a press
 * (a spreadsheet import, clearing a round, a handicap override) does not need
 * to be in that first load. `next/dynamic` splits it into its own chunk.
 *
 * A chunk that was never fetched cannot be fetched with no signal, and a
 * rejected import makes `next/dynamic` throw to the error boundary, which would
 * turn a press into a crashed screen. So the loader is wrapped: a failed load
 * becomes this notice, in the panel's place, and the rest of the screen is
 * untouched. Every panel loaded this way writes to the server, so with no
 * signal there is nothing it could have done anyway.
 */
function PanelNeedsSignal() {
  return (
    <p className="text-muted" role="status" style={{ margin: 0 }}>
      This part needs a connection. Reload the page when you have signal.
    </p>
  );
}

/**
 * Wrap a dynamic import. `next/dynamic` sits on React.lazy, which remembers a
 * failed load until the page is reloaded, so the import is called again here
 * (a fresh call each time, never one rejected promise reused) before giving up.
 * Giving up shows the notice, which says to reload: a tab left open across a
 * deploy has lost its chunk and only a reload finds the new one.
 */
export async function orNeedsSignal<C extends ComponentType<never>>(load: () => Promise<C>, attempts = 3): Promise<C> {
  for (let i = 0; i < attempts; i++) {
    try {
      return await load();
    } catch {
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  return PanelNeedsSignal as unknown as C;
}

export function PanelLoading() {
  return (
    <p className="text-muted" role="status" style={{ margin: 0 }}>
      Opening…
    </p>
  );
}
