// Next.js's `output: "standalone"` build produces a self-contained
// server.js + trimmed node_modules, but deliberately leaves out a few
// things a real deploy has to add back by hand:
//   - public/ and .next/static/ (static assets aren't traced as server deps)
//   - the Prisma query-engine binary + generated client, which Next's file
//     tracer frequently misses since Prisma loads it dynamically at runtime
//   - a seed copy of the dev database, so a freshly installed desktop app
//     has real schema + starter data on first launch
// Run after `next build`, before electron-builder packages the result.
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const standalone = path.join(root, ".next", "standalone");

if (!fs.existsSync(standalone)) {
  console.error("No .next/standalone output found — run `next build` first.");
  process.exit(1);
}

function copy(src, dest) {
  if (!fs.existsSync(src)) return;
  fs.cpSync(src, dest, { recursive: true, force: true });
  console.log(`copied ${path.relative(root, src)} -> ${path.relative(root, dest)}`);
}

copy(path.join(root, "public"), path.join(standalone, "public"));
copy(path.join(root, ".next", "static"), path.join(standalone, ".next", "static"));
copy(path.join(root, "node_modules", ".prisma"), path.join(standalone, "node_modules", ".prisma"));
copy(path.join(root, "node_modules", "@prisma", "client"), path.join(standalone, "node_modules", "@prisma", "client"));
copy(path.join(root, "prisma", "schema.prisma"), path.join(standalone, "prisma", "schema.prisma"));
copy(path.join(root, "prisma", "dev.db"), path.join(standalone, "prisma", "dev.db"));

console.log("Standalone bundle ready for electron-builder.");
