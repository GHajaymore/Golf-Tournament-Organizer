/**
 * THE ADDRESS THIS PAGE WAS ASKED FOR ON, as an origin — for a printed QR.
 *
 * A sign's QR used to be drawn in the browser off `window.location.origin`, so
 * a sign printed from a preview build pointed at that preview and one printed
 * from production at production. The Print kit draws its QR on the server and
 * keeps the same answer by reading the request's own host (Vercel's proxy
 * passes it as `x-forwarded-host`), never `siteOrigin()`, which would send a
 * sign printed on a test server to the live site.
 */
export function requestOrigin(h: { get(name: string): string | null }): string {
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "localhost").split(",")[0].trim();
  const forwarded = (h.get("x-forwarded-proto") ?? "").split(",")[0].trim();
  const proto = forwarded === "https" || forwarded === "http" ? forwarded : /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host) ? "http" : "https";
  return `${proto}://${host}`;
}
