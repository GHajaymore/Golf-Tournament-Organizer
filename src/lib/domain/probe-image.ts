import { deflateSync } from "node:zlib";

/**
 * A PICTURE OF NOTHING, for proving the card reader's model can see.
 *
 * The owner's "Check AI" sends each AI job one tiny real request. The card
 * reading job reads photographs, so its check has to send one — and it must
 * never be a real card or a real person (CLAUDE.md hard rule 2). So it is drawn
 * here, in code: a plain square of one colour, a PNG built byte by byte.
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), Buffer.from(data)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** A `size`×`size` PNG of one RGB colour, as base64. */
export function solidSquarePng(size: number, rgb: [number, number, number]): string {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const row = Buffer.alloc(1 + size * 3); // filter byte 0, then pixels
  for (let x = 0; x < size; x++) row.set(rgb, 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array(0)),
  ]);
  return png.toString("base64");
}

/** The check's picture: a red square, so the model can be asked its colour. */
export const PROBE_IMAGE = { media: "image/png" as const, size: 32, rgb: [220, 30, 30] as [number, number, number] };
