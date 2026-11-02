import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { spawn } from "node:child_process";
import type { AddressInfo } from "node:net";

/**
 * THE HOURLY CANARY NEVER WATCHES THE DEMO CLUB (2026-10-24; docs/claude/demo-club.md).
 *
 * `canary.yml` runs `scripts/prod-smoke.mjs`, and its one database-backed check is the public
 * board named by `CANARY_BOARD_URL`. The demo club's board is up whenever the demo is, which says
 * nothing about a real club's — so a board carrying the demo's mark (`data-demo-club`, drawn by
 * `DemoClubLabel`) fails the canary at once, telling whoever set it to name a real club's board.
 *
 * Run as the canary runs: the real script, against a stand-in site with every public door right,
 * once with a real board (CONTROL: passes) and once with the demo's.
 */

const DOORS: Record<string, string> = {
  "/": "TourneyHQ",
  "/faq": "TourneyHQ",
  "/privacy": "Privacy",
  "/terms": "Terms",
  "/play": "Enter your round code",
};

let server: Server;
let base = "";

beforeAll(async () => {
  server = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    if (path === "/live/real") return void res.writeHead(200).end("<main><h1>Club medal</h1>TourneyHQ</main>");
    if (path === "/live/demo") return void res.writeHead(200).end('<main><aside data-demo-club="">Demo club, invented players</aside>TourneyHQ</main>');
    if (DOORS[path]) return void res.writeHead(200).end(`<main>${DOORS[path]}</main>`);
    res.writeHead(404).end("not here");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

function canary(board: string): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["scripts/prod-smoke.mjs"], {
      env: { ...process.env, PROD_BASE_URL: base, PROD_BOARD_URL: `${base}${board}` },
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => resolve({ code, out }));
  });
}

describe("the canary and the demo club", () => {
  it("CONTROL: a real club's board passes", async () => {
    const { code, out } = await canary("/live/real");
    expect(out).toContain("all 7 doors answered");
    expect(code).toBe(0);
  }, 60_000);

  it("refuses the demo club's board, and says why", async () => {
    const { code, out } = await canary("/live/demo");
    expect(out).toContain("is the demo club's board");
    expect(code).toBe(1);
  }, 60_000);
});
