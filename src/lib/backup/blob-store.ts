/**
 * THE FOUR CALLS THE BACKUP MAKES OF VERCEL BLOB: put, head, list, delete.
 *
 * Written against Blob's HTTP API rather than through the `@vercel/blob`
 * package, deliberately and for now: adding a dependency means changing
 * `package.json` and the lockfile, which other open pull requests hold, and
 * installing it into the `node_modules` every worktree on this machine shares.
 * These four requests are copied from `@vercel/blob` 2.8.0 (`dist/chunk-*.js`:
 * `requestApi`, `createPutHeaders`, `head`, `list`, `del`; API version 12), and
 * `backup-blob-store.test.ts` pins each one's method, address and headers. The
 * day the package can be added, this file is what it replaces.
 *
 * Every file is PRIVATE (`x-vercel-blob-access: private`): its address answers
 * nobody without the store's token. Names are exact (no random suffix) and a
 * backup is never overwritten; only `latest.json` is.
 *
 * Errors carry the call, the status and Blob's error code — never the token,
 * which travels only in the Authorization header, and never a body.
 */

const API = "https://vercel.com/api/blob";
const API_VERSION = "12";

export interface BlobFile {
  pathname: string;
  url: string;
  size: number;
  uploadedAt: Date;
}

export interface BlobStore {
  put(pathname: string, body: Buffer, options: { contentType: string; overwrite: boolean }): Promise<void>;
  /** null when there is no such file. */
  head(pathname: string): Promise<{ uploadedAt: Date; size: number } | null>;
  list(prefix: string): Promise<BlobFile[]>;
  del(urls: string[]): Promise<void>;
}

export class BlobCallFailed extends Error {
  constructor(
    readonly call: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(`Vercel Blob ${call} answered ${status} (${code}).`);
    this.name = "BlobCallFailed";
  }
}

/** A read-write token is `vercel_blob_rw_<storeId>_<secret>`. */
export function storeIdOf(token: string): string {
  return token.split("_")[3] ?? "";
}

type Fetch = typeof fetch;

export function vercelBlobStore(token: string, fetchImpl: Fetch = fetch, pause = (ms: number) => new Promise((r) => setTimeout(r, ms))): BlobStore {
  const storeId = storeIdOf(token);
  if (!token || !storeId) throw new Error("BLOB_READ_WRITE_TOKEN is not a Vercel Blob read-write token.");

  async function call(name: string, path: string, init: RequestInit, allowNotFound = false): Promise<Response | null> {
    let attempt = 0;
    for (;;) {
      let res: Response | null = null;
      try {
        res = await fetchImpl(`${API}${path}`, {
          ...init,
          headers: {
            authorization: `Bearer ${token}`,
            "x-api-version": API_VERSION,
            "x-vercel-blob-store-id": storeId,
            "x-api-blob-request-attempt": String(attempt),
            ...(init.headers as Record<string, string> | undefined),
          },
        });
      } catch {
        res = null; // a network failure: retried like a 5xx
      }
      if (res?.ok) return res;
      let code = "network_error";
      if (res) {
        try {
          code = ((await res.json()) as { error?: { code?: string } })?.error?.code ?? "unknown_error";
        } catch {
          code = "unknown_error";
        }
        if (allowNotFound && (res.status === 404 || code === "not_found")) return null;
      }
      const retryable = !res || res.status >= 500 || code === "unknown_error" || code === "service_unavailable";
      if (!retryable || attempt >= 2) throw new BlobCallFailed(name, res?.status ?? 0, code);
      attempt += 1;
      await pause(500 * attempt);
    }
  }

  return {
    async put(pathname, body, { contentType, overwrite }) {
      await call("put", `/?${new URLSearchParams({ pathname })}`, {
        method: "PUT",
        body: new Uint8Array(body),
        headers: {
          "x-vercel-blob-access": "private",
          "x-content-type": contentType,
          "x-add-random-suffix": "0",
          "x-allow-overwrite": overwrite ? "1" : "0",
        },
      });
    },

    async head(pathname) {
      const res = await call("head", `?${new URLSearchParams({ url: pathname })}`, { method: "GET" }, true);
      if (!res) return null;
      const json = (await res.json()) as { uploadedAt: string; size: number };
      return { uploadedAt: new Date(json.uploadedAt), size: json.size };
    },

    async list(prefix) {
      const out: BlobFile[] = [];
      let cursor = "";
      for (let page = 0; page < 50; page++) {
        const params = new URLSearchParams({ prefix, limit: "1000" });
        if (cursor) params.set("cursor", cursor);
        const res = (await call("list", `?${params}`, { method: "GET" }))!;
        const json = (await res.json()) as {
          blobs: { pathname: string; url: string; size: number; uploadedAt: string }[];
          cursor?: string;
          hasMore?: boolean;
        };
        for (const b of json.blobs) out.push({ pathname: b.pathname, url: b.url, size: b.size, uploadedAt: new Date(b.uploadedAt) });
        if (!json.hasMore || !json.cursor) break;
        cursor = json.cursor;
      }
      return out;
    },

    async del(urls) {
      for (let i = 0; i < urls.length; i += 100) {
        await call("delete", "/delete", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ urls: urls.slice(i, i + 100) }),
        });
      }
    },
  };
}
