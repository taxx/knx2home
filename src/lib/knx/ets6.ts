/**
 * ETS6 password-protected project decryption.
 *
 * ETS6 encrypts the project XML files inside a nested P-*.zip archive with
 * WinZip AES (AE-2). Decryption follows the same path as the reference
 * `ffs.py` script:
 *
 *   1. zip password = base64(PBKDF2-SHA256(userPwd_utf16le,
 *                          salt="21.project.ets.knx.org", 65536 iter, 32 bytes))
 *   2. WinZip AES key material per file =
 *          PBKDF2-HMAC-SHA1(zipPwd, file_salt, 1000 iter, 66 bytes)
 *      - AES key   = keyMaterial[0:32]
 *      - HMAC key  = keyMaterial[32:64]
 *      - pwd check = keyMaterial[64:66]
 *   3. Encrypted file layout (inside the P-*.zip local header):
 *      [ salt(16) ] + [ pwd_verify(2) ] + [ AES-CTR ciphertext ] + [ HMAC(10) ]
 *   4. AES-256-CTR uses a 128-bit little-endian counter starting at 1.
 *   5. Decrypted payload is raw DEFLATE (no zlib header).
 *
 * The AES-256-CTR keystream is produced with the Web Crypto API
 * (`crypto.subtle`). WinZip's counter is little-endian while Web Crypto's
 * AES-CTR increments a big-endian counter, so each 16-byte block is decrypted
 * with an explicit little-endian counter block.
 */

import { unzipSync, inflateSync } from "fflate";

const ETS_SALT = "21.project.ets.knx.org";

/* ---------------- PBKDF2 (Web Crypto) ---------------- */

async function pbkdf2(
  password: Uint8Array,
  salt: Uint8Array,
  iterations: number,
  length: number,
  hash: "SHA-1" | "SHA-256"
): Promise<Uint8Array> {
  const subtle = crypto.subtle;
  const pwKey = await subtle.importKey(
    "raw",
    new Uint8Array(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );
  const bits = await subtle.deriveBits(
    { name: "PBKDF2", hash, salt: new Uint8Array(salt), iterations },
    pwKey,
    length * 8
  );
  return new Uint8Array(bits);
}

/** Derive the ETS6 AES-zip password from the user's project password. */
async function deriveZipPassword(password: string): Promise<Uint8Array> {
  const pwBytes = new Uint8Array(password.length * 2);
  for (let i = 0; i < password.length; i++) {
    const c = password.charCodeAt(i);
    pwBytes[2 * i] = c & 0xff;
    pwBytes[2 * i + 1] = c >> 8;
  }
  const derived = await pbkdf2(
    pwBytes,
    new TextEncoder().encode(ETS_SALT),
    65536,
    32,
    "SHA-256"
  );
  // base64-encode the 32 derived bytes -> this byte string is the AES-zip password
  let bin = "";
  for (let i = 0; i < derived.length; i++) bin += String.fromCharCode(derived[i]);
  const b64 = btoa(bin);
  const out = new Uint8Array(b64.length);
  for (let i = 0; i < b64.length; i++) out[i] = b64.charCodeAt(i);
  return out;
}

/* ---------------- AES-CTR (Web Crypto, per little-endian block) ---------------- */

function incrLittleEndian(counter: Uint8Array): void {
  for (let i = 0; i < counter.length; i++) {
    counter[i] = (counter[i] + 1) & 0xff;
    if (counter[i] !== 0) break; // carry ends when no overflow
  }
}

/**
 * Decrypt a WinZip-AES ciphertext with AES-256-CTR using a 128-bit
 * little-endian counter starting at `counterStart` (1 per WinZip AE-2).
 */
async function aesCtrDecrypt(
  enckey: Uint8Array,
  ciphertext: Uint8Array,
  counterStart: number
): Promise<Uint8Array> {
  const keyObj = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(enckey),
    { name: "AES-CTR" },
    false,
    ["decrypt"]
  );
  const counter = new Uint8Array(16);
  let v = counterStart;
  for (let i = 0; i < 16; i++) {
    counter[i] = v & 0xff;
    v = Math.floor(v / 256);
  }
  const plain = new Uint8Array(ciphertext.length);
  const padded = new Uint8Array(16);
  for (let i = 0; i < ciphertext.length; i += 16) {
    const n = Math.min(16, ciphertext.length - i);
    padded.fill(0);
    padded.set(ciphertext.subarray(i, i + n));
    const block = await crypto.subtle.decrypt(
      { name: "AES-CTR", counter, length: 128 },
      keyObj,
      padded
    );
    plain.set(new Uint8Array(block).subarray(0, n), i);
    incrLittleEndian(counter);
  }
  return plain;
}

