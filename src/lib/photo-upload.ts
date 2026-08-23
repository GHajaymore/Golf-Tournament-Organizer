/**
 * Getting a photograph off a phone and into an action, at a sensible size.
 *
 * Shared rather than copied because the number that matters — how far a photo
 * is scaled down before it is sent — is a trade between what the reader can
 * make out and what the upload costs an organizer standing on a course with
 * one bar of signal. Two copies would drift, and the one that got worse would
 * be whichever screen was looked at less.
 *
 * Browser only: it needs a canvas.
 */

/** Long edge, in pixels, after scaling. A 12-megapixel photo is far more than
 *  is needed to read two-digit numbers off a card. */
export const MAX_PHOTO_EDGE = 1600;

/**
 * Downscale an image file to a JPEG data URL.
 *
 * Never upscales — a photo already smaller than the limit is left alone rather
 * than blown up, which would cost bytes and add nothing to read.
 */
export async function shrinkPhoto(file: File, maxEdge = MAX_PHOTO_EDGE): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no canvas");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  return canvas.toDataURL("image/jpeg", 0.85);
}
