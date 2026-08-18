/**
 * Lets a script import the app services, for verifying against real data.
 *
 * Those modules start with `import "server-only"`, which is a package that
 * exists to THROW when a server module is pulled into a client bundle. A
 * script is the server, so outside Next it throws on a danger that is not
 * there. This resolves it to nothing.
 *
 *   npx tsx --require ./scripts/server-shim.cjs scripts/your-script.ts
 */
// `server-only` exists to throw when a server module is pulled into a client
// bundle. A script IS the server, so it resolves to nothing here.
const Module = require("module");
const path = require("path");
const empty = path.join(__dirname, "server-shim-empty.cjs");
const orig = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "server-only" || request === "client-only") return empty;
  return orig.call(this, request, ...rest);
};
