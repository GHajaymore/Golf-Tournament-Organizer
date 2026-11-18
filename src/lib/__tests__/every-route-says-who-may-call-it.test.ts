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

/** The staff and owner gates a route may call (trusted by NAME, as the action sweep trusts them; their bodies are theirs to test). */
const SESSION_GATES = [
  "requireStaffEvent(", "requireStaff(", "requireAdminEvent(", "requireOrganizerOrg(", "requireOrganizer(",
  "requireStaffSession(", "requireStaffOrg(", "requireRosterOrg(", "requireOrg(", "requireClub(",
];
/** A role COMPARED, not merely read: an echo of `session.role` is not a check. */
const ROLE_COMPARE = /\brole\s*[!=]==\s*["']|\.canEdit\b|\bisOwner\(/;
/** A refusal: a 401/403 answer, a redirect, or a 404. */
const REFUSAL = /status:\s*40[13]\b|new Response\([^)]*40[13]|\bredirect\(|\bnotFound\(/;

const first = (body: string, needles: string[]) => {
  const at = needles.map((n) => body.indexOf(n)).filter((i) => i >= 0);
  return at.length ? Math.min(...at) : -1;
};

/** Where a handler first reads the database (the gate must come before it). */
function firstDataRead(body: string): number {
  return first(body, ["prisma.", "$queryRaw", "$executeRaw"]);
}

/** Which gate a handler carries, and where its REFUSAL sits (the gate is the refusal, not the mention). */
function gateOf(h: Pick<Handler, "body" | "src">): Gate | null {
  const body = h.body;
  // A bearer token compared with a secret (the compare may sit in a helper of the same file): the handler
  // reads the header, and the 401 comes after it.
  const header = body.search(/authorization/i);
  if (header >= 0 && h.src.includes("Bearer ${")) {
    const refuse = body.indexOf("401", header);
    if (refuse >= 0) return { kind: "bearer", at: refuse };
  }
  // A webhook verifier: Resend/Svix, Twilio, Stripe.
  const sig = first(body, ["verifySignedEvent(", "signatureOk(", "constructEvent(", "verifySignature("]);
  if (sig >= 0) return { kind: "signature", at: sig };
  const staff = first(body, SESSION_GATES);
  if (staff >= 0) return { kind: "staff", at: staff };
  // A session whose role is compared and refused, in that order.
  const session = body.indexOf("getSession(");
  if (session >= 0) {
    const rest = body.slice(session);
    const compare = rest.search(ROLE_COMPARE);
    if (compare >= 0) {
      const refuse = rest.slice(compare).search(REFUSAL);
      if (refuse >= 0) return { kind: "session+role", at: session + compare + refuse };
    }
  }
  return null;
}

/** The sweep's own pass/fail: null when the handler is gated before its first read, else why not. Controls use this too. */
function verdictOf(h: Pick<Handler, "body" | "src">): string | null {
  const g = gateOf(h);
  if (!g) return "has no gate (a role must be compared and refused, a bearer or signature checked)";
  const read = firstDataRead(h.body);
  if (read >= 0 && read < g.at) return `reads the database before its ${g.kind} gate`;
  return null;
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
  return marks.map((m, i) => {
    const upTo = src.slice(m.index!, i + 1 < marks.length ? marks[i + 1].index! : src.length);
    // The handler ends at its closing brace in column 0, so a helper written below it is not its gate.
    const close = upTo.indexOf("\n}");
    return { file, method: m[1], body: close >= 0 ? upTo.slice(0, close + 2) : upTo, src };
  });
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
    const bad = HANDLERS.filter((h) => !(h.file in PUBLIC_ROUTES)).flatMap((h) => {
      const why = verdictOf(h);
      return why ? [`${h.file}: ${h.method} ${why}`] : [];
    });
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

  it("CONTROL: the sweep's own verdict flags every weak shape and passes the right one", () => {
    const v = (src: string) => verdictOf(handlersIn("x/route.ts", stripComments(src))[0]);
    // ungated
    expect(v("export async function GET() { return Response.json(await prisma.user.findMany()); }")).not.toBeNull();
    // a bare session, never checked
    expect(v("export async function GET() { const s = await getSession(); return Response.json({ ok: !!s }); }")).not.toBeNull();
    // the role only echoed
    expect(v("export async function GET() { const s = await getSession(); return Response.json({ role: s.role }); }")).not.toBeNull();
    // the role echoed, with a refusal that only asks whether anybody is signed in
    expect(v('export async function GET() { const s = await getSession(); const r = s?.role; if (!s) return Response.json({ r }, { status: 401 }); return Response.json({}); }')).not.toBeNull();
    // the read comes before the role check
    expect(
      v('export async function GET() {\n  const s = await getSession();\n  const e = await prisma.event.findMany();\n  if (s.role !== "admin") return Response.json({}, { status: 401 });\n  return Response.json(e);\n}'),
    ).toMatch(/before/);
    // a role compared but nothing refused
    expect(v('export async function GET() { const s = await getSession(); const a = s.role === "admin"; return Response.json({ a }); }')).not.toBeNull();
    // a read before a late bearer check
    expect(
      v('export async function GET(r: Request) { await prisma.club.findMany(); if (r.headers.get("authorization") !== `Bearer ${s}`) return new Response("no", { status: 401 }); }'),
    ).toMatch(/before/);
    // the header is read first, but the read of the database comes before the 401 refusal
    expect(v('export async function GET(r: Request) { const h = r.headers.get("authorization"); await prisma.club.findMany(); if (h !== `Bearer ${s}`) return new Response("no", { status: 401 }); }')).toMatch(/before/);
    // a gate named only in a comment
    expect(v("export async function GET() { // authorization Bearer ${s} 401\n return Response.json({}); }")).not.toBeNull();
    // a gate in a helper BELOW the handler is not the handler's
    expect(v("export async function GET() {\n  return Response.json({});\n}\n\nfunction later(r: Request) { return verifySignedEvent({}); }")).not.toBeNull();
    // the right shape: session, role compared, refused, then the read (the console play-status door)
    expect(
      v('export async function GET() {\n  const session = await getSession();\n  if (!session || (session.role !== "admin" && session.role !== "assistant")) {\n    return NextResponse.json({ ok: false }, { status: 401 });\n  }\n  const e = await prisma.event.findUnique({ where: { id: session.eventId } });\n  return NextResponse.json({ e });\n}'),
    ).toBeNull();
    // a second handler in the same file is judged on its own
    const two = handlersIn(
      "x/route.ts",
      "export async function GET() { return 1; }\nexport async function POST(r: Request) { await verifySignedEvent({}); }",
    );
    expect(two.map((h) => verdictOf(h) === null)).toEqual([false, true]);
  });
});
