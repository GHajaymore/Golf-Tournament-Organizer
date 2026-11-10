import { describe, it, expect } from "vitest";
import net from "node:net";
import { forward, resolveOnce, waitForUpstream } from "../../../scripts/ci/forward-postgres.mjs";
import { partsFor } from "../../../scripts/qa/layers.mjs";
import { listeningInodes } from "../../../scripts/qa/free-port.mjs";

/**
 * The two helpers a job in Playwright's container image needs (2026-11-06): the database is
 * reached on localhost although the service is named `postgres`, and the server of a round is
 * stopped without `lsof`.
 */

function listen(handler: (s: net.Socket) => void): Promise<net.Server> {
  return new Promise((resolve) => {
    const s = net.createServer(handler);
    s.listen(0, "127.0.0.1", () => resolve(s));
  });
}
const portOf = (s: net.Server) => (s.address() as net.AddressInfo).port;

function exchange(port: number, send: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const c = net.connect({ host: "127.0.0.1", port });
    let got = "";
    c.on("data", (d) => {
      got += d.toString();
      if (got.length >= send.length) c.end();
    });
    c.on("close", () => resolve(got));
    c.on("error", reject);
    c.write(send);
  });
}

describe("forward-postgres: localhost reaches the service", () => {
  it("passes bytes both ways to the upstream", async () => {
    const upstream = await listen((s) => s.on("data", (d) => s.write(`echo:${d}`)));
    const fwd = await forward({ listenPort: 0, host: "127.0.0.1", port: portOf(upstream) });
    try {
      expect(await exchange(portOf(fwd), "hello")).toBe("echo:hello");
    } finally {
      fwd.close();
      upstream.close();
    }
  });

  /**
   * THE NAME IS RESOLVED ONCE (2026-11-09): every connection used to ask Docker's DNS for the
   * service's address again, and a lookup slow under Prisma's connection burst is a connection
   * slow to open. The forwarder is handed the address; a lookup that fails leaves the name, and
   * an address that refuses falls back to the name — in every case the bytes still get through.
   */
  it("resolves the service's name once and hands connections the address", async () => {
    const asked: string[] = [];
    const address = await resolveOnce("postgres", async (name) => {
      asked.push(name);
      return { address: "127.0.0.1", family: 4 };
    });
    expect(address).toBe("127.0.0.1");
    expect(asked).toEqual(["postgres"]);
    const upstream = await listen((s) => s.on("data", (d) => s.write(`echo:${d}`)));
    const fwd = await forward({ listenPort: 0, host: "postgres", port: portOf(upstream), address });
    try {
      // Three connections, and the lookup is still the one made at start: `postgres` is no host
      // this machine knows, so had any connection gone by name it would have failed.
      for (const word of ["one", "two", "three"]) expect(await exchange(portOf(fwd), word)).toBe(`echo:${word}`);
      expect(asked).toEqual(["postgres"]);
    } finally {
      fwd.close();
      upstream.close();
    }
  });

  it("an address is its own answer, and a failed lookup falls back to the name and says so", async () => {
    let lookups = 0;
    expect(await resolveOnce("127.0.0.1", async () => ((lookups += 1), { address: "10.0.0.9", family: 4 }))).toBe("127.0.0.1");
    expect(lookups).toBe(0);
    const said: string[] = [];
    const error = console.error;
    console.error = (line: string) => said.push(line);
    try {
      expect(await resolveOnce("zz-no-such-service", async () => Promise.reject(new Error("EAI_AGAIN")))).toBe("zz-no-such-service");
    } finally {
      console.error = error;
    }
    expect(said).toEqual([expect.stringContaining("could not resolve zz-no-such-service (EAI_AGAIN); connecting by name")]);
  });

  it("an address that refuses falls back to the name for that connection", async () => {
    const upstream = await listen((s) => s.on("data", (d) => s.write(`echo:${d}`)));
    const port = portOf(upstream);
    // 127.0.0.2 is loopback too, but nothing listens there on this port: refused at once.
    const fwd = await forward({ listenPort: 0, host: "127.0.0.1", port, address: "127.0.0.2" });
    const said: string[] = [];
    const error = console.error;
    console.error = (line: string) => said.push(line);
    try {
      expect(await exchange(portOf(fwd), "still")).toBe("echo:still");
    } finally {
      console.error = error;
      fwd.close();
      upstream.close();
    }
    expect(said).toEqual([expect.stringContaining(`127.0.0.2:${port} ECONNREFUSED; connecting by name 127.0.0.1`)]);
  });

  it("waits for an upstream and gives up with the address in the message", async () => {
    const closed = await listen(() => {});
    const port = portOf(closed);
    closed.close();
    await expect(waitForUpstream("127.0.0.1", port, 1)).rejects.toThrow(`127.0.0.1:${port}`);
  });

  it("the control: waiting succeeds when something is listening", async () => {
    const up = await listen(() => {});
    try {
      await expect(waitForUpstream("127.0.0.1", portOf(up), 5)).resolves.toBeUndefined();
    } finally {
      up.close();
    }
  });
});

describe("layers.mjs says once which parts run in the image", () => {
  it("image is true exactly for chromium, firefox and webkit parts", () => {
    const parts = [...partsFor(1, {}), ...partsFor(1, { schedule: "nightly", countries: "all" }), ...partsFor(1, { schedule: "weekly", countries: "all" })];
    expect(parts.length).toBeGreaterThan(10);
    for (const p of parts) expect(p.image, p.id).toBe(["chromium", "firefox", "webkit"].includes(p.browsers));
  });

  it("the control: a part with a channel or no browser is not in the image", () => {
    const all = [...partsFor(1, { schedule: "nightly", countries: "all" }), ...partsFor(1, { schedule: "weekly", countries: "all" })];
    expect(all.some((p) => p.browsers === "" && p.image === false)).toBe(true);
    expect(all.some((p) => p.browsers.includes("chrome") || p.browsers.includes("msedge"))).toBe(true);
    expect(all.some((p) => p.image === true)).toBe(true);
  });
});

describe("free-port: finds the listener without lsof", () => {
  const table = [
    "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode",
    "   0: 00000000:0DDD 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1001        0 11111 1 0 100 0 0 10 0",
    "   1: 0100007F:0DDD 0100007F:9C40 01 00000000:00000000 00:00000000 00000000  1001        0 22222 1 0 100 0 0 10 0",
    "   2: 00000000:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1001        0 33333 1 0 100 0 0 10 0",
  ].join("\n");

  it("takes only listening sockets (state 0A) on the port", () => {
    // 0x0DDD = 3549: the listener (11111) counts, the established connection (22222) does not
    expect([...listeningInodes(3549, [table])]).toEqual(["11111"]);
    expect([...listeningInodes(8080, [table])]).toEqual(["33333"]);
    expect([...listeningInodes(9999, [table])]).toEqual([]);
  });
});
