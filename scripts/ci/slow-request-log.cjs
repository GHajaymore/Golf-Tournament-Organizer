/**
 * A SLOW-REQUEST LOG FOR THE END-TO-END SERVER ONLY (B112, 27 Nov 2026).
 *
 * Three times (5 Nov, 14 Nov, 27 Nov) a spec's `page.goto` has returned its headers and then never
 * finished the body, for about 30 s, with no event anywhere. The artifacts cannot say whether the
 * SERVER was slow to finish rendering or the RUNNER stalled. This file makes the server say.
 *
 * It is NOT application code and is never loaded by the app. `playwright.config.ts` starts the test
 * server with `NODE_OPTIONS=--require ./scripts/ci/slow-request-log.cjs` and `E2E_SLOW_REQUEST_MS`; nothing
 * else requires it, so production (Vercel) cannot run it. With `E2E_SLOW_REQUEST_MS` unset or not a
 * positive number, `install()` does nothing at all and leaves `http.Server` exactly as it was.
 *
 * What it writes, one line each, to stdout and appended to a file (`logFile()`) that
 * `e2e/goto-watchdog.ts` reads for the window of a stalled navigation:
 *
 *   OPEN  a request still not finished after the threshold: its route, how long, whether the headers
 *         had gone out and when, how many bytes the socket has taken, whether the socket is gone.
 *   SLOW  the same request when it does finish (or its connection closes), with the total.
 *
 * "headers at 300 ms, OPEN at 5 s, body bytes not moving" is a server that is waiting; "no line at all
 * for a request the browser says is open" is a runner that stalled.
 *
 * It only observes: the request event is passed on untouched, and a failure in this file is swallowed.
 */
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const MARK = "[slow-request]";

/** Where the lines are appended. The same answer for the server and for the watchdog that reads it. */
function logFile(env = process.env) {
  return env.E2E_SLOW_REQUEST_LOG || path.join(os.tmpdir(), "tourneyhq-e2e-slow-requests.log");
}

/** The threshold in ms, or 0 when the log is off. */
function thresholdMs(env = process.env) {
  const n = Number(env.E2E_SLOW_REQUEST_MS);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Wrap `http.Server.prototype.emit` once. Returns whether it is on.
 * `write` is where a line goes (default: stdout and the file); the unit test passes its own.
 */
function install(env = process.env, write) {
  const limit = thresholdMs(env);
  if (!limit) return false;
  if (http.Server.prototype.emit.__slowRequestLog) return true;
  const file = logFile(env);
  const out =
    write ||
    ((line) => {
      console.log(line);
      try {
        fs.appendFileSync(file, line + "\n");
      } catch {
        /* a log that cannot be written must never touch a request */
      }
    });

  const original = http.Server.prototype.emit;
  const wrapped = function emit(event, req, res) {
    if (event === "request" && req && res) {
      try {
        watch(req, res, limit, out);
      } catch {
        /* observe only */
      }
    }
    return original.apply(this, arguments);
  };
  wrapped.__slowRequestLog = true;
  http.Server.prototype.emit = wrapped;
  return true;
}

function watch(req, res, limit, out) {
  const started = Date.now();
  let headersAt = null;
  const writeHead = res.writeHead;
  res.writeHead = function () {
    if (headersAt === null) headersAt = Date.now() - started;
    return writeHead.apply(this, arguments);
  };
  const where = `${req.method} ${String(req.url).slice(0, 160)}`;
  const state = () =>
    `status=${res.statusCode} headers=${headersAt === null ? "not sent" : `${headersAt} ms`} bytes=${res.socket ? res.socket.bytesWritten : "?"} socketDestroyed=${res.socket ? res.socket.destroyed : "?"}`;
  const stamp = () => new Date().toISOString();
  let ended = false;
  const timer = setTimeout(() => {
    if (!ended) out(`${stamp()} ${MARK} OPEN ${where} after ${Date.now() - started} ms ${state()} writableFinished=${res.writableFinished}`);
  }, limit);
  timer.unref();
  const finish = (how) => {
    if (ended) return;
    ended = true;
    clearTimeout(timer);
    const total = Date.now() - started;
    if (total >= limit) out(`${stamp()} ${MARK} SLOW ${where} total ${total} ms (${how}) ${state()}`);
  };
  res.on("finish", () => finish("finished"));
  res.on("close", () => finish("closed"));
}

/**
 * THE CONTROL LINE: printed once when the log is on, to stdout and to the file, so a round (or a CI
 * run) can prove the server it is about to test really has the log. `scripts/ci/slow-request-env.mjs`
 * reads it back. Nothing is printed when the log is off.
 */
function announce(env = process.env, write) {
  const limit = thresholdMs(env);
  if (!limit) return false;
  const line = `${new Date().toISOString()} ${MARK} on, threshold ${limit} ms`;
  if (write) write(line);
  else {
    console.log(line);
    try {
      fs.appendFileSync(logFile(env), line + "\n");
    } catch {
      /* a log that cannot be written must never touch a request */
    }
  }
  return true;
}

if (thresholdMs()) {
  install();
  announce();
}

module.exports = { install, announce, logFile, thresholdMs, MARK };
