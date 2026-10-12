import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";

/**
 * THE SERVICE WORKER KEEPS NOBODY'S SCREENS (2026-10-11).
 *
 * `public/sw.js` answered every in-app page request from its cache FIRST,
 * keyed by address alone. On a phone that changed hands, the second member
 * tapping Money was shown the first member's money, their card, and their
 * "YOU" on the board — measured on the seeded club, three screens of three,
 * and again on the standing fixture by `e2e/shared-phone.spec.ts`.
 *
 * Nothing saw it. Every spec opens a screen by its ADDRESS, which is a whole
 * document and never came from the cache; a player gets there by TAPPING A
 * TAB, which is a page-data request and always did. And an earlier measurement
 * of mine called this safe, because it looked for a name on the screen rather
 * than comparing the screen.
 *
 * The cache existed so a tab would open with no signal. It did not do that
 * either (measured with the old worker, everything cached). So the worker now
 * keeps the four files that are nobody's and touches nothing else — and this
 * holds it to that, by running the real script in a sandbox with a cache and
 * a network the test controls.
 */

const SOURCE = readFileSync(join(process.cwd(), "public", "sw.js"), "utf8");
const ORIGIN = "https://club.example";

type Net = (url: string) => Response | Promise<Response>;

/** What a phone holds between visits: its caches. */
class Disk {
  caches = new Map<string, Map<string, Response>>();
  /** Every address anything was ever filed under, in any cache. */
  kept(): string[] {
    return [...this.caches.values()].flatMap((store) => [...store.keys()]);
  }
}

function fakeCaches(disk: Disk) {
  const key = (req: { url: string } | string) => (typeof req === "string" ? req : req.url);
  const open = (name: string) => {
    if (!disk.caches.has(name)) disk.caches.set(name, new Map());
    const store = disk.caches.get(name)!;
    return Promise.resolve({
      match: (req: { url: string } | string) => Promise.resolve(store.get(key(req))?.clone()),
      put: (req: { url: string } | string, res: Response) => {
        store.set(key(req), res);
        return Promise.resolve();
      },
      addAll: () => Promise.resolve(),
    });
  };
  return {
    open,
    delete: (name: string) => Promise.resolve(disk.caches.delete(name)),
    keys: () => Promise.resolve([...disk.caches.keys()]),
    // The old worker asked every cache at once.
    match: (req: { url: string } | string) => {
      for (const store of disk.caches.values()) {
        const hit = store.get(key(req));
        if (hit) return Promise.resolve(hit.clone());
      }
      return Promise.resolve(undefined);
    },
  };
}

/** One running worker: the real script, its handlers, and a network to answer it. */
function worker(disk: Disk, net: { current: Net }) {
  const handlers: Record<string, (event: unknown) => void> = {};
  const self = {
    addEventListener: (type: string, fn: (event: unknown) => void) => void (handlers[type] = fn),
    skipWaiting: () => {},
    clients: { claim: () => Promise.resolve(), matchAll: () => Promise.resolve([]), openWindow: () => Promise.resolve() },
    location: { origin: ORIGIN },
    registration: { showNotification: () => Promise.resolve() },
  };
  const fetch = (req: { url: string }) =>
    new Promise<Response>((resolve, reject) => {
      try {
        Promise.resolve(net.current(req.url)).then(resolve, reject);
      } catch (e) {
        reject(e);
      }
    });
  vm.runInNewContext(SOURCE, { self, caches: fakeCaches(disk), fetch, Response, URL, Promise, console });

  /**
   * What the worker does with a request: "LEFT TO THE BROWSER" when it does
   * not answer (the network then does, exactly as with no worker at all), the
   * body it answered with, or "FAILED".
   */
  const get = async (path: string, mode = "cors", method = "GET"): Promise<string> => {
    let answer: Promise<Response> | null = null;
    handlers.fetch({
      request: { method, mode, url: path.startsWith("http") ? path : ORIGIN + path },
      respondWith: (p: Promise<Response>) => void (answer = Promise.resolve(p)),
    });
    if (!answer) return "LEFT TO THE BROWSER";
    try {
      const res = await (answer as Promise<Response>);
      return res.ok ? await res.text() : "FAILED";
    } catch {
      return "FAILED";
    }
  };
  const activate = async () => {
    let done: Promise<unknown> = Promise.resolve();
    handlers.activate({ waitUntil: (p: Promise<unknown>) => void (done = p) });
    await done;
  };
  return { get, activate, handlers };
}

const page = (body: string) => new Response(body, { status: 200 });
const OFFLINE: Net = () => {
  throw new TypeError("Failed to fetch");
};
/** Lets the worker's own after-the-answer writes finish. */
const settle = () => new Promise((r) => setTimeout(r, 5));

/** What a thumb on a tab asks for, and the other private things a page fetches. */
const PRIVATE = [
  "/me/money?_rsc=8GvCFQYhNJxIos7c",
  "/me/card?_rsc=8GvCFQYhNJxIos7c",
  "/me/board?_rsc=8GvCFQYhNJxIos7c",
  "/dashboard?_rsc=1abc",
  "/account?_rsc=1abc",
  "/api/push/status",
  "/uploads/club-logo.png",
  "/card-photos/ann.jpg",
];

