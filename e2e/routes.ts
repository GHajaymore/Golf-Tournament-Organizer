import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * The routes that are in neither shell, derived once and read by both specs.
 *
 * `layout.spec` measures them for sideways scroll and blank icons;
 * `touch.spec` measures them for the 44px floor. That is two rules over one
 * list, and the list has to be ONE list — two copies of a filesystem walk is
 * how one of them quietly stops covering a route somebody added.
 *
 * These pages sit outside `(app)` and `(player)` because they run BEFORE a
 * tournament exists: `/choose`, where every new organizer lands, `/match/new`,
 * which is the whole of the casual-round product, and `/play`, which is how
 * somebody with a round code gets in. All three are used standing up, on a
 * phone, which is exactly why the touch floor matters on them.
 *
 * Dynamic segments are skipped — `/live/[token]` and `/register/[token]` need
 * a param, and both already have tests of their own.
 */
export function standaloneScreens(cwd: string = process.cwd()): string[] {
  const root = join(cwd, "src", "app");
  const usable = (name: string) =>
    !name.startsWith("[") && !name.startsWith("_") && !name.startsWith("(");

  return readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .filter((e) => usable(e.name))
    // `api` holds route handlers, which have no layout and nothing to tap.
    .filter((e) => e.name !== "api")
    .flatMap((e) => {
      const here = join(root, e.name);
      // A route may be the directory itself (`/choose`) or one level down
      // (`/match/new`), so both are looked for rather than assumed.
      const paths: string[] = [];
      if (existsSync(join(here, "page.tsx"))) paths.push(`/${e.name}`);
      for (const child of readdirSync(here, { withFileTypes: true })) {
        if (!child.isDirectory() || !usable(child.name)) continue;
        if (existsSync(join(here, child.name, "page.tsx"))) paths.push(`/${e.name}/${child.name}`);
      }
      return paths;
    })
    .sort();
}

/**
 * What a standalone route needs in the URL to actually render.
 *
 * NOT an exclusion list — every route stays swept and stays asserted. This
 * says how to REACH one, and the answer comes from the app's own links rather
 * than from anything invented here.
 *
 * `/choose` sends anyone with a single active event straight to their landing
 * screen, so the organizer session these specs use never sees it. `?stay=1` is
 * what suppresses that, and it is what the "create another tournament" link
 * and the event switcher both point at — so the screen is measured in the
 * state it is genuinely used in, not a contrived one.
 *
 * A route that starts redirecting and has no such door fails loudly, which is
 * the right outcome: an unreachable screen is a finding.
 */
export const ENTRY_QUERY: Record<string, string> = {
  "/choose": "?stay=1",
};

/** The URL to visit for a route, with whatever it needs to render. */
export function entryUrl(path: string): string {
  return `${path}${ENTRY_QUERY[path] ?? ""}`;
}
