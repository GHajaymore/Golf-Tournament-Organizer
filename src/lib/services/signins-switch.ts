import "server-only";
import { cache } from "react";
import { prisma } from "../db";
import { maySignIn, signInsClosed } from "../sign-in-gate";

/**
 * THE SWITCH ON THE OWNER CONSOLE (Ajay, 2026-10-21: "make sure its an easy control which we can
 * flip back to allow signup / signin").
 *
 * The hold itself is `signInsClosed` — production, with an owner to let through. Until this day
 * the only way to open it was a Vercel variable and a redeploy. Now one press on /owner opens
 * accounts to everybody at once, and one press holds them again. It is a row, not a build:
 * `PlatformSetting` "signins" = "open" | "held".
 *
 * It can only OPEN what the hold shut; it never shuts anything that is open (dev, CI, previews).
 * `SIGNINS=open` in Vercel still opens it too, for whoever prefers that route.
 *
 * If the row cannot be read, the hold stands: a database fault must not open the front door.
 */
export const SIGNINS_KEY = "signins";

/** Has the owner opened accounts from the console? Read once per request. */
export const signInsOpenedOnConsole = cache(async (): Promise<boolean> => {
  try {
    const row = await prisma.platformSetting.findUnique({ where: { key: SIGNINS_KEY } });
    return row?.value === "open";
  } catch {
    return false;
  }
});

/** Is the front door held right now — the deploy's rule, unless the console has opened it? */
export async function signInsHeld(): Promise<boolean> {
  if (!signInsClosed()) return false;
  return !(await signInsOpenedOnConsole());
}

/** May this address be signed in (or keep a session) right now? */
export async function maySignInNow(email: string | null | undefined): Promise<boolean> {
  if (!(await signInsHeld())) return true;
  return maySignIn(email);
}

/** The owner's press. Returns what the switch now says. */
export async function setSignInsOpen(open: boolean): Promise<"open" | "held"> {
  const value = open ? "open" : "held";
  await prisma.platformSetting.upsert({ where: { key: SIGNINS_KEY }, update: { value }, create: { key: SIGNINS_KEY, value } });
  return value;
}
