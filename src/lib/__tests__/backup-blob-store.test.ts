import { describe, it, expect } from "vitest";
import { vercelBlobStore, storeIdOf, BlobCallFailed } from "../backup/blob-store";

/**
 * THE FOUR BLOB CALLS, PINNED (B21). `blob-store.ts` speaks Blob's HTTP API as
 * `@vercel/blob` 2.8.0 does; these are the requests that package sends, so a
 * change here is a change to what production asks of the store. An invented
 * token: `vercel_blob_rw_<storeId>_<secret>`.
 */

const TOKEN = "vercel_blob_rw_zzStore123_zzNotARealSecret";

interface Seen {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function fakeFetch(answers: Array<{ status: number; json: unknown }>) {
  const seen: Seen[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    seen.push({ url, method: String(init.method), headers: init.headers as Record<string, string>, body: init.body });
    const a = answers.shift() ?? { status: 200, json: {} };
    return new Response(JSON.stringify(a.json), { status: a.status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { impl, seen };
}

const noPause = async () => {};

describe("the Blob calls", () => {
  it("read the store id from the token, and refuse a token that is not one", () => {
    expect(storeIdOf(TOKEN)).toBe("zzStore123");
    expect(() => vercelBlobStore("not-a-token")).toThrow(/BLOB_READ_WRITE_TOKEN/);
  });

  it("put: PRIVATE, the exact name, no overwrite unless asked, the token only in its header", async () => {
    const { impl, seen } = fakeFetch([{ status: 200, json: {} }, { status: 200, json: {} }]);
    const store = vercelBlobStore(TOKEN, impl, noPause);
    await store.put("backups/2026-11-14/020004-daily.thqbak", Buffer.from("sealed"), { contentType: "application/octet-stream", overwrite: false });
    await store.put("backups/latest.json", Buffer.from("{}"), { contentType: "application/json", overwrite: true });
    expect(seen[0].method).toBe("PUT");
    expect(seen[0].url).toBe("https://vercel.com/api/blob/?pathname=backups%2F2026-11-14%2F020004-daily.thqbak");
    expect(seen[0].headers).toMatchObject({
      authorization: `Bearer ${TOKEN}`,
      "x-api-version": "12",
      "x-vercel-blob-store-id": "zzStore123",
      "x-vercel-blob-access": "private",
      "x-add-random-suffix": "0",
      "x-allow-overwrite": "0",
      "x-content-type": "application/octet-stream",
    });
    expect(seen[1].headers["x-allow-overwrite"]).toBe("1");
    expect(seen[0].url).not.toContain("zzNotARealSecret");
  });

  it("head: the upload time, or null when there is no such file", async () => {
    const { impl, seen } = fakeFetch([
      { status: 200, json: { uploadedAt: "2026-11-14T02:00:09.000Z", size: 12 } },
      { status: 404, json: { error: { code: "not_found", message: "The requested blob does not exist" } } },
    ]);
    const store = vercelBlobStore(TOKEN, impl, noPause);
    expect(await store.head("backups/latest.json")).toEqual({ uploadedAt: new Date("2026-11-14T02:00:09.000Z"), size: 12 });
    expect(await store.head("backups/latest.json")).toBeNull();
    expect(seen[0]).toMatchObject({ method: "GET", url: "https://vercel.com/api/blob?url=backups%2Flatest.json" });
  });

  it("list: follows the cursor to the end", async () => {
    const blob = (n: number) => ({ pathname: `backups/x/${n}`, url: `https://s/${n}`, size: n, uploadedAt: "2026-11-14T02:00:00Z" });
    const { impl, seen } = fakeFetch([
      { status: 200, json: { blobs: [blob(1), blob(2)], cursor: "c1", hasMore: true } },
      { status: 200, json: { blobs: [blob(3)], hasMore: false } },
    ]);
    const files = await vercelBlobStore(TOKEN, impl, noPause).list("backups/");
    expect(files.map((f) => f.size)).toEqual([1, 2, 3]);
    expect(seen.map((s) => s.url)).toEqual([
      "https://vercel.com/api/blob?prefix=backups%2F&limit=1000",
      "https://vercel.com/api/blob?prefix=backups%2F&limit=1000&cursor=c1",
    ]);
  });

  it("delete: POSTs the addresses, a hundred at a time", async () => {
    const { impl, seen } = fakeFetch([]);
    const urls = Array.from({ length: 150 }, (_, i) => `https://s/${i}`);
    await vercelBlobStore(TOKEN, impl, noPause).del(urls);
    expect(seen.map((s) => [s.method, s.url])).toEqual([
      ["POST", "https://vercel.com/api/blob/delete"],
      ["POST", "https://vercel.com/api/blob/delete"],
    ]);
    expect(JSON.parse(String(seen[0].body)).urls).toHaveLength(100);
    expect(JSON.parse(String(seen[1].body)).urls).toHaveLength(50);
  });

  it("retries a server error twice, then fails naming the call and code — never the token", async () => {
    const { impl, seen } = fakeFetch([
      { status: 503, json: { error: { code: "service_unavailable" } } },
      { status: 500, json: { error: { code: "internal_server_error" } } },
      { status: 200, json: {} },
    ]);
    await vercelBlobStore(TOKEN, impl, noPause).put("backups/a", Buffer.from("x"), { contentType: "x", overwrite: false });
    expect(seen.map((s) => s.headers["x-api-blob-request-attempt"])).toEqual(["0", "1", "2"]);

    const failing = fakeFetch([
      { status: 500, json: {} },
      { status: 500, json: {} },
      { status: 500, json: {} },
    ]);
    const error = await vercelBlobStore(TOKEN, failing.impl, noPause)
      .put("backups/a", Buffer.from("x"), { contentType: "x", overwrite: false })
      .catch((e) => e);
    expect(error).toBeInstanceOf(BlobCallFailed);
    expect(String(error.message)).toBe("Vercel Blob put answered 500 (unknown_error).");
    expect(String(error.message)).not.toContain("zzNotARealSecret");
  });

  it("does not retry a refusal (a suspended or full store answers the same next time)", async () => {
    const { impl, seen } = fakeFetch([{ status: 403, json: { error: { code: "store_suspended" } } }]);
    const error = await vercelBlobStore(TOKEN, impl, noPause)
      .put("backups/a", Buffer.from("x"), { contentType: "x", overwrite: false })
      .catch((e) => e);
    expect(error.code).toBe("store_suspended");
    expect(seen).toHaveLength(1);
  });
});
