import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { askForBotCheck, isLandingPost, makeGuardedFetch, BOT_CHECK_WAIT_MS } from "@/lib/bot-check-fetch";
import { readSource } from "./source";

/**
 * THE BOT CHECK MAY NOT HOLD THE FRONT DOOR SHUT.
 *
 * `e2e/the-bot-check-cannot-shut-the-door.spec.ts` does this in a browser with
 * the real script blocked and stalled. This drives the guard itself, where the
 * order of events can be chosen exactly: the check answering, erroring or
 * saying nothing, before or after the request has gone.
 *
 * Every case counts what was actually SENT, because the two faults this can
 * have are opposite ones: a request that never goes, and a request that goes
 * twice (a sign-up made twice, a reset link sent twice).
 */

const ORIGIN = "https://club.example.invalid";
const POST = { method: "POST", body: "form" } as const;
const answer = (text: string) => new Response(text);

/** A stand-in for the bot check's own `fetch`: it waits to be told the check's outcome, then sends through `out`. */
function botCheck(out: () => typeof fetch) {
  let pass!: () => void;
  let fail!: (why: Error) => void;
  const outcome = new Promise<void>((yes, no) => {
    pass = yes;
    fail = no;
  });
  const calls: Array<{ headers: Headers }> = [];
  const checked: typeof fetch = async (input, init) => {
    await outcome;
    const headers = new Headers(init?.headers);
    headers.set("x-is-human", "yes");
    calls.push({ headers });
    return out()(input, { ...init, headers });
  };
  return { checked, pass, fail, calls };
}

function harness() {
  const sent: Array<{ human: boolean; aborted: boolean }> = [];
  let respond: (r: Response) => void = () => {};
  let refuse: (e: Error) => void = () => {};
  const plain: typeof fetch = (_input, init) => {
    // The browser refuses a request whose signal is already aborted, unsent.
    if (init?.signal?.aborted) return Promise.reject(new DOMException("aborted", "AbortError"));
    sent.push({ human: new Headers(init?.headers).has("x-is-human"), aborted: false });
    return new Promise<Response>((yes, no) => {
      respond = yes;
      refuse = no;
    });
  };
  const guarded = makeGuardedFetch({ plain, isProtected: (input, init) => isLandingPost(input, init, ORIGIN) });
  const check = botCheck(() => guarded.send);
  const fetchNow = guarded.guard(() => check.checked);
  return { sent, fetchNow, check, respond: (r: Response) => respond(r), refuse: (e: Error) => refuse(e) };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("a request nobody asked the bot check about never waits for it", () => {
  it("signing in goes straight out, and the bot check is not even started", async () => {
    const h = harness();
    const going = h.fetchNow(`${ORIGIN}/`, POST);
    expect(h.sent, "a sign-in waited on the bot check").toEqual([{ human: false, aborted: false }]);
    expect(h.check.calls).toEqual([]);
    h.respond(answer("in"));
    expect(await (await going).text()).toBe("in");
  });

  it("an ask is used once: the request after a sign-up is a plain one again", async () => {
    const h = harness();
    askForBotCheck(Date.now());
    const first = h.fetchNow(`${ORIGIN}/`, POST);
    h.check.pass();
    await vi.advanceTimersByTimeAsync(0);
    h.respond(answer("signed up"));
    await first;
    const second = h.fetchNow(`${ORIGIN}/`, POST);
    expect(h.sent.map((s) => s.human)).toEqual([true, false]);
    h.respond(answer("in"));
    await second;
  });

  it("an ask does not outlive the moment it was made", async () => {
    const h = harness();
    askForBotCheck(Date.now() - 60_000);
    void h.fetchNow(`${ORIGIN}/`, POST);
    expect(h.sent).toEqual([{ human: false, aborted: false }]);
  });

  it("an address the check is not set on is never held, asked or not", async () => {
    const h = harness();
    askForBotCheck(Date.now());
    void h.fetchNow(`${ORIGIN}/dashboard`, POST);
    void h.fetchNow(`${ORIGIN}/`, { method: "GET" });
    void h.fetchNow("https://elsewhere.example.invalid/", POST);
    expect(h.sent.map((s) => s.human)).toEqual([false, false, false]);
    expect(h.check.calls).toEqual([]);
  });
});

describe("a sign-up is checked, for a bounded time, and sent exactly once", () => {
  it("the check answers: sent once, with the check's word on it", async () => {
    const h = harness();
    askForBotCheck(Date.now());
    const going = h.fetchNow(`${ORIGIN}/`, POST);
    expect(h.sent, "a sign-up went before the check had answered").toEqual([]);
    h.check.pass();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.sent).toEqual([{ human: true, aborted: false }]);
    h.respond(answer("made"));
    expect(await (await going).text()).toBe("made");
    await vi.advanceTimersByTimeAsync(BOT_CHECK_WAIT_MS * 2);
    expect(h.sent, "the wait ran out on a request that had already gone, and sent it again").toHaveLength(1);
  });

  it("the check is blocked: sent once without it, and the server decides", async () => {
    const h = harness();
    askForBotCheck(Date.now());
    const going = h.fetchNow(`${ORIGIN}/`, POST);
    h.check.fail(new Error("script blocked"));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.sent, "a blocked check stopped the request going at all").toEqual([{ human: false, aborted: false }]);
    h.respond(answer("server's answer"));
    expect(await (await going).text()).toBe("server's answer");
  });

  it("the check never answers: sent once without it when the wait runs out — and not before", async () => {
    const h = harness();
    askForBotCheck(Date.now());
    const going = h.fetchNow(`${ORIGIN}/`, POST);
    await vi.advanceTimersByTimeAsync(BOT_CHECK_WAIT_MS - 1);
    expect(h.sent, "the request gave up on the check early").toEqual([]);
    await vi.advanceTimersByTimeAsync(2);
    expect(h.sent, "a check that never answered held the request for ever").toEqual([{ human: false, aborted: false }]);
    h.respond(answer("server's answer"));
    expect(await (await going).text()).toBe("server's answer");
  });

  it("the check answers AFTER the wait ran out: the waiting copy is not sent as well", async () => {
    const h = harness();
    askForBotCheck(Date.now());
    const going = h.fetchNow(`${ORIGIN}/`, POST);
    await vi.advanceTimersByTimeAsync(BOT_CHECK_WAIT_MS + 1);
    expect(h.sent).toHaveLength(1);
    h.check.pass();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.sent, "the same sign-up was sent twice").toEqual([{ human: false, aborted: false }]);
    h.respond(answer("once"));
    expect(await (await going).text()).toBe("once");
  });

  it("the request went and its answer is slow: it is not given up on, however long it takes", async () => {
    const h = harness();
    askForBotCheck(Date.now());
    const going = h.fetchNow(`${ORIGIN}/`, POST);
    h.check.pass();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(BOT_CHECK_WAIT_MS * 5);
    expect(h.sent, "a slow answer was taken for a stuck check, and the sign-up sent again").toHaveLength(1);
    h.respond(answer("late"));
    expect(await (await going).text()).toBe("late");
  });

  it("the request went and FAILED: the caller hears that, and it is not sent again", async () => {
    const h = harness();
    askForBotCheck(Date.now());
    const going = h.fetchNow(`${ORIGIN}/`, POST);
    const heard = going.then(
      () => "answered",
      (e: Error) => e.message,
    );
    h.check.pass();
    await vi.advanceTimersByTimeAsync(0);
    h.refuse(new Error("network down"));
    expect(await heard).toBe("network down");
    await vi.advanceTimersByTimeAsync(BOT_CHECK_WAIT_MS * 2);
    expect(h.sent).toHaveLength(1);
  });

  it("the caller cancels while it waits: nothing is sent, then or later", async () => {
    const h = harness();
    askForBotCheck(Date.now());
    const stop = new AbortController();
    const heard = h.fetchNow(`${ORIGIN}/`, { ...POST, signal: stop.signal }).then(
      () => "answered",
      () => "cancelled",
    );
    stop.abort();
    expect(await heard).toBe("cancelled");
    h.check.pass();
    await vi.advanceTimersByTimeAsync(BOT_CHECK_WAIT_MS * 2);
    expect(h.sent).toEqual([]);
  });
});

