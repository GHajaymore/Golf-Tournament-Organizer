/**
 * THE EVENT SCREEN'S ONE SAVE, AS A PLAN (R3, from the review): what one press sends, in what order, and what it says
 * when it stops. In a module with NO directive, so the screen runs it and a test can pin it.
 *
 * The press sends only what is left to keep, in a fixed order, and stops at the first failure, so a retry finishes
 * exactly what remains and a change to the tees alone never saves the details again:
 *
 *   open    details (`saveEvent`), then the tees, then who may play other tees.
 *   locked  the days (`setTournamentDates`), then the tees, then the policy. NEVER `saveEvent`: the details are
 *           locked, and `saveEvent` and `setTournamentDates` are never both in one press.
 */
export type SaveStep = "saveEvent" | "setTournamentDates" | "tee" | "policy";

export function eventSavePlan(p: {
  locked: boolean;
  /** Anything differs from what is stored (the days included). Read only while open. */
  details: boolean;
  /** The days (or tentative) differ from what is stored. Read only while locked. */
  dates: boolean;
  tee: boolean;
  policy: boolean;
}): SaveStep[] {
  const plan: SaveStep[] = [];
  if (p.locked) {
    if (p.dates) plan.push("setTournamentDates");
  } else if (p.details) {
    plan.push("saveEvent");
  }
  if (p.tee) plan.push("tee");
  if (p.policy) plan.push("policy");
  return plan;
}

const KEPT: Record<SaveStep, (locked: boolean) => string> = {
  saveEvent: () => "The details",
  setTournamentDates: () => "The days",
  tee: () => "The tees",
  policy: () => "Who may play other tees",
};

const NOT_KEPT: Record<SaveStep, string> = {
  saveEvent: "The details were not",
  setTournamentDates: "The days were not",
  tee: "The tees were not",
  policy: "Who may play other tees was not",
};

/**
 * WHAT TO SAY WHEN THE PRESS STOPS: plainly, what was kept and what was not. `reason` is the server's own sentence, or
 * null when the call threw (a dropped connection, a server error), which is said in words and never reaches the error page.
 */
export function failureWords(done: readonly SaveStep[], failed: SaveStep, locked: boolean, reason: string | null): string {
  if (done.length === 0) return reason ?? "That didn't reach us. Press Save to try again.";
  const names = done.map((s) => KEPT[s](locked));
  const saved = names.length === 1 ? `${names[0]} ${done[0] === "policy" ? "was" : "were"} saved.` : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1].toLowerCase()} were saved.`;
  const why = reason ?? "that didn't reach us.";
  return `${saved} ${NOT_KEPT[failed]}: ${why.replace(/\.$/, "")}. Press Save to finish.`;
}

export type StepResult = { ok: boolean; error?: string };

/**
 * RUNS THE PLAN. A refusal returns its words; a throw (a dropped connection, a server error) has none. NEITHER escapes:
 * both come back as the sentence to say beside Save, with what was kept and what was not, and `done` says which steps
 * the screen may treat as kept. `run` does one step's call and moves the screen's own "kept" state when it succeeds.
 */
export async function runSavePlan(
  plan: readonly SaveStep[],
  run: (step: SaveStep) => Promise<StepResult>,
  locked: boolean,
): Promise<{ done: SaveStep[]; error: string | null }> {
  const done: SaveStep[] = [];
  for (const step of plan) {
    let result: StepResult;
    try {
      result = await run(step);
    } catch {
      return { done, error: failureWords(done, step, locked, null) };
    }
    if (!result.ok) return { done, error: failureWords(done, step, locked, result.error ?? "That didn't save.") };
    done.push(step);
  }
  return { done, error: null };
}

/**
 * WHAT "PLAYERS & SCORING" SENDS (R3). While Event draws the tees' policy (`teesHere` false on the old card), the old card
 * must not write it back from its own stale copy: the policy is left out of the payload (`saveTournamentSettings` merges a
 * `Partial`, so the stored value stands) and out of its idea of "unsaved".
 */
export function playSettingsToSave<T extends { teePolicy: string }>(form: T, teesHere: boolean): Partial<T> {
  if (teesHere) return form;
  const rest = { ...form } as Partial<T>;
  delete rest.teePolicy;
  return rest;
}

export function playSettingsDirty<T extends { teePolicy: string }>(form: T, stored: T, teesHere: boolean): boolean {
  return (Object.keys(form) as (keyof T)[]).some((k) => (k === "teePolicy" && !teesHere ? false : form[k] !== stored[k]));
}
