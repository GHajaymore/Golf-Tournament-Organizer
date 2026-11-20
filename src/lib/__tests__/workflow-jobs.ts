/** A workflow's jobs, by name: the text from `  <name>:` at two spaces under `jobs:` to the next one. */
export function jobsOf(text: string): Record<string, string> {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  const jobs: Record<string, string[]> = {};
  let current: string | null = null;
  for (const l of lines.slice(start + 1)) {
    const m = /^  ([\w-]+):\s*$/.exec(l);
    if (m) {
      current = m[1];
      jobs[current] = [];
    } else if (current && /^\S/.test(l)) {
      current = null; // a new top-level key ends `jobs:`
    }
    if (current) jobs[current].push(l);
  }
  return Object.fromEntries(Object.entries(jobs).map(([k, v]) => [k, v.join("\n")]));
}
