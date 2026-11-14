import { readdirSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readSource } from "./source";
import {
  PUSH_WAIT_MS,
  releaseThisDevicesPush,
  thisDevicesPushEndpoint,
  withinLimit,
} from "@/lib/push-client";

/**
 * SIGN-OUT NEVER WAITS ON THE BROWSER'S PUSH MACHINERY (round G636-1, Safari).
 *
 * `/choose` asked `pushManager.getSubscription()` in a WebKit with no
 * `PushManager`; the call never settled, the page hung, and the Sign out press
 * never landed. Every Sign out awaits `releaseThisDevicesPush()` before
 * signing out, so these pin: no question is put to a browser that cannot push,
 * and every question that IS put has a limit. Then a sweep keeps the questions
 * in `push-client.ts`, so a screen written later cannot ask one bare.
 */

const ENDPOINT = "https://push.example.invalid/zz-push-one-place";
const never = <T>() => new Promise<T>(() => {});

type Stubs = { pushManagerInWindow: boolean; getSubscription: () => Promise<unknown>; unsubscribe?: () => Promise<boolean> };

function stubBrowser({ pushManagerInWindow, getSubscription, unsubscribe }: Stubs) {
  const getSub = vi.fn(getSubscription);
  const reg = { pushManager: { getSubscription: getSub } };
  vi.stubGlobal("window", pushManagerInWindow ? { PushManager: function PushManager() {} } : {});
  vi.stubGlobal("navigator", { serviceWorker: { getRegistration: vi.fn(async () => reg), ready: never() } });
  return { getSub, sub: { endpoint: ENDPOINT, unsubscribe: vi.fn(unsubscribe ?? (async () => true)) } };
}

/** Resolves to "pending" if the promise has not settled once the timers have run `ms`. */
async function settledWithin<T>(p: Promise<T>, ms: number): Promise<T | "pending"> {
  let out: T | "pending" = "pending";
  void p.then((v) => (out = v));
  await vi.advanceTimersByTimeAsync(ms);
  return out;
}

describe("this browser's push is never waited on forever", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("a browser without PushManager is not asked at all, and answers at once (WebKit's hang)", async () => {
    const { getSub } = stubBrowser({ pushManagerInWindow: false, getSubscription: never });
    expect(await settledWithin(releaseThisDevicesPush(), 0)).toBe("");
    expect(await settledWithin(thisDevicesPushEndpoint(), 0)).toBe("");
    expect(getSub, "a browser that cannot push was asked for its subscription").not.toHaveBeenCalled();
  });

  it("a getSubscription that never settles lets sign-out go on within the limit", async () => {
    stubBrowser({ pushManagerInWindow: true, getSubscription: never });
    const release = releaseThisDevicesPush();
    const field = thisDevicesPushEndpoint();
    expect(await settledWithin(release, PUSH_WAIT_MS * 2 + 50)).toBe("");
    expect(await settledWithin(field, 0)).toBe("");
  });

  it("an unsubscribe that never settles still hands sign-out the endpoint within the limit", async () => {
    const holder: { sub?: unknown } = {};
    const { sub } = stubBrowser({ pushManagerInWindow: true, getSubscription: async () => holder.sub, unsubscribe: never });
    holder.sub = sub;
    expect(await settledWithin(releaseThisDevicesPush(), PUSH_WAIT_MS * 3 + 50)).toBe(ENDPOINT);
    expect(sub.unsubscribe).toHaveBeenCalledOnce();
  });

  it("a browser that answers is answered: the endpoint, and the browser lets go", async () => {
    const holder: { sub?: unknown } = {};
    const { sub } = stubBrowser({ pushManagerInWindow: true, getSubscription: async () => holder.sub });
    holder.sub = sub;
    expect(await settledWithin(thisDevicesPushEndpoint(), 0)).toBe(ENDPOINT);
    expect(sub.unsubscribe).not.toHaveBeenCalled();
    expect(await settledWithin(releaseThisDevicesPush(), 0)).toBe(ENDPOINT);
    expect(sub.unsubscribe).toHaveBeenCalledOnce();
  });

  it("withinLimit: a throw, a rejection and a hang all come back as the fallback", async () => {
    expect(await settledWithin(withinLimit(() => { throw new Error("x"); }, "fb"), 0)).toBe("fb");
    expect(await settledWithin(withinLimit(() => Promise.reject(new Error("x")), "fb"), 0)).toBe("fb");
    expect(await settledWithin(withinLimit(never<string>, "fb"), PUSH_WAIT_MS - 1)).toBe("pending");
    expect(await settledWithin(withinLimit(never<string>, "fb"), PUSH_WAIT_MS)).toBe("fb");
  });
});

describe("push is asked in one place: src/lib/push-client.ts", () => {
  /**
   * A bare question to the browser's push machinery, which can hang for ever in
   * WebKit. `register` / `getRegistrations` (ServiceWorkerRegister's
   * fire-and-forget housekeeping, which nothing awaits) are not push questions.
   */
  const BARE = [/\.pushManager\b/, /serviceWorker\s*\.\s*(ready|getRegistration)\b/];

  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? e.name === "__tests__" ? [] : files(`${dir}/${e.name}`)
        : /\.(ts|tsx)$/.test(e.name) ? [`${dir}/${e.name}`] : [],
    );

  it("control: the sweep sees a bare question when there is one", () => {
    const bare = "const reg = await navigator.serviceWorker.ready; await reg.pushManager.getSubscription();";
    expect(BARE.every((re) => re.test(bare))).toBe(true);
    expect(BARE.some((re) => re.test(readSource("src", "lib", "push-client.ts"))), "the sweep reads nothing").toBe(true);
  });

  it("no file but push-client.ts asks one", () => {
    const offenders = files("src")
      .filter((f) => f !== "src/lib/push-client.ts")
      .filter((f) => BARE.some((re) => re.test(readSource(f))));
    expect(offenders, "ask through src/lib/push-client.ts, which feature-checks and time-limits every wait").toEqual([]);
  });
});
