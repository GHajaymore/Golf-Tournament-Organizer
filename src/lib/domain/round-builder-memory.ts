import { addFormatFor } from "@/lib/domain/round-choices";
import { isStageType } from "@/lib/stage-types";

/**
 * WHAT THE SECRETARY PICKED IN THE ROUND BUILDER, KEPT BEYOND THE PANEL.
 *
 * The builder's kind and format are the panel's own state, so anything that mounts the panel afresh — a refresh
 * that lands as a new tree, a reload — empties them, and the select reads "" with no kind chosen (CI runs
 * 41950657167, 43589900390 and G682: "Format for every round added" read "" after Round robin, Add, Bracket).
 * A pick made a moment ago is the person's, so it is written down as it is made and read back when the panel
 * starts with nothing chosen. It is only a moment: a pick older than `MAX_AGE_MS` is not offered, so nobody
 * meets a kind chosen for them hours ago ("asked, not assumed" still holds).
 *
 * The clock and the store are PASSED IN, so the rule is tested without a browser.
 */
export const MEMORY_KEY = "thq:round-builder";
export const MAX_AGE_MS = 30_000;

export type BuilderPick = { type: string; format: string };

export function remember(store: Pick<Storage, "setItem">, pick: BuilderPick, now: number): void {
  if (!pick.type) return;
  try {
    store.setItem(MEMORY_KEY, JSON.stringify({ type: pick.type, format: pick.format, at: now }));
  } catch {
    // Storage blocked or full: the builder simply works as it did.
  }
}

/** The pick to start from, or null — nothing kept, too old, or no longer a kind the builder offers. */
export function recall(store: Pick<Storage, "getItem">, now: number): BuilderPick | null {
  try {
    const raw = store.getItem(MEMORY_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { type?: unknown; format?: unknown; at?: unknown };
    if (typeof v.type !== "string" || !isStageType(v.type)) return null;
    if (typeof v.at !== "number" || now - v.at < 0 || now - v.at > MAX_AGE_MS) return null;
    return { type: v.type, format: addFormatFor(v.type, typeof v.format === "string" ? v.format : "") };
  } catch {
    return null;
  }
}
