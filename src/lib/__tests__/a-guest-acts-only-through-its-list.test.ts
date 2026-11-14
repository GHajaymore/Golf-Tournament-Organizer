import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { readSource } from "./source";
import { GUEST_ACTIONS } from "@/lib/domain/player-link";

/**
 * A GUEST'S PLAYER LINK ACTS ONLY THROUGH ITS CLOSED LIST (J39/J40 PR 1;
 * design §2.8, the review's S4 and S5).
 *
 * `GUEST_ACTIONS` names every server action a link may perform. This holds the
 * source to it: an action that reaches the guest session — directly
 * (`getGuestSession`), through the round-scoped gate that admits a guest
 * (`requireScoreEntryForStage`), or through `guestActorFor` — must be on the
 * list; the guest machinery is called from nowhere else; and the guest's own
 * entry is taken from the viewer, never from an argument.
 *
 * Every OTHER action still calls `getSession()`, which never answers for a
 * link, and so refuses a guest: that is what keeps the list closed.
 */

const ACTIONS_DIR = join("src", "app", "actions");
// `getPlayerViewer(` answers for a link as readily as for an account; `playStatusForScreen(`
// asks it for the player screen (G1, `currentPlayStatus`).
const GUEST_DOORS = ["getGuestSession(", "requireScoreEntryForStage(", "guestActorFor(", "getPlayerViewer(", "playStatusForScreen("];
/** Actions that reach a guest door but are not a GUEST action: the open door itself. */
const NOT_GUEST_WRITES = new Set(["openPlayerLink"]);

function actionsIn(src: string): { name: string; body: string }[] {
  return src
    .split("export async function ")
    .slice(1)
    .map((piece) => ({ name: piece.slice(0, piece.indexOf("(")), body: piece }));
}

const ACTIONS = readdirSync(ACTIONS_DIR)
  .filter((f) => f.endsWith(".ts"))
  .flatMap((f) => actionsIn(readSource("src", "app", "actions", f)).map((a) => ({ ...a, file: f })));

function reachesAGuestDoor(body: string): boolean {
  return GUEST_DOORS.some((d) => body.includes(d));
}

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === "__tests__" || name === "node_modules") continue;
    if (statSync(p).isDirectory()) sources(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p.split("\\").join("/"));
  }
  return out;
}

describe("a guest acts only through GUEST_ACTIONS", () => {
  it("every action that reaches the guest session is on the list", () => {
    const off = ACTIONS.filter((a) => reachesAGuestDoor(a.body) && !NOT_GUEST_WRITES.has(a.name) && !(GUEST_ACTIONS as readonly string[]).includes(a.name)).map((a) => `${a.file}: ${a.name}`);
    expect(off, "put it on GUEST_ACTIONS (domain/player-link.ts) with the design's say-so, or keep the guest out of it").toEqual([]);
  });

  it("every action on the list exists and does reach it", () => {
    for (const name of GUEST_ACTIONS) {
      const found = ACTIONS.find((a) => a.name === name);
      expect(found, `${name} is on GUEST_ACTIONS but is no action`).toBeTruthy();
      expect(reachesAGuestDoor(found!.body), `${name} is on GUEST_ACTIONS but never reaches the guest session`).toBe(true);
    }
  });

  it("the guest machinery is called from nowhere else", () => {
    const allowed: Record<string, string[]> = {
      // guest-auth.ts DEFINES it (`getGuestSession = cache(`), so is not a caller.
      "getGuestSession(": ["src/lib/player-viewer.ts", "src/app/actions/player-link.ts"],
      "guestActorFor(": ["src/lib/player-viewer.ts", "src/app/actions/tournament.ts"],
      "guestViewer(": ["src/lib/player-viewer.ts"],
      // The player screens' door, and the one resolver the siren's poll asks through (G1: the siren
      // follows the screen's event; `currentPlayStatus` -> `playStatusForScreen`).
      // player-viewer.ts DEFINES it (`export async function getPlayerViewer(`).
      "getPlayerViewer(": ["src/lib/player-viewer.ts", "src/lib/page-helpers.ts", "src/lib/services/play-status-screen.ts"],
    };
    const files = sources("src");
    for (const [call, where] of Object.entries(allowed)) {
      const callers = files.filter((f) => readSource(f).includes(call));
      expect(callers.sort(), call).toEqual([...where].sort());
    }
  });

  it("the round-scoped gate admits a guest only for the ROUND's own event", () => {
    const tournament = readSource("src", "app", "actions", "tournament.ts");
    expect(tournament).toMatch(/const guest = stage \? await guestActorFor\(stage\.eventId, session\) : null;\s*if \(guest\) return requireScoreEntry\(guest\);/);
  });

  it("the guest's entry comes from the viewer, never from an argument (S4, S5)", () => {
    const me = readSource("src", "lib", "services", "me.ts");
    const body = me.slice(me.indexOf("export async function myPlayerIdsFor("), me.indexOf("export async function myPlayerIdsFor(") + 900);
    expect(body).toContain("who.guest.eventId !== eventId");
    expect(body).toContain("where: { id: who.guest.playerId, eventId }");
    expect(body).toContain("mayPlayThroughLink(row.status)");
    expect(body, "a guest must never be asked by address").not.toContain("byAddress");
    const viewer = readSource("src", "lib", "player-viewer.ts");
    expect(viewer).toMatch(/email: "",/);
  });

  it("CONTROL: an action that reaches the guest session off the list is seen", () => {
    const [fake] = actionsIn("export async function withdrawForGuest(id: string) {\n  const g = await getGuestSession();\n}\n");
    expect(reachesAGuestDoor(fake.body)).toBe(true);
    expect((GUEST_ACTIONS as readonly string[]).includes(fake.name)).toBe(false);
  });
});

