const { app, BrowserWindow, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const http = require("node:http");

const DEV_PORT = 3000; // the ordinary `npm run dev` port
const PACKAGED_PORT = 3210;
const isDev = !app.isPackaged;

let serverProcess = null;
let mainWindow = null;

function ensureUserDatabase() {
  const userDbPath = path.join(app.getPath("userData"), "flights.db");
  if (!fs.existsSync(userDbPath)) {
    const seedDbPath = path.join(process.resourcesPath, "standalone", "prisma", "dev.db");
    if (fs.existsSync(seedDbPath)) {
      fs.copyFileSync(seedDbPath, userDbPath);
    }
  }
  return userDbPath;
}

function portIsOpen(port) {
  return new Promise((resolve) => {
    http
      .get(`http://127.0.0.1:${port}/`, (res) => {
        res.resume();
        resolve(true);
      })
      .on("error", () => resolve(false));
  });
}

function waitForServer(port, timeoutMs = 30000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    (async function poll() {
      if (await portIsOpen(port)) {
        resolve();
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`Nothing answered on port ${port} within ${timeoutMs}ms`));
        return;
      }
      setTimeout(poll, 300);
    })();
  });
}

// Packaged builds run a fully self-contained Next.js standalone bundle
// (server.js + trimmed node_modules) as a child process, with the real
// SQLite database in the OS user-data folder — not the read-only,
// reinstallable app directory — so tournament data survives updates.
//
// Dev builds do NOT spawn their own `next dev`: two `next dev` processes
// sharing the same project's `.next` cache directory will step on each
// other. Instead this just points the window at the `npm run dev` server
// you already have running on :3000 (the same one the browser and mobile
// shells use), so desktop/mobile/browser are all live against one source
// of truth while you're testing.
async function startServerIfNeeded() {
  if (isDev) {
    const alreadyUp = await portIsOpen(DEV_PORT);
    if (!alreadyUp) {
      console.warn(
        `[TourneyHQ] Nothing is answering on http://localhost:${DEV_PORT} yet.\n` +
          `Run "npm run dev" in another terminal first, then relaunch electron:dev.`
      );
    }
    return DEV_PORT;
  }

  const standaloneRoot = path.join(process.resourcesPath, "standalone");
  const userDbPath = ensureUserDatabase();
  serverProcess = spawn(process.execPath, [path.join(standaloneRoot, "server.js")], {
    cwd: standaloneRoot,
    env: {
      ...process.env,
      PORT: String(PACKAGED_PORT),
      HOSTNAME: "127.0.0.1",
      DATABASE_URL: `file:${userDbPath}`,
      ELECTRON_RUN_AS_NODE: "1",
    },
    stdio: "inherit",
  });
  serverProcess.on("exit", (code) => {
    if (code !== 0 && code !== null) console.error(`TourneyHQ server exited with code ${code}`);
  });
  return PACKAGED_PORT;
}

async function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: "#16181a",
    title: "TourneyHQ",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // External links (nothing in-app currently opens one, but this is the
  // correct default so a future <a target="_blank"> doesn't spawn a
  // Chromium child window inside the desktop shell) open in the OS browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  await waitForServer(port);
  mainWindow.loadURL(`http://127.0.0.1:${port}/dashboard`);
}

app.whenReady().then(async () => {
  const port = await startServerIfNeeded();
  await createWindow(port);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(port);
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (serverProcess) serverProcess.kill();
});
