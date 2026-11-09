// Make a job container's Postgres service answer on localhost:5432.
//
//   node scripts/ci/forward-postgres.mjs postgres 5432      (the service's name, its port)
//
// WHY. A job that runs in Playwright's container image reaches its `services:` Postgres by the
// service's NAME, not by localhost, and GitHub refuses `--network` in a job container's options so
// the service cannot be put on localhost. Every script that touches the database (the seed, the
// fixtures) refuses a host that is not localhost, on purpose: a seed pointed at a database
// somewhere else cannot be undone. Rather than loosen those guards, this forwards bytes from
// 127.0.0.1:<port> to <host>:<port> inside the container, so every DATABASE_URL stays
// `@localhost:5432` exactly as it is in the jobs that do not use a container.
//
// It forwards TCP and nothing else: no credentials, no parsing.
import net from "node:net";

/** Start a forwarder; resolves with the listening server. */
export function forward({ listenPort, host, port, listenHost = "127.0.0.1" }) {
  const server = net.createServer((client) => {
    const upstream = net.connect({ host, port });
    client.pipe(upstream);
    upstream.pipe(client);
    const end = () => {
      client.destroy();
      upstream.destroy();
    };
    client.on("error", end);
    upstream.on("error", end);
    client.on("close", end);
    upstream.on("close", end);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    // IPv4 only, on purpose: every DATABASE_URL says `localhost`, which Node 17+ may resolve to
    // ::1 first, but node and Prisma both fall back to 127.0.0.1 when ::1 refuses; binding both
    // families would only add a second listener to keep honest.
    server.listen(listenPort, listenHost, () => {
      // After it is listening a later error (EMFILE on accept, say) must not be an unhandled
      // 'error' event that kills the forwarder silently: say it, and keep serving.
      server.on("error", (e) => console.error(`forwarder: ${e.message}`));
      resolve(server);
    });
  });
}

/** Resolves when <host>:<port> accepts a connection, rejects after `seconds`. */
export async function waitForUpstream(host, port, seconds = 60) {
  const until = Date.now() + seconds * 1000;
  for (;;) {
    const ok = await new Promise((resolve) => {
      const s = net.connect({ host, port });
      s.once("connect", () => (s.destroy(), resolve(true)));
      s.once("error", () => (s.destroy(), resolve(false)));
    });
    if (ok) return;
    if (Date.now() > until) throw new Error(`${host}:${port} did not accept a connection in ${seconds} seconds`);
    await new Promise((r) => setTimeout(r, 1000));
  }
}

if (process.argv[1] && process.argv[1].endsWith("forward-postgres.mjs")) {
  const [, , host, portText = "5432"] = process.argv;
  if (!host) {
    console.error("usage: node scripts/ci/forward-postgres.mjs <service-name> [port]");
    process.exit(2);
  }
  const port = Number(portText);
  waitForUpstream(host, port)
    .then(() => forward({ listenPort: port, host, port }))
    .then(() => console.log(`forwarding localhost:${port} to ${host}:${port}`))
    .catch((e) => {
      console.error(`::error::${e.message}`);
      process.exit(1);
    });
}
