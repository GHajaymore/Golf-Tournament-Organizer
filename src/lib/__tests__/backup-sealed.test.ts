import { describe, it, expect, beforeAll } from "vitest";
import { generateKeyPairSync, randomBytes, type KeyObject } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Writable } from "node:stream";
import {
  BackupRefused,
  MAGIC,
  keyIdOf,
  openStream,
  readPrivateKey,
  readPublicKey,
  sealStream,
  sealedKeyId,
} from "../backup/sealed";

/**
 * THE BACKUP'S ENVELOPE (B21): what it opens, and everything it must refuse.
 *
 * A key pair is made here, at run time, and never written anywhere: nothing in
 * this file is a key (`no-secret-is-committed.test.ts`). Small segments, so a
 * few hundred bytes cross several and every boundary is exercised.
 */

let pub: KeyObject;
let priv: KeyObject;
let otherPriv: KeyObject;

beforeAll(() => {
  const a = generateKeyPairSync("rsa", { modulusLength: 2048 });
  pub = a.publicKey;
  priv = a.privateKey;
  otherPriv = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
});

async function through(stream: NodeJS.ReadWriteStream, input: Buffer, chunk = 37): Promise<Buffer> {
  const out: Buffer[] = [];
  const parts: Buffer[] = [];
  for (let i = 0; i < input.length; i += chunk) parts.push(input.subarray(i, i + chunk));
  await pipeline(
    Readable.from(parts),
    stream,
    new Writable({
      write(c: Buffer, _e, done) {
        out.push(c);
        done();
      },
    }),
  );
  return Buffer.concat(out);
}

const seal = (plain: Buffer, segment = 64) => through(sealStream(pub, segment), plain);
const open = (file: Buffer, key = priv, chunk = 37) => through(openStream(key), file, chunk);

async function refusal(file: Buffer, key = priv): Promise<string> {
  try {
    await open(file, key);
  } catch (e) {
    return e instanceof BackupRefused ? e.reason : `not a refusal: ${String(e)}`;
  }
  return "opened";
}

/** Byte offsets of each segment's record, read from the layout. */
function segmentOffsets(file: Buffer): number[] {
  let at = MAGIC.length + 4 + file.readUInt32BE(MAGIC.length);
  const out: number[] = [];
  while (at < file.length) {
    out.push(at);
    at += 5 + file.readUInt32BE(at + 1) + 16;
  }
  return out;
}

describe("the envelope opens what it sealed", () => {
  it.each([0, 1, 63, 64, 65, 640, 1000])("%i bytes, across segments of 64", async (n) => {
    const plain = randomBytes(n);
    const file = await seal(plain);
    expect(file.subarray(0, MAGIC.length).equals(MAGIC)).toBe(true);
    expect((await open(file)).equals(plain)).toBe(true);
    // And read a byte at a time, and all at once: the reader does not care how it is fed.
    expect((await open(file, priv, 1)).equals(plain)).toBe(true);
    expect((await open(file, priv, file.length)).equals(plain)).toBe(true);
  });

  it("holds no plaintext: a recognisable phrase is not in the file", async () => {
    const plain = Buffer.from("zz-restore-drill Invented Golfer ".repeat(20));
    const file = await seal(plain);
    expect(file.includes(Buffer.from("Invented Golfer"))).toBe(false);
  });

  it("names its key, the same from either half", async () => {
    const file = await seal(Buffer.from("x"));
    expect(sealedKeyId(file)).toBe(keyIdOf(pub));
    expect(keyIdOf(priv)).toBe(keyIdOf(pub));
    expect(keyIdOf(otherPriv)).not.toBe(keyIdOf(pub));
  });

  it("two seals of the same plaintext differ (a fresh data key and nonce each time)", async () => {
    const plain = Buffer.from("same");
    expect((await seal(plain)).equals(await seal(plain))).toBe(false);
  });
});

