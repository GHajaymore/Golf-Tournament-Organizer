import { expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { hashEmailCode } from "../src/lib/domain/email-code-hash";

/**
 * THE EMAILED CODE, TYPED AS THE PERSON WOULD (2026-10-21).
 *
 * Creating an account, claiming an invited address, or signing in on an
 * address nobody has proved now asks for a six-digit code emailed to it, and
 * nobody is signed in until it is typed back (`services/email-code.ts`). The
 * e2e server has no mail provider, so the code it made is in its own log and
 * nowhere a spec can read. This sets a KNOWN code on the newest unused code
 * row for that address — the same stored shape as the app's
 * (`hashEmailCode`: sha256 of the user's id and the code) — and types it into
 * the panel, so the app's own check, browser binding and attempt count are
 * all still the ones that decide.
 *
 * One helper for every spec that signs up or claims through the form: when
 * the step changes, it changes here.
 */

export const KNOWN_CODE = "246810";

/** The code box, on whichever panel turned into the code step. */
export const codeBox = (page: Page) => page.getByLabel("6-digit code").locator("visible=true").first();

/** Put a code we know on the newest code still out for this address. */
export async function setKnownCode(email: string, code: string = KNOWN_CODE): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findUniqueOrThrow({ where: { email: email.trim().toLowerCase() }, select: { id: true } });
    const row = await prisma.emailCode.findFirst({
      where: { userId: user.id, usedAt: null },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (!row) throw new Error(`no code is out for ${email} — the panel asked for one the server never made`);
    await prisma.emailCode.update({ where: { id: row.id }, data: { codeHash: hashEmailCode(user.id, code) } });
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Wait for "Enter your code" (or "Confirm it's you"), set a known code, type
 * it and press Confirm email. Where the person goes next is the caller's to
 * assert, as it was before the step existed.
 */
export async function verifyByCode(page: Page, email: string): Promise<void> {
  await expect(codeBox(page), "the panel did not ask for the emailed code").toBeVisible({ timeout: 30_000 });
  await setKnownCode(email);
  await codeBox(page).fill(KNOWN_CODE);
  await page.getByRole("button", { name: "Confirm email" }).locator("visible=true").first().click();
}
