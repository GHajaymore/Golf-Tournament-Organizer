// Local absolute paths in what is committed: the one rule, read by the guard hook (guard.mjs, on every commit)
// and by src/lib/__tests__/no-local-paths-in-the-repository.test.ts (every tracked file).
//
// This module has no "#!" line on purpose: vitest imports it, and a "#!" line in a CRLF checkout fails to load.

/** Files that are not ours to police (dependency metadata, binaries). */
export const UNSCANNED_FILE = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$|\.(pdf|png|jpe?g|gif|webp|ico|woff2?|ttf|mp4|zip)$/i;

/**
 * A local absolute path names the Windows user and the machine's layout (ledger row 10: agent definitions went into
 * a public-repo PR holding scratchpad paths). Each pattern needs a real name or folder after the prefix, so a
 * placeholder (`/c/Users/...`, `C:\Users\<you>`) or the bare word AppData in prose is not a hit.
 */
export const LOCAL_PATH = [
  /\b[A-Za-z]:(?:\\{1,2}|\/)Users(?:\\{1,2}|\/)+[A-Za-z0-9_]/i, // C:\Users\<you>, with one or two backslashes (escaped in JS or JSON) or a slash
  /\/[A-Za-z]\/Users\/[A-Za-z0-9_]/i, // /c/Users/<you> (Git Bash; WSL mounts too)
  /\b[A-Za-z]--Users-[A-Za-z0-9]/i, // C--Users-<you>-Documents-…: the folder Claude names a project's memory and transcripts by
  /AppData(?:\\{1,2}|\/)+(?:Local|LocalLow|Roaming)\b/i, // the Local, LocalLow and Roaming folders under AppData
];

/** Lines holding a local absolute path, as "file: local path" descriptions (the path itself is not echoed). */
export function findLocalPaths(lines) {
  const found = [];
  for (const { file, text } of lines) {
    if (UNSCANNED_FILE.test(file)) continue;
    if (LOCAL_PATH.some((re) => re.test(text))) found.push(`${file}: local path`);
  }
  return found;
}
