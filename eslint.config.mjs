import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

/**
 * Lint rules for the console.
 *
 * Deliberately narrow. A rule that fires on hundreds of existing lines gets
 * switched off within a day, so this turns on the checks that catch real
 * defects in *this* codebase and leaves style alone — Prettier-style
 * disagreements are not worth a red build.
 *
 * The accessibility rules earn their place: an unlabelled score box is
 * invisible to a screen reader and invisible in review, and this app is a row
 * of eighteen of them.
 */
export default [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "out/**",
      "dist/**",
      "electron/**",
      "android/**",
      "ios/**",
      "prisma/migrations/**",
      "next-env.d.ts",
    ],
  },
  {
    rules: {
      // An unused variable is usually a half-finished edit. Underscore-prefixed
      // names are the escape hatch for a deliberately ignored argument.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
      // `any` disables the type checking that catches the bugs this project
      // keeps hitting — a wrong field name, a null that was not handled.
      "@typescript-eslint/no-explicit-any": "error",
      // A `const` read above the line that declares it. TypeScript permits
      // this whenever the read sits inside a closure, because the closure
      // *could* run later — but a callback passed to .map() runs immediately,
      // and the read throws "Cannot access X before initialization" at
      // runtime. That is exactly how the Rounds & formats screen broke: it
      // used `attendanceMode` inside a .map() above the line declaring it, so
      // the page threw on every render, and since saving a score revalidates
      // the whole layout, no score could be entered anywhere in the app.
      // tsc and 985 tests all passed. Only the browser console showed it.
      "no-use-before-define": "off",
      "@typescript-eslint/no-use-before-define": [
        "error",
        { functions: false, classes: false, variables: true, typedefs: false },
      ],
      // Style, not correctness. Left to judgement.
      "react/no-unescaped-entities": "off",
    },
  },
];
