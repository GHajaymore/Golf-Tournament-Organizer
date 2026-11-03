/**
 * WHICH SERVER ACTION A PLAIN FORM POST CALLS (2026-11-03).
 *
 * A press the app makes itself names its action in the `next-action` header, and that is how
 * `coverage.ts` has always recorded reach. A form posted WITHOUT the page's script — JavaScript
 * off, or the round code's held press let go after ten seconds (`HeldBeforeLoad`) — sends no such
 * header: Next writes the action into the form's own body instead. So the two round-code actions
 * were walked by `round-code-before-the-script.spec.ts` and still reported "no screen test calls"
 * (round G421-1).
 *
 * Next writes it one of two ways, and both are read:
 *   - an action with nothing bound: a field NAMED `$ACTION_ID_<id>`;
 *   - an action with state bound (`useActionState`, as the round-code forms are): a field
 *     `$ACTION_<n>:0` whose VALUE is `{"id":"<id>","bound":…}` (measured in the trace of G421-1).
 *
 * Read from a multipart body (Next's forms are `multipart/form-data`) or an urlencoded one.
 * Pure, so `src/lib/__tests__/form-post-reach.test.ts` can hold it to a real body.
 */
const ID = /^[0-9a-f]{20,}$/i;

function fields(body: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  if (/content-disposition:\s*form-data/i.test(body)) {
    const part = /content-disposition:\s*form-data;\s*name="([^"]*)"[^\r\n]*\r?\n(?:[^\r\n]+\r?\n)*\r?\n([^\r\n]*)/gi;
    for (const m of body.matchAll(part)) out.push([m[1], m[2]]);
    return out;
  }
  try {
    for (const [k, v] of new URLSearchParams(body)) out.push([k, v]);
  } catch {
    /* not a form body */
  }
  return out;
}

/** The ids of the server actions a form post's body calls; none for any other body. */
export function actionsInFormPost(body: string | null | undefined): string[] {
  // Cheap first: most POST bodies name no action at all (urlencoded, `$` is `%24`).
  if (!body || !/(\$|%24)ACTION_/i.test(body)) return [];
  const ids = new Set<string>();
  for (const [name, value] of fields(body)) {
    if (name.startsWith("$ACTION_ID_")) {
      const id = name.slice("$ACTION_ID_".length);
      if (ID.test(id)) ids.add(id);
    } else if (/^\$ACTION_\d+:0$/.test(name)) {
      try {
        const id = (JSON.parse(value) as { id?: unknown })?.id;
        if (typeof id === "string" && ID.test(id)) ids.add(id);
      } catch {
        /* not the action's reference */
      }
    }
  }
  return [...ids];
}
