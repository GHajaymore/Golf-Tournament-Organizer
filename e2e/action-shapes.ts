import ts from "typescript";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * WHAT EVERY SERVER ACTION TAKES, READ FROM THE SOURCE.
 *
 * A `"use server"` export is a public HTTP endpoint (CLAUDE.md): anybody with
 * a session cookie can POST to it with whatever arguments they like. To knock
 * on every one of those doors a test has to know what each expects — and a
 * hand-kept list of 263 signatures would be out of date by the next commit.
 *
 * So this asks the compiler. The build's own manifest names every action and
 * the file it lives in; the TypeScript checker says what each parameter is,
 * all the way down through the object types — and a caller turns that shape
 * into arguments.
 */

export type Shape =
  | { kind: "string"; name: string; literals?: string[] }
  | { kind: "number"; name: string }
  | { kind: "boolean"; name: string }
  | { kind: "array"; name: string; of: Shape }
  | { kind: "record"; name: string; of: Shape }
  | { kind: "object"; name: string; props: { name: string; optional: boolean; shape: Shape }[] }
  | { kind: "unknown"; name: string; text: string };

export interface ActionShape {
  /** The id the browser sends in the `next-action` header. */
  id: string;
  /** The export's name, or `inline:<n>` for one written inside a component. */
  name: string;
  /** Path from the repository root, with forward slashes. */
  file: string;
  /** A route whose bundle carries the action, so a POST there reaches it. */
  path: string;
  params: { name: string; optional: boolean; shape: Shape }[];
  /** False when the source could not be matched to the manifest entry. */
  known: boolean;
}

interface ManifestEntry {
  workers: Record<string, unknown>;
  filename: string;
  exportedName: string;
}

/** Library types whose members are not arguments anybody types in. */
const OPAQUE = new Set(["Date", "FormData", "File", "Blob", "Map", "Set", "Promise", "Uint8Array", "ArrayBuffer"]);

function repoPath(filename: string): string {
  const flat = filename.replace(/\\/g, "/");
  const at = flat.lastIndexOf("/src/");
  return at >= 0 ? flat.slice(at + 1) : flat;
}

/**
 * A route to POST to. A static console screen for preference: it is behind
 * the same session the action is, and it has no segment to fill in.
 */
function routeFor(workers: string[]): string {
  const paths = workers
    .map((w) => w.replace(/^app/, "").replace(/\/page$/, "").replace(/\/\([^)]+\)/g, ""))
    .map((p) => (p === "" ? "/" : p))
    .filter((p) => !p.includes("["));
  const rank = (p: string) => (p.startsWith("/me") ? 1 : p === "/" ? 3 : workers.some((w) => w.startsWith("app/(app)") && w.includes(p)) ? 0 : 2);
  return [...paths].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))[0] ?? "/";
}