/**
 * SF-3 (security review): a pending or waitlisted guest sees Today's waiting
 * card ONLY — refused by each page of the event itself, not only by the layout
 * (a layout that does not draw its page does not stop the page's payload).
 */
describe("SF-3: a waiting guest is refused by the page, not only the layout", () => {
  const PAGES = ["board", "card", "match", "rules"];
  it("the event's own player screens ask requirePlayingViewer, never the bare viewer", () => {
    for (const p of PAGES) {
      const src = readSource("src", "app", "(player)", "me", p, "page.tsx");
      expect(src, p).toContain("await requirePlayingViewer()");
      expect(src, p).not.toContain("await requirePlayerViewer()");
    }
  });
  it("Today renders nothing of its own for a waiting guest, and the layout asks the same rule", () => {
    const today = readSource("src", "app", "(player)", "me", "page.tsx");
    expect(today).toMatch(/const session = await requirePlayerViewer\(\);\s*if \(guestIsWaiting\(session\)\) return null;/);
    expect(readSource("src", "app", "(player)", "layout.tsx")).toContain("const guestWaiting = guestIsWaiting(session);");
  });
  it("the rule is the writes' own: a guest not confirmed is waiting", () => {
    const helpers = readSource("src", "lib", "page-helpers.ts");
    expect(helpers).toMatch(/return !!viewer\.guest && !mayPlayThroughLink\(viewer\.guest\.status\);/);
    expect(helpers).toMatch(/if \(guestIsWaiting\(viewer\)\) redirect\("\/me"\);/);
  });
  it("CONTROL: a page on the bare viewer is seen", () => {
    expect("const session = await requirePlayerViewer();").not.toContain("await requirePlayingViewer()");
  });
});

/**
 * A SIGNED-IN ACTOR WHO REACHES THE ROUND NEVER NEEDS THE GUEST COOKIE (CI on
 * #1125: 31 existing audit tests that call the card actions with a stubbed
 * session failed on `cookies` "outside a request scope"). The account's own
 * paths return before the guest is asked; and a cookie that cannot be read is
 * NO guest, never access.
 */
describe("the guest is asked only when no signed-in actor reaches the round", () => {
  const tournament = readSource("src", "app", "actions", "tournament.ts");
  const gate = tournament.slice(tournament.indexOf("async function requireScoreEntryForStage("), tournament.indexOf("const ownPlayerIds"));
  it("the account's own and reached tournaments return before guestActorFor is called", () => {
    const own = gate.indexOf("if (stage.eventId === session.eventId) return requireScoreEntry(session);");
    const reached = gate.indexOf("if (access) {");
    const guest = gate.indexOf("guestActorFor(");
    expect(own).toBeGreaterThan(0);
    expect(reached).toBeGreaterThan(own);
    expect(guest, "the guest cookie is read before the account's own path").toBeGreaterThan(reached);
  });
  it("an unreadable cookie is no guest and no chosen view; Next's own control flow is rethrown", () => {
    const auth = readSource("src", "lib", "guest-auth.ts");
    expect(auth).toMatch(/catch \(e\) \{\s*unstable_rethrow\(e\);\s*return undefined;\s*\}/);
    expect(auth).toContain("readGuestCookieValue(verify(await readCookie(GUEST_COOKIE)))");
    expect(auth).toContain("const v = await readCookie(PLAYER_VIEW_COOKIE);");
  });
  it("outside a request (no cookies at all) there is no guest", async () => {
    const { getGuestSession, playerViewChosen } = await import("@/lib/guest-auth");
    expect(await getGuestSession()).toBeNull();
    expect(await playerViewChosen()).toBeNull();
  });
});
