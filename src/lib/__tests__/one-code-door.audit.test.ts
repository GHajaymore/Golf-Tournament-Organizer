import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";

/**
 * THE ONE DOOR FOR A TYPED CODE, AGAINST REAL ROWS (plan row 4c, simplicity
 * cut 1; design "One code box" §6 audit items 1-6, Security items 1-7).
 *
 * A round code (8) and a guest's personal player link code (12) may be typed
 * into either box; both go through `openAnyCode`. What a guesser, a guest in
 * the "wrong" box and a crafted request would try:
 *
 *   1  a wrong eight costs the client's ROUND budget only, a wrong twelve its
 *      LINK budget only — chosen by shape, and the same answer whichever action
 *      carried it (`openCode`, `openCodeForm`, `claimPlayerSlotForm`)
 *   2  after a twelve, right or wrong, no counter key holds an unkeyed hash of
 *      its first 8 characters or of all 12 (design §2.3: /play cut it to 8)
 *   3  unknown, reissued and codes-off (eight), and unknown, turned off,
 *      replaced and withdrawn (twelve): one answer, `toEqual` each other
 *   4  a right code of each kind leaves the client's count where it was
 *   5  a right personal code typed "at /play" (through `openCode`) holds the
 *      link on this browser and records it, and makes no play session and no
 *      account session (the hold is untouched: no `createSession`)
 *   6  `claimPlayerSlot` handed a real personal code and a real player id is
 *      refused, and writes nothing
 *   7  (PR B) the eight's platform alarm: 300 failures from 300 networks do not
 *      trip it, the 301st trips and reports once; while it stands a network's
 *      13th failure in the window is refused with the one sentence and a right
 *      code inside its twelve still opens; no readable address is one shared bucket
 *
 * Fixtures: `zz-code-door` club, invented names, no addresses, deleted in
 * `finally`. Each case uses a fresh client address so a counting window that
 * outlives one run cannot leak between cases.
 *
 *   npx vitest run --config vitest.audit.config.ts src/lib/__tests__/one-code-door.audit.test.ts
 */

const jar = vi.hoisted(() => new Map<string, string>());
const head = vi.hoisted(() => new Map<string, string>());

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = jar.get(name);
      return value === undefined ? undefined : { name, value };
    },
    getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
  headers: async () => ({ get: (name: string) => head.get(name.toLowerCase()) ?? null }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));

import { ensurePass, rotatePass, revokePass } from "@/lib/services/player-link";
import { openCode, openCodeForm } from "@/app/actions/code-box";
import { claimPlayerSlot, claimPlayerSlotForm } from "@/app/actions/play";
import { clientKeyFor } from "@/lib/rate-limit";
import { CODE_WORDS } from "@/lib/domain/code-shape";
import { generateAccessCode } from "@/lib/codes";

const prisma = new PrismaClient();
const MARK = "zz-code-door";
const PARS = Array.from({ length: 18 }, () => 4);

let eventId = "";
let stageId = "";
let roundCode = "";
let reissuedCode = "";
let offCode = "";
const guests: Record<"live" | "off" | "replaced" | "withdrawn", { id: string; code: string }> = {
  live: { id: "", code: "" },
  off: { id: "", code: "" },
  replaced: { id: "", code: "" },
  withdrawn: { id: "", code: "" },
};
let memberId = "";

const r = () => Math.floor(Math.random() * 250) + 1;
/** A fresh client: a random address in 10/8. */
function newClient(): string {
  const address = `10.${r()}.${r()}.${r()}`;
  head.set("x-forwarded-for", address);
  return address;
}
async function countOf(kind: "round-code-client" | "player-link-client", address: string): Promise<number> {
  const row = await prisma.rateLimitHit.findUnique({ where: { key: clientKeyFor(kind, address, Date.now()) } });
  return row?.count ?? 0;
}
const sha = (s: string) => createHash("sha256").update(s.trim().toLowerCase()).digest("hex");
const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

