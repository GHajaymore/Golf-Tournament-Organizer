/** `k6/http`, as much of it as the load scripts here use. See ../k6-lite.mjs. */
const rt = () => globalThis.__k6lite;
const body = (b) => (b == null ? null : typeof b === "string" ? b : JSON.stringify(b));

export default {
  get: (url, params) => rt().request("GET", url, null, params),
  post: (url, payload, params) => rt().request("POST", url, body(payload), params),
  put: (url, payload, params) => rt().request("PUT", url, body(payload), params),
  del: (url, payload, params) => rt().request("DELETE", url, body(payload), params),
};
