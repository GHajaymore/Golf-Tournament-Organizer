import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { readSource, stripComments } from "./source";

/**
 * THE LAUNCH FACTS ARE BUILT ONCE (gap G3, 2026-10-31).
 *
 * The workflow review found them built three times — the dashboard, the launch
 * action and the setup flow, each from its own queries — so the setup rail
 * could say "4 of 5" while Launch went through. Now `launchFactsFrom`
 * (domain/launch-check.ts) is the one builder, and everybody asks
 * `launchCheckFor`, which reads the setup flow's own facts.
 *
 * The shape banned is a call of `launchRefusal(` or a value typed `LaunchFacts`
 * anywhere but the gate that defines them and the one builder.
 */
const ALLOWED = new Set(["src/lib/domain/phase-gate.ts", "src/lib/domain/launch-check.ts"]);

/** Whether a source file builds launch facts of its own. */
function buildsLaunchFacts(src: string): boolean {
  const code = stripComments(src);
  return /\blaunchRefusal\s*\(/.test(code) || /\bLaunchFacts\b/.test(code);
}

const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== "__tests__") walk(p, out);
    } else if (/\.(ts|tsx)$/.test(name)) out.push(p.split("\\").join("/"));
  }
  return out;
};

describe("one builder of the launch facts", () => {
  const files = walk("src");

  it("CONTROL: the sweep reads the source, and sees a copy when there is one", () => {
    expect(files.length).toBeGreaterThan(400);
    // The builder itself is seen…
    expect(buildsLaunchFacts(readSource("src/lib/domain/launch-check.ts"))).toBe(true);
    // …and so is the dashboard's old copy, as it was written before G3.
    const oldDashboard = `const phaseBlock = lifecycleAction?.kind === "launch"
      ? launchRefusal({
          playingRounds: state.stages.filter((s) => isPlayingRound(s.type)).length,
          confirmed: state.confirmed.length,
        })
      : null;`;
    expect(buildsLaunchFacts(oldDashboard)).toBe(true);
    // A comment naming the gate is not a copy.
    expect(buildsLaunchFacts("// asks launchRefusal( through launchCheckFor\nconst x = 1;")).toBe(false);
  });

  it("no file but the gate and the builder calls launchRefusal or builds LaunchFacts", () => {
    const copies = files.filter((f) => !ALLOWED.has(f) && buildsLaunchFacts(readSource(f)));
    expect(copies, "a second builder of the launch facts").toEqual([]);
  });

  it("the dashboard and the action ask the setup flow's verdict", () => {
    expect(readSource("src/app/(app)/dashboard/page.tsx")).toMatch(/await launchCheckFor\(session\.eventId\)/);
    expect(readSource("src/app/actions/tournament.ts")).toMatch(/const \{ refusal \} = await launchCheckFor\(eventId\)/);
    // And the flow's verdict is the builder's, so the rail asks it too.
    expect(readSource("src/lib/domain/setup-flow.ts")).toMatch(/launchCheck\(/);
    expect(readSource("src/lib/domain/launch-check.ts")).toMatch(/launchRefusal\(launchFactsFrom\(f\)\)/);
  });

  it("SECURITY: the action reads setup only after the organizer gate, for the event it resolved", () => {
    // `launchTournament` is a public endpoint. Its refusals name this
    // tournament's rounds and screens, so they must be behind the gate.
    const src = readSource("src/app/actions/tournament.ts");
    const body = src.slice(src.indexOf("export async function launchTournament("));
    const gate = body.indexOf("await adminEventOrRefusal()");
    const facts = body.indexOf("await launchCheckFor(eventId)");
    expect(gate).toBeGreaterThan(-1);
    expect(facts, "launch reads setup before the organizer gate").toBeGreaterThan(gate);
    expect(body.slice(gate, facts)).toMatch(/if \("refused" in gate\) return \{ ok: false, error: gate\.refused \}/);
  });
});
