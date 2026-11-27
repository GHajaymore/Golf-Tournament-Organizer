import { describe, it, expect, afterEach, vi } from "vitest";
import { createRequire } from "node:module";
import { readFileSync, readdirSync, statSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { createServer, request as httpRequest, Server } from "node:http";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { watchNavigation, serverLinesSince } from "../../../e2e/goto-watchdog";

/**
 * B112 (27 Nov 2026): the test server's slow-request log and the navigation watchdog that reads it.
 * Both are test tooling. The promises: the log is OFF without the variable only the e2e webServer sets
 * (so production, which never loads it, cannot run it), it ON with the variable (the control), and the
 * watchdog only ever logs.
 */
const root = join(__dirname, "..", "..", "..");
const nodeRequire = createRequire(join(root, "package.json"));
const modulePath = join(root, "scripts", "ci", "slow-request-log.cjs");
const freshLog = () => {
  delete nodeRequire.cache[nodeRequire.resolve(modulePath)];
  return nodeRequire(modulePath) as {
    install: (env: Record<string, string | undefined>, write?: (line: string) => void) => boolean;
    thresholdMs: (env: Record<string, string | undefined>) => number;
  };
};

const realEmit = Server.prototype.emit;
afterEach(() => {
  Server.prototype.emit = realEmit;
  vi.restoreAllMocks();
});

const get = (port: number, path: string) =>
  new Promise<void>((resolve, reject) => {
    httpRequest({ port, path, agent: false }, (res) => {
      res.resume();
      res.on("end", () => resolve());
    })
      .on("error", reject)
      .end();
  });

describe("the slow-request log is off unless the e2e server turns it on", () => {
  it("does nothing without E2E_SLOW_REQUEST_MS: http.Server is untouched", () => {
    for (const env of [{}, { E2E_SLOW_REQUEST_MS: "" }, { E2E_SLOW_REQUEST_MS: "0" }, { E2E_SLOW_REQUEST_MS: "soon" }, { E2E_SLOW_REQUEST_MS: "-5" }]) {
      const log = freshLog();
      expect(log.install(env)).toBe(false);
      expect(Server.prototype.emit).toBe(realEmit);
    }
  });

  it("loading the file with the variable unset leaves http.Server untouched too (what a stray require would do)", () => {
    const saved = process.env.E2E_SLOW_REQUEST_MS;
    delete process.env.E2E_SLOW_REQUEST_MS;
    try {
      freshLog();
      expect(Server.prototype.emit).toBe(realEmit);
    } finally {
      if (saved !== undefined) process.env.E2E_SLOW_REQUEST_MS = saved;
    }
  });

  it("CONTROL: with the variable set it logs a slow request (OPEN while pending, SLOW at the end) and not a fast one", async () => {
    const lines: string[] = [];
    expect(freshLog().install({ E2E_SLOW_REQUEST_MS: "60" }, (l) => lines.push(l))).toBe(true);
    expect(Server.prototype.emit).not.toBe(realEmit);
    const server = createServer((req, res) => {
      const wait = req.url?.startsWith("/slow") ? 200 : 0;
      setTimeout(() => res.end("ok"), wait);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;
    try {
      await get(port, "/fast?x=1");
      expect(lines).toEqual([]);
      await get(port, "/slow?bust=123");
      const open = lines.find((l) => l.includes(" OPEN "));
      const slow = lines.find((l) => l.includes(" SLOW "));
      expect(open).toMatch(/\[slow-request\] OPEN GET \/slow\?bust=123 after \d+ ms status=200 headers=not sent/);
      expect(slow).toMatch(/\[slow-request\] SLOW GET \/slow\?bust=123 total \d+ ms \(finished\) status=200 headers=\d+ ms/);
    } finally {
      await new Promise((r) => server.close(r));
    }
  });

  it("installs once however often it is asked", () => {
    const log = freshLog();
    log.install({ E2E_SLOW_REQUEST_MS: "60" }, () => {});
    const first = Server.prototype.emit;
    expect(log.install({ E2E_SLOW_REQUEST_MS: "60" }, () => {})).toBe(true);
    expect(Server.prototype.emit).toBe(first);
  });

  it("is switched on in the e2e webServer's env and nowhere in the application", () => {
    const config = readFileSync(join(root, "playwright.config.ts"), "utf8");
    expect(config).toContain("E2E_SLOW_REQUEST_MS");
    expect(config).toContain("--require ./scripts/ci/slow-request-log.cjs");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx|js|mjs|cjs)$/.test(name) && !p.includes("__tests__")) {
          const s = readFileSync(p, "utf8");
          if (s.includes("E2E_SLOW_REQUEST_MS") || s.includes("slow-request-log")) offenders.push(p);
        }
      }
    };
    walk(join(root, "src"));
    for (const f of ["next.config.mjs", "vercel.json", "package.json"]) {
      try {
        if (readFileSync(join(root, f), "utf8").includes("slow-request-log")) offenders.push(f);
      } catch {
        /* not there */
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("the navigation watchdog only logs", () => {
  const fakePage = () => {
    const listeners = new Set<unknown>();
    return {
      on: (_e: string, f: unknown) => listeners.add(f),
      off: (_e: string, f: unknown) => listeners.delete(f),
      mainFrame: () => ({}),
      isClosed: () => false,
      url: () => "http://localhost/stages",
      evaluate: async () => "loading at page clock 1 ms",
      context: () => ({ browser: () => null }),
      listeners,
    };
  };
  const withThreshold = async (ms: string, run: () => Promise<void>) => {
    const saved = process.env.E2E_GOTO_WATCHDOG_MS;
    process.env.E2E_GOTO_WATCHDOG_MS = ms;
    try {
      await run();
    } finally {
      if (saved === undefined) delete process.env.E2E_GOTO_WATCHDOG_MS;
      else process.env.E2E_GOTO_WATCHDOG_MS = saved;
    }
  };
  const said = (spy: ReturnType<typeof vi.spyOn>) => spy.mock.calls.map((c) => String(c[0])).join("\n");

  it("a navigation that returns in time says nothing and returns its value", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const page = fakePage();
    await withThreshold("500", async () => {
      expect(await watchNavigation(page as never, "goto /stages", async () => "the response")).toBe("the response");
    });
    expect(said(spy)).toBe("");
    expect(page.listeners.size).toBe(0);
  });

  it("CONTROL: a navigation that is still pending says where, and its result is untouched", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await withThreshold("30", async () => {
      const out = await watchNavigation(fakePage() as never, "goto /stages?bust=1", () => new Promise<string>((r) => setTimeout(() => r("late"), 150)));
      expect(out).toBe("late");
    });
    await new Promise((r) => setTimeout(r, 50));
    const text = said(spy);
    expect(text).toContain("[goto-watchdog] goto /stages?bust=1 still pending after");
    expect(text).toContain("document responses: none yet");
    expect(text).toContain("page.evaluate answers: loading");
    expect(text).toContain("server's own lines");
  });

  it("an error from the navigation is rethrown as it was, not replaced", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    await withThreshold("30", async () => {
      await expect(watchNavigation(fakePage() as never, "goto /x", async () => {
        await new Promise((r) => setTimeout(r, 60));
        throw new Error("net::ERR_ABORTED");
      })).rejects.toThrow("net::ERR_ABORTED");
    });
  });

  it("reads the server's lines for the window only, and survives a missing log", () => {
    const dir = mkdtempSync(join(tmpdir(), "zz-slow-"));
    try {
      const file = join(dir, "log");
      const t = Date.parse("2026-11-27T22:07:30.000Z");
      writeFileSync(
        file,
        [`${new Date(t - 60_000).toISOString()} [slow-request] OPEN GET /old`, `${new Date(t + 5_000).toISOString()} [slow-request] OPEN GET /stages?bust=9 after 5000 ms`, "not a line"].join("\n"),
      );
      expect(serverLinesSince(t, file)).toEqual([`${new Date(t + 5_000).toISOString()} [slow-request] OPEN GET /stages?bust=9 after 5000 ms`]);
      expect(serverLinesSince(t, join(dir, "missing"))).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
