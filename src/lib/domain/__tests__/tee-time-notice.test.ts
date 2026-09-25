import { describe, it, expect } from "vitest";
import { teeTimeNotices } from "../tee-time-notice";
import type { TeeSheet } from "../tee-sheet";

/**
 * The rule the whole feature turns on: a first publish tells everyone, a
 * re-publish tells only whom it moved. Getting this wrong spams a field or
 * silences a change, so the assertions are exact — who, and new vs changed.
 */

function sheet(groups: Array<{ time: string; startHole: number; playerIds: string[] }>): TeeSheet {
  return {
    savedAt: "2026-05-01T00:00:00.000Z",
    startType: "tee",
    groups: groups.map((g, i) => ({ name: `Group ${i + 1}`, startHole: g.startHole, time: g.time, playerIds: g.playerIds })),
  };
}

describe("teeTimeNotices", () => {
  const next = sheet([
    { time: "8:00 AM", startHole: 1, playerIds: ["ann", "bob"] },
    { time: "8:10 AM", startHole: 1, playerIds: ["cid", "dan"] },
  ]);

  it("tells everyone drawn, as 'new', on a first publish", () => {
    const notices = teeTimeNotices(null, next, true);
    expect(notices.map((n) => n.playerId).sort()).toEqual(["ann", "bob", "cid", "dan"]);
    expect(notices.every((n) => n.kind === "new")).toBe(true);
    // The time and start ride along for the message.
    expect(notices.find((n) => n.playerId === "cid")).toMatchObject({ time: "8:10 AM", startHole: 1 });
  });

  it("tells everyone even with a previous sheet, when it is a first publish", () => {
    // firstPublish wins over the diff: a sheet drafted, unpublished, then
    // published is news to the whole field regardless of what the draft held.
    const notices = teeTimeNotices(next, next, true);
    expect(notices).toHaveLength(4);
    expect(notices.every((n) => n.kind === "new")).toBe(true);
  });

  it("says nothing when a re-publish changed no times", () => {
    const notices = teeTimeNotices(next, next, false);
    expect(notices).toEqual([]);
  });

  it("tells only the player whose time moved, as 'changed'", () => {
    const moved = sheet([
      { time: "8:00 AM", startHole: 1, playerIds: ["ann", "bob"] },
      { time: "8:20 AM", startHole: 1, playerIds: ["cid", "dan"] }, // 8:10 -> 8:20
    ]);
    const notices = teeTimeNotices(next, moved, false);
    expect(notices.map((n) => n.playerId).sort()).toEqual(["cid", "dan"]);
    expect(notices.every((n) => n.kind === "changed")).toBe(true);
    expect(notices.find((n) => n.playerId === "cid")?.time).toBe("8:20 AM");
    // Ann and Bob, unchanged, are not pinged.
    expect(notices.some((n) => n.playerId === "ann")).toBe(false);
  });

  it("treats a moved start hole as a change", () => {
    const moved = sheet([
      { time: "8:00 AM", startHole: 10, playerIds: ["ann", "bob"] }, // 1 -> 10
      { time: "8:10 AM", startHole: 1, playerIds: ["cid", "dan"] },
    ]);
    const notices = teeTimeNotices(next, moved, false);
    expect(notices.map((n) => n.playerId).sort()).toEqual(["ann", "bob"]);
    expect(notices.every((n) => n.kind === "changed")).toBe(true);
  });

  it("tells a newly added player as 'new' on a re-publish", () => {
    const added = sheet([
      { time: "8:00 AM", startHole: 1, playerIds: ["ann", "bob"] },
      { time: "8:10 AM", startHole: 1, playerIds: ["cid", "dan", "eve"] }, // eve added
    ]);
    const notices = teeTimeNotices(next, added, false);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ playerId: "eve", kind: "new" });
  });

  it("does not notify a player dropped from the sheet", () => {
    const dropped = sheet([
      { time: "8:00 AM", startHole: 1, playerIds: ["ann"] }, // bob removed
      { time: "8:10 AM", startHole: 1, playerIds: ["cid", "dan"] },
    ]);
    const notices = teeTimeNotices(next, dropped, false);
    expect(notices.some((n) => n.playerId === "bob")).toBe(false);
    // And nobody else moved, so it is silent.
    expect(notices).toEqual([]);
  });
});
