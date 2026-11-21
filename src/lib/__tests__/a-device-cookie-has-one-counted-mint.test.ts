import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { readSource } from "./source";

/**
 * A DEVICE COOKIE HAS ONE COUNTED MINT (B96; Security Lead on PR #1199).
 *
 * Every signed `ng_device` is set by `mintDevice` in `services/known-device.ts`, which counts it (the platform alarm and
 * the per-network slow bucket) and sets nothing when refused. A second place that signs a device, or sets the cookie,
 * is a mint nobody counts: the code door and a refused cookieless request were each one.
 *
 * Break-it (seen red): call `signUnder("ng_device", …)` or `setSignedDevice(` from another file, or add a second call
 * to `setSignedDevice(` inside known-device.ts.
 */

const SRC = "src"; // relative to the project root, as `readSource` reads it
const HOME = join("src", "lib", "services", "known-device.ts").replace(/\\/g, "/");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue;
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

/** The lines of `code` that sign or set a device cookie. */
export function mintsIn(code: string): string[] {
  return code
    .split(/\r?\n/)
    .filter((l) => /\bsetSignedDevice\s*\(|\bsignUnder\s*\(\s*(?:"ng_device"|DEVICE_KEY)|\.set\(\s*(?:"ng_device"|DEVICE_COOKIE\b)/.test(l));
}

describe("a device cookie has one counted mint", () => {
  it("CONTROL: the sweep sees a mint, and passes an ordinary line", () => {
    expect(mintsIn('jar.set("ng_device", sign(v), {})')).toHaveLength(1);
    expect(mintsIn('const c = signUnder("ng_device", v);')).toHaveLength(1);
    expect(mintsIn("return setSignedDevice(jar);")).toHaveLength(1);
    expect(mintsIn('jar.set("ng_guest", value);')).toHaveLength(0);
  });

  it("no file but known-device.ts signs or sets a device cookie", () => {
    const strays: string[] = [];
    for (const file of walk(SRC)) {
      const rel = file.replace(/\\/g, "/").replace(/^.*?(src\/)/, "src/");
      if (rel === HOME) continue;
      for (const line of mintsIn(readSource(file))) strays.push(`${rel}: ${line.trim()}`);
    }
    expect(strays).toEqual([]);
  });

  it("inside known-device.ts the signing is done in one place, reached only by mintDevice", () => {
    const code = readSource(join(SRC, "lib", "services", "known-device.ts"));
    const calls = code.split(/\r?\n/).filter((l) => /\bsetSignedDevice\s*\(/.test(l) && !/function setSignedDevice/.test(l));
    expect(calls).toHaveLength(1);
    const mint = code.slice(code.indexOf("export async function mintDevice"), code.indexOf("function setSignedDevice"));
    expect(mint).toMatch(/setSignedDevice\(/);
    expect(mint).toMatch(/clientGuessGate\("guest-mint-alarm"/);
    expect(mintsIn(code).filter((l) => /\.set\(/.test(l))).toHaveLength(1);
  });
});