describe("a page somebody asks for", () => {
  it("is never answered by the worker — the network answers, or nothing does", async () => {
    const net = { current: (() => page("ann's screen")) as Net };
    const sw = worker(new Disk(), net);
    for (const path of PRIVATE) expect(await sw.get(path), path).toBe("LEFT TO THE BROWSER");
  });

  it("is never kept — not after one visit, not after many", async () => {
    const disk = new Disk();
    const net = { current: (() => page("ann's screen")) as Net };
    const sw = worker(disk, net);
    for (let visit = 0; visit < 3; visit += 1) for (const path of PRIVATE) await sw.get(path);
    await settle();
    expect(disk.kept(), "something of a signed-in person's was filed on the phone").toEqual([]);
  });

  it("so the next person on the phone cannot be handed it, with signal or without", async () => {
    const disk = new Disk();
    const net = { current: (() => page("ann's money")) as Net };
    const anns = worker(disk, net);
    await anns.get(PRIVATE[0]);
    await settle();

    // Bea takes the phone. The worker may have been stopped and started.
    const beas = worker(disk, net);
    net.current = () => page("bea's money");
    expect(await beas.get(PRIVATE[0])).toBe("LEFT TO THE BROWSER");
    net.current = OFFLINE;
    expect(await beas.get(PRIVATE[0])).toBe("LEFT TO THE BROWSER");
    expect(disk.kept()).toEqual([]);
  });

  it("CONTROL: the old worker, run the same way, hands Bea Ann's money", async () => {
    // The worker this replaced, in two lines — so the sandbox is shown to be
    // able to express the defect, and the assertions above are not passing on
    // a harness that could never fail.
    const old = [
      'self.addEventListener("fetch", (event) => {',
      "  const req = event.request;",
      "  event.respondWith(caches.match(req).then((cached) => {",
      '    const network = fetch(req).then((res) => { caches.open("flights-v1").then((c) => c.put(req, res.clone())); return res; }).catch(() => cached);',
      "    return cached || network;",
      "  }));",
      "});",
    ].join("\n");
    const disk = new Disk();
    const run = (net: Net) => {
      const handlers: Record<string, (event: unknown) => void> = {};
      const self = { addEventListener: (t: string, fn: (e: unknown) => void) => void (handlers[t] = fn) };
      vm.runInNewContext(old, { self, caches: fakeCaches(disk), fetch: (req: { url: string }) => Promise.resolve().then(() => net(req.url)), Response, Promise });
      return async (path: string) => {
        let answer: Promise<Response> | null = null;
        handlers.fetch({ request: { url: ORIGIN + path }, respondWith: (p: Promise<Response>) => void (answer = Promise.resolve(p)) });
        if (!answer) throw new Error("the old worker did not answer");
        return (await (answer as Promise<Response>)).text();
      };
    };
    expect(await run(() => page("ann's money"))(PRIVATE[0])).toBe("ann's money");
    await settle();
    expect(await run(() => page("bea's money"))(PRIVATE[0]), "the harness cannot show the defect").toBe("ann's money");
  });
});

describe("what is nobody's", () => {
  it("is exactly four files, kept for everybody", async () => {
    const disk = new Disk();
    const net = { current: (() => page("icon bytes")) as Net };
    const sw = worker(disk, net);
    for (const path of ["/manifest.webmanifest", "/icon.svg", "/icon-192.png", "/icon-512.png"]) {
      expect(await sw.get(path), path).toBe("icon bytes");
    }
    await settle();
    net.current = OFFLINE;
    expect(await sw.get("/icon-192.png")).toBe("icon bytes");
    expect(disk.kept().map((u) => u.replace(ORIGIN, "")).sort()).toEqual(
      ["/icon-192.png", "/icon-512.png", "/icon.svg", "/manifest.webmanifest"].sort(),
    );
  });

  it("and the list is a list — another image is somebody's until it is named", async () => {
    const sw = worker(new Disk(), { current: () => page("x") });
    expect(await sw.get("/icon-999.png")).toBe("LEFT TO THE BROWSER");
    expect(await sw.get("/some/club/logo.svg")).toBe("LEFT TO THE BROWSER");
    expect(await sw.get("/manifest.webmanifest?x=1")).not.toBe("FAILED");
  });

  it("leaves alone a whole document, a build chunk, another site, and anything that is not a GET", async () => {
    const sw = worker(new Disk(), { current: () => page("x") });
    expect(await sw.get("/me/money", "navigate")).toBe("LEFT TO THE BROWSER");
    expect(await sw.get("/_next/static/chunks/app.js")).toBe("LEFT TO THE BROWSER");
    expect(await sw.get("https://elsewhere.example/icon.svg")).toBe("LEFT TO THE BROWSER");
    expect(await sw.get("/icon.svg", "cors", "POST")).toBe("LEFT TO THE BROWSER");
  });
});

describe("a phone that already has the old cache on it", () => {
  it("loses it the first time this version runs", async () => {
    const disk = new Disk();
    disk.caches.set("flights-v1", new Map([[ORIGIN + PRIVATE[0], page("whoever last used this phone")]]));
    disk.caches.set("thq-pages-v2", new Map([[ORIGIN + PRIVATE[1], page("a draft of this fix")]]));
    const sw = worker(disk, { current: OFFLINE });
    await sw.activate();
    expect([...disk.caches.keys()]).toEqual([]);
    expect(await sw.get(PRIVATE[0])).toBe("LEFT TO THE BROWSER");
  });

  it("and still shows a pushed notification — the worker's other job is untouched", () => {
    const sw = worker(new Disk(), { current: OFFLINE });
    expect(typeof sw.handlers.push).toBe("function");
    expect(typeof sw.handlers.notificationclick).toBe("function");
    expect(typeof sw.handlers.install).toBe("function");
    expect(typeof sw.handlers.fetch, "a worker with no fetch handler is not installable on some browsers").toBe("function");
  });
});
