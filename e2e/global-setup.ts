import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { seed } from "./fixture.mjs";

/**
 * Seed the tournament, then write a signed-in browser state for each role.
 *
 * Sessions are cookies signed with AUTH_SECRET, so they can be minted here
 * rather than driven through a login form. That is deliberate: a sign-in
 * screen is worth testing once, on its own, and not paid for at the start of
 * every other test in the suite.
 */
export default async function globalSetup() {
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
  // Facts the tests assert against, written out rather than duplicated as
  // constants in each spec — a fixture that changes shape should break the
  // tests loudly, not silently disagree with them.
  writeFileSync(join(dir, "data.json"), JSON.stringify({ ...data, port }, null, 2));
}