export function actionShapes(distDir = ".next-e2e"): ActionShape[] {
  const root = process.cwd();
  const manifest = JSON.parse(readFileSync(join(root, distDir, "server", "server-reference-manifest.json"), "utf8")) as {
    node: Record<string, ManifestEntry>;
  };
  const entries = Object.entries(manifest.node).map(([id, e]) => ({ id, ...e, file: repoPath(e.filename) }));
  const files = [...new Set(entries.map((e) => e.file))];

  const configPath = join(root, "tsconfig.json");
  const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: () => {},
  });
  if (!parsed) throw new Error("could not read tsconfig.json");
  const program = ts.createProgram(files.map((f) => resolve(root, f)), { ...parsed.options, noEmit: true });
  const checker = program.getTypeChecker();

  const shapeOf = (type: ts.Type, name: string, depth: number): Shape => {
    const text = checker.typeToString(type);
    if (depth > 5) return { kind: "unknown", name, text };
    if (type.isUnion()) {
      const real = type.types.filter((t) => !(t.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined | ts.TypeFlags.Void)));
      if (real.length === 0) return { kind: "unknown", name, text };
      if (real.every((t) => t.isStringLiteral())) {
        return { kind: "string", name, literals: real.map((t) => (t as ts.StringLiteralType).value) };
      }
      if (real.every((t) => t.flags & ts.TypeFlags.BooleanLike)) return { kind: "boolean", name };
      if (real.every((t) => t.flags & ts.TypeFlags.NumberLike)) return { kind: "number", name };
      if (real.every((t) => t.flags & ts.TypeFlags.StringLike)) return { kind: "string", name };
      // A mixed union: the richest member is the one worth sending.
      const object = real.find((t) => t.flags & ts.TypeFlags.Object);
      return shapeOf(object ?? real[0], name, depth + 1);
    }
    if (type.flags & ts.TypeFlags.StringLike) {
      return type.isStringLiteral() ? { kind: "string", name, literals: [type.value] } : { kind: "string", name };
    }
    if (type.flags & ts.TypeFlags.NumberLike) return { kind: "number", name };
    if (type.flags & ts.TypeFlags.BooleanLike) return { kind: "boolean", name };
    if (checker.isArrayType(type) || checker.isTupleType(type)) {
      const [of] = checker.getTypeArguments(type as ts.TypeReference);
      return { kind: "array", name, of: of ? shapeOf(of, name, depth + 1) : { kind: "unknown", name, text } };
    }
    if (type.flags & ts.TypeFlags.Object) {
      const symbolName = type.symbol?.name ?? "";
      if (OPAQUE.has(symbolName)) return { kind: "unknown", name, text };
      const index = type.getStringIndexType();
      const props = checker.getPropertiesOfType(type);
      if (index && props.length === 0) return { kind: "record", name, of: shapeOf(index, name, depth + 1) };
      return {
        kind: "object",
        name,
        props: props
          .filter((p) => !(p.flags & ts.SymbolFlags.Method))
          .map((p) => {
            const decl = p.valueDeclaration ?? p.declarations?.[0];
            const propType = decl ? checker.getTypeOfSymbolAtLocation(p, decl) : checker.getDeclaredTypeOfSymbol(p);
            return { name: p.name, optional: !!(p.flags & ts.SymbolFlags.Optional), shape: shapeOf(propType, p.name, depth + 1) };
          }),
      };
    }
    return { kind: "unknown", name, text };
  };

  const paramsOf = (fn: ts.SignatureDeclaration): ActionShape["params"] =>
    fn.parameters.map((p) => {
      const name = ts.isIdentifier(p.name) ? p.name.text : "arg";
      return {
        name,
        optional: !!p.questionToken || !!p.initializer || !!p.dotDotDotToken,
        shape: shapeOf(checker.getTypeAtLocation(p), name, 0),
      };
    });

  /** Every function in a file, by export name; and the inline ones in order. */
  const perFile = new Map<string, { named: Map<string, ts.SignatureDeclaration>; inline: ts.SignatureDeclaration[] }>();
  for (const file of files) {
    const source = program.getSourceFile(resolve(root, file));
    const named = new Map<string, ts.SignatureDeclaration>();
    const inline: ts.SignatureDeclaration[] = [];
    if (source) {
      const fileIsServer = source.statements.some(
        (s) => ts.isExpressionStatement(s) && ts.isStringLiteral(s.expression) && s.expression.text === "use server",
      );
      const visit = (node: ts.Node) => {
        if (ts.isFunctionDeclaration(node) && node.name && node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
          named.set(node.name.text, node);
        }
        if (ts.isVariableStatement(node) && node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
          for (const d of node.declarationList.declarations) {
            if (ts.isIdentifier(d.name) && d.initializer && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) {
              named.set(d.name.text, d.initializer);
            }
          }
        }
        if (!fileIsServer && (ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node))) {
          const body = node.body;
          if (body && ts.isBlock(body)) {
            const first = body.statements[0];
            if (first && ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression) && first.expression.text === "use server") {
              inline.push(node);
            }
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    perFile.set(file, { named, inline });
  }

  return entries
    .map((e) => {
      const found = perFile.get(e.file);
      const inlineAt = /^\$\$RSC_SERVER_ACTION_(\d+)$/.exec(e.exportedName);
      const fn = inlineAt ? found?.inline[Number(inlineAt[1])] : found?.named.get(e.exportedName);
      return {
        id: e.id,
        name: inlineAt ? `inline:${inlineAt[1]}` : e.exportedName,
        file: e.file,
        path: routeFor(Object.keys(e.workers)),
        params: fn ? paramsOf(fn) : [],
        known: !!fn,
      };
    })
    .sort((a, b) => a.file.localeCompare(b.file) || a.name.localeCompare(b.name));
}