/** A round code no stage holds, of the right shape. */
async function unusedRoundCode(): Promise<string> {
  for (;;) {
    const code = generateAccessCode();
    if ((await prisma.stage.count({ where: { accessCode: code } })) === 0) return code;
  }
}
async function freshCode(): Promise<string> {
  for (;;) {
    const code = generateAccessCode();
    if (![roundCode, reissuedCode, offCode].includes(code) && (await prisma.stage.count({ where: { accessCode: code } })) === 0) return code;
  }
}

async function cleanUp() {
  await prisma.organization.deleteMany({ where: { name: { startsWith: MARK } } });
}

async function makeEvent(orgId: string, name: string, playerAccess: string) {
  const ev = await prisma.event.create({
    data: {
      name: `${MARK} ${name}`,
      organizationId: orgId,
      status: "live",
      shape: "single",
      format: "stroke",
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      playerAccess,
      shareToken: `${MARK}-${name.replace(/\W/g, "")}-${Date.now()}`,
      customPars: JSON.stringify(PARS),
      customStrokeIndex: JSON.stringify(PARS.map((_, i) => i + 1)),
    },
    select: { id: true },
  });
  const stage = await prisma.stage.create({
    data: { eventId: ev.id, position: 0, type: "Stroke Play Round", format: "Stroke Play", holes: 18, scoringBasis: "gross", accessCode: await freshCode() },
    select: { id: true, accessCode: true },
  });
  return { eventId: ev.id, stageId: stage.id, code: stage.accessCode };
}

let seed = 1;
async function entry(name: string, standing = "") {
  const p = await prisma.player.create({
    data: { eventId, name, email: "", standing, status: "confirmed", handicap: 10, seed: seed++ },
    select: { id: true },
  });
  return p.id;
}

