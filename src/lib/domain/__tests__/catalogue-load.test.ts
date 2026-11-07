import { describe, it, expect } from "vitest";
import {
  judgeRow,
  isGcaId,
  parseCatalogueFile,
  chunkRows,
  CATALOGUE_FORMAT,
  CATALOGUE_VERSION,
  GCA_PREFIX,
} from "../catalogue-load";
import { readSource } from "../../__tests__/source";

/**
 * THE CATALOGUE LOAD'S JUDGEMENT (J29): what a row must be to be stored, and the one thing that is
 * refused whatever else it holds, a GolfCourseAPI id. Invented courses only.
 */
const PARS = [4, 5, 4, 4, 3, 5, 3, 4, 4, 4, 4, 3, 4, 5, 4, 4, 3, 5];
const SI = [6, 10, 12, 16, 14, 2, 18, 4, 8, 3, 9, 17, 7, 1, 13, 11, 15, 5];
const row = (over: Record<string, unknown> = {}) => ({
  id: "zz-og-1",
  name: "Zz Invented Links",
  city: "Nowhere",
  state: "ZZ",
  country: "US",
  website: "",
  address: "",
  par: 72,
  pars: JSON.stringify(PARS),
  yards: "",
  strokeIndex: JSON.stringify(SI),
  tees: "[]",
  cardProblem: "",
  ...over,
});

describe("judgeRow", () => {
  it("takes a row with a card the app's own checker passes, with the card re-written canonically", () => {
    const v = judgeRow(row());
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.row.pars).toBe(JSON.stringify(PARS));
  });

  it("refuses every gca: id, however clean its card, and says it is GolfCourseAPI's", () => {
    for (const id of ["gca:123", "GCA:9", " gca:1"]) {
      const v = judgeRow(row({ id }));
      expect(v.ok).toBe(false);
      if (!v.ok) expect(v.kind).toBe("gca");
    }
    expect(isGcaId("gca:1")).toBe(true);
    expect(isGcaId("abc")).toBe(false);
    expect(GCA_PREFIX).toBe("gca:");
  });

  it("skips, never stores blank: no card, a source refusal, a card the checker refuses", () => {
    expect(judgeRow(row({ pars: "", strokeIndex: "" }))).toMatchObject({ ok: false, kind: "skipped" });
    expect(judgeRow(row({ cardProblem: "No stroke index" }))).toMatchObject({ ok: false, kind: "skipped" });
    // Placeholder stroke index: 0 on every hole (found on 334 development rows marked usable).
    expect(judgeRow(row({ strokeIndex: JSON.stringify(PARS.map(() => 0)) }))).toMatchObject({ ok: false, kind: "skipped" });
    const dupe = [...SI];
    dupe[1] = 6;
    expect(judgeRow(row({ strokeIndex: JSON.stringify(dupe) }))).toMatchObject({ ok: false, kind: "skipped" });
  });

  it("skips malformed rows and never throws", () => {
    for (const bad of [null, 5, "x", [], {}, row({ name: "" }), row({ pars: "{" }), row({ tees: "{}" }), row({ city: 4 }), row({ yards: "[1,2]" })]) {
      expect(judgeRow(bad)).toMatchObject({ ok: false });
    }
  });

  it("never lets yardage be the reason (an absent yardage is fine)", () => {
    expect(judgeRow(row({ yards: "" })).ok).toBe(true);
  });
});

describe("parseCatalogueFile", () => {
  const file = (over: Record<string, unknown> = {}) =>
    JSON.stringify({ format: CATALOGUE_FORMAT, version: CATALOGUE_VERSION, count: 1, exportedFrom: "development", courses: [row()], ...over });
  it("reads a file of the right kind and version", () => {
    expect(parseCatalogueFile(file()).ok).toBe(true);
  });
  it("refuses another version, another file, a cut-short list, and non-JSON", () => {
    expect(parseCatalogueFile(file({ version: 2 }))).toMatchObject({ ok: false });
    expect(parseCatalogueFile(file({ format: "other" }))).toMatchObject({ ok: false });
    expect(parseCatalogueFile(file({ count: 5 }))).toMatchObject({ ok: false });
    expect(parseCatalogueFile(file({ courses: "x" }))).toMatchObject({ ok: false });
    expect(parseCatalogueFile("not json")).toMatchObject({ ok: false });
  });
});

describe("chunkRows", () => {
  it("splits by count and by size, keeping every row once, in order", () => {
    const rows = Array.from({ length: 250 }, (_, i) => row({ id: `zz-${i}` }));
    const byCount = chunkRows(rows, 100, 10_000_000);
    expect(byCount.map((c) => c.length)).toEqual([100, 100, 50]);
    const size = JSON.stringify(rows[0]).length;
    const bySize = chunkRows(rows, 1000, size * 3 + 1);
    expect(bySize.every((c) => c.length <= 3)).toBe(true);
    expect(bySize.flat()).toEqual(rows);
  });
});

describe("the export script and the load keep gca out (a sweep with a control)", () => {
  it("the export script refuses gca ids, non-local databases and paths inside the repo", () => {
    const src = readSource("scripts/export-catalogue.ts");
    expect(src).toContain("isGcaId");
    expect(src).toContain("localhost");
    expect(src).toContain("Refusing to write inside the repository");
  });
  it("the action asks the owner list before anything", () => {
    const src = readSource("src/app/actions/owner.ts");
    const body = src.slice(src.indexOf("export async function loadCourseCatalogue"));
    expect(body.indexOf("isOwner(")).toBeGreaterThan(-1);
    expect(body.indexOf("isOwner(")).toBeLessThan(body.indexOf("loadCatalogueRows("));
  });
});
