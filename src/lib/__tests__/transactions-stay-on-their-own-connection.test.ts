import { describe, expect, it } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { readSource, stripComments } from "./source";

/**
 * A TRANSACTION STAYS ON ITS OWN CONNECTION (2026-11-09).
 *
 * `prisma.$transaction(async (tx) => …)` holds ONE pooled connection for as
 * long as the callback runs, and everything the callback does on `tx` goes
 * down that connection, inside the transaction's atomicity and its five-second
 * limit. Anything it does on the bare `prisma` client instead needs a SECOND
 * connection from the pool, is outside the transaction (it sees and leaves
 * state the transaction has not committed), and is outside its timeout: when
 * the pool is slow to hand over that second connection the transaction's clock
 * keeps running, the commit fails with P2028 "Transaction already closed", and
 * the action throws instead of answering. The nightly of 2026-11-09 found the
 * first one (`a-prize-transaction-reads-on-its-own-connection.test.ts` is its
 * story): the organizer's Prizes screen became "This screen didn't load" where a
 * refusal in words should have been.
 *
 * That was one read in one helper. This file closes the class, in two shapes:
 *
 *  - DIRECT: `prisma.` written inside the callback body itself.
 *  - INDIRECT: the callback hands its work to a helper, and the helper reaches
 *    for the bare client — which is exactly how the first one was written.
 *
 * The indirect shape cannot be seen from the callback alone, so the rule is
 * stated for every TRANSACTION SCOPE — the callback, and every function that
 * is handed a client as a parameter (`tx: Tx`, `tx: PrizeTx`,
 * `db: Pick<typeof prisma, …>`, `Prisma.TransactionClient`) — and it is the
 * same rule in both:
 *
 *  1. the bare `prisma` is never named (not read, not written, not passed on);
 *  2. everything AWAITED is on the scope's client, or is a call that is handed
 *     the client as an argument;
 *  3. a call RETURNED (or an expression-bodied arrow) that is a plain function
 *     of this module's own is handed the client too.
 *
 * (2) and (3) are what make the class closed rather than the one defect
 * fixed: every helper the body waits on is itself a scope under rule (1),
 * so a bare read two helpers deep is found at the helper, and a helper that
 * forgot to take the client is found at the call. The database is never
 * touched here — the source is read, comments stripped, braces matched — and
 * the controls at the bottom plant each shape to prove the scanner sees it.
 *
 * A legitimate await on something that is not the database (a hash, say) is
 * named in `KNOWN_OFF_CLIENT` with its reason; nothing is there today.
 */

const ROOT = process.cwd();

/** `file:line text` → why the await is not a database call. Empty on purpose. */
const KNOWN_OFF_CLIENT: Record<string, string> = {};

/** A parameter of one of these types is a database client handed in by the caller. */
const CLIENT_TYPE = /^\s*(?:Prisma\.)?TransactionClient\b|^\s*\w*Tx\b|^\s*Pick<\s*typeof\s+prisma\b|^\s*typeof\s+prisma\b|^\s*PrismaClient\b/;

/** Plain-identifier calls that never reach a database, so a `return` of one is fine. */
const GLOBALS = new Set([
  "String", "Number", "Boolean", "Array", "Object", "Promise", "Error", "Map", "Set", "Date", "JSON", "Math",
  "parseInt", "parseFloat", "isNaN", "isFinite", "BigInt", "Symbol", "RegExp", "structuredClone",
]);

// ---------------------------------------------------------------------------
// Reading code: strings, template literals, regex literals and brackets.
// ---------------------------------------------------------------------------

