import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));
// A stranger presses the switch: no session at all.
vi.mock("@/lib/auth", () => ({ getSession: async () => null }));

import { signInsHeld, maySignInNow, launchState, launchSwitch, SIGNINS_KEY } from "@/lib/services/signins-switch";
import { setAccountsOpen } from "@/app/actions/owner";

/**
 * THE LAUNCH SWITCH, AGAINST REAL ROWS (Ajay, 2026-10-21: "make sure its an easy control which we
 * can flip back to allow signup / signin" … "we need to block everyone").
 *
 * Production's hold is the deploy's rule (`signInsClosed`); the owner console's row can open it and
 * hold it again. This walks both directions with the deploy holding, the safe reading of a missing
 * row, and that nobody but an owner can press it.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const OWNER = "zz-launch-switch-owner@example.invalid";
const STRANGER = "zz-launch-switch-stranger@example.invalid";
let before: string | null = null;
const saved: Record<string, string | undefined> = {};

const set = async (value: string | null) => {
  if (value === null) await prisma.platformSetting.deleteMany({ where: { key: SIGNINS_KEY } });
  else await prisma.platformSetting.upsert({ where: { key: SIGNINS_KEY }, update: { value }, create: { key: SIGNINS_KEY, value } });
};

beforeAll(async () => {
  before = (await prisma.platformSetting.findUnique({ where: { key: SIGNINS_KEY } }))?.value ?? null;
  for (const k of ["VERCEL_ENV", "OWNER_EMAILS", "SIGNINS", "SIGNIN_ALLOW_EMAILS"]) saved[k] = process.env[k];
  // The deploy holds: production, with an owner to let through.
  process.env.VERCEL_ENV = "production";
  process.env.OWNER_EMAILS = OWNER;
  delete process.env.SIGNINS;
  delete process.env.SIGNIN_ALLOW_EMAILS;
});

afterAll(async () => {
  try {
    await set(before);
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await prisma.$disconnect();
  }
});

describe("the launch switch on the owner console", () => {
  it("holds everybody but the owners while no row says otherwise — a missing row is held, not open", async () => {
    await set(null);
    expect(await signInsHeld()).toBe(true);
    expect(await maySignInNow(STRANGER), "a stranger signs in with nothing switched").toBe(false);
    expect(await maySignInNow(OWNER), "the owner is shut out of their own app").toBe(true);
  });

  it("opens to everybody when the console says open, and holds again when it says held", async () => {
    await set("open");
    expect(await signInsHeld(), "the console opened accounts and the door is still held").toBe(false);
    expect(await maySignInNow(STRANGER)).toBe(true);
    await set("held");
    expect(await signInsHeld(), "the console held accounts again and the door stayed open").toBe(true);
    expect(await maySignInNow(STRANGER)).toBe(false);
  });

  it("every held page asks one answer, and the card is told since when it went live", async () => {
    await set(null);
    expect(await launchState()).toBe("held");
    expect(await launchSwitch()).toMatchObject({ state: "held", switchSays: "held", liveSince: null, rule: "holds" });
    const before = Date.now();
    await set("open");
    expect(await launchState()).toBe("live");
    const sw = await launchSwitch();
    expect(sw).toMatchObject({ state: "live", switchSays: "live", rule: "holds" });
    // The row's own time, so "Live since" is when it was pressed and not when the card was read.
    expect(sw.liveSince!.getTime()).toBeGreaterThanOrEqual(before - 5_000);
    expect(sw.liveSince!.getTime()).toBeLessThanOrEqual(Date.now() + 5_000);
  });

  it("SIGNINS=open in the environment is live whatever the row says, and the card is told why", async () => {
    process.env.SIGNINS = "open";
    try {
      await set("held");
      expect(await launchState()).toBe("live");
      expect(await launchSwitch()).toMatchObject({ state: "live", switchSays: "held", rule: "signins-open" });
    } finally {
      delete process.env.SIGNINS;
    }
  });

  it("CONTROL: it never shuts a deployment that does not hold (dev, CI, a preview)", async () => {
    process.env.VERCEL_ENV = "preview";
    try {
      await set("held");
      expect(await signInsHeld()).toBe(false);
    } finally {
      process.env.VERCEL_ENV = "production";
    }
  });

  it("only an owner can press it", async () => {
    await set(null);
    const res = await setAccountsOpen(true);
    expect(res.ok, "somebody with no session opened accounts").toBe(false);
    expect(await prisma.platformSetting.findUnique({ where: { key: SIGNINS_KEY } }), "a refused press wrote the switch").toBeNull();
  });
});
