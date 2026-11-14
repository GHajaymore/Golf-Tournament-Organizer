import {
  constants,
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  privateDecrypt,
  publicEncrypt,
  randomBytes,
  type KeyObject,
} from "node:crypto";
import { Transform, type TransformCallback } from "node:stream";

/**
 * THE BACKUP'S ENVELOPE: sealed to a public key, opened only with the private
 * half, which never touches Vercel, GitHub or this repository (B21).
 *
 * Every backup gets a fresh 256-bit data key. The data key is wrapped with
 * RSA-OAEP (SHA-256) under `BACKUP_PUBLIC_KEY`; the data is cut into segments
 * of at most `SEGMENT_BYTES`, and each segment is sealed with AES-256-GCM under
 * its own nonce. So:
 *
 *   - a stolen Blob token yields ciphertext only, and so does a stolen
 *     Vercel environment: the public key cannot open anything;
 *   - a flipped byte anywhere is refused at the segment that holds it, BEFORE
 *     a byte of that segment's plaintext is handed on (GCM authenticates per
 *     segment, so a restore never loads a forged row and checks afterwards);
 *   - segments cannot be dropped, reordered or swapped between backups: each
 *     one's additional data is the hash of this backup's header, its index and
 *     whether it is the last;
 *   - a file cut short is refused, because the last segment says it is the
 *     last, and a file that runs on past it is refused too.
 *
 * The layout, every integer big-endian:
 *
 *   "THQBAK1\n"                      8 bytes
 *   header length                    u32
 *   header                           JSON: v, alg, keyId, wrappedKey, noncePrefix, segmentBytes
 *   then, for each segment:
 *     last?                          u8 (1 on the final segment, else 0)
 *     ciphertext length              u32 (= plaintext length, at most segmentBytes)
 *     ciphertext                     …
 *     GCM tag                        16 bytes
 *
 * Nonce = 8 random bytes (the header's `noncePrefix`) + the segment index (u32):
 * never repeated under one data key, and the data key is never reused.
 */

export const MAGIC = Buffer.from("THQBAK1\n", "ascii");
/** Plaintext per segment. A refused segment costs at most this much re-reading, and holds at most this much in memory. */
export const SEGMENT_BYTES = 1 << 20;
const TAG_BYTES = 16;
const ALG = "RSA-OAEP-SHA256/AES-256-GCM";
/** The smallest RSA key accepted. The keygen script makes 4096-bit keys; tests use 2048 for speed. */
const MIN_RSA_BITS = 2048;

export interface SealedHeader {
  v: 1;
  alg: typeof ALG;
  /** Which key pair: the first 16 hex characters of SHA-256 over the public key (SPKI, DER). Not a secret. */
  keyId: string;
  wrappedKey: string;
  noncePrefix: string;
  segmentBytes: number;
}

export type RefusalReason = "not-a-backup" | "wrong-key" | "tampered" | "truncated" | "trailing-data";

/** Why a file was not opened. The message never holds key material or plaintext. */
export class BackupRefused extends Error {
  constructor(
    readonly reason: RefusalReason,
    message: string,
  ) {
    super(message);
    this.name = "BackupRefused";
  }
}

function rsaOnly(key: KeyObject, what: string): KeyObject {
  const bits = key.asymmetricKeyDetails?.modulusLength ?? 0;
  if (key.asymmetricKeyType !== "rsa" || bits < MIN_RSA_BITS) {
    throw new Error(`The ${what} must be an RSA key of at least ${MIN_RSA_BITS} bits.`);
  }
  return key;
}

/**
 * Text as it may arrive from an environment variable or a password manager: a
 * PEM block, the same with its newlines written as `\n`, or the PEM block
 * base64-encoded on one line. Vercel keeps multi-line values, but a paste
 * through a one-line field must not decide whether backups run.
 */
function pemFrom(text: string): string {
  let t = text.trim();
  if (t.includes("\\n")) t = t.split("\\n").join("\n");
  if (!t.includes("-----BEGIN")) {
    const decoded = Buffer.from(t, "base64").toString("utf8");
    if (decoded.includes("-----BEGIN")) t = decoded.trim();
  }
  return t;
}

export function readPublicKey(text: string): KeyObject {
  return rsaOnly(createPublicKey(pemFrom(text)), "backup public key");
}

