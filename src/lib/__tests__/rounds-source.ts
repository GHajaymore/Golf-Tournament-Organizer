import { readdirSync } from "node:fs";
import { join } from "node:path";
import { readSource } from "./source";

/**
 * THE ROUNDS SCREEN'S SOURCE, WHEREVER ITS CONTROLS NOW LIVE (R4, the move).
 *
 * `StagesClient.tsx` held every control of a round inline; they were lifted into `src/components/rounds/`
 * so the redesigned screen draws the same components. A guard that pins what the Rounds screen draws
 * reads the screen AND the components it mounts, through `readSource` (comments stripped).
 */
export function roundsFolderFiles(): string[] {
  const dir = join("src", "components", "rounds");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"))
    .sort()
    .map((f) => join(dir, f).split("\\").join("/"));
}

export function roundsScreenSource(): string {
  return [readSource("src/components/StagesClient.tsx"), ...roundsFolderFiles().map((f) => readSource(f))].join("\n");
}
