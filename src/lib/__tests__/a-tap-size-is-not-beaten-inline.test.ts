import { describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { readSource, stripComments } from "./source";

/**
 * A SIZE WRITTEN INLINE ON A CONTROL MUST NOT BEAT THE FINGER'S.
 *
 * Under a coarse pointer `globals.css` raises every control to 44px — `.btn`,
 * `.input`, a label round a radio, and the rest — with `min-height`. An inline
 * `minHeight` beats every one of those rules, because no stylesheet rule
 * outranks a style attribute. So a control that wrote its own
 * (`style={{ minHeight: 36 }}` on a `.btn`) kept 36px on a phone, and the
 * touch rule written for it was dead there without a word. Club settings'
 * eighteen house-default options were exactly that, found 2026-10-23 when the
 * touch sweep first opened the screen's tabs; a sweep of the source then found
 * eight more.
 *
 * The rule, read from source over every `.tsx` in `src/app` and
 * `src/components`:
 *
 *   - a pressable (a button, link, label, summary, field, a `…Button` or
 *     `…Link` component, or anything with a control's role) that sets an
 *     inline `minHeight` under 44px must read it through the token the
 *     coarse-pointer rule sets: `minHeight: "var(--tap-min, 36px)"`;
 *   - an inline `height` under 44px is allowed only on an element a
 *     coarse-pointer `min-height` rule reaches by class (or a label or
 *     summary, which the coarse block reaches by element) — `min-height` wins
 *     over `height`, so there the rule still does its job. Anywhere else a
 *     small `height` is a small target with nothing to raise it.
 *
 * WHAT THIS CANNOT SEE: a size that arrives through a prop, a style built at
 * run time, or a stylesheet rule more specific than the coarse one (those
 * were swept by hand on 2026-10-23 and none outranks it). `touch.spec`
 * measures what is drawn, on the screens it walks.
 */

const FLOOR = 44;
const TOKEN = "var(--tap-min";

const PRESS_TAGS = new Set(["button", "a", "label", "summary", "select", "input", "textarea", "Link"]);
const PRESS_ROLES = new Set(["button", "link", "tab", "radio", "checkbox", "switch", "option", "menuitem"]);

/** Classes a coarse-pointer rule gives a 44px `min-height`, read off the stylesheet. */
export function coarseSizedClasses(css: string): { classes: Set<string>; tokenSet: boolean } {
  const classes = new Set<string>();
  let tokenSet = false;
  const opener = /@media\s*\(pointer:\s*coarse\)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = opener.exec(css))) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    while (i < css.length && depth > 0) {
      if (css[i] === "{") depth += 1;
      else if (css[i] === "}") depth -= 1;
      i += 1;
    }
    const block = stripComments(css.slice(start, i - 1));
    for (const rule of block.split("}")) {
      const [selectors, body] = rule.split("{");
      if (!body) continue;
      if (/--tap-min:\s*44px/.test(body) && /:root/.test(selectors)) tokenSet = true;
      if (!/min-height:\s*44px/.test(body)) continue;
      for (const c of selectors.match(/\.[A-Za-z][\w-]*/g) ?? []) classes.add(c.slice(1));
    }
  }
  return { classes, tokenSet };
}

/** The pixels a size expression can come to, or null when it is not a plain figure. */
function figures(expr: ts.Expression): number[] | null {
  if (ts.isNumericLiteral(expr)) return [Number(expr.text)];
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
    const px = /^\s*(\d+(?:\.\d+)?)(px)?\s*$/.exec(expr.text);
    return px ? [Number(px[1])] : null;
  }
  if (ts.isParenthesizedExpression(expr)) return figures(expr.expression);
  if (ts.isConditionalExpression(expr)) {
    const a = figures(expr.whenTrue);
    const b = figures(expr.whenFalse);
    if (!a && !b) return null;
    return [...(a ?? []), ...(b ?? [])];
  }
  return null;
}

export interface TapFault {
  where: string;
  what: string;
}

