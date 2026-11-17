import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { readSource, stripComments } from "./source";

/**
 * EVERY API ROUTE SAYS WHO MAY CALL IT, BEFORE IT TOUCHES ANYTHING (B71).
 *
 * A `route.ts` handler is a public HTTP endpoint, exactly as a `"use server"`
 * export is. Server actions are swept by `every-action-says-who-may-call-it`;
 * this is the same sweep for `src/app/api/**` (the Security Lead's review of
 * /api/console-play-status found nothing held the routes, so a new one could
 * ship ungated and every test stay green).
 *
 * Each handler (GET, POST, ...) must either
 *   (a) carry one of the gates below, AHEAD of its first read of the database,
 *       or
 *   (b) be on PUBLIC_ROUTES with a one-line reason.
 *
 * The shapes are banned, not the spellings: a bearer-token compare (any
 * secret), a webhook signature check (any provider's verifier), a staff or
 * owner gate, or a session whose role is then looked at. Read through
 * `readSource` (comments stripped) because these files describe their gates in
 * prose, and prose must not satisfy the rule. What this does NOT prove is that
 * a gate's check is right; the route's own tests do that.
 */

/** Routes with no gate, and why that is right. A `FINDING:` is wrong and waiting to be placed. */
const PUBLIC_ROUTES: Record<string, string> = {
  "src/app/api/health/route.ts": "uptime probe: answers {ok} from SELECT 1, returns nothing about anyone",
  "src/app/api/logo/[org]/route.ts": "a club's own mark, already shown on every public board; a non-logo id is a 404",
};

type Gate = { kind: string; at: number };

/** The staff and owner gates a session route may use (the names the action sweep trusts). */
const SESSION_GATES = [
  "requireStaffEvent(", "requireStaff(", "requireAdminEvent(", "requireOrganizerOrg(", "requireOrganizer(",
  "requireStaffSession(", "requireStaffOrg(", "requireRosterOrg(", "requireOrg(", "requireClub(", "requireOwner(",
];
const ROLE_LOOKS = [".canEdit", "isOwner(", "isStaff", 'role !== "admin"', 'role === "admin"', ".role"];

const first = (body: string, needles: string[]) => {
  const at = needles.map((n) => body.indexOf(n)).filter((i) => i >= 0);
  return at.length ? Math.min(...at) : -1;
};

/** Which gate a handler body carries, and where. */
function gateOf(h: Pick<Handler, "body" | "src">): Gate | null {
  const body = h.body;
  // A bearer token compared with a secret, refused with 401 (cron routes, the deploy window). The compare
  // may sit in a helper of the same file; the handler must read the header itself and refuse with 401.
  const header = body.search(/authorization/i);
  if (header >= 0 && h.src.includes("Bearer ${") && body.includes("401")) return { kind: "bearer", at: header };
  // A webhook verifier: Resend/Svix, Twilio, Stripe.
  const sig = first(body, ["verifySignedEvent(", "signatureOk(", "constructEvent(", "verifySignature("]);
  if (sig >= 0) return { kind: "signature", at: sig };
  const staff = first(body, SESSION_GATES);
  if (staff >= 0) return { kind: "staff", at: staff };
  // A session, whose role is then looked at.
  const session = body.indexOf("getSession(");
  if (session >= 0 && first(body.slice(session), ROLE_LOOKS) >= 0) return { kind: "session+role", at: session };
  return null;
}

/** Where a handler first reads the database (the gate must come before it). */
function firstDataRead(body: string): number {
  return first(body, ["prisma.", "$queryRaw", "$executeRaw"]);
}

interface Handler {
  file: string;
  method: string;
  body: string;
  /** The whole file, for a gate whose helper sits outside the handler. */
  src: string;
}

const METHODS = "GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS";

function handlersIn(file: string, src: string): Handler[] {
  const re = new RegExp(`export\\s+(?:async\\s+)?(?:function\\s+|const\\s+)(${METHODS})\\b`, "g");
  const marks = [...src.matchAll(re)];
  return marks.map((m, i) => ({
    file,
    method: m[1],
    body: src.slice(m.index!, i + 1 < marks.length ? marks[i + 1].index! : src.length),
    src,
  }));
}

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return routeFiles(full);
    return /^route\.(ts|tsx|js|jsx)$/.test(name) ? [full] : [];
  });
}

const ROOT = process.cwd();
const FILES = routeFiles(join(ROOT, "src", "app", "api"))
  .map((f) => relative(ROOT, f).split("\\").join("/"))
  .sort();
const HANDLERS = FILES.flatMap((f) => handlersIn(f, readSource(...f.split("/"))));
const byFile = (f: string) => HANDLERS.filter((h) => h.file === f);

describe("who may call an API route", () => {
  it("every handler carries a gate ahead of its first database read, or its route is on the public list", () => {
    const bad: string[] = [];
    for (const h of HANDLERS) {
      if (h.file in PUBLIC_ROUTES) continue;
      const g = gateOf(h);
      if (!g) bad.push(`${h.file}: ${h.method} has no gate`);
      else {
        const read = firstDataRead(h.body);
        if (read >= 0 && read < g.at) bad.push(`${h.file}: ${h.method} reads the database before its ${g.kind} gate`);
      }
    }
    expect(bad, "gate it (bearer, signature, staff or session+role) or add the route to PUBLIC_ROUTES and say why").toEqual([]);
  });

  it("a route file exports at least one handler (a handler written another way would escape the sweep)", () => {
    expect(FILES.filter((f) => byFile(f).length === 0)).toEqual([]);
  });

  it("the public list names only routes that exist and still have no gate, each with a reason", () => {
    const stale = Object.keys(PUBLIC_ROUTES).filter((f) => !FILES.includes(f) || byFile(f).some((h) => gateOf(h)));
    expect(stale, "gone, or gated since: take it off the list").toEqual([]);
    expect(Object.entries(PUBLIC_ROUTES).filter(([, why]) => why.trim().length < 10)).toEqual([]);
  });

  it("CONTROL: the routes are found, and each gate kind is seen on a real one", () => {
    expect(FILES.length).toBeGreaterThanOrEqual(10);
    const kinds = new Set(HANDLERS.map((h) => gateOf(h)?.kind));
    expect(kinds.has("bearer")).toBe(true);
    expect(kinds.has("signature")).toBe(true);
    expect(FILES).toContain("src/app/api/deploy-window/route.ts");
  });

  it("CONTROL: an ungated route, a read before the gate, and a prose-only gate are all seen", () => {
    const [open] = handlersIn("x/route.ts", "export async function GET() { return Response.json(await prisma.user.findMany()); }");
    expect(gateOf(open)).toBeNull();

    const [late] = handlersIn(
      "x/route.ts",
      'export async function GET(r: Request) { await prisma.club.findMany(); if (r.headers.get("authorization") !== `Bearer ${s}`) return new Response("no", { status: 401 }); }',
    );
    const g = gateOf(late)!;
    expect(firstDataRead(late.body)).toBeLessThan(g.at);

    const [prose] = handlersIn(
      "x/route.ts",
      stripComments("export async function GET() { // authorization Bearer ${s} 401\n return Response.json({}); }"),
    );
    expect(gateOf(prose)).toBeNull();

    // A second handler in the same file is judged on its own.
    const two = handlersIn(
      "x/route.ts",
      "export async function GET() { return 1; }\nexport async function POST(r: Request) { await verifySignedEvent({}); }",
    );
    expect(two.map((h) => gateOf(h)?.kind ?? null)).toEqual([null, "signature"]);
  });
});
