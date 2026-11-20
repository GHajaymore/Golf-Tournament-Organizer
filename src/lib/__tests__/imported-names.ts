/**
 * The names a source file imports, from single- and multi-line `import { … } from`
 * blocks, a renamed import (`x as y`) counted under its own name. Shared by the
 * sweeps that keep an old reader out of a file (`the-tournament-is-asked-one-way`,
 * `the-actions-ask-the-machine`), so they cannot read imports two ways. Read
 * the source through `readSource`, so a comment is never an import.
 */
export function importedNames(src: string): string[] {
  const names: string[] = [];
  for (const m of src.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["'][^"']+["']/g)) {
    for (const part of m[1].split(",")) {
      const name = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0].trim();
      if (name) names.push(name);
    }
  }
  return names;
}
