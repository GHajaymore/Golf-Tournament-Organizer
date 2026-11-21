import { describe, it, expect } from "vitest";
import { readSource } from "./source";

/**
 * THE GUEST DOOR MAKES NO SIGN-IN (J39/J40 PR 3B; Security Lead C1.9).
 *
 * A guest who enters themselves on the sign-up link is outside the sign-in hold, like a round code and a player link:
 * they need no email and no account, and the entry they make WAITS for a staff press. That is only true while the door
 * never reaches the code that makes an account or a session, or asks the hold. `registerForEvent` (a member's entry)
 * does some of those things, on purpose, after a proved address; the guest branch must never.
 *
 * Read through `readSource`, so a comment that names a forbidden call cannot satisfy or break it.
 *
 * Break-it (seen red): call `syncPlayerAccount` from `registerAsGuest`.
 */

const FORBIDDEN = ["createSession(", "syncPlayerAccount(", "sendRegistrationEmail(", "getSession(", "maySignInNow(", "signInsHeld(", "launchState(", "sendEmailCode(", "upsertMember("];

/** The calls in `text` that the guest door must never make. */
export function reachesASignIn(text: string): string[] {
  return FORBIDDEN.filter((call) => text.includes(call));
}

const DOOR_FILES = ["src/app/actions/guest-entry.ts", "src/lib/services/guest-entry.ts", "src/lib/domain/guest-entry.ts", "src/lib/guest-code-memory.ts"];

describe("the guest door makes no sign-in", () => {
  it("CONTROL: the sweep sees each forbidden call, and lets a plain guest write through", () => {
    for (const call of FORBIDDEN) expect(reachesASignIn(`await ${call}event.id);`), call).toEqual([call]);
    expect(reachesASignIn("await tx.player.create({ data: { standing: 'guest', status: 'pending' } });")).toEqual([]);
  });

  it("the door's files exist (a renamed file would make the sweep vacuous)", () => {
    for (const f of DOOR_FILES) expect(readSource(f).length, f).toBeGreaterThan(100);
  });

  it("registerAsGuest, its service and its words reach no account, no session, no mail and no hold", () => {
    for (const f of DOOR_FILES) expect(reachesASignIn(readSource(f)), f).toEqual([]);
  });

  it("the guest branch of the member page is the same: the form component calls only the guest actions", () => {
    const form = readSource("src/components/GuestEntryForm.tsx");
    expect(form).toContain("registerAsGuest(");
    expect(reachesASignIn(form)).toEqual([]);
  });
});