const CLOSER: Record<string, string> = { "{": "}", "(": ")", "[": "]" };
// "" is the start of a slice: an argument list sliced out of its parentheses may begin with a regex.
const BEFORE_REGEX = new Set(["", "(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";", "+", "-", "*", "%", "<", ">", "~", "^"]);

/** Index just past the string literal that opens at `i`. A `${…}` inside a template is code and is walked as code. */
function pastString(src: string, i: number): number {
  const q = src[i];
  i += 1;
  while (i < src.length) {
    const c = src[i];
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (c === q) return i + 1;
    if (q === "`" && c === "$" && src[i + 1] === "{") {
      i = closerOf(src, i + 1) + 1;
      continue;
    }
    i += 1;
  }
  return i;
}

/** Index just past a regex literal opening at `i`, or `i` when the slash is a division after all. */
function pastRegex(src: string, i: number): number {
  let j = i + 1;
  let inClass = false;
  while (j < src.length) {
    const c = src[j];
    if (c === "\n") return i;
    if (c === "\\") {
      j += 2;
      continue;
    }
    if (inClass) {
      if (c === "]") inClass = false;
    } else if (c === "[") inClass = true;
    else if (c === "/") {
      j += 1;
      while (j < src.length && /[a-z]/.test(src[j])) j += 1;
      return j;
    }
    j += 1;
  }
  return i;
}

function lastSignificant(src: string, before: number): string {
  let k = before - 1;
  while (k >= 0 && /\s/.test(src[k])) k -= 1;
  return k >= 0 ? src[k] : "";
}

/** Index just past the string or regex literal that opens at `i`, or `i` when there is none. */
function pastLiteral(src: string, i: number): number {
  const c = src[i];
  if (c === '"' || c === "'" || c === "`") return pastString(src, i);
  if (c === "/" && BEFORE_REGEX.has(lastSignificant(src, i))) return pastRegex(src, i);
  return i;
}

/** Index of the bracket that closes the one at `open`; strings and regex literals are stepped over. */
function closerOf(src: string, open: number): number {
  const stack: string[] = [];
  let i = open;
  while (i < src.length) {
    const c = src[i];
    const past = pastLiteral(src, i);
    if (past > i) {
      i = past;
      continue;
    }
    if (c in CLOSER) stack.push(CLOSER[c]);
    else if (c === "}" || c === ")" || c === "]") {
      const want = stack.pop();
      if (want !== c) throw new Error(`unbalanced bracket at ${open}: expected ${want} but found ${c} at ${i}`);
      if (stack.length === 0) return i;
    }
    i += 1;
  }
  throw new Error(`the bracket at ${open} never closes`);
}

/** The text split at top-level commas. `angles` also treats `<…>` as a bracket, for parameter lists. */
function splitTop(text: string, angles: boolean): string[] {
  const out: string[] = [];
  let depthAngle = 0;
  let start = 0;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const past = pastLiteral(text, i);
    if (past > i) {
      i = past;
      continue;
    }
    if (c in CLOSER) {
      i = closerOf(text, i) + 1;
      continue;
    }
    if (angles) {
      if (c === "=" && text[i + 1] === ">") {
        i += 2;
        continue;
      }
      if (c === "<") depthAngle += 1;
      else if (c === ">") depthAngle -= 1;
    }
    if (c === "," && depthAngle === 0) {
      out.push(text.slice(start, i));
      start = i + 1;
    }
    i += 1;
  }
  out.push(text.slice(start));
  return out.map((s) => s.trim()).filter((s) => s.length > 0);
}

/** Every top-level opening bracket of the given kind, in order. */
function openers(src: string, kind: "(" | "{"): number[] {
  const out: number[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const past = pastLiteral(src, i);
    if (past > i) {
      i = past;
      continue;
    }
    if (c === kind) out.push(i);
    i += 1;
  }
  return out;
}

const lineOf = (src: string, at: number): number => src.slice(0, at).split("\n").length;

// ---------------------------------------------------------------------------
// Finding the scopes: transaction callbacks and client-parameter functions.
// ---------------------------------------------------------------------------

interface Scope {
  /** Where it is, for the message. */
  label: string;
  /** The parameter the client arrives on: `tx`, `db`, … */
  client: string;
  /** The code of the body (a block's inside, or an expression), and where it starts in the file. */
  body: string;
  at: number;
  /** An expression-bodied arrow: the whole body is what it returns. */
  expression: boolean;
}

/**
 * After a parameter list's `)`: skips a return type and answers where the body
 * is — a block's `{`, an arrow's `=>`, or null when this was no function at all.
 */
function bodyStart(src: string, afterParams: number): { kind: "block" | "arrow"; at: number } | null {
  let i = afterParams;
  while (i < src.length && /\s/.test(src[i])) i += 1;
  if (src[i] === ":") {
    // A return type: read it until a `{` or `=>` at depth 0 that is not part of the type.
    i += 1;
    let angle = 0;
    while (i < src.length) {
      const c = src[i];
      const past = pastLiteral(src, i);
      if (past > i) {
        i = past;
        continue;
      }
      if (c === "=" && src[i + 1] === ">") {
        if (angle === 0) return { kind: "arrow", at: i };
        i += 2;
        continue;
      }
      if (c === "<") angle += 1;
      else if (c === ">") angle -= 1;
      else if (c === "(" || c === "[") {
        i = closerOf(src, i) + 1;
        continue;
      } else if (c === "{") {
        const prev = lastSignificant(src, i);
        if (angle === 0 && !/[:|&,=]/.test(prev)) return { kind: "block", at: i };
        i = closerOf(src, i) + 1;
        continue;
      } else if ((c === ";" || c === ",") && angle === 0) return null;
      i += 1;
    }
    return null;
  }
  if (src[i] === "{") return { kind: "block", at: i };
  if (src[i] === "=" && src[i + 1] === ">") return { kind: "arrow", at: i };
  return null;
}

/** The expression after an arrow's `=>`, to the end of its statement. */
function arrowBody(src: string, arrowAt: number): { body: string; at: number; expression: boolean } {
  let i = arrowAt + 2;
  while (i < src.length && /\s/.test(src[i])) i += 1;
  if (src[i] === "{") {
    const end = closerOf(src, i);
    return { body: src.slice(i + 1, end), at: i + 1, expression: false };
  }
  const start = i;
  while (i < src.length) {
    const c = src[i];
    const past = pastLiteral(src, i);
    if (past > i) {
      i = past;
      continue;
    }
    if (c in CLOSER) {
      i = closerOf(src, i) + 1;
      continue;
    }
    if (c === ";" || c === "," || c === ")" || c === "]" || c === "}") break;
    i += 1;
  }
  return { body: src.slice(start, i), at: start, expression: true };
}

function scopesIn(src: string, file: string): Scope[] {
  const scopes: Scope[] = [];

  // 1. Every interactive transaction's callback.
  const tx = /\$transaction\s*\(/g;
  for (let m = tx.exec(src); m; m = tx.exec(src)) {
    const open = m.index + m[0].length - 1;
    const close = closerOf(src, open);
    const args = src.slice(open + 1, close);
    const cb = /^\s*async\s*\(\s*([\w$]+)\s*(?::[^)]*)?\)\s*=>/.exec(args);
    if (!cb) continue; // the batch form, `$transaction([ … ])`, holds no callback
    const arrowAt = open + 1 + cb[0].length - 2;
    const { body, at, expression } = arrowBody(src, arrowAt);
    scopes.push({ label: `${file}:${lineOf(src, m.index)} $transaction(async (${cb[1]}) => …)`, client: cb[1], body, at, expression });
  }

  // 2. Every function handed a client as a parameter.
  for (const open of openers(src, "(")) {
    if (lastSignificant(src, open) === ":") continue; // `fn: (tx: …) => …` is a TYPE, not a function
    let close: number;
    try {
      close = closerOf(src, open);
    } catch {
      continue;
    }
    const params = splitTop(src.slice(open + 1, close), true);
    const client = params
      .map((p) => /^([\w$]+)\s*\??\s*:\s*([\s\S]+)$/.exec(p))
      .find((p) => p && CLIENT_TYPE.test(p[2]));
    if (!client) continue;
    const start = bodyStart(src, close + 1);
    if (!start) continue;
    // `function liftArchive(`, `const findDuplicate = (`, `const f = async (`, `withLock<T>(`
    const name = /([\w$]+)\s*(?:<[^()]*>)?\s*(?:=\s*(?:async\s*)?)?$/.exec(src.slice(Math.max(0, open - 120), open))?.[1] ?? "(arrow)";
    if (start.kind === "block") {
      const end = closerOf(src, start.at);
      scopes.push({ label: `${file}:${lineOf(src, open)} ${name}(${client[1]})`, client: client[1], body: src.slice(start.at + 1, end), at: start.at + 1, expression: false });
    } else {
      const { body, at, expression } = arrowBody(src, start.at);
      scopes.push({ label: `${file}:${lineOf(src, open)} ${name}(${client[1]}) =>`, client: client[1], body, at, expression });
    }
  }
  return scopes;
}

// ---------------------------------------------------------------------------
// The rule, applied to one scope.
// ---------------------------------------------------------------------------

interface Offence {
  where: string;
  text: string;
  why: string;
}

/** `name` is among the call's top-level arguments. */
function handedClient(args: string, name: string): boolean {
  return splitTop(args, false).some((a) => a === name);
}

/** The callee chain at `i` (`tx.player.count`, `Promise.all`, `names`), or "" when there is none. */
function calleeAt(body: string, i: number): string {
  return /^[\w$][\w$.]*/.exec(body.slice(i))?.[0] ?? "";
}

/** Whether the call `callee(args)` goes through the client; Promise combinators look inside. */
function callOnClient(callee: string, args: string, name: string): boolean {
  if (callee === name || callee.startsWith(`${name}.`)) return true;
  if (handedClient(args, name)) return true;
  if (/^Promise\.(all|allSettled|race|any)$/.test(callee)) {
    const inner = /([\w$][\w$.]*)\s*\(/g;
    let any = false;
    for (let m = inner.exec(args); m; m = inner.exec(args)) {
      if (GLOBALS.has(m[1]) || /^new\s/.test(args.slice(Math.max(0, m.index - 4), m.index))) continue;
      any = true;
      const open = m.index + m[0].length - 1;
      if (!callOnClient(m[1], args.slice(open + 1, closerOf(args, open)), name)) return false;
    }
    return any;
  }
  return false;
}

function offencesIn(scope: Scope, src: string): Offence[] {
  const out: Offence[] = [];
  const { body, client } = scope;
  const where = (i: number) => `${scope.label.split(" ")[0].replace(/:\d+$/, "")}:${lineOf(src, scope.at + i)}`;
  const lineText = (i: number) => body.slice(body.lastIndexOf("\n", i) + 1, body.indexOf("\n", i) < 0 ? undefined : body.indexOf("\n", i)).trim();

  // 1. The bare client is never named.
  const bare = /(?<!typeof\s)(?<![\w$.])prisma(?![\w$])/g;
  for (let m = bare.exec(body); m; m = bare.exec(body)) {
    out.push({ where: where(m.index), text: lineText(m.index), why: `names the bare \`prisma\` inside a transaction scope — use \`${client}\`` });
  }

  // 2. Everything awaited is on the client, or is handed it.
  const awaits = /\bawait\s+/g;
  for (let m = awaits.exec(body); m; m = awaits.exec(body)) {
    const i = m.index + m[0].length;
    const callee = calleeAt(body, i);
    if (callee === client || callee.startsWith(`${client}.`)) continue;
    const afterCallee = i + callee.length;
    const next = body[afterCallee] === " " ? afterCallee + 1 : afterCallee;
    let ok = false;
    if (callee && body[next] === "(") {
      const close = closerOf(body, next);
      ok = callOnClient(callee, body.slice(next + 1, close), client);
    }
    if (!ok) {
      const key = `${where(m.index)} ${lineText(m.index)}`;
      if (key in KNOWN_OFF_CLIENT) continue;
      out.push({ where: where(m.index), text: lineText(m.index), why: `awaits something that is not on \`${client}\` and is not handed \`${client}\` — a database call here runs on a second connection, outside the transaction` });
    }
  }

  // 3. A returned (or expression-bodied) call to one of this module's own functions is handed the client.
  const returns: number[] = scope.expression ? [Math.max(0, body.search(/\S/))] : [];
  const ret = /\breturn\s+/g;
  for (let m = ret.exec(body); m; m = ret.exec(body)) returns.push(m.index + m[0].length);
  for (const i of returns) {
    const callee = calleeAt(body, i);
    if (!callee || callee.includes(".") || GLOBALS.has(callee) || callee === client) continue;
    const afterCallee = i + callee.length;
    if (body[afterCallee] !== "(") continue;
    if (/^(await|new|typeof|void)$/.test(callee)) continue;
    const close = closerOf(body, afterCallee);
    if (!handedClient(body.slice(afterCallee + 1, close), client)) {
      out.push({ where: where(i), text: lineText(i), why: `returns \`${callee}(…)\` without handing it \`${client}\` — if it reaches the database it does so on a second connection; if it is pure, name it in KNOWN_OFF_CLIENT` });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The corpus.
// ---------------------------------------------------------------------------

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e === "__tests__") continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (e.endsWith(".ts") && !/\.(test|spec|audit\.test)\.ts$/.test(e) && !e.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

const rel = (p: string) => p.replace(ROOT + "\\", "").replace(ROOT + "/", "").replace(/\\/g, "/");
const FILES = sourceFiles(join(ROOT, "src")).map(rel);

function sweep(file: string, src: string): { scopes: Scope[]; offences: Offence[] } {
  try {
    const scopes = scopesIn(src, file);
    return { scopes, offences: scopes.flatMap((s) => offencesIn(s, src)) };
  } catch (e) {
    throw new Error(`${file}: ${(e as Error).message}`);
  }
}

describe("a transaction stays on its own connection", () => {
  const swept = FILES.map((f) => ({ file: f, ...sweep(f, readSource(f)) }));
  const callbacks = swept.flatMap((s) => s.scopes.filter((x) => x.label.includes("$transaction")));
  const helpers = swept.flatMap((s) => s.scopes.filter((x) => !x.label.includes("$transaction")));

  it("sweeps the real corpus and finds the transactions that are there", () => {
    expect(FILES.length).toBeGreaterThan(200);
    expect(FILES).toContain("src/lib/services/intake-lock.ts");
    // Every interactive transaction the repository held on 2026-11-09, so a finder that
    // stopped seeing them could not pass by seeing nothing.
    expect(callbacks.length).toBeGreaterThanOrEqual(15);
    expect(callbacks.map((c) => c.label.split(" ")[0].replace(/:\d+$/, ""))).toEqual(
      expect.arrayContaining([
        "src/lib/services/intake-lock.ts",
        "src/lib/services/purge.ts",
        "src/lib/services/regroup.ts",
        "src/lib/services/stroke-cut.ts",
        "src/lib/services/billing.ts",
        "src/app/actions/tournament.ts",
        "src/app/actions/owner.ts",
        "src/app/actions/courses.ts",
        "src/app/actions/player-index.ts",
      ]),
    );
    // The helpers handed a client: the shape the first defect hid in.
    expect(helpers.map((h) => h.label.split(" ").slice(1).join(" "))).toEqual(
      expect.arrayContaining(["liftArchive(tx)", "deleteRoundRows(tx)", "prizeHoldings(tx)", "lockEventForPrizes(tx)", "prizeWinnerNames(tx)", "findDuplicate(db) =>"]),
    );
  });

  for (const s of swept) {
    if (s.scopes.length === 0) continue;
    it(`${s.file}: every transaction scope stays on its client`, () => {
      const said = s.offences.map((o) => `  ${o.where}  ${o.text}\n    ${o.why}`).join("\n");
      expect(s.offences, `\n${said}\n`).toEqual([]);
    });
  }

  it("KNOWN_OFF_CLIENT names only lines that exist", () => {
    const all = new Set(swept.flatMap((s) => s.offences.map((o) => `${o.where} ${o.text}`)));
    for (const key of Object.keys(KNOWN_OFF_CLIENT)) expect(all.has(key) || swept.some((s) => readSource(s.file).includes(key.split(" ").slice(1).join(" "))), key).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Controls: each shape planted, each seen; the clean shapes, left alone.
// ---------------------------------------------------------------------------

const plant = (code: string) => sweep("planted.ts", stripComments(code));

describe("the control: the scanner sees each shape it bans", () => {
  it("DIRECT — the bare client inside the callback body", () => {
    const { offences } = plant(`
      export async function f(eventId: string) {
        return prisma.$transaction(async (tx) => {
          await tx.event.update({ where: { id: eventId }, data: { a: "}" } });
          const rows = await prisma.player.findMany({ where: { eventId } });
          return rows.length;
        });
      }`);
    expect(offences.map((o) => o.why)).toEqual([expect.stringContaining("names the bare `prisma`"), expect.stringContaining("awaits something that is not on `tx`")]);
    expect(offences[0].where).toBe("planted.ts:5");
  });

  it("INDIRECT — a helper awaited inside the callback without the client", () => {
    const { offences } = plant(`
      async function names(eventId: string, ids: string[]) {
        return prisma.player.findMany({ where: { eventId, id: { in: ids } } });
      }
      export async function f(eventId: string) {
        const out = await prisma.$transaction(async (tx) => {
          const held = await tx.prize.findMany({ where: { eventId } });
          const byName = await names(eventId, held.map((h) => h.winnerId));
          return byName.size;
        });
        return out;
      }`);
    expect(offences).toHaveLength(1);
    expect(offences[0].why).toContain("awaits something that is not on `tx` and is not handed `tx`");
    expect(offences[0].text).toContain("names(eventId");
  });

  it("INDIRECT — a helper that TAKES the client and reaches past it", () => {
    const { offences } = plant(`
      type Tx = Prisma.TransactionClient;
      async function names(tx: Tx, eventId: string): Promise<Map<string, string>> {
        const rows = await prisma.player.findMany({ where: { eventId } });
        return new Map(rows.map((r) => [r.id, r.name]));
      }`);
    expect(offences.map((o) => o.why)).toEqual([expect.stringContaining("names the bare `prisma`"), expect.stringContaining("awaits something that is not on `tx`")]);
  });

  it("INDIRECT — a helper that takes the client and returns another helper's promise without it", () => {
    const { offences } = plant(`
      async function names(tx: PrizeTx, eventId: string, ids: string[]) {
        return lookUp(eventId, ids);
      }
      const other = (db: Pick<typeof prisma, "player">, eventId: string) => lookUp(eventId);`);
    expect(offences.map((o) => o.why)).toEqual([expect.stringContaining("returns `lookUp(…)` without handing it `tx`"), expect.stringContaining("returns `lookUp(…)` without handing it `db`")]);
  });

  it("a bare read AFTER the callback closes is not inside it (the brace matching)", () => {
    const { scopes, offences } = plant(`
      export async function f(eventId: string) {
        await prisma.$transaction(async (tx) => {
          for (const id of ids) {
            if (!held.has(id)) {
              await tx.scorecard.create({ data: { eventId, strokes: "[null, {}]" } });
            }
          }
          await tx.$executeRaw\`SELECT pg_advisory_xact_lock(hashtext(\${eventId}))\`;
          const stale = existing.filter((c) => /[{(]/.test(c.name)).map((c) => c.id);
          if (stale.length > 0) await tx.scorecard.deleteMany({ where: { id: { in: stale } } });
        }, { timeout: 60_000 });
        const after = await prisma.auditLog.create({ data: { eventId } });
        return after;
      }`);
    expect(scopes).toHaveLength(1);
    expect(scopes[0].body).toContain("deleteMany");
    expect(scopes[0].body).not.toContain("auditLog");
    expect(offences).toEqual([]);
  });

  it("the clean shapes: handed on, returned on, batched, typed, a tx-taking opener", () => {
    const { scopes, offences } = plant(`
      export async function withLock<T>(eventId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
        return prisma.$transaction(async (tx) => {
          await tx.$executeRaw\`SELECT 1\`;
          return fn(tx);
        });
      }
      async function lift(tx: Tx, organizationId: string): Promise<void> {
        await tx.event.updateMany({ where: { organizationId }, data: { archivedAt: null } });
        await Promise.all([tx.subscription.updateMany({ where: { organizationId }, data: {} }), other(tx, organizationId)]);
      }
      export async function f(organizationId: string) {
        await prisma.$transaction(async (tx) => {
          await tx.subscription.upsert({ where: { organizationId }, update: {}, create: { organizationId } });
          if (keeps(plan)) await lift(tx, organizationId);
          const rows = await more(organizationId, tx);
          return rows.map((r) => r.id);
        });
        await prisma.$transaction([prisma.a.deleteMany({}), prisma.b.deleteMany({})]);
        const fresh = await prisma.event.findMany({ where: { organizationId } });
        return fresh;
      }`);
    expect(scopes.map((s) => s.label.split(" ").slice(1).join(" "))).toEqual(["$transaction(async (tx) => …)", "$transaction(async (tx) => …)", "lift(tx)"]);
    expect(offences).toEqual([]);
  });

  it("a Promise.all inside the body is looked into", () => {
    const { offences } = plant(`
      await prisma.$transaction(async (tx) => {
        const [a, b] = await Promise.all([tx.player.count({ where }), names(eventId)]);
        return a + b;
      });`);
    expect(offences).toHaveLength(1);
    expect(offences[0].text).toContain("Promise.all");
  });
});
