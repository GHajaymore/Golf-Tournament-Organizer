import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("next/cache", () => ({
  unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
  revalidateTag: () => {},
  revalidatePath: () => {},
}));
// The organizer pressing Save: a staff session on the fixture's event.
const session = { current: null as null | { eventId: string; role: string; email: string } };
vi.mock("@/lib/auth", () => ({ getSession: async () => session.current }));

import { createElement } from "react";
import { PrismaClient } from "@prisma/client";
import { renderToStaticMarkup } from "react-dom/server";
import { reportFor, reportCardInput, type EventReport as Report } from "@/lib/services/event-report";
import { liveBoard } from "@/lib/services/live-board";
import { publicCopy } from "@/lib/services/public-names";
import { EventReport } from "@/components/EventReport";
import { ReportForPlayersOnly } from "@/components/ReportForPlayersOnly";
import { reportCard } from "@/lib/domain/report-card";
import { NAME_WITHHELD, REPORT_SHARED_WITH_PLAYERS, reportOpenToPublic } from "@/lib/domain/report-settings";
import { setNameWithheld, setReportSettings } from "@/app/actions/report-settings";
import { seedRich, teardownRich, NAMES } from "../../../e2e/report-rich-fixture.mjs";

/**
 * THE REPORT'S SETTINGS AND A WITHHELD NAME, AGAINST REAL ROWS (2026-10-24).
 *
 *   the default      nothing touched: the public copy names winners and
 *                    carries no amount — the rule before the setting
 *   each setting     "everyone" puts amounts on the public copy; "none" takes
 *                    them off the field's; the organizer's copy always has them
 *   who opens it     "players" makes a visitor's copy the one sentence; a board
 *                    that is not public does the same, whatever the setting
 *   it persists      Save writes the row; a value off the lists is refused
 *   a withheld name  absent from the public report, the public board's data and
 *                    the share card — present for the staff and with the flag off
 *
 *   npx vitest run --config vitest.audit.config.ts the-report-settings
 */

const MARK = "zz-audit-settings";
const prisma = new PrismaClient();
let seeded: Awaited<ReturnType<typeof seedRich>>;

const copy = async (eventId: string, kind: "staff" | "player" | "public", email = ""): Promise<Report> => {
  const found = await reportFor(eventId, kind === "public" ? { kind } : { kind, email });
  if (!found || found.kind !== "event") throw new Error("no event report");
  return found.report;
};
const amountsIn = (r: Report) =>
  [...r.skins, ...r.sideGames].flatMap((g) => g.winners.map((w) => w.amount)).filter(Boolean).length + (r.settleUp ? 1 : 0);

beforeAll(async () => {
  seeded = await seedRich(MARK);
}, 120_000);
afterAll(async () => {
  await teardownRich(MARK);
  await prisma.$disconnect();
});

describe("the default needs no touching", () => {
  it("a new tournament's report is open to the board's link, and amounts are the players'", async () => {
    const e = await prisma.event.findUniqueOrThrow({ where: { id: seeded.events.stableford.eventId } });
    expect([e.reportVisibility, e.reportAmounts]).toEqual(["board", "players"]);
    const pub = await copy(e.id, "public");
    expect(pub.skins.length).toBeGreaterThan(0);
    expect(amountsIn(pub)).toBe(0);
    expect(amountsIn(await copy(e.id, "staff", seeded.organizerEmail))).toBeGreaterThan(0);
  });
});

