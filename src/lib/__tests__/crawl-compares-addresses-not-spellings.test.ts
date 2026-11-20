import { describe, it, expect } from "vitest";
import { EventEmitter } from "node:events";
import { readSource } from "./source";
import { addressKey, arrivedAt, elsewhere, sameAddress, watchNavigations } from "../../../e2e/navigation-settle";

/**
 * THE CRAWL COMPARES ADDRESSES, NOT SPELLINGS (backlog B85, from the reviews of #1185).
 *
 * Matching a press's navigation to its target by exact string raised a false STUCK when the screen had
 * arrived by a redirect, by a reordered query or at a trailing slash. It never hid a SILENT. The guarantee:
 * the same address in another spelling is the same address; a different page is still a different page;
 * and a press that sent nothing is still silent.
 */
describe("sameAddress", () => {
  it("ignores the order of query parameters", () => {
    expect(sameAddress("/print?round=2&signs=group", "/print?signs=group&round=2")).toBe(true);
  });
  it("ignores a trailing slash, the host, the fragment and Next's _rsc", () => {
    expect(sameAddress("/rounds/", "/rounds")).toBe(true);
    expect(sameAddress("http://127.0.0.1:3101/rounds?a=1", "/rounds?a=1")).toBe(true);
    expect(sameAddress("/rounds?a=1#top", "/rounds?a=1")).toBe(true);
    expect(sameAddress("/rounds?a=1&_rsc=xyz", "/rounds?a=1")).toBe(true);
    expect(sameAddress("/", "http://x")).toBe(true);
  });
  it("control: a genuinely different page is a different address", () => {
    expect(sameAddress("/print", "/prints")).toBe(false);
    expect(sameAddress("/rounds", "/rounds/2")).toBe(false);
    expect(sameAddress("/print?round=2", "/print?round=3")).toBe(false);
    expect(sameAddress("/print?round=2", "/print")).toBe(false);
    expect(sameAddress("/print?round=2&x=1", "/print?round=2")).toBe(false);
    expect(sameAddress("/print?a=1&a=2", "/print?a=1")).toBe(false);
    expect(sameAddress("/Print", "/print")).toBe(false);
  });
  it("keeps an encoded value apart from its neighbour", () => {
    expect(sameAddress("/p?q=a%26b", "/p?q=a&b")).toBe(false);
    expect(addressKey("/p?b=2&a=1")).toBe("/p?a=1&b=2");
  });
});

describe("arrivedAt and elsewhere", () => {
  it("arrived when the final address matches any target, in any spelling", () => {
    expect(arrivedAt("http://x/print/?signs=group&round=2", ["/print?round=2&signs=group"])).toBe(true);
  });
  it("a redirect counts as arriving: the redirected request is a target too, and the page ends on it", () => {
    const e = new EventEmitter();
    const w = watchNavigations({ on: (n, f) => e.on(n, f), off: (n, f) => e.off(n, f) });
    const h = { rsc: "1" };
    e.emit("request", { url: () => "http://x/old?_rsc=a", headers: () => h });
    e.emit("request", { url: () => "http://x/new/?z=1&y=2&_rsc=a", headers: () => h });
    const targets = elsewhere("/start", w.seen());
    expect(arrivedAt("http://x/new?y=2&z=1", targets)).toBe(true);
  });
  it("control: ending on some other page is not arriving", () => {
    expect(arrivedAt("/somewhere-else", ["/print?round=2"])).toBe(false);
    expect(arrivedAt("/start", [])).toBe(false);
  });
  it("a request to the address we are on (a refresh) is not somewhere else, however spelt", () => {
    expect(elsewhere("/rounds?a=1&b=2", ["/rounds/?b=2&a=1", "/print"])).toEqual(["/print"]);
  });
});

describe("the crawl still catches a SILENT, and uses the comparator", () => {
  const spec = readSource("e2e/every-control.spec.ts");
  it("a press that sent nothing is not a navigation", async () => {
    const e = new EventEmitter();
    const w = watchNavigations({ on: (n, f) => e.on(n, f), off: (n, f) => e.off(n, f) });
    e.emit("request", { url: () => "http://x/api/ping", headers: () => ({}) });
    expect(w.seen()).toEqual([]);
    expect(elsewhere("/rounds", w.seen())).toEqual([]);
    expect(spec).toMatch(/outcome: "silent", note: ""/);
  });
  it("no exact-address comparison of a page's address with a start or target is left in the judge", () => {
    expect(spec).toMatch(/arrivedAt\(u\.href, targets\)/);
    expect(spec).toMatch(/elsewhere\(startUrl, navigations\.seen\(\)\)/);
    expect(spec).not.toMatch(/page\.url\(\) (===|!==) startUrl/);
    expect(spec).not.toMatch(/u\.href !== startUrl/);
    expect(spec).not.toMatch(/targets\.includes\(/);
  });
});