describe("the wiring", () => {
  it("only a same-origin POST to the landing page is the protected request", () => {
    expect(isLandingPost(`${ORIGIN}/`, { method: "POST" }, ORIGIN)).toBe(true);
    expect(isLandingPost("/", { method: "post" }, ORIGIN)).toBe(true);
    expect(isLandingPost("/?next=%2Fprizes", { method: "POST" }, ORIGIN)).toBe(true);
    expect(isLandingPost(new Request(`${ORIGIN}/`, { method: "POST" }), undefined, ORIGIN)).toBe(true);
    expect(isLandingPost(`${ORIGIN}/`, undefined, ORIGIN)).toBe(false);
    expect(isLandingPost(`${ORIGIN}/me`, { method: "POST" }, ORIGIN)).toBe(false);
    expect(isLandingPost("https://elsewhere.example.invalid/", { method: "POST" }, ORIGIN)).toBe(false);
  });

  it("the sign-up form asks, and it is the only thing that does", () => {
    const panel = readSource("src/components/LoginPanel.tsx");
    expect(panel.split("askForBotCheck(").length - 1, "the ask is made somewhere other than once").toBe(1);
    const at = panel.indexOf("askForBotCheck(");
    const next = panel.indexOf("await ", at);
    expect(panel.slice(next, next + 40), "the ask is not made just before the sign-up is sent").toContain("await signUp(");
  });

  it("the bot check is started between the two halves of the guard, in that order", () => {
    const start = readSource("src/instrumentation-client.ts");
    const order = ["makeGuardedFetch(", "window.fetch = send;", "initBotId(", "const checked = window.fetch;", "window.fetch = guard("].map((s) => start.indexOf(s));
    expect(order.every((at) => at >= 0), `a step is missing: ${order.join(", ")}`).toBe(true);
    expect([...order].sort((a, b) => a - b), "the steps are out of order").toEqual(order);
  });
});