/* ---------------- WinZip AES zip parsing ---------------- */

interface ZipEntry {
  name: string;
  compSize: number;
  localOffset: number;
  extra: Uint8Array;
}

interface AesExtra {
  saltLength: number;
  keyLength: number;
  method: number;
}

const AES_MAC_LENGTH = 10;

function findEndOfCentralDirectory(data: Uint8Array): number {
  for (let i = data.length - 22; i >= 0; i--) {
    if (
      data[i] === 0x50 &&
      data[i + 1] === 0x4b &&
      data[i + 2] === 0x05 &&
      data[i + 3] === 0x06
    ) {
      return i;
    }
  }
  return -1;
}

function parseCentralDirectory(data: Uint8Array, cdOff: number, cdSize: number): ZipEntry[] {
  const entries: ZipEntry[] = [];
  let off = cdOff;
  const end = cdOff + cdSize;
  while (off + 46 <= end) {
    if (
      data[off] !== 0x50 ||
      data[off + 1] !== 0x4b ||
      data[off + 2] !== 0x01 ||
      data[off + 3] !== 0x02
    ) {
      break;
    }
    const compSize =
      (data[off + 20] | (data[off + 21] << 8) | (data[off + 22] << 16) | (data[off + 23] << 24)) >>> 0;
    const nameLen = data[off + 28] | (data[off + 29] << 8);
    const extraLen = data[off + 30] | (data[off + 31] << 8);
    const commentLen = data[off + 32] | (data[off + 33] << 8);
    const relOff =
      (data[off + 42] | (data[off + 43] << 8) | (data[off + 44] << 16) | (data[off + 45] << 24)) >>> 0;
    const name = new TextDecoder("utf-8").decode(data.subarray(off + 46, off + 46 + nameLen));
    const extra = data.subarray(off + 46 + nameLen, off + 46 + nameLen + extraLen);
    entries.push({ name, compSize, localOffset: relOff, extra });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function findAesExtra(extra: Uint8Array): AesExtra | null {
  let off = 0;
  while (off + 4 <= extra.length) {
    const id = extra[off] | (extra[off + 1] << 8);
    const size = extra[off + 2] | (extra[off + 3] << 8);
    if (id === 0x9901) {
      // body: version(2) | vendor "AE"(2) | strength(1) | method(2)
      const strength = extra[off + 8];
      const method = extra[off + 9] | (extra[off + 10] << 8);
      const keyLength = strength === 3 ? 32 : strength === 2 ? 24 : 16;
      const saltLength = strength === 3 ? 16 : strength === 2 ? 12 : 8;
      return { saltLength, keyLength, method };
    }
    off += 4 + size;
  }
  return null;
}

/** Derive WinZip-AES key material and check the 2-byte password verification. */
async function tryKeyMaterial(
  zipPassword: Uint8Array,
  salt: Uint8Array,
  pwdVerify: Uint8Array,
  keyLength: number
): Promise<{ enckey: Uint8Array; macKey: Uint8Array } | null> {
  const keyMaterial = await pbkdf2(zipPassword, salt, 1000, keyLength * 2 + 2, "SHA-1");
  const check = keyMaterial.subarray(2 * keyLength);
  if (check[0] !== pwdVerify[0] || check[1] !== pwdVerify[1]) return null;
  return {
    enckey: keyMaterial.subarray(0, keyLength).slice(),
    macKey: keyMaterial.subarray(keyLength, 2 * keyLength).slice(),
  };
}

function decryptEntry(
  archive: Uint8Array,
  entry: ZipEntry,
  aes: AesExtra,
  password: string
): Promise<Uint8Array> {
  const dataStart =
    entry.localOffset +
    30 +
    (archive[entry.localOffset + 26] | (archive[entry.localOffset + 27] << 8)) +
    (archive[entry.localOffset + 28] | (archive[entry.localOffset + 29] << 8));
  const salt = archive.subarray(dataStart, dataStart + aes.saltLength);
  const pwdVerify = archive.subarray(
    dataStart + aes.saltLength,
    dataStart + aes.saltLength + 2
  );
  const cipherLen = entry.compSize - aes.saltLength - 2 - AES_MAC_LENGTH;
  const ciphertext = archive.subarray(
    dataStart + aes.saltLength + 2,
    dataStart + aes.saltLength + 2 + cipherLen
  );
  return decryptAes(ciphertext, salt, pwdVerify, aes.keyLength, password);
}

async function decryptAes(
  ciphertext: Uint8Array,
  salt: Uint8Array,
  pwdVerify: Uint8Array,
  keyLength: number,
  password: string
): Promise<Uint8Array> {
  // Candidate zip passwords, in the same order ffs.py tries them:
  // ETS6 encrypted password, then the raw password (ETS5), then no password.
  const candidates: Array<Uint8Array> = [];
  if (password) candidates.push(await deriveZipPassword(password));
  if (password) candidates.push(new TextEncoder().encode(password));
  candidates.push(new Uint8Array(0));

  for (const candidate of candidates) {
    const derived = await tryKeyMaterial(candidate, salt, pwdVerify, keyLength);
    if (derived) {
      return aesCtrDecrypt(derived.enckey, ciphertext, 1);
    }
  }
  if (password) {
    throw new Error("Wrong password: could not decrypt the protected project.");
  }
  throw new Error("This project is password-protected. Enter the password to continue.");
}

/**
 * Unpack a (possibly encrypted) P-*.zip archive into its XML files.
 *
 * Returns `{ name -> bytes }` for every `.xml` entry inside the archive.
 */
export async function extractNestedXml(
  archiveData: Uint8Array,
  password?: string
): Promise<Record<string, Uint8Array>> {
  const xml: Record<string, Uint8Array> = {};

  // Passwordless (or otherwise unencrypted) archive: just unpack it.
  try {
    const inner = unzipSync(archiveData);
    for (const [name, data] of Object.entries(inner)) {
      if (name.toLowerCase().endsWith(".xml")) xml[name] = data;
    }
    return xml;
  } catch {
    // fall through to the AES path below
  }

  const eocd = findEndOfCentralDirectory(archiveData);
  if (eocd < 0) throw new Error("Could not find the inner ZIP directory.");
  const cdSize =
    (archiveData[eocd + 12] |
      (archiveData[eocd + 13] << 8) |
      (archiveData[eocd + 14] << 16) |
      (archiveData[eocd + 15] << 24)) >>> 0;
  const cdOff =
    (archiveData[eocd + 16] |
      (archiveData[eocd + 17] << 8) |
      (archiveData[eocd + 18] << 16) |
      (archiveData[eocd + 19] << 24)) >>> 0;

  for (const entry of parseCentralDirectory(archiveData, cdOff, cdSize)) {
    if (!entry.name.toLowerCase().endsWith(".xml")) continue;
    const aes = findAesExtra(entry.extra);
    if (!aes) {
      // Unencrypted XML entry (unexpected for an encrypted archive, but handle it)
      const dataStart =
        entry.localOffset +
        30 +
        (archiveData[entry.localOffset + 26] |
          (archiveData[entry.localOffset + 27] << 8)) +
        (archiveData[entry.localOffset + 28] |
          (archiveData[entry.localOffset + 29] << 8));
      const compressed = archiveData.subarray(dataStart, dataStart + entry.compSize);
      xml[entry.name] = inflateSync(compressed);
      continue;
    }
    const decrypted = await decryptEntry(archiveData, entry, aes, password || "");
    xml[entry.name] = inflateSync(decrypted);
  }

  if (Object.keys(xml).length === 0) {
    throw new Error("No project XML found in the archive.");
  }
  return xml;
}
