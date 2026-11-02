#!/usr/bin/env node
/**
 * THE LOAD SCRIPT, RUN WITHOUT k6 — for a small local proof that it works.
 *
 *     node scripts/load/k6-lite.mjs scripts/load/shotgun-144.js
 *     PLAYERS=12 VIEWERS=20 BASE_URL=http://127.0.0.1:3102 node scripts/load/k6-lite.mjs scripts/load/shotgun-144.js
 *
 * k6 is the instrument for the real run (README.md). It is a separate binary,
 * and a machine without it should still be able to prove the script does what
 * it says before anybody points it at a preview. This runs the SAME file, with
 * the part of k6's API it uses and nothing more:
 *
 *   k6/http        get, post — synchronous, as in k6, with a cookie jar per
 *                  virtual user that keeps a Secure cookie off plain http (as k6 does)
 *   k6             check, sleep, fail, group
 *   k6/metrics     Trend, Rate, Counter
 *   k6/execution   scenario.iterationInTest, vu.idInTest, vu.iterationInScenario
 *   options        scenarios of `per-vu-iterations` and `constant-vus`, and
 *                  thresholds of the form p(N)<x, avg<x, max<x, rate<x, rate>x, count<x
 *   open()         a file, relative to the script
 *
 * HOW A CALL IS SYNCHRONOUS: each virtual user is a worker thread; it posts the
 * request to the main thread, which fetches it, and the worker waits on an
 * Atomics flag and takes the answer with `receiveMessageOnPort`. The timing is
 * the main thread's, from the request leaving to the last byte of the body, so
 * a figure here is the server's and the network's, not this runner's.
 *
 * What it is NOT: k6's scheduler, its HTTP/2, or its precision at thousands of
 * users. At the scale of a laptop it measures the same thing.
 */