describe("the envelope refuses", () => {
  const plain = randomBytes(300);

  it("a flipped byte in any segment's ciphertext, tag or length", async () => {
    const file = await seal(plain);
    const offsets = segmentOffsets(file);
    expect(offsets.length).toBe(5); // 64 × 4 + a last segment of 44
    for (const at of offsets) {
      for (const delta of [5, 5 + 10, 5 + file.readUInt32BE(at + 1) + 3]) {
        const bad = Buffer.from(file);
        bad[at + delta] ^= 0x01;
        expect(await refusal(bad)).toBe("tampered");
      }
    }
  });

  it("a flipped byte in the header (the data key, the nonce, the key id)", async () => {
    const file = await seal(plain);
    const headerEnd = MAGIC.length + 4 + file.readUInt32BE(MAGIC.length);
    const text = file.subarray(MAGIC.length + 4, headerEnd).toString("utf8");
    const nonceAt = MAGIC.length + 4 + text.indexOf('"noncePrefix":"') + 15;
    const bad = Buffer.from(file);
    bad[nonceAt] = bad[nonceAt] === 0x41 ? 0x42 : 0x41;
    expect(await refusal(bad)).toBe("tampered");
  });

  it("a file cut short — at a segment boundary too", async () => {
    const file = await seal(plain);
    const offsets = segmentOffsets(file);
    expect(await refusal(file.subarray(0, offsets[offsets.length - 1]))).toBe("truncated");
    expect(await refusal(file.subarray(0, file.length - 1))).toBe("truncated");
    expect(await refusal(file.subarray(0, 20))).toBe("truncated");
  });

  it("anything after the last segment", async () => {
    const file = await seal(plain);
    expect(await refusal(Buffer.concat([file, Buffer.from([0])]))).toBe("trailing-data");
  });

  it("segments dropped or swapped", async () => {
    const file = await seal(plain);
    const [h, s0, s1] = segmentOffsets(file);
    const seg0 = file.subarray(s0, s1);
    const seg1 = file.subarray(s1, s1 + (s1 - s0));
    const header = file.subarray(0, h);
    const rest = file.subarray(s1 + (s1 - s0));
    expect(await refusal(Buffer.concat([header, seg1, seg0, rest]))).toBe("tampered");
    expect(await refusal(Buffer.concat([header, seg1, rest]))).toBe("tampered");
  });

  it("a segment marked last before the end", async () => {
    const file = await seal(plain);
    const [first] = segmentOffsets(file);
    const bad = Buffer.from(file);
    bad[first] = 1;
    expect(await refusal(bad)).toBe("tampered");
  });

  it("a segment from another backup sealed to the same key", async () => {
    const a = await seal(plain);
    const b = await seal(plain);
    const [aFirst, aSecond] = segmentOffsets(a);
    const [bFirst, bSecond] = segmentOffsets(b);
    const spliced = Buffer.concat([a.subarray(0, aFirst), b.subarray(bFirst, bSecond), a.subarray(aSecond)]);
    expect(await refusal(spliced)).toBe("tampered");
  });

  it("the wrong private key, before reading a byte of data", async () => {
    expect(await refusal(await seal(plain), otherPriv)).toBe("wrong-key");
  });

  it("the wrong key even when the file claims to be sealed to it", async () => {
    const file = await seal(plain);
    const text = file.toString("latin1").replace(keyIdOf(pub), keyIdOf(otherPriv));
    expect(await refusal(Buffer.from(text, "latin1"), otherPriv)).toBe("wrong-key");
  });

  it("something that is not a backup", async () => {
    expect(await refusal(Buffer.from("PK\u0003\u0004 a zip file, not a backup"))).toBe("not-a-backup");
  });
});

describe("the key as it arrives from an environment variable", () => {
  it("reads a PEM, a PEM with its newlines escaped, and a PEM in base64", () => {
    const pem = pub.export({ type: "spki", format: "pem" }).toString();
    for (const text of [pem, pem.split("\n").join("\\n"), Buffer.from(pem).toString("base64"), `  ${pem}  `]) {
      expect(keyIdOf(readPublicKey(text))).toBe(keyIdOf(pub));
    }
    const privatePem = priv.export({ type: "pkcs8", format: "pem" }).toString();
    expect(keyIdOf(readPrivateKey(privatePem))).toBe(keyIdOf(pub));
  });

  it("refuses a key that is not RSA, or too small", () => {
    const ec = generateKeyPairSync("ec", { namedCurve: "P-256" }).publicKey.export({ type: "spki", format: "pem" }).toString();
    expect(() => readPublicKey(ec)).toThrow(/RSA/);
    const small = generateKeyPairSync("rsa", { modulusLength: 1024 }).publicKey.export({ type: "spki", format: "pem" }).toString();
    expect(() => readPublicKey(small)).toThrow(/2048/);
  });
});