describe("each setting does what it says", () => {
  const set = (id: string, data: { reportAmounts?: string; reportVisibility?: string }) => prisma.event.update({ where: { id }, data });
  const id = () => seeded.events.stableford.eventId;
  const player = () => seeded.events.stableford.players[0].email as string;

  it("everyone: the public copy carries the amounts and the settle-up", async () => {
    await set(id(), { reportAmounts: "everyone" });
    try {
      const pub = await copy(id(), "public");
      expect(amountsIn(pub)).toBeGreaterThan(1);
      expect(pub.settleUp).not.toBeNull();
      // And the share card still never carries one.
      expect(JSON.stringify(reportCard(reportCardInput({ kind: "event", report: pub }), "public"))).not.toMatch(/\$/);
    } finally {
      await set(id(), { reportAmounts: "players" });
    }
  });

  it("none: the field's copy names the winners only; the organizer's copy keeps the amounts", async () => {
    await set(id(), { reportAmounts: "none" });
    try {
      expect(amountsIn(await copy(id(), "player", player()))).toBe(0);
      expect(amountsIn(await copy(id(), "staff", seeded.organizerEmail))).toBeGreaterThan(0);
      // Control: on the default the same player sees them.
      await set(id(), { reportAmounts: "players" });
      expect(amountsIn(await copy(id(), "player", player()))).toBeGreaterThan(0);
    } finally {
      await set(id(), { reportAmounts: "players" });
    }
  });

  it("the public copy never says that anything is left off it", async () => {
    // The words on the page, not its stylesheet (which says "overflow: hidden").
    const html = renderToStaticMarkup(createElement(EventReport, { report: await copy(id(), "public") }))
      .replace(/<style[\s\S]*?<\/style>/g, "")
      .replace(/<[^>]+>/g, " ");
    expect(html).not.toMatch(/amounts are|hidden|not shown|names the winners only/i);
    // Control: the organizer's copy does say who sees them.
    expect(renderToStaticMarkup(createElement(EventReport, { report: await copy(id(), "staff", seeded.organizerEmail) }))).toMatch(/Amounts are shown/);
  });

  it("players: a visitor is told in one sentence, and the board's privacy wins over 'anyone'", () => {
    expect(reportOpenToPublic(true, "players")).toBe(false);
    expect(reportOpenToPublic(false, "board")).toBe(false);
    const html = renderToStaticMarkup(createElement(ReportForPlayersOnly));
    expect(html).toContain(REPORT_SHARED_WITH_PLAYERS);
    expect(html).toContain('href="/play"');
    expect(html.replace(/<style[\s\S]*?<\/style>/, "")).not.toMatch(/closed|private|padlock|lock/i);
    for (const n of NAMES) expect(html).not.toContain(n);
  });
});

describe("the settings persist, and only the lists' values are taken", () => {
  it("Save writes the row, and a value off the lists is refused without writing", async () => {
    const id = seeded.events.medal.eventId;
    session.current = { eventId: id, role: "admin", email: seeded.organizerEmail };
    try {
      expect(await setReportSettings("players", "none")).toEqual({ ok: true });
      let e = await prisma.event.findUniqueOrThrow({ where: { id } });
      expect([e.reportVisibility, e.reportAmounts]).toEqual(["players", "none"]);
      expect((await setReportSettings("everybody", "all")).ok).toBe(false);
      e = await prisma.event.findUniqueOrThrow({ where: { id } });
      expect([e.reportVisibility, e.reportAmounts]).toEqual(["players", "none"]);
      expect(await setReportSettings("board", "players")).toEqual({ ok: true });
    } finally {
      session.current = null;
    }
  });

  it("a player only — refused with no session, and for a player of another tournament", async () => {
    await expect(setReportSettings("board", "players")).rejects.toThrow();
    session.current = { eventId: seeded.events.medal.eventId, role: "player", email: "x@example.invalid" };
    await expect(setNameWithheld(seeded.events.medal.players[0].id, true)).rejects.toThrow();
    session.current = { eventId: seeded.events.medal.eventId, role: "admin", email: seeded.organizerEmail };
    try {
      const other = seeded.events.stableford.players[0].id;
      expect((await setNameWithheld(other, true)).ok).toBe(false);
      expect((await prisma.player.findUniqueOrThrow({ where: { id: other } })).publicNameWithheld).toBe(false);
    } finally {
      session.current = null;
    }
  });
});

describe("a withheld name is nowhere a signed-out reader can see it", () => {
  it("not in the public report, the public board's data or the share card — and there for the staff", async () => {
    const id = seeded.events.medal.eventId;
    const ailsa = seeded.events.medal.players[0];
    const visible = async () => {
      const report = await reportFor(id, { kind: "public" });
      const board = await publicCopy(id, await liveBoard(id));
      const card = reportCard(reportCardInput(report!), "public");
      const html = renderToStaticMarkup(createElement(EventReport, { report: (report as { report: Report }).report }));
      return { report: JSON.stringify(report), board: JSON.stringify(board), card: JSON.stringify(card), html };
    };
    // Control first: with the flag off, the name is on every one of them.
    const before = await visible();
    for (const [k, v] of Object.entries(before)) expect(v, k).toContain(ailsa.name);

    session.current = { eventId: id, role: "admin", email: seeded.organizerEmail };
    try {
      expect(await setNameWithheld(ailsa.id, true)).toEqual({ ok: true });
      const after = await visible();
      for (const [k, v] of Object.entries(after)) {
        expect(v, k).not.toContain(ailsa.name);
        expect(v, k).not.toContain("Ailsa T.");
      }
      expect(after.html).toContain(NAME_WITHHELD);
      // The staff and the field still see the name.
      expect(JSON.stringify(await copy(id, "staff", seeded.organizerEmail))).toContain(ailsa.name);
    } finally {
      await setNameWithheld(ailsa.id, false);
      session.current = null;
    }
  });
});
