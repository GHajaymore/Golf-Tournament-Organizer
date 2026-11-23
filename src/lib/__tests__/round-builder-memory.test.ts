import { describe, expect, it } from "vitest";
import { MAX_AGE_MS, recall, remember } from "@/lib/domain/round-builder-memory";
import { readSource } from "./source";

function fakeStore() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

const T0 = 1_700_000_000_000;

describe("the round builder keeps what the secretary picked across a fresh mount", () => {
  it("a pick made a moment ago comes back (Round robin, Match Play, then Bracket)", () => {
    const s = fakeStore();
    remember(s, { type: "Round Robin", format: "Match Play" }, T0);
    remember(s, { type: "Bracket Stage", format: "Match Play" }, T0 + 1_000);
    expect(recall(s, T0 + 2_000)).toEqual({ type: "Bracket Stage", format: "Match Play" });
  });

  it("a format that no longer fits the kind comes back as the kind's own", () => {
    const s = fakeStore();
    remember(s, { type: "Round Robin", format: "Stroke Play" }, T0);
    expect(recall(s, T0)?.format).toBe("Match Play");
  });

  it("nothing kept, a stale pick, a made-up kind and garbage all start empty", () => {
    expect(recall(fakeStore(), T0)).toBeNull();
    const old = fakeStore();
    remember(old, { type: "Round Robin", format: "Match Play" }, T0);
    expect(recall(old, T0 + MAX_AGE_MS + 1)).toBeNull();
    const odd = fakeStore();
    remember(odd, { type: "Nonsense", format: "Match Play" }, T0);
    expect(recall(odd, T0)).toBeNull();
    const junk = fakeStore();
    junk.setItem("thq:round-builder", "{not json");
    expect(recall(junk, T0)).toBeNull();
  });

  it("no kind chosen is not written down", () => {
    const s = fakeStore();
    remember(s, { type: "", format: "" }, T0);
    expect(recall(s, T0)).toBeNull();
  });

  it("the panel reads it on mount and writes it as picks are made", () => {
    const src = readSource("src/components/rounds/AddRoundPanel.tsx");
    expect(src).toContain("recall(sessionStorage, Date.now())");
    expect(src).toContain("remember(sessionStorage, { type: newType, format: addFormat }, Date.now())");
  });
});