describe("one door for a typed code", () => {
  beforeAll(async () => {
    await cleanUp();
    const club = await prisma.organization.create({ data: { name: `${MARK} Larkfield`, kind: "club", timeZone: "UTC" }, select: { id: true } });
    const main = await makeEvent(club.id, "Spring Outing", "both");
    ({ eventId, stageId, code: roundCode } = main);
    // A round whose code was REISSUED: the old one opens nothing.
    const reissued = await makeEvent(club.id, "Summer Medal", "both");
    reissuedCode = reissued.code;
    await prisma.stage.update({ where: { id: reissued.stageId }, data: { accessCode: await freshCode() } });
    // A tournament that has turned codes OFF since: its code opens nothing.
    offCode = (await makeEvent(club.id, "Autumn Cup", "email")).code;

    memberId = await entry("Esme Fairholt");
    for (const [key, name] of [["live", "Robin Vale"], ["off", "Tobin Quarrie"], ["replaced", "Wren Calloway"], ["withdrawn", "Idris Penmarch"]] as const) {
      const id = await entry(name, "guest");
      const shown = await ensurePass(eventId, id, "Corin Abernethy");
      if (!shown.ok) throw new Error(`the fixture's guest ${name} got no link`);
      guests[key] = { id, code: shown.code };
    }
    await revokePass(eventId, guests.off.id, "Corin Abernethy");
    const replaced = await rotatePass(eventId, guests.replaced.id, "Corin Abernethy");
    if (!replaced.ok) throw new Error("the fixture's link was not replaced");
    await prisma.player.update({ where: { id: guests.withdrawn.id }, data: { status: "withdrawn" } });
  });

  afterAll(async () => {
    try {
      await cleanUp();
    } finally {
      await prisma.$disconnect();
    }
  });

  beforeEach(() => {
    jar.clear();
    head.clear();
  });

  it("1. the budget is chosen by the code's shape, and the answer is the same whichever action carried it", async () => {
    const wrongEight = await unusedRoundCode();
    const wrongTwelve = `${guests.live.code.slice(0, 11)}${guests.live.code.endsWith("Z") ? "Y" : "Z"}`;

    const a = newClient();
    const before8 = [await countOf("round-code-client", a), await countOf("player-link-client", a)];
    const viaBox = await openCode(wrongEight);
    const after8 = [await countOf("round-code-client", a), await countOf("player-link-client", a)];
    expect(after8[0] - before8[0], "a wrong eight costs the round budget").toBe(1);
    expect(after8[1] - before8[1], "a wrong eight costs nothing of the link budget").toBe(0);

    const b = newClient();
    const before12 = [await countOf("round-code-client", b), await countOf("player-link-client", b)];
    const viaBox12 = await openCode(wrongTwelve);
    const after12 = [await countOf("round-code-client", b), await countOf("player-link-client", b)];
    expect(after12[0] - before12[0], "a wrong twelve costs nothing of the round budget").toBe(0);
    expect(after12[1] - before12[1], "a wrong twelve costs the link budget").toBe(1);

    // Whichever action name carried it: the same words.
    newClient();
    const viaForm = await openCodeForm(null, form({ code: wrongEight }));
    const viaClaimForm = await claimPlayerSlotForm(null, form({ code: wrongEight, group: "tee:1" }));
    const viaForm12 = await openCodeForm(null, form({ code: wrongTwelve }));
    const viaClaimForm12 = await claimPlayerSlotForm(null, form({ code: wrongTwelve, group: "tee:1" }));
    expect(viaBox).toEqual({ ok: false, error: CODE_WORDS.opensNothing });
    expect(viaBox12).toEqual(viaBox);
    for (const res of [viaForm, viaClaimForm, viaForm12, viaClaimForm12]) {
      expect(res.ok).toBe(false);
      expect(res.error).toBe(CODE_WORDS.opensNothing);
    }
  });

  it("2. a personal code, right or wrong, is never a per-code key: no unkeyed hash of its first 8 or of all 12", async () => {
    newClient();
    const wrong = `${guests.live.code.slice(0, 11)}${guests.live.code.endsWith("Z") ? "Y" : "Z"}`;
    // Typed as a guest types it at /play: lower case, dashes.
    const dashed = (c: string) => `${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8)}`.toLowerCase();
    expect((await openCode(dashed(wrong))).ok).toBe(false);
    expect((await openCode(dashed(guests.live.code))).ok).toBe(true);
    expect((await openCodeForm(null, form({ code: dashed(wrong) }))).ok).toBe(false);
    // The §2.3 case ON PURPOSE (a fixture's random code has it only about a quarter of the time): a personal
    // code whose first 8 are all round-code symbols — the help's own example, which no pass here holds.
    const roundish = "K7QM2XRA9DTP";
    expect(await openCode(dashed(roundish))).toEqual({ ok: false, error: CODE_WORDS.opensNothing });
    expect((await openCodeForm(null, form({ code: dashed(roundish) }))).ok).toBe(false);
    const keys = (await prisma.rateLimitHit.findMany({ where: { key: { startsWith: "round-code:" } }, select: { key: true } })).map((k) => k.key);
    for (const code of [wrong, guests.live.code, roundish]) {
      for (const secret of [code.slice(0, 8), code]) {
        expect(keys.filter((k) => k.includes(sha(secret))), `a counter holds the hash of ${secret.length} characters of a personal code`).toEqual([]);
      }
    }
    // CONTROL: a round code typed wrong IS keyed by its hash (the per-code limit is the round code's).
    const wrongEight = await unusedRoundCode();
    await openCode(wrongEight);
    const after = (await prisma.rateLimitHit.findMany({ where: { key: { startsWith: "round-code:" } }, select: { key: true } })).map((k) => k.key);
    expect(after.some((k) => k.includes(sha(wrongEight)))).toBe(true);
  });

  it("3. every code of the right shape that opens nothing gets one answer, whatever the reason", async () => {
    const answers: unknown[] = [];
    for (const typed of [await unusedRoundCode(), reissuedCode, offCode]) {
      newClient();
      answers.push(await openCode(typed));
    }
    const unknownTwelve = `${guests.live.code.slice(0, 11)}${guests.live.code.endsWith("Z") ? "Y" : "Z"}`;
    for (const typed of [unknownTwelve, guests.off.code, guests.replaced.code, guests.withdrawn.code]) {
      newClient();
      answers.push(await openCode(typed));
    }
    for (const a of answers) expect(a).toEqual({ ok: false, error: CODE_WORDS.opensNothing });
    // CONTROL: the replaced link's NEW code and the round's code do open.
    newClient();
    expect((await openCode(roundCode)).ok).toBe(true);
  });

  it("4. a right code of each kind gives its attempt back: the client's count is where it was", async () => {
    const a = newClient();
    const round0 = await countOf("round-code-client", a);
    const opened = await openCode(roundCode);
    expect(opened.ok && opened.kind).toBe("round");
    expect(await countOf("round-code-client", a)).toBe(round0);
    const link0 = await countOf("player-link-client", a);
    const link = await openCode(guests.live.code);
    expect(link).toEqual({ ok: true, kind: "player-link", href: "/me" });
    expect(await countOf("player-link-client", a)).toBe(link0);
    // CONTROL: a wrong one in between IS still counted.
    await openCode(`${guests.live.code.slice(0, 11)}${guests.live.code.endsWith("Z") ? "Y" : "Z"}`);
    expect(await countOf("player-link-client", a)).toBe(link0 + 1);
  });

  it("5. a personal code typed at /play holds the link on this browser — and makes no play or account session", async () => {
    newClient();
    const devices = () => prisma.playerPassDevice.count({ where: { pass: { playerId: guests.live.id } } });
    const before = await devices();
    const users = await prisma.user.count();
    const res = await openCode(`${guests.live.code.slice(0, 4)}-${guests.live.code.slice(4, 8)}-${guests.live.code.slice(8)}`.toLowerCase());
    expect(res).toEqual({ ok: true, kind: "player-link", href: "/me" });
    expect(jar.get("ng_guest"), "the link is held on this browser").toBeTruthy();
    expect(jar.get("ng_guest")).not.toContain(guests.live.code);
    expect(jar.has("ng_play"), "a personal code made a play session").toBe(false);
    expect(jar.has("ng_session"), "a personal code made an account session").toBe(false);
    expect(await devices(), "the browser is recorded once").toBe(before + 1);
    expect(await prisma.user.count(), "a User was made").toBe(users);
    // The plain form, with no script: the same door, ending in Today.
    jar.clear();
    newClient();
    const redirected = await openCodeForm(null, form({ code: guests.live.code })).then(
      () => "",
      (e: unknown) => String((e as { digest?: string }).digest ?? e),
    );
    expect(redirected, "the no-script post ends in a redirect to Today").toMatch(/NEXT_REDIRECT.*\/me/);
    expect(jar.get("ng_guest")).toBeTruthy();
    expect(jar.has("ng_play")).toBe(false);
  });

  it("6. the round's second step refuses a personal code, with a real player, and writes nothing", async () => {
    newClient();
    const sessions = await prisma.scoringKeeper.count({ where: { stageId } });
    const res = await claimPlayerSlot(guests.live.code, guests.live.id);
    expect(res).toEqual({ ok: false, error: CODE_WORDS.opensNothing });
    const res2 = await claimPlayerSlot(guests.live.code, memberId);
    expect(res2).toEqual({ ok: false, error: CODE_WORDS.opensNothing });
    expect(jar.has("ng_play"), "a personal code started a play session").toBe(false);
    expect(jar.has("ng_guest"), "the second step opened the link").toBe(false);
    expect(await prisma.scoringKeeper.count({ where: { stageId } })).toBe(sessions);
    // CONTROL: the round's own code and the same member DO start the session.
    newClient();
    expect(await claimPlayerSlot(roundCode, memberId)).toEqual({ ok: true });
    expect(jar.has("ng_play")).toBe(true);
  });
  it("7. the eight's platform alarm: 300 failures from 300 networks do not trip, the 301st trips and reports once; then 12 per network, and a right code still opens", async () => {
    const alarmKey = () => clientKeyFor("eight-char-alarm", "eight-char-platform", Date.now());
    const alarmCount = async () => (await prisma.rateLimitHit.findUnique({ where: { key: alarmKey() } }))?.count ?? 0;
    const used = new Set([roundCode, reissuedCode, offCode]);
    const wrongEight = () => {
      for (;;) {
        const code = generateAccessCode();
        if (!used.has(code)) {
          used.add(code);
          return code;
        }
      }
    };
    // Every network this case makes, so a standing alarm and its slow pace are removed afterwards: left in
    // the counter table they would slow every other round code typed on this database for an hour.
    const networks: string[] = [];
    const network = (n: number) => {
      const address = `10.${200 + Math.floor(n / 250)}.${r()}.${(n % 250) + 1}`;
      networks.push(address);
      head.set("x-forwarded-for", address);
      return address;
    };
    const slowOf = async (address: string) =>
      (await prisma.rateLimitHit.findUnique({ where: { key: clientKeyFor("eight-char-slow", address, Date.now()) } }))?.count ?? 0;
    const alarmLines = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.filter((c) => String(c[0]).includes("[eight-char-alarm]"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await prisma.rateLimitHit.deleteMany({ where: { key: alarmKey() } });
      for (let i = 0; i < 300; i += 1) {
        network(i);
        expect(await openCode(wrongEight()), `failure ${i + 1}`).toEqual({ ok: false, error: CODE_WORDS.opensNothing });
      }
      expect(await alarmCount(), "300 failures from 300 networks are all counted").toBe(300);
      expect(alarmLines(spy), "300 does not trip it").toHaveLength(0);

      // The 301st trips it, and is itself only slowed (its own network is at one failure): reported once.
      const n301 = network(300);
      expect(await openCode(wrongEight())).toEqual({ ok: false, error: CODE_WORDS.opensNothing });
      expect(await alarmCount()).toBe(301);
      expect(alarmLines(spy), "the 301st trips it and reports").toHaveLength(1);
      expect(await slowOf(n301), "the slow pace now counts this network").toBe(1);
      network(301);
      await openCode(wrongEight());
      expect(alarmLines(spy), "reported once a window, not once a request").toHaveLength(1);

      // While it stands: a network's 12 failures are answered, the 13th is refused with the ONE sentence,
      // and a right code from a network still inside its twelve opens and gives its attempt back.
      const n = network(302);
      for (let i = 0; i < 11; i += 1) expect(await openCode(wrongEight())).toEqual({ ok: false, error: CODE_WORDS.opensNothing });
      const opened = await openCode(roundCode);
      expect(opened.ok && opened.kind, "a right code still opens while the alarm stands").toBe("round");
      expect(await slowOf(n), "and it gave its own attempt back").toBe(11);
      expect(await openCode(wrongEight()), "the 12th failure is answered").toEqual({ ok: false, error: CODE_WORDS.opensNothing });
      const refused = await openCode(wrongEight());
      expect(refused.ok).toBe(false);
      expect(!refused.ok && refused.error, "the 13th gets the one throttle sentence").toMatch(/^Too many code attempts\. Wait .+ and try again, or ask your organizer to read the code out\.$/);
      // Refused before the lookup: even the right code from THIS network, now, by the same words (as the link's).
      const real = await openCode(roundCode);
      expect(!real.ok && real.error).toMatch(/^Too many code attempts\./);
      // Another network is not held by this one's, and a success never counts toward the alarm.
      const alarmBefore = await alarmCount();
      network(303);
      const other = await openCode(roundCode);
      expect(other.ok && other.kind).toBe("round");
      expect(await alarmCount(), "a success is given back and never stays counted").toBe(alarmBefore);

      // No readable address: one shared bucket, never no limit (item 9).
      head.clear();
      const before = await countOf("round-code-client", "no-client-address");
      expect(await openCode(wrongEight())).toEqual({ ok: false, error: CODE_WORDS.opensNothing });
      expect((await countOf("round-code-client", "no-client-address")) - before, "no address counts in the shared bucket").toBe(1);
      const shared = await openCode(roundCode);
      expect(shared.ok && shared.kind, "a right code with no address still opens").toBe("round");
      expect((await countOf("round-code-client", "no-client-address")) - before, "and gives its attempt back").toBe(1);
    } finally {
      spy.mockRestore();
      const keys = [alarmKey(), "no-client-address", ...networks].flatMap((a) =>
        a === alarmKey()
          ? [a]
          : a === "no-client-address"
            ? [clientKeyFor("round-code-client", a, Date.now())]
            : [clientKeyFor("round-code-client", a, Date.now()), clientKeyFor("eight-char-slow", a, Date.now())],
      );
      await prisma.rateLimitHit.deleteMany({ where: { key: { in: keys } } });
    }
  });
});
