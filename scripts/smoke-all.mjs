#!/usr/bin/env node
/**
 * THE SMOKE PASS, THE WAY CI RUNS IT: all five scripts, against a BUILT server.
 *
 * `npm run smoke` runs one of the five and points at port 3000. CI's "Build and
 * smoke" step builds, starts the built server and runs all five against it —
 * and the difference between those two is a whole class of red build that only
 * shows up after a push. This is that step, locally, in one command.
 *
 * WHY NOT JUST POINT THE SCRIPTS AT THE DEV SERVER. Because on a developer
 * machine it dies halfway through, and then the scripts blame your change.
 * Measured on 2026-09-17 while shipping the same-name warning: seven restarts
 * in one evening, and Next says so itself in its own log —
 *
 *     ⚠ Server is approaching the used memory threshold, restarting...
 *
 * `next dev` compiles each route on demand and holds the graph; a 41-route walk
 * compiles most of the app in one process, and on a 16GB machine also running a
 * build and a test suite it hits the threshold and respawns. Every request in
 * flight at that moment returns nothing, which the scripts print as
 * `→ 0 / fetch failed` — the "no server" signature CLAUDE.md documents, and it
 * reads exactly like a broken route.
 *
 * A production server does not compile anything and stays flat. The same five
 * scripts that failed three times against the dev server passed first time
 * against this one, unchanged.
 *
 * Usage:
 *   npm run smoke:all              build, then run all five
 *   npm run smoke:all -- --no-build   reuse the last .next-ci build
 *
 * It never touches `.next`, so a dev server can keep running beside it.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const PORT = Number(process.env.SMOKE_PORT ?? 3102);
const BASE = `http://localhost:${PORT}`;
const DIST = ".next-ci";
const SCRIPTS = [
  "smoke-routes.mjs",
  "verify-round-controls.mjs",
  "verify-drafting.mjs",
  "verify-week-view.mjs",
  "verify-lifecycle.mjs",
];

/**
 * The secret the scripts sign their cookies with, and the one the server
 * verifies against, ARE THE SAME ONE HERE.
 *
 * They have to be. A script signing with a different secret is redirected to
 * sign-in, and then it searches an empty page and reports no problems — the
 * "checked six screens / checked nothing" failure CLAUDE.md has a section
 * about. So the value is set once, in this file, for both sides.
 */
const AUTH_SECRET = process.env.AUTH_SECRET ?? "local-smoke-secret";

const run = (cmd, args, extraEnv = {}) =>
  new Promise((resolve) => {
    const child = spawn(cmd, args, {
      stdio: "inherit",
      shell: process.platform === "win32",
      env: { ...process.env, ...extraEnv },
    });
    child.on("exit", (code) => resolve(code ?? 1));
  });

async function serverIsUp() {
  try {
    const res = await fetch(BASE, { redirect: "manual" });
    return res.status > 0;
  } catch {
    return false;
  }
}

async function main() {
  const build = !process.argv.includes("--no-build");

  /**
   * SOMEBODY ELSE'S SERVER IS NOT YOUR BUILD. The same trap `reuseExistingServer`
   * sets for Playwright: attach to whatever is listening and you test code you
   * have not built. Refused rather than reused.
   */
  if (await serverIsUp()) {
    console.error(`Something is already listening on ${BASE}.`);
    console.error("That may be an older build. Stop it, or set SMOKE_PORT to a free port.");
    /**
     * `exitCode` and RETURN, not `process.exit`. Calling it here — inside the
     * turn of an async function that has just awaited a `fetch` — tears the
     * loop down while libuv still holds that socket, and on Windows node dies
     * with `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` printed
     * underneath the message. The refusal is right; the crash after it reads
     * like the tool being broken.
     */
    process.exitCode = 1;
    return;
  }

  if (build) {
    console.log(`Building into ${DIST} (leaves .next alone, so a dev server can keep running)…\n`);
    // The checked build — rebuilds once if a page's client manifest is missing
    // a module (scripts/build-checked.mjs), the fault that 500s a random route.
    const code = await run("node", ["scripts/build-checked.mjs"], { NEXT_DIST_DIR: DIST });
    if (code !== 0) process.exit(code);
  } else if (!existsSync(join(process.cwd(), DIST, "BUILD_ID"))) {
    console.error(`--no-build, but there is no ${DIST} build to run. Drop the flag.`);
    process.exit(1);
  }

  console.log(`\nStarting the built server on ${BASE}…`);
  const server = spawn("npx", ["next", "start", "--port", String(PORT)], {
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
    env: { ...process.env, NEXT_DIST_DIR: DIST, AUTH_SECRET },
  });
  let serverLog = "";
  server.stdout?.on("data", (d) => (serverLog += d.toString()));
  server.stderr?.on("data", (d) => (serverLog += d.toString()));

  const stop = () => {
    if (server.exitCode !== null) return;
    // On Windows `kill` leaves the real server behind its shell wrapper.
    if (process.platform === "win32" && server.pid) {
      spawn("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      server.kill();
    }
  };
  process.on("SIGINT", () => {
    stop();
    process.exit(130);
  });

  let status = 1;
  try {
    // Poll rather than sleep a fixed amount, the same way the CI step does:
    // too short is a flaky failure, too long is wasted every single run.
    let up = false;
    for (let i = 0; i < 90; i += 1) {
      if (server.exitCode !== null) {
        console.error("The server exited before it began serving:\n");
        console.error(serverLog.slice(-2000));
        process.exit(1);
      }
      if (await serverIsUp()) {
        up = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    if (!up) {
      console.error(`Server never answered on ${BASE}.\n`);
      console.error(serverLog.slice(-2000));
      process.exit(1);
    }

    for (const script of SCRIPTS) {
      console.log(`\n── ${script} ${"─".repeat(Math.max(0, 56 - script.length))}`);
      const code = await run("node", [join("scripts", script)], {
        SMOKE_BASE_URL: BASE,
        AUTH_SECRET,
      });
      if (code !== 0) {
        console.error(`\n${script} failed. The four after it did not run.`);
        status = code;
        return;
      }
    }
    status = 0;
    console.log("\nAll five passed against the built server.");
  } finally {
    stop();
    process.exitCode = status;
  }
}

await main();
