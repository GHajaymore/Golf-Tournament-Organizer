import { afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { registerForEvent, confirmEntryCode, type RegisterResult } from "@/app/actions/register";
import { hashEmailCode } from "@/lib/domain/email-code-hash";
import type { RegistrationForm } from "@/lib/domain/registration-intake";

/**
 * AN ENTRY ON A TOURNAMENT'S PUBLIC LINK, AS THE ENTRANT MAKES IT (2026-11-13).
 *
 * The link no longer enters anybody until the address is proved: `registerForEvent`
 * emails a six-digit code and `confirmEntryCode` takes it back. An audit test about
 * what happens to an entry (its place, its tees, its deadline) presses both, the way
 * `verifyByCode` does in the browser: the mail provider is absent, so a KNOWN code
 * is put on the newest unused code row for the address (the same stored shape as
 * the app's), and the app's own check, browser binding and attempt count decide.
 *
 * The file using this mocks `next/headers` `cookies` with ONE jar, which is the
 * browser: the code belongs to the browser that asked for it.
 */
export const KNOWN_ENTRY_CODE = "135790";

const prisma = new PrismaClient();
const made = new Set<string>();

// The users the entries made (a code needs a row to hang on) go when the file's tests do.
afterAll(async () => {
  try {
    if (made.size) await prisma.user.deleteMany({ where: { email: { in: [...made] } } });
  } finally {
    await prisma.$disconnect();
  }
});

export async function enterOnTheLink(token: string, form: RegistrationForm): Promise<RegisterResult> {
  const asked = await registerForEvent(token, form);
  if (!asked.needsCode) return asked;
  const email = (form.email ?? "").trim().toLowerCase();
  made.add(email);
  const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
  const row = await prisma.emailCode.findFirst({ where: { userId: user.id, usedAt: null }, orderBy: { createdAt: "desc" }, select: { id: true } });
  if (!row) throw new Error(`no code is out for ${email}`);
  await prisma.emailCode.update({ where: { id: row.id }, data: { codeHash: hashEmailCode(user.id, KNOWN_ENTRY_CODE) } });
  return confirmEntryCode(token, email, KNOWN_ENTRY_CODE);
}
