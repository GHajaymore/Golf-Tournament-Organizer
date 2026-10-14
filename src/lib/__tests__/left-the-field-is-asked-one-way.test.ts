import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { hasLeftTheField, LEFT_THE_FIELD } from "@/lib/domain/left-the-field";
import { readSource } from "./source";

/**
 * "HAS THIS PLAYER LEFT THE FIELD" IS ASKED OF `hasLeftTheField` / `LEFT_THE_FIELD`.
 *
 * Three readers spelled it out — `status === "withdrawn" || status ===
 * "disqualified"`, and a status list naming both — which was right until a
 * third way out of the field is added, and then two of the three would be
 * wrong. Places that SAY something different to a withdrawn player and to a
 * disqualified one (which way back there is) are not this question, and use
 * neither spelling.
 */
describe("leaving the field", () => {
  it("is withdrawing or being disqualified, and nothing else", () => {
    expect(LEFT_THE_FIELD).toEqual(["withdrawn", "disqualified"]);
    for (const s of ["withdrawn", "disqualified"]) expect(hasLeftTheField(s), s).toBe(true);
    for (const s of ["confirmed", "waitlisted", "pending", ""]) expect(hasLeftTheField(s), s).toBe(false);
  });

  function sources(dir: string, out: string[] = []): string[] {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) {
        if (e.name === "__tests__" || e.name === "node_modules") continue;
        sources(rel, out);
      } else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(rel);
    }
    return out;
  }
  const BOTH = /status === "withdrawn" \|\| [\w.]*status === "disqualified"|status === "disqualified" \|\| [\w.]*status === "withdrawn"|"withdrawn", "disqualified"\]|"disqualified", "withdrawn"\]/;

  it("CONTROL: the sweep recognises the copies it replaced, and not a place that tells the two apart", () => {
    expect(BOTH.test('state.players.filter((p) => p.status === "withdrawn" || p.status === "disqualified")')).toBe(true);
    expect(BOTH.test('where: { eventId, status: { in: ["confirmed", "withdrawn", "disqualified"] } },')).toBe(true);
    expect(BOTH.test('player.status === "withdrawn" ? `has withdrawn` : player.status === "disqualified" ? `ruled out` : ``')).toBe(false);
  });

  it("is spelled out nowhere else", () => {
    const strays = sources("src").filter((f) => !f.endsWith("domain/left-the-field.ts") && BOTH.test(readSource(f)));
    expect(strays, "ask hasLeftTheField(status), or spread LEFT_THE_FIELD into a status list").toEqual([]);
  });
});
