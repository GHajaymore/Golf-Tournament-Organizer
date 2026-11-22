import type { Page } from "@playwright/test";
import type { PrismaClient } from "@prisma/client";

/**
 * A COMMITTEE CORRECTION OPENED BY A FIXTURE, in the database (state machine PR 9b, test plan
 * F5). Until 9b a spec that needed to press a locked control on a live tournament wrote the
 * blanket flag, which opened every part and said nothing about which part it needed; the flag
 * is no longer read. A spec opens ONE part now, the way `openCorrection` stores it (the scope, a
 * reason, who, and the end of the day), so it says which part it needed and every other part
 * stays shut. Only on a fixture: a tournament whose name starts with the `zz` mark (Hard rule 1).
 * `src/lib/__tests__/correction-fixture.ts` is its twin for the audit suite, held to the real
 * action's row by `the-blanket-unlock-is-not-read.audit.test.ts`.
 */
export async function openCorrectionFor(prisma: PrismaClient, eventId: string, scope: string): Promise<void> {
  const { name } = await prisma.event.findUniqueOrThrow({ where: { id: eventId }, select: { name: true } });
  if (!/^zz/i.test(name.trim())) throw new Error(`“${name}” carries no zz mark: a spec opens a correction only on its own tournament (Hard rule 1).`);
  await prisma.event.update({
    where: { id: eventId },
    data: { correctionScope: scope, correctionReason: "zz spec: a part opened for this walk", correctionBy: "Zz Organizer", correctionUntil: new Date(Date.now() + 6 * 60 * 60 * 1000) },
  });
}

/** Done, as a fixture presses it. */
export async function endCorrectionFor(prisma: PrismaClient, eventId: string): Promise<void> {
  await prisma.event.update({ where: { id: eventId }, data: { correctionScope: null, correctionReason: null, correctionBy: null, correctionUntil: null } });
}

/**
 * OPEN A COMMITTEE CORRECTION as the Organizer would (state machine PR 5b; TD
 * Q2): press the banner's or the dashboard's button, say why, open it. It
 * replaces the one-press "Unlock setup" the specs used to make. `scope` picks
 * the part when the dialog offers more than one (the dashboard); a banner
 * preselects its own.
 */
export const CORRECTION_REASON = "zz spec: correcting a setup mistake";

export async function makeCommitteeCorrection(page: Page, opts: { scope?: string; reason?: string } = {}): Promise<void> {
  await page.getByRole("button", { name: "Make a committee correction" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Make a committee correction" });
  await dialog.waitFor({ state: "visible", timeout: 20_000 });
  if (opts.scope) await dialog.getByLabel("Open which part").selectOption({ label: opts.scope });
  await dialog.getByLabel("Why").fill(opts.reason ?? CORRECTION_REASON);
  await dialog.getByRole("button", { name: "Open it for a correction" }).click();
  await dialog.waitFor({ state: "hidden", timeout: 20_000 });
  await keepFixtureCorrectionsOpen();
}

/** A correction must outlive the walk that opened it by at least this long. */
export const CORRECTION_MIN_LEFT_MS = 10 * 60 * 1000;
/** ...and is given this long when it would not (the same 6 h `openCorrectionFor` gives). */
export const CORRECTION_EXTENSION_MS = 6 * 60 * 60 * 1000;

/**
 * THE CORRECTION'S NEW END, or null when it needs none. The real action ends a correction at the
 * club's midnight (`endOfClubDay`), so one pressed at 23:59:50 lapses ten seconds later and the
 * lock is back mid-test (PR 1202, team-allowance.spec.ts). `now` is TOLD, never read here.
 */
export function correctionEndKeptOpen(until: Date | null, now: Date): Date | null {
  if (!until) return null;
  if (until.getTime() - now.getTime() >= CORRECTION_MIN_LEFT_MS) return null;
  return new Date(now.getTime() + CORRECTION_EXTENSION_MS);
}

/**
 * After the press, push out any zz fixture's correction that would lapse within minutes. One
 * place for every spec that calls `makeCommitteeCorrection`. Only a tournament carrying the zz
 * mark is touched (Hard rule 1).
 */
export async function keepFixtureCorrectionsOpen(now: Date = new Date()): Promise<void> {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.event.findMany({
      where: { name: { startsWith: "zz", mode: "insensitive" }, correctionScope: { not: null }, correctionUntil: { not: null } },
      select: { id: true, correctionUntil: true },
    });
    for (const r of rows) {
      const next = correctionEndKeptOpen(r.correctionUntil, now);
      if (next) await prisma.event.update({ where: { id: r.id }, data: { correctionUntil: next } });
    }
  } finally {
    await prisma.$disconnect();
  }
}
