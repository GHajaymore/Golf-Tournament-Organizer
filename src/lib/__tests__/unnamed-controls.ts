/**
 * Form controls in rendered HTML that nothing names.
 *
 * A control is named by `aria-label` / `aria-labelledby` / `title`, by a
 * `<label for>` pointing at its id, or by a `<label>` that wraps it. A
 * `<label>` sitting BESIDE a control with no `for` names nothing — a screen
 * reader announces "edit text" — and that is the case this exists to find.
 *
 * Shared by `first-run-controls-are-named` and `console-controls-are-named`,
 * which each carry a control proving it can find an unnamed one.
 */
export function unnamedControls(html: string): string[] {
  const labelFor = new Set([...html.matchAll(/<label[^>]*\sfor="([^"]+)"/g)].map((m) => m[1]));
  const out: string[] = [];
  for (const m of html.matchAll(/<(input|select|textarea)\b([^>]*)>/g)) {
    const [tag, kind, attrs] = [m[0], m[1], m[2]];
    const type = /\stype="([^"]+)"/.exec(attrs)?.[1] ?? "";
    if (["hidden", "submit", "button", "reset", "image"].includes(type)) continue;
    // A control hidden from everyone, driven by a visible button (a file
    // picker behind "Upload"), is not in the accessibility tree at all.
    if (/\shidden(="[^"]*")?(\s|$|\/)/.test(attrs)) continue;
    if (/\saria-label(ledby)?="[^"]+"/.test(attrs) || /\stitle="[^"]+"/.test(attrs)) continue;
    const id = /\sid="([^"]+)"/.exec(attrs)?.[1];
    if (id && labelFor.has(id)) continue;
    // Wrapped: an unclosed <label> opened before this control — and one with
    // some TEXT in it. A label wrapping nothing but the box names nothing;
    // the tiebreaker switches on the scoring screen were exactly that.
    const before = html.slice(0, m.index);
    const open = before.lastIndexOf("<label");
    if (open > before.lastIndexOf("</label>")) {
      const close = html.indexOf("</label>", m.index);
      const words = html.slice(open, close < 0 ? undefined : close).replace(/<[^>]*>/g, "").trim();
      if (words) continue;
    }
    out.push(`${kind}${type ? `[${type}]` : ""} ${tag.slice(0, 80)}`);
  }
  return out;
}
