import { describe, it, expect } from "vitest";
import net from "node:net";
import { forward, waitForUpstream } from "../../../scripts/ci/forward-postgres.mjs";
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