/** Every inline size on a pressable in one file that beats, or has no, coarse-pointer rule. */
export function tapSizeFaults(file: string, source: string, covered: Set<string>): { faults: TapFault[]; examined: number } {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const faults: TapFault[] = [];
  let examined = 0;

  // Same-file `const x = { … }` (optionally typed), for `style={x}` and `{ ...x }`.
  const objects = new Map<string, ts.ObjectLiteralExpression>();
  const collect = (n: ts.Node) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
      let init: ts.Expression = n.initializer;
      while (ts.isAsExpression(init) || ts.isSatisfiesExpression(init) || ts.isParenthesizedExpression(init)) init = init.expression;
      if (ts.isObjectLiteralExpression(init)) objects.set(n.name.text, init);
    }
    ts.forEachChild(n, collect);
  };
  collect(sf);

  const propsOf = (expr: ts.Expression, seen = new Set<string>()): ts.PropertyAssignment[] => {
    let e = expr;
    while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e)) e = e.expression;
    if (ts.isIdentifier(e)) {
      const o = objects.get(e.text);
      if (!o || seen.has(e.text)) return [];
      seen.add(e.text);
      return propsOf(o, seen);
    }
    if (!ts.isObjectLiteralExpression(e)) return [];
    const out: ts.PropertyAssignment[] = [];
    for (const p of e.properties) {
      if (ts.isPropertyAssignment(p)) out.push(p);
      else if (ts.isSpreadAssignment(p)) out.push(...propsOf(p.expression, seen));
    }
    return out;
  };

  const visit = (n: ts.Node) => {
    if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
      const tag = n.tagName.getText(sf);
      const attr = (name: string) =>
        n.attributes.properties.find((a): a is ts.JsxAttribute => ts.isJsxAttribute(a) && a.name.getText(sf) === name);
      const role = attr("role")?.initializer;
      const roleText = role && ts.isStringLiteral(role) ? role.text : "";
      // A field inside a label is tapped by its label, which is what touch.spec
      // measures too: the 18px box of a checkbox is the glyph, not the target.
      let insideLabel = false;
      for (let up: ts.Node | undefined = n.parent; up && !insideLabel; up = up.parent) {
        if (ts.isJsxElement(up) && up.openingElement !== n && up.openingElement.tagName.getText(sf) === "label") insideLabel = true;
      }
      const pressable =
        (PRESS_TAGS.has(tag) || /^[A-Z]\w*(Button|Link)$/.test(tag) || PRESS_ROLES.has(roleText)) &&
        !(tag === "input" && insideLabel);
      const style = attr("style")?.initializer;
      if (pressable && style && ts.isJsxExpression(style) && style.expression) {
        examined += 1;
        const classAttr = attr("className")?.initializer;
        const classText = classAttr ? classAttr.getText(sf) : "";
        const classes = new Set(classText.match(/[A-Za-z][\w-]*/g) ?? []);
        const reached = tag === "label" || tag === "summary" || [...classes].some((c) => covered.has(c));
        for (const p of propsOf(style.expression)) {
          const key = p.name.getText(sf);
          if (key !== "minHeight" && key !== "height") continue;
          if (p.initializer.getText(sf).includes(TOKEN)) continue;
          const px = figures(p.initializer);
          if (!px || !px.some((v) => v < FLOOR)) continue;
          if (key === "height" && reached) continue;
          const line = sf.getLineAndCharacterOfPosition(p.getStart(sf)).line + 1;
          faults.push({
            where: `${file}:${line}`,
            what:
              key === "minHeight"
                ? `<${tag}> minHeight ${p.initializer.getText(sf)} beats the 44px touch rule — write minHeight: "${TOKEN}, ${px[0]}px)"`
                : `<${tag}> height ${p.initializer.getText(sf)} and no coarse-pointer rule reaches it by class`,
          });
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return { faults, examined };
}

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "__tests__") out.push(...tsxFiles(p));
    } else if (e.name.endsWith(".tsx")) out.push(p);
  }
  return out;
}

const covered = coarseSizedClasses(readSource("src", "app", "globals.css"));

describe("a tap size written inline does not beat the finger's", () => {
  it("the coarse-pointer rules are read: the classes they raise, and the token", () => {
    // CONTROL: a reader that found nothing would make every `height` a fault
    // or, worse, the token check meaningless.
    for (const c of ["btn", "input", "seg-opt", "hole-nav-btn", "touch-target"]) expect(covered.classes.has(c), c).toBe(true);
    expect(covered.tokenSet, "--tap-min is not set to 44px under a coarse pointer").toBe(true);
  });

  it("no pressable in the app sets a size under 44px that the touch rule cannot raise", () => {
    const root = process.cwd();
    const faults: TapFault[] = [];
    let examined = 0;
    for (const dir of [join(root, "src", "app"), join(root, "src", "components")]) {
      for (const f of tsxFiles(dir)) {
        const rel = relative(root, f).replace(/\\/g, "/");
        const found = tapSizeFaults(rel, readSource(rel), covered.classes);
        faults.push(...found.faults);
        examined += found.examined;
      }
    }
    // CONTROL: the walk really read styled controls (several hundred carry one).
    expect(examined, "examined almost no styled controls — is the walk reading the files?").toBeGreaterThan(200);
    expect(faults.map((f) => `${f.where} — ${f.what}`)).toEqual([]);
  });

  it("CONTROL: it catches Club settings' option label as it was, and passes it as it is", () => {
    const before = `export const X = () => (
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, minHeight: 36 }}>
        <input type="radio" />
      </label>
    );`;
    const after = before.replace("minHeight: 36", `minHeight: "var(--tap-min, 36px)"`);
    expect(tapSizeFaults("before.tsx", before, covered.classes).faults).toHaveLength(1);
    expect(tapSizeFaults("after.tsx", after, covered.classes).faults).toEqual([]);
  });

  it("CONTROL: a size reached through a const or a spread, a ternary, and a bare height", () => {
    const src = `
      const chip = { minHeight: 30 };
      const base = { padding: 4 };
      export const X = ({ on }: { on: boolean }) => (<>
        <button style={chip} />
        <a role="button" style={{ ...base, minHeight: on ? 48 : "32px" }} />
        <button style={{ height: 24 }} />
        <button className="btn btn-icon" style={{ height: 24, width: 24 }} />
        <button className="hole-nav-btn" style={{ height: 40 }} />
        <label><input type="checkbox" style={{ width: 18, height: 18 }} /> Tick</label>
        <div style={{ minHeight: 12 }} />
      </>);`;
    const lines = tapSizeFaults("c.tsx", src, covered.classes).faults.map((f) => f.what);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^<button> minHeight 30/);
    expect(lines[1]).toMatch(/^<a> minHeight on \? 48 : "32px"/);
    expect(lines[2]).toMatch(/^<button> height 24 and no coarse-pointer rule/);
  });
});
