// Kill whatever listens on a TCP port, on Linux, without `lsof`.
//
//   node scripts/qa/free-port.mjs 3101
//
// round.mjs stops its server with `lsof -ti:PORT | xargs -r kill -9`. Playwright's container image
// (where the browser parts of a round run) has no lsof, and a missing tool there would not fail:
// the old server would simply stay up, and the next layer would be driven against a server in the
// WRONG cookie mode. So this reads the same fact from /proc: the listening socket's inode in
// /proc/net/tcp{,6}, then the process that holds that inode among its file descriptors.
import { readFileSync, readdirSync, readlinkSync } from "node:fs";

/** Inodes of sockets listening (state 0A) on `port`. */
export function listeningInodes(port, tables) {
  const hex = port.toString(16).toUpperCase().padStart(4, "0");
  const inodes = new Set();
  for (const text of tables) {
    for (const line of text.split("\n").slice(1)) {
      const f = line.trim().split(/\s+/);
      // sl local_address rem_address st tx_queue:rx_queue tr:tm->when retrnsmt uid timeout inode
      if (f.length < 10 || f[3] !== "0A") continue;
      if (f[1].split(":")[1] !== hex) continue;
      inodes.add(f[9]);
    }
  }
  return inodes;
}

export function freePort(port) {
  const tables = [];
  for (const t of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    try {
      tables.push(readFileSync(t, "utf8"));
    } catch {
      // not Linux, or no IPv6: nothing to read
    }
  }
  const inodes = listeningInodes(port, tables);
  if (inodes.size === 0) return [];
  const killed = [];
  for (const pid of readdirSync("/proc").filter((n) => /^\d+$/.test(n))) {
    if (Number(pid) === process.pid) continue;
    let fds = [];
    try {
      fds = readdirSync(`/proc/${pid}/fd`);
    } catch {
      continue;
    }
    for (const fd of fds) {
      let link = "";
      try {
        link = readlinkSync(`/proc/${pid}/fd/${fd}`);
      } catch {
        continue;
      }
      const m = /^socket:\[(\d+)\]$/.exec(link);
      if (m && inodes.has(m[1])) {
        try {
          process.kill(Number(pid), "SIGKILL");
          killed.push(Number(pid));
        } catch {
          // already gone
        }
        break;
      }
    }
  }
  return killed;
}

if (process.argv[1] && process.argv[1].endsWith("free-port.mjs")) {
  const port = Number(process.argv[2]);
  if (!Number.isInteger(port) || port <= 0) {
    console.error("usage: node scripts/qa/free-port.mjs <port>");
    process.exit(2);
  }
  const killed = freePort(port);
  if (killed.length) console.log(`stopped ${killed.join(", ")} on port ${port}`);
}
