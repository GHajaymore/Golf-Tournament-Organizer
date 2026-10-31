import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * REGISTER INTEREST, AGAINST REAL ROWS (2026-10-21).
 *
 * `registerInterest` is public — no session — so what it keeps, what it sends
 * and what it refuses are asserted against the database: a good answer is a
 * row and a copy to inquiries@; a script's answer (the hidden box) is neither,
 * and is told it worked; a fourth note from one address inside the hour is
 * refused, so a loop on one address is not a loop on our inbox.
 *
 * The email is mocked: a test must never write to the real mailbox.
 */
const prisma = new PrismaClient();
const RUN = Date.now().toString(36);
const EMAIL = `zz-interest-${RUN}@example.invalid`;

const sent: Array<{ to: string; told: string; who: { name: string; club: string; role: string } }> = [];
vi.mock("@/lib/email", () => ({
  sendInterestEmail: async (to: string, told: string, who: { name: string; club: string; role: string }) => {
    sent.push({ to, told, who });
    return { id: `zz-msg-${sent.length}`, status: "sent", detail: "" };
  },
}));

const { registerInterest } = await import("@/app/actions/interest");
const { interestWords } = await import("@/lib/go-live");
const { launchState } = await import("@/lib/services/signins-switch");

const good = { name: "Zz Pat", email: EMAIL, club: "Zz Oakmere GC", role: "secretary", members: "50-150", note: "Thursday draw" };

async function cleanup() {
  await prisma.interestRequest.deleteMany({ where: { email: { startsWith: "zz-interest-" } } });
}

beforeAll(cleanup);
afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("registerInterest", () => {
  it("keeps a good answer, and copies it to inquiries@ with the words a person reads", async () => {
    expect(await registerInterest(good)).toEqual({ ok: true });
    const rows = await prisma.interestRequest.findMany({ where: { email: EMAIL } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "Zz Pat", club: "Zz Oakmere GC", role: "secretary", members: "50-150", note: "Thursday draw" });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("inquiries@tourneyhq.club");
    expect(sent[0].who.role).toBe("Club secretary or manager");
    // What they were promised is the go-live switch's, asked on the server: this deployment's.
    expect(sent[0].told).toBe(interestWords(await launchState()).toldInquiries);
    // Where the copy went is kept on the note, so /owner can say it.
    expect(rows[0]).toMatchObject({ notifyId: "zz-msg-1", notifyStatus: "sent" });
    expect(rows[0].notifyAt).not.toBeNull();
  });

  it("refuses a bad address beside its box, and keeps nothing", async () => {
    const before = await prisma.interestRequest.count({ where: { email: { startsWith: "zz-interest-" } } });
    expect(await registerInterest({ ...good, email: "not an address" })).toMatchObject({ ok: false, field: "email" });
    expect(await prisma.interestRequest.count({ where: { email: { startsWith: "zz-interest-" } } })).toBe(before);
  });

  it("answers a script as if it worked, and keeps and sends nothing", async () => {
    const spamEmail = `zz-interest-spam-${RUN}@example.invalid`;
    const mails = sent.length;
    expect(await registerInterest({ ...good, email: spamEmail, website: "http://spam.example" })).toEqual({ ok: true });
    expect(await prisma.interestRequest.count({ where: { email: spamEmail } })).toBe(0);
    expect(sent.length).toBe(mails);
  });

  it("refuses a fourth note from one address inside the hour, in words that say we have it", async () => {
    expect((await registerInterest(good)).ok).toBe(true);
    expect((await registerInterest(good)).ok).toBe(true);
    const fourth = await registerInterest(good);
    expect(fourth.ok).toBe(false);
    expect(fourth.error).toMatch(/already have your note/);
    expect(await prisma.interestRequest.count({ where: { email: EMAIL } })).toBe(3);
  });
});
