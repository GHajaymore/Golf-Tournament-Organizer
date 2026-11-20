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
//
// THE NAME IS RESOLVED ONCE (2026-11-09). Each `net.connect({ host: "postgres" })` asked Docker's
// embedded DNS for the service's address again — once per connection, and Prisma's pool opens its
// connections in a burst when a transaction waits for a second one. A lookup that is slow or
// answers EAI_AGAIN under that burst is a connection that is slow to open, which is the shape of
// the P2028 "Transaction already closed" the nightly of 2026-11-09 produced. So the name is looked
// up at start, every connection goes to that address, and only if the address ever refuses does a
// connection fall back to the name — the forwarder keeps working either way, and says which.
import net from "node:net";
import dns from "node:dns/promises";

/**
 * The service's IPv4 address, looked up ONCE; the name itself when it is already an address or
 * the lookup fails (connecting by name then behaves exactly as before, and the failure is said).
 */
export async function resolveOnce(host, lookup = (name) => dns.lookup(name, { family: 4 })) {
  if (net.isIP(host)) return host;
  try {
    const { address } = await lookup(host);
    return address;
  } catch (e) {
    console.error(`forwarder: could not resolve ${host} (${e.message}); connecting by name`);
    return host;
  }
}

/**
 * One client connection, carried to the upstream. Tried at `address` first; when that is refused
 * before it connects and `address` is not the name, tried once more by name.
 */
function carry(client, { address, host, port }) {
  const end = (upstream) => () => {
    client.destroy();
    upstream.destroy();
  };
  client.on("error", () => client.destroy());
  const attempt = (target, fallback) => {
    const upstream = net.connect({ host: target, port });
    const close = end(upstream);
    // Node clears `upstream.connecting` before it emits the error of a refused connect, so a
    // refusal is told apart from a later fault by whether 'connect' ever fired.
    let connected = false;
    upstream.once("connect", () => {
      connected = true;
      client.pipe(upstream);
      upstream.pipe(client);
      client.on("error", close);
      client.on("close", close);
      upstream.on("error", close);
      upstream.on("close", close);
    });
    upstream.once("error", (e) => {
      if (!connected && fallback) {
        console.error(`forwarder: ${target}:${port} ${e.code ?? e.message}; connecting by name ${fallback}`);
        upstream.destroy();
        attempt(fallback, null);
        return;
      }
      close();
    });
  };
  attempt(address, address !== host ? host : null);
}

/** Start a forwarder; resolves with the listening server. `address` defaults to connecting by `host`. */
export function forward({ listenPort, host, port, listenHost = "127.0.0.1", address = host }) {
  const server = net.createServer((client) => carry(client, { address, host, port }));
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
  resolveOnce(host)
    .then(async (address) => {
      await waitForUpstream(address, port);
      await forward({ listenPort: port, host, port, address });
      console.log(`forwarding localhost:${port} to ${host}:${port}${address !== host ? ` (${address}, resolved once)` : ""}`);
    })
    .catch((e) => {
      console.error(`::error::${e.message}`);
      process.exit(1);
    });
}
