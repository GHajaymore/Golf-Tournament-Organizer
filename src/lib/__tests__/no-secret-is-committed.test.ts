import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import { statSync } from "node:fs";
import { join } from "node:path";
import { readVerbatim } from "./source";

/**
 * THE REPOSITORY IS PUBLIC, SO NOTHING IN IT MAY BE A KEY.
 *
 * CLAUDE.md's second hard rule is about people's names. This is the same rule
 * for credentials, and it had no instrument: a token pasted into a script to
 * try something, a database address in a doc, an `.env` added by `git add` on
 * a tired evening — each is in the history of a public repository for ever the
 * moment it is pushed, and each would have passed every test this project has.
 *
 * So every file git tracks is read, whole, comments included (a key in a
 * comment is a key), for the SHAPES credentials have. Shapes rather than
 * names: the word DATABASE_URL in a sentence is not a leak; a database address
 * with a password in it is.
 *
 * WHAT THIS CANNOT SEE: a key with no recognisable shape, anything already in
 * the history, and a file git has not been told about yet — which is why it
 * runs on every push, when the file HAS just been told about.
 */

const root = process.cwd();
const tracked = execSync("git ls-files", { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  .split("\n")
  .map((f) => f.trim())
  .filter(Boolean);

/** Not text, or not ours to read: pictures, fonts, the lockfile (hashes by the thousand), generated PDFs. */
const SKIP = /\.(png|jpe?g|webp|gif|ico|svg|woff2?|ttf|otf|pdf|zip|icns|mp4|lock)$|(^|\/)package-lock\.json$/i;

/** Passwords that are plainly not: a placeholder in an example, or the throwaway database a test runner makes. */
const PLACEHOLDER = /^(password|passwd|pass|postgres|secret|changeme|example|user|xxx+|\.\.\.|<[^>]*>|\$\{?[A-Z_]+\}?|\[[^\]]*\]|your[-_a-z]*)$/i;
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|postgres|db|host|hostname|example\.com|<[^>]*>|\$\{?[A-Z_]+\}?)(:\d+)?$/i;

type Hit = { what: string; text: string };

function secretsIn(text: string): Hit[] {
  const hits: Hit[] = [];
  const add = (what: string, pattern: RegExp) => {
    for (const m of text.matchAll(pattern)) hits.push({ what, text: m[0].slice(0, 24) + "…" });
  };
  add("a private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/g);
  add("an AWS access key", /\bAKIA[0-9A-Z]{16}\b/g);
  add("a GitHub token", /\bgh[pousr]_[0-9A-Za-z]{36,}\b/g);
  add("a live payment key", /\b[sr]k_live_[0-9A-Za-z]{16,}\b/g);
  add("a Slack token", /\bxox[baprs]-[0-9A-Za-z-]{20,}\b/g);
  add("a Google API key", /\bAIza[0-9A-Za-z_-]{35}\b/g);
  add("a mail provider key", /\b(re_[0-9A-Za-z]{24,}|SG\.[0-9A-Za-z_-]{16,}\.[0-9A-Za-z_-]{16,})\b/g);
  // A database (or any) address with a real password in it, on a host that is not this machine.
  for (const m of text.matchAll(/\b[a-z][a-z0-9+.-]*:\/\/([^\s:@/"'`]+):([^\s@/"'`]+)@([^\s/"'`?#]+)/gi)) {
    const [, , password, host] = m;
    if (PLACEHOLDER.test(password) || LOCAL_HOST.test(host)) continue;
    hits.push({ what: "an address with a password in it", text: m[0].replace(password, "•••").slice(0, 60) });
  }
  return hits;
}

describe("nothing committed is a credential", () => {
  it("CONTROL: the detector knows a key when it sees one, and an example when it sees one", () => {
    // Built at run time, so this file does not itself contain what it looks for.
    const key = ["-----BEGIN RSA ", "PRIVATE KEY-----"].join("");
    const aws = "AKIA" + "ABCDEFGHIJKLMNOP";
    const hub = "ghp_" + "a".repeat(36);
    const db = "postgresql://" + "app:" + "s3cr3tPassw0rd" + "@db.internal.example.net:5432/app";
    expect(secretsIn(key)).toHaveLength(1);
    expect(secretsIn(aws)).toHaveLength(1);
    expect(secretsIn(hub)).toHaveLength(1);
    expect(secretsIn(db)).toHaveLength(1);
    // The runner's throwaway database, a documented placeholder, and prose that names a setting.
    expect(secretsIn("postgresql://postgres:postgres@localhost:5432/tourneyhq_ci")).toEqual([]);
    expect(secretsIn("postgresql://USER:PASSWORD@HOST:5432/DB")).toEqual([]);
    expect(secretsIn("set DATABASE_URL and AUTH_SECRET before starting")).toEqual([]);
    expect(secretsIn("https://tourneyhq.club/faq")).toEqual([]);
  });

  it("the sweep reads the repository, not a corner of it", () => {
    expect(tracked.length).toBeGreaterThan(900);
    expect(tracked).toContain("src/lib/auth.ts");
    expect(tracked).toContain(".github/workflows/ci.yml");
  });

  it("no environment file is tracked, except the example", () => {
    const env = tracked.filter((f) => /(^|\/)\.env(\..+)?$/.test(f) && !/\.example$/.test(f));
    expect(env, "an environment file is in the repository").toEqual([]);
  });

  it("no tracked file carries a key, a token or an address with a password in it", () => {
    const found: string[] = [];
    let read = 0;
    for (const file of tracked) {
      if (SKIP.test(file)) continue;
      let size = 0;
      try {
        size = statSync(join(root, file)).size;
      } catch {
        continue; // deleted in the working tree, still in the index
      }
      if (size > 2_000_000) continue;
      read += 1;
      for (const hit of secretsIn(readVerbatim(file))) found.push(`${file}: ${hit.what} — ${hit.text}`);
    }
    expect(read, "almost nothing was read").toBeGreaterThan(800);
    expect(found).toEqual([]);
  });
});
