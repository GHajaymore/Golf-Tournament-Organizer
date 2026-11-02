import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readSource } from "./source";

/**
 * A COMPONENT WITH A BOX IN IT IS DECLARED ONCE, AT THE TOP OF ITS FILE (2026-10-21).
 *
 * The text-box crawl could not type into either hex box on Club settings. Each was
 * drawn by `HexField`, a component declared INSIDE `ThemePicker` — so every render
 * of the picker made a new `HexField`, React treated it as a different component,
 * threw the box away and drew a fresh one. One character went in, the focus went
 * with the old box, and the next key went nowhere. `CardImport` had the same shape
 * around its three card rows.
 *
 * So: no component nested inside another may draw an `<input>`, a `<textarea>` or a
 * `<select>`. (A nested component that draws no box is still remounted each render
 * — wasteful, but nothing a person loses.)
 */
const ROOT = "src";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "__tests__" || name === "node_modules" ? [] : files(p);
    return name.endsWith(".tsx") ? [p] : [];
  });
}

/**
 * Components declared indented — inside something else — whose own body draws a
 * box. The body runs from the declaration to the first later line at the same
 * indent that closes it.
 */
export function nestedBoxComponents(src: string): string[] {
  const lines = src.split("\n");
  const found: string[] = [];
  lines.forEach((line, i) => {
    const m = /^(\s+)(?:const|let|function)\s+([A-Z]\w*)\s*(?:=\s*(?:\(|function)|\()/.exec(line);
    if (!m) return;
    const indent = m[1];
    // A one-line component ends where it starts.
    let end = line.trimEnd().endsWith(";") ? i : lines.length;
    for (let j = i + 1; end === lines.length && j < lines.length; j += 1) {
      if (lines[j].startsWith(`${indent}}`) || lines[j].startsWith(`${indent})`)) {
        end = j;
        break;
      }
    }
    const body = lines.slice(i, end + 1).join("\n");
    if (/<(input|textarea|select)\b/.test(body)) found.push(m[2]);
  });
  return found;
}

describe("a component that draws a box is not declared inside another", () => {
  const all = files(ROOT);

  it("finds the source", () => {
    expect(all.length).toBeGreaterThan(200);
  });

  it("no nested component in src draws an input, a textarea or a select", () => {
    const bad = all.flatMap((f) => nestedBoxComponents(readSource(f)).map((name) => `${f}: ${name}`));
    expect(bad, bad.join("\n")).toEqual([]);
  });

  it("control: the shape that shipped is caught, and a top-level one is not", () => {
    const shipped = [
      "export function ThemePicker() {",
      "  const HexField = ({ value }: { value: string }) => {",
      "    return <input className=\"input\" value={value} />;",
      "  };",
      "  return <HexField value=\"\" />;",
      "}",
    ].join("\n");
    expect(nestedBoxComponents(shipped)).toEqual(["HexField"]);
    const fixed = [
      "function HexField({ value }: { value: string }) {",
      "  return <input className=\"input\" value={value} />;",
      "}",
      "export function ThemePicker() {",
      "  const Label = () => <span>Colour</span>;",
      "  return <HexField value=\"\" />;",
      "}",
    ].join("\n");
    expect(nestedBoxComponents(fixed)).toEqual([]);
  });
});
