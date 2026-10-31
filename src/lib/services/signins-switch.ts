import "server-only";
import { cache } from "react";
import { prisma } from "../db";
import { holdRule, maySignIn, signInsClosed, type HoldRule } from "../sign-in-gate";
import { launchStateOf, type LaunchState } from "../go-live";

/**
 * THE SWITCH ON THE OWNER CONSOLE (Ajay, 2026-10-21: "make sure its an easy control which we can
 * flip back to allow signup / signin"; 2026-10-23: "I just need one switch to say let's go live").
 *
 * The hold itself is `signInsClosed` — production, with an owner to let through. Until 2026-10-21
 * the only way to open it was a Vercel variable and a redeploy. Now one press on /owner — Go live —
 * opens accounts to everybody and turns every held page to its live words at once (`go-live.ts`
 * lists them), and one press holds it all again. It is a row, not a build:
 * `PlatformSetting` "signins" = "open" | "held".
 *
 * It can only OPEN what the hold shut; it never shuts anything that is open (dev, CI, previews).
 * `SIGNINS=open` in Vercel still opens it too, for whoever prefers that route.
 *
 * If the row cannot be read, the hold stands: a database fault must not open the front door.
 */
export const SIGNINS_KEY = "signins";

/** The switch's row, read once per request: what it says and when it was last pressed. */
const switchRow = cache(async (): Promise<{ value: string; updatedAt: Date } | null> => {
  try {
    return await prisma.platformSetting.findUnique({ where: { key: SIGNINS_KEY }, select: { value: true, updatedAt: true } });
  } catch {
    return null;
  }
});

/** Has the owner opened accounts from the console? Read once per request. */
export const signInsOpenedOnConsole = cache(async (): Promise<boolean> => (await switchRow())?.value === "open");

/** Is the front door held right now — the deploy's rule, unless the console has opened it? */
export async function signInsHeld(): Promise<boolean> {
  if (!signInsClosed()) return false;
  return !(await signInsOpenedOnConsole());
}

/** THE ONE ANSWER every held page asks: "held" or "live". */
export async function launchState(): Promise<LaunchState> {
  return launchStateOf(await signInsHeld());
}

/** May this address be signed in (or keep a session) right now? */
export async function maySignInNow(email: string | null | undefined): Promise<boolean> {
  if (!(await signInsHeld())) return true;
  return maySignIn(email);
}

/** Everything the owner card says about the switch. */
export interface LaunchSwitch {
  /** What every page is showing now. */
  state: LaunchState;
  /** What the switch itself says — "live" only once it has been pressed to Go live. */
  switchSays: LaunchState;
  /** When it was last pressed to Go live, or null. */
  liveSince: Date | null;
  /** Whether this deployment lets the switch decide, and if not, why. */
  rule: HoldRule;
}

export async function launchSwitch(): Promise<LaunchSwitch> {
  const row = await switchRow();
  const switchSays: LaunchState = row?.value === "open" ? "live" : "held";
  return { state: await launchState(), switchSays, liveSince: switchSays === "live" ? row!.updatedAt : null, rule: holdRule() };
}

/** The owner's press. Returns what the switch now says. */
export async function setSignInsOpen(open: boolean): Promise<"open" | "held"> {
  const value = open ? "open" : "held";
  await prisma.platformSetting.upsert({ where: { key: SIGNINS_KEY }, update: { value }, create: { key: SIGNINS_KEY, value } });
  return value;
}
