import { describe, it, expect } from "vitest";
import { readSource } from "./source";

/**
 * A GUEST IS NEVER SHOWN A CONTROL THAT CANNOT WORK (J39/J40 PR 2, G2).
 *
 * PR 1 drew the tee-time alerts toggle on a guest's Today, and its one press,
 * `savePushSubscription`, asked `getSession()` and answered "Not signed in."
 * to every guest. So a toggle is drawn for a guest only where the action it
 * presses admits the guest viewer.
 */

const today = readSource("src", "app", "(player)", "me", "page.tsx");
const pushActions = readSource("src", "app", "actions", "push.ts");
const saveBody = pushActions.slice(pushActions.indexOf("export async function savePushSubscription("));
const saveAdmitsAGuest = saveBody.slice(0, saveBody.indexOf("\nexport ") > 0 ? saveBody.indexOf("\nexport ") : undefined).includes("getPlayerViewer(");

describe("the tee-time alerts toggle on a guest's Today", () => {
  const toggles = today.match(/[^\n]*<PushToggle\b[^\n]*/g) ?? [];

  it("Today draws the toggle", () => {
    expect(toggles.length).toBeGreaterThan(0);
  });

  it("is drawn for a guest only when its save admits a guest", () => {
    if (saveAdmitsAGuest) return;
    for (const t of toggles) expect(t, "a guest is shown a toggle whose press answers 'Not signed in.'").toContain("!session.guest &&");
  });

  it("CONTROL: an unguarded toggle beside a session-only save is seen", () => {
    const line = "          <PushToggle />";
    expect(line).not.toContain("!session.guest &&");
    expect("const session = await getSession();".includes("getPlayerViewer(")).toBe(false);
  });
});
