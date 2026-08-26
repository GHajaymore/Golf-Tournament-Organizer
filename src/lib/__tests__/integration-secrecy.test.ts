import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, sep } from "node:path";

/**
 * An association credential must not leave the server.
 *
 * `Integration.secret` is the first real secret this app stores. Everything
 * else it holds is a fact about a golf tournament; this is a key that lets
 * somebody act as the club against their association — reading members'
 * indexes and, where the club has that permission, writing to their official
 * records.
 *
 * The rule is easy to hold today and easy to break in six months, because the
 * way it breaks is somebody building a perfectly reasonable settings screen
 * that shows the current value so an organizer can check it. So it is a guard
 * that reads the source rather than a note in a comment.
 *
 * Three things it enforces:
 *
 *   - no client component imports the integration service at all;
 *   - nothing selects `secret` except the one service allowed to;
 *   - the audit log never records it, because an audit trail is exactly the
 *     place a leaked credential would sit unnoticed for a year.
 */

const SRC = join(process.cwd(), "src");
const ALLOWED = join("lib", "services", "integrations.ts");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(e.name)) out.push(full);
  }
  return out;
}

const files = walk(SRC).filter((f) => !f.includes("__tests__"));
const rel = (f: string) => f.replace(SRC + sep, "");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("an association credential never leaves the server", () => {
  it("has files to check, so this cannot pass vacuously", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it("is selected in exactly one place", () => {
    /**
     * `select: { secret: true }` anywhere else is the shape that leaks it. A
     * page that selects it to decide whether to show "connected" has put the
     * key into the HTML — the boolean is the thing to send, never the value.
     */
    const offenders = files.filter((f) => {
      if (rel(f) === ALLOWED) return false;
      const src = strip(readFileSync(f, "utf8"));
      return /\bsecret:\s*true\b/.test(src);
    });
    expect(offenders.map(rel), "only services/integrations.ts may select the secret").toEqual([]);
  });

  it("is never written to the audit log", () => {
    // An audit trail is precisely where a leaked credential would sit
    // unnoticed for a year, because nobody reads one until something is wrong.
    const offenders = files.filter((f) => {
      const src = strip(readFileSync(f, "utf8"));
      if (!/auditLog\.create/.test(src)) return false;
      return /\bsecret\b/.test(src);
    });
    expect(offenders.map(rel), "the audit log must never carry a credential").toEqual([]);
  });

  it("is never reached from a client component", () => {
    // A "use client" file importing the integration service would pull the
    // credential path into the browser bundle.
    const offenders = files.filter((f) => {
      const src = readFileSync(f, "utf8");
      if (!/^["']use client["']/m.test(src)) return false;
      return /services\/integrations/.test(src);
    });
    expect(offenders.map(rel), "client components must not import the integration service").toEqual(
      [],
    );
  });

  it("keeps the service server-only, so an accidental import fails loudly", () => {
    const service = readFileSync(join(SRC, ALLOWED), "utf8");
    expect(service).toMatch(/import ["']server-only["']/);
  });
});
