import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { seed } from "./fixture.mjs";
import { controlLineRefusal } from "../scripts/ci/slow-request-env.mjs";

const nodeRequire = createRequire(`${process.cwd()}/package.json`);

/**
 * Seed the tournament, then write a signed-in browser state for each role.
 *
 * Sessions are cookies signed with AUTH_SECRET, so they can be minted here
 * rather than driven through a login form. That is deliberate: a sign-in
 * screen is worth testing once, on its own, and not paid for at the start of
 * every other test in the suite.
 */
export default async function globalSetup() {
  // B112: a CI run starts its own server (a reused one, as a round's or a local one, is not ours to
  // judge here: scripts/qa/round.mjs checks its own). That server must have printed the slow-request
  // control line since this run began, or the stall instrument is silently off.
  if (process.env.CI && process.env.E2E_REUSE_SERVER !== "1") {
    const file = (nodeRequire("./scripts/ci/slow-request-log.cjs") as { logFile: () => string }).logFile();
    let text = "";
    try {
      text = readFileSync(file, "utf8");
    } catch {
      /* no file is the same as no line */
    }
    const why = controlLineRefusal(text, Number(process.env.E2E_RUN_STARTED ?? 0) - 1_000);
    if (why) throw new Error(`Slow-request log: ${why}. Log read: ${file}`);
  }
  const data = await seed();

  const dir = join(process.cwd(), ".e2e");
  mkdirSync(dir, { recursive: true });

  const port = Number(process.env.E2E_PORT ?? 3101);
  const stateFor = (who: { session: string; event: string }) => ({
    cookies: [
      { name: "ng_session", value: who.session, domain: "localhost", path: "/", expires: -1, httpOnly: false, secure: false, sameSite: "Lax" as const },
      { name: "ng_active_event", value: who.event, domain: "localhost", path: "/", expires: -1, httpOnly: false, secure: false, sameSite: "Lax" as const },
    ],
    origins: [],
  });

  writeFileSync(join(dir, "organizer.json"), JSON.stringify(stateFor(data.organizer), null, 2));
  writeFileSync(join(dir, "player.json"), JSON.stringify(stateFor(data.player), null, 2));
  // The same two roles on the interclub league, which is a different event in
  // the same club: the league secretary and one club's member.
  writeFileSync(join(dir, "league-organizer.json"), JSON.stringify(stateFor(data.league.organizer), null, 2));
  writeFileSync(join(dir, "league-member.json"), JSON.stringify(stateFor(data.league.member), null, 2));
  // Facts the tests assert against, written out rather than duplicated as
  // constants in each spec — a fixture that changes shape should break the
  // tests loudly, not silently disagree with them.
  writeFileSync(join(dir, "data.json"), JSON.stringify({ ...data, port }, null, 2));
}