export function readPrivateKey(text: string): KeyObject {
  return rsaOnly(createPrivateKey(pemFrom(text)), "backup private key");
}

/** The key pair's name, the same from either half. */
export function keyIdOf(key: KeyObject): string {
  const pub = key.type === "private" ? createPublicKey(key) : key;
  return createHash("sha256").update(pub.export({ type: "spki", format: "der" })).digest("hex").slice(0, 16);
}

function u32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
}

function nonceFor(prefix: Buffer, index: number): Buffer {
  return Buffer.concat([prefix, u32(index)]);
}

function aadFor(headerHash: Buffer, index: number, last: boolean): Buffer {
  return Buffer.concat([headerHash, u32(index), Buffer.from([last ? 1 : 0])]);
}

/** Seals whatever is written into it. The output is a complete `.thqbak` once the input ends. */
export function sealStream(publicKey: KeyObject, segmentBytes = SEGMENT_BYTES): Transform {
  rsaOnly(publicKey, "backup public key");
  const dataKey = randomBytes(32);
  const noncePrefix = randomBytes(8);
  const wrappedKey = publicEncrypt(
    { key: publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
    dataKey,
  );
  const header: SealedHeader = {
    v: 1,
    alg: ALG,
    keyId: keyIdOf(publicKey),
    wrappedKey: wrappedKey.toString("base64"),
    noncePrefix: noncePrefix.toString("base64"),
    segmentBytes,
  };
  const headerBytes = Buffer.from(JSON.stringify(header), "utf8");
  const preamble = Buffer.concat([MAGIC, u32(headerBytes.length), headerBytes]);
  const headerHash = createHash("sha256").update(preamble).digest();

  let pending: Buffer[] = [];
  let pendingBytes = 0;
  let index = 0;
  let started = false;

  const segment = (plain: Buffer, last: boolean): Buffer => {
    if (index > 0xffffffff) throw new Error("A backup this large is past the envelope's segment count.");
    const cipher = createCipheriv("aes-256-gcm", dataKey, nonceFor(noncePrefix, index), { authTagLength: TAG_BYTES });
    cipher.setAAD(aadFor(headerHash, index, last));
    const body = Buffer.concat([cipher.update(plain), cipher.final()]);
    index += 1;
    return Buffer.concat([Buffer.from([last ? 1 : 0]), u32(body.length), body, cipher.getAuthTag()]);
  };

  return new Transform({
    transform(chunk: Buffer, _encoding, done: TransformCallback) {
      try {
        if (!started) {
          this.push(preamble);
          started = true;
        }
        pending.push(chunk);
        pendingBytes += chunk.length;
        if (pendingBytes >= segmentBytes) {
          let all = Buffer.concat(pending);
          while (all.length >= segmentBytes) {
            this.push(segment(all.subarray(0, segmentBytes), false));
            all = all.subarray(segmentBytes);
          }
          pending = all.length ? [Buffer.from(all)] : [];
          pendingBytes = all.length;
        }
        done();
      } catch (error) {
        done(error as Error);
      }
    },
    flush(done: TransformCallback) {
      try {
        if (!started) this.push(preamble);
        this.push(segment(Buffer.concat(pending), true));
        dataKey.fill(0);
        done();
      } catch (error) {
        done(error as Error);
      }
    },
  });
}

/** Reads the header without opening anything: which key the file was sealed to. */
export function sealedKeyId(file: Buffer): string {
  return parsePreamble(file)?.header.keyId ?? "";
}

function parsePreamble(buf: Buffer): { header: SealedHeader; length: number } | null {
  if (buf.length < MAGIC.length + 4) return null;
  if (!buf.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new BackupRefused("not-a-backup", "This is not a TourneyHQ backup (.thqbak).");
  }
  const headerLength = buf.readUInt32BE(MAGIC.length);
  if (headerLength > 64 * 1024) throw new BackupRefused("not-a-backup", "The backup's header is not readable.");
  const end = MAGIC.length + 4 + headerLength;
  if (buf.length < end) return null;
  let header: SealedHeader;
  try {
    header = JSON.parse(buf.subarray(MAGIC.length + 4, end).toString("utf8")) as SealedHeader;
  } catch {
    throw new BackupRefused("not-a-backup", "The backup's header is not readable.");
  }
  if (
    header?.v !== 1 ||
    header.alg !== ALG ||
    typeof header.keyId !== "string" ||
    typeof header.wrappedKey !== "string" ||
    typeof header.noncePrefix !== "string" ||
    !Number.isInteger(header.segmentBytes) ||
    header.segmentBytes < 1 ||
    header.segmentBytes > 64 * SEGMENT_BYTES
  ) {
    throw new BackupRefused("not-a-backup", "The backup's header is not one this version reads.");
  }
  return { header, length: end };
}

/**
 * Opens a sealed stream. Plaintext leaves it one AUTHENTICATED segment at a
 * time; the stream errors with `BackupRefused` the moment anything is wrong.
 */
export function openStream(privateKey: KeyObject): Transform {
  rsaOnly(privateKey, "backup private key");
  const ourKeyId = keyIdOf(privateKey);
  let buf: Buffer = Buffer.alloc(0);
  let dataKey: Buffer | null = null;
  let noncePrefix: Buffer = Buffer.alloc(0);
  let headerHash: Buffer = Buffer.alloc(0);
  let segmentBytes = 0;
  let index = 0;
  let finished = false;

  const step = (push: (b: Buffer) => void): void => {
    if (!dataKey) {
      const pre = parsePreamble(buf);
      if (!pre) return;
      if (pre.header.keyId !== ourKeyId) {
        throw new BackupRefused(
          "wrong-key",
          `This backup was sealed to key ${pre.header.keyId}; the key given is ${ourKeyId}.`,
        );
      }
      try {
        dataKey = privateDecrypt(
          { key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
          Buffer.from(pre.header.wrappedKey, "base64"),
        );
      } catch {
        throw new BackupRefused("wrong-key", "The key given does not open this backup.");
      }
      if (dataKey.length !== 32) throw new BackupRefused("tampered", "The backup's data key is not whole.");
      noncePrefix = Buffer.from(pre.header.noncePrefix, "base64");
      if (noncePrefix.length !== 8) throw new BackupRefused("tampered", "The backup's header is not whole.");
      headerHash = createHash("sha256").update(buf.subarray(0, pre.length)).digest();
      segmentBytes = pre.header.segmentBytes;
      buf = buf.subarray(pre.length);
    }
    while (buf.length > 0) {
      if (finished) throw new BackupRefused("trailing-data", "The backup runs on past its last segment.");
      if (buf.length < 5) return;
      const lastByte = buf[0];
      if (lastByte !== 0 && lastByte !== 1) throw new BackupRefused("tampered", `Segment ${index} is not whole.`);
      const length = buf.readUInt32BE(1);
      if (length > segmentBytes) throw new BackupRefused("tampered", `Segment ${index} is longer than a segment may be.`);
      const total = 5 + length + TAG_BYTES;
      if (buf.length < total) return;
      const last = lastByte === 1;
      const decipher = createDecipheriv("aes-256-gcm", dataKey, nonceFor(noncePrefix, index), {
        authTagLength: TAG_BYTES,
      });
      decipher.setAAD(aadFor(headerHash, index, last));
      decipher.setAuthTag(buf.subarray(5 + length, total));
      let plain: Buffer;
      try {
        plain = Buffer.concat([decipher.update(buf.subarray(5, 5 + length)), decipher.final()]);
      } catch {
        throw new BackupRefused("tampered", `Segment ${index} failed its check: the file was changed or damaged.`);
      }
      if (plain.length) push(plain);
      index += 1;
      buf = buf.subarray(total);
      if (last) finished = true;
    }
  };

  return new Transform({
    transform(chunk: Buffer, _encoding, done: TransformCallback) {
      try {
        buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
        step((b) => this.push(b));
        done();
      } catch (error) {
        done(error as Error);
      }
    },
    flush(done: TransformCallback) {
      try {
        if (!dataKey) throw new BackupRefused("truncated", "The backup ends before its header does.");
        if (!finished || buf.length) {
          throw new BackupRefused("truncated", "The backup ends before its last segment: it was cut short.");
        }
        (dataKey as Buffer).fill(0);
        done();
      } catch (error) {
        done(error as Error);
      }
    },
  });
}