import { Worker, isMainThread, parentPort, workerData, receiveMessageOnPort, MessageChannel } from "node:worker_threads";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/** The script with its k6 imports pointed at this file's own modules. */
function prepare(script) {
  const source = readFileSync(script, "utf8");
  const shim = (name) => pathToFileURL(join(HERE, "k6-lite", `${name}.mjs`)).href;
  const rewritten = source
    .replace(/from\s+["']k6\/http["']/g, `from "${shim("http")}"`)
    .replace(/from\s+["']k6\/metrics["']/g, `from "${shim("metrics")}"`)
    .replace(/from\s+["']k6\/execution["']/g, `from "${shim("execution")}"`)
    .replace(/from\s+["']k6["']/g, `from "${shim("k6")}"`);
  // Beside the run's other output, not in the system's temp folder: on Windows a hundred workers
  // resolving a module under AppData at once failed three of them with "lstat … UNKNOWN" (2026-10-23).
  const dir = join(process.cwd(), ".qa", "k6-lite");
  mkdirSync(dir, { recursive: true });
  const out = join(dir, `script-${process.pid}.mjs`);
  writeFileSync(out, rewritten);
  return pathToFileURL(out).href;
}

const seconds = (d) => {
  const m = /^(\d+(?:\.\d+)?)(ms|s|m|h)?$/.exec(String(d ?? "0"));
  if (!m) throw new Error(`a duration k6-lite cannot read: ${d}`);
  return Number(m[1]) * { ms: 0.001, s: 1, m: 60, h: 3600 }[m[2] ?? "s"];
};

if (isMainThread) {
  const script = process.argv[2];
  if (!script) {
    console.error("usage: node scripts/load/k6-lite.mjs <k6 script>");
    process.exit(2);
  }
  const scriptPath = resolve(script);
  const url = prepare(scriptPath);
  const env = { ...process.env };

  /** Every worker's requests go through here. */
  async function serve(port, flag) {
    port.on("message", async (req) => {
      const t0 = performance.now();
      let answer;
      try {
        const res = await fetch(req.url, { method: req.method, headers: req.headers, body: req.body ?? undefined, redirect: "manual" });
        const waiting = performance.now() - t0;
        const body = await res.text();
        answer = { status: res.status, body, headers: Object.fromEntries(res.headers), setCookies: res.headers.getSetCookie?.() ?? [], timings: { duration: performance.now() - t0, waiting } };
      } catch (e) {
        answer = { status: 0, body: "", headers: {}, setCookies: [], error: e instanceof Error ? e.message : String(e), timings: { duration: performance.now() - t0, waiting: 0 } };
      }
      port.postMessage(answer);
      Atomics.store(flag, 0, 1);
      Atomics.notify(flag, 0);
    });
  }

  let nextVu = 0;
  function vu(role, extra = {}) {
    nextVu += 1;
    const { port1, port2 } = new MessageChannel();
    const flag = new Int32Array(new SharedArrayBuffer(4));
    serve(port1, flag);
    const worker = new Worker(fileURLToPath(import.meta.url), { workerData: { url, scriptPath, env, port: port2, flag, vu: nextVu, role, ...extra }, transferList: [port2] });
    return new Promise((done) => {
      let result = null;
      worker.on("message", (m) => (result = m));
      worker.on("error", (e) => (result = { error: e.message, metrics: {} }));
      worker.on("exit", () => {
        port1.close();
        done(result ?? { error: "the virtual user ended without a word", metrics: {} });
      });
    });
  }

  const started = Date.now();
  const setup = await vu("setup");
  if (setup.error) {
    console.error(`setup failed: ${setup.error}`);
    process.exit(1);
  }
  const options = setup.options ?? {};
  const runs = [setup];
  const all = [];
  for (const [name, sc] of Object.entries(options.scenarios ?? { default: { executor: "per-vu-iterations", vus: 1, iterations: 1, exec: "default" } })) {
    const startAt = seconds(sc.startTime ?? "0s");
    for (let i = 0; i < sc.vus; i += 1) {
      all.push(
        new Promise((r) => setTimeout(r, startAt * 1000)).then(() =>
          vu("scenario", { scenario: name, executor: sc.executor, exec: sc.exec ?? "default", idInScenario: i, iterations: sc.iterations ?? 1, duration: seconds(sc.duration ?? sc.maxDuration ?? "10m"), data: setup.data }),
        ),
      );
    }
  }
  console.log(`k6-lite: ${all.length} virtual users in ${Object.keys(options.scenarios ?? {}).length} scenario(s) against ${env.BASE_URL || "(the script's default)"}`);
  runs.push(...(await Promise.all(all)));

  // ── Add the metrics up and judge the thresholds ─────────────────────────
  const merged = {};
  for (const r of runs) {
    if (r.error) console.log(`  a virtual user stopped: ${r.error}`);
    for (const [name, m] of Object.entries(r.metrics ?? {})) {
      const into = (merged[name] ??= { type: m.type, values: [], pass: 0, total: 0, count: 0 });
      into.values.push(...(m.values ?? []));
      into.pass += m.pass ?? 0;
      into.total += m.total ?? 0;
      into.count += m.count ?? 0;
    }
  }
  const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] : NaN);
  const stat = (m, name) => {
    if (m.type === "rate") return { rate: m.total ? m.pass / m.total : NaN };
    if (m.type === "counter") return { count: m.count };
    const v = [...m.values].sort((a, b) => a - b);
    const avg = v.reduce((a, b) => a + b, 0) / (v.length || 1);
    const s = { avg, min: v[0], med: pct(v, 50), max: v[v.length - 1], count: v.length };
    for (const p of [90, 95, 99]) s[`p(${p})`] = pct(v, p);
    void name;
    return s;
  };
  console.log(`\nk6-lite: ran ${((Date.now() - started) / 1000).toFixed(0)}s`);
  for (const [name, m] of Object.entries(merged).sort()) {
    const s = stat(m, name);
    const line =
      m.type === "rate"
        ? `${(s.rate * 100).toFixed(2)}% (${m.pass} of ${m.total})`
        : m.type === "counter"
          ? `${s.count}`
          : `avg=${s.avg.toFixed(1)}ms min=${s.min?.toFixed(1)}ms med=${s.med?.toFixed(1)}ms p(90)=${s["p(90)"]?.toFixed(1)}ms p(95)=${s["p(95)"]?.toFixed(1)}ms max=${s.max?.toFixed(1)}ms (n=${s.count})`;
    console.log(`  ${name.padEnd(22)} ${line}`);
  }
  let failed = 0;
  for (const [name, rules] of Object.entries(options.thresholds ?? {})) {
    const m = merged[name];
    for (const rule of rules) {
      const r = /^(p\((\d+(?:\.\d+)?)\)|avg|max|min|med|rate|count)\s*(<|>|<=|>=)\s*(\d+(?:\.\d+)?)$/.exec(rule.replace(/\s+/g, ""));
      if (!m || !r) {
        console.log(`  ? ${name}: ${rule} — ${m ? "not a form k6-lite reads" : "nothing was recorded"}`);
        failed += 1;
        continue;
      }
      const s = stat(m, name);
      const got = r[2] ? pct([...m.values].sort((a, b) => a - b), Number(r[2])) : s[r[1]];
      const limit = Number(r[4]);
      const pass = { "<": got < limit, ">": got > limit, "<=": got <= limit, ">=": got >= limit }[r[3]];
      console.log(`  ${pass ? "✓" : "✗"} ${name}: ${rule} (was ${Number.isFinite(got) ? +got.toFixed(4) : got})`);
      if (!pass) failed += 1;
    }
  }
  console.log(failed ? `\nk6-lite: ${failed} threshold(s) crossed` : "\nk6-lite: every threshold held");
  process.exit(failed ? 99 : 0);
} else {
  // ── One virtual user ───────────────────────────────────────────────────
  const { url, scriptPath, env, port, flag, vu, role, scenario, executor, exec: fn, idInScenario, iterations, duration, data } = workerData;
  const metrics = {};
  const record = (name, type, value) => {
    const m = (metrics[name] ??= { type, values: [], pass: 0, total: 0, count: 0 });
    if (type === "trend") m.values.push(value);
    else if (type === "rate") {
      m.total += 1;
      if (value) m.pass += 1;
    } else m.count += value;
  };
  const jar = new Map();
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  const iteration = { n: 0 };
  globalThis.__ENV = env;
  globalThis.__VU = vu;
  globalThis.open = (p) => readFileSync(resolve(dirname(scriptPath), p), "utf8");
  globalThis.__k6lite = {
    request(method, target, body, params = {}) {
      const secure = target.startsWith("https:");
      const cookies = [...jar.values()].filter((c) => secure || !c.secure).map((c) => `${c.name}=${c.value}`).join("; ");
      const headers = { "user-agent": "k6-lite", ...(params.headers ?? {}), ...(cookies ? { cookie: cookies } : {}) };
      Atomics.store(flag, 0, 0);
      port.postMessage({ method, url: target, headers, body: body ?? null });
      Atomics.wait(flag, 0, 0);
      // The flag is set after the answer is posted; take it, waiting a millisecond at a time if it is not there yet.
      let got = receiveMessageOnPort(port);
      while (!got) {
        Atomics.wait(sleeper, 0, 0, 1);
        got = receiveMessageOnPort(port);
      }
      const res = got.message;
      for (const raw of res.setCookies) {
        const [pair, ...attrs] = raw.split(";").map((s) => s.trim());
        const at = pair.indexOf("=");
        const name = pair.slice(0, at);
        const value = pair.slice(at + 1);
        const lower = attrs.map((a) => a.toLowerCase());
        if (!value || lower.some((a) => a === "max-age=0" || a.startsWith("expires=thu, 01 jan 1970"))) jar.delete(name);
        else jar.set(name, { name, value, secure: lower.includes("secure") });
      }
      record("http_reqs", "counter", 1);
      record("http_req_duration", "trend", res.timings.duration);
      record("http_req_failed", "rate", !(res.status >= 200 && res.status < 400));
      return res;
    },
    sleep(s) {
      Atomics.wait(sleeper, 0, 0, Math.max(0, s * 1000));
    },
    record,
    exec: {
      get scenario() {
        return { name: scenario ?? "setup", iterationInTest: executor === "per-vu-iterations" ? idInScenario * iterations + iteration.n : idInScenario * 1_000_000 + iteration.n };
      },
      get vu() {
        return { idInTest: vu, iterationInScenario: iteration.n };
      },
    },
  };
  try {
    // One more try if the file system blinks while a hundred threads load the same module.
    const mod = await import(url).catch(() => {
      Atomics.wait(sleeper, 0, 0, 250);
      return import(`${url}?again`);
    });
    if (role === "setup") {
      const out = typeof mod.setup === "function" ? mod.setup() : undefined;
      parentPort.postMessage({ options: JSON.parse(JSON.stringify(mod.options ?? {})), data: out, metrics });
    } else {
      const f = mod[fn];
      if (typeof f !== "function") throw new Error(`the script exports no function called ${fn}`);
      const until = Date.now() + duration * 1000;
      const count = executor === "per-vu-iterations" ? iterations : Infinity;
      for (iteration.n = 0; iteration.n < count && Date.now() < until; iteration.n += 1) {
        try {
          f(data);
          record("iterations", "counter", 1);
        } catch (e) {
          if (e?.k6abort) throw e;
          console.log(`  [vu ${vu}] iteration threw: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      parentPort.postMessage({ metrics });
    }
  } catch (e) {
    parentPort.postMessage({ error: e instanceof Error ? e.message : String(e), metrics });
  }
  port.close();
}
