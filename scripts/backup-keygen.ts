/**
 * MAKE THE BACKUP KEY PAIR — the owner runs this ONCE, on his own machine (B21).
 *
 *   npx tsx scripts/backup-keygen.ts --out "C:\Users\<you>\Documents\thq-backup-private.pem"
 *
 * It writes the PRIVATE key to the file named (which must be outside this
 * repository and must not exist yet) and prints the PUBLIC key, which is not a
 * secret: it goes into Vercel Production as BACKUP_PUBLIC_KEY.
 *
 * Then: put the private key's text in your password manager AND one offline
 * place (a USB stick in a drawer), and delete the file. Without the private key
 * no backup can ever be read — by anybody, you included. The private key never
 * goes to Vercel, GitHub, a chat or this folder.
 *
 * 4096-bit RSA. The key id printed names the pair: every backup records the id
 * it was sealed to, and the restore says when the key given is not that one.
 */
import { generateKeyPairSync, createPublicKey } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
import { keyIdOf } from "../src/lib/backup/sealed";

const i = process.argv.indexOf("--out");
const out = i === -1 ? undefined : process.argv[i + 1];
if (!out) {
  console.error('Usage: npx tsx scripts/backup-keygen.ts --out "<path outside this folder>\\thq-backup-private.pem"');
  process.exit(2);
}
const target = resolve(out);
const inside = relative(resolve(__dirname, ".."), target);
if (!inside.startsWith("..") && !isAbsolute(inside)) {
  console.error("Refused: the private key may not be written inside the repository. Choose a path outside it.");
  process.exit(2);
}
if (existsSync(target)) {
  console.error("Refused: that file already exists. A key pair is never overwritten; choose a new name.");
  process.exit(2);
}

const { publicKey, privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 4096,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});
writeFileSync(target, privateKey, { encoding: "utf8", mode: 0o600, flag: "wx" });

console.log(`Private key written to ${target}`);
console.log("  -> copy its text into your password manager and one offline place, then delete the file.\n");
console.log(`Key id: ${keyIdOf(createPublicKey(publicKey))}\n`);
console.log("PUBLIC key — paste ALL of it, including the BEGIN and END lines, into Vercel → Settings →");
console.log("Environment Variables → BACKUP_PUBLIC_KEY (Production only):\n");
console.log(publicKey);
