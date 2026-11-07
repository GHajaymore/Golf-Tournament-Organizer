// Fail, naming the cause, when the browsers a job drives are not where Playwright looks for them.
//
//   node scripts/ci/check-browsers-present.mjs chromium firefox
//
// A job in Playwright's container image installs nothing: the browsers were baked into the image
// for ONE Playwright version (mcr.microsoft.com/playwright:v<X>-noble). If the locked
// @playwright/test and the image's tag drift apart, this finds out here, in one step with a name,
// instead of as a test that cannot launch. (browser-image-matches-the-lockfile.test.ts makes the
// same check before the push.)
import { existsSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pw = require("playwright-core");
const engines = process.argv.slice(2);
if (engines.length === 0) {
  console.error("::error::check-browsers-present.mjs needs the engines to look for, e.g. chromium.");
  process.exit(2);
}
let missing = 0;
for (const name of engines) {
  const engine = pw[name];
  if (!engine) {
    console.error(`::error::${name} is not a Playwright engine.`);
    process.exit(2);
  }
  const path = engine.executablePath();
  if (path && existsSync(path)) {
    console.log(`${name}: ${path}`);
  } else {
    missing++;
    console.error(
      `::error::${name} is not at ${path}. The image's browsers are not the ones Playwright ${require("playwright-core/package.json").version} expects: a machine/config fault, not the app.`,
    );
  }
}
process.exit(missing ? 1 : 0);
