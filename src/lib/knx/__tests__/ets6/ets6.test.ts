import { describe, expect, it } from "@jest/globals";
import { deflateSync, inflateSync, unzipSync, zipSync } from "fflate";

import { extractNestedXml } from "@/lib/knx/ets6";

const ETS_SALT = "21.project.ets.knx.org";

async function pbkdf2(
  password: Uint8Array,
  salt: Uint8Array,
  iterations: number,
  length: number,
  hash: "SHA-1" | "SHA-256"
): Promise<Uint8Array> {
  const subtle = crypto.subtle;
  const pwKey = await subtle.importKey("raw", new Uint8Array(password), { name: "PBKDF2" }, false, ["deriveBits"]);
  const bits = await subtle.deriveBits(
    { name: "PBKDF2", hash, salt: new Uint8Array(salt), iterations },
    pwKey,
    length * 8
  );
  return new Uint8Array(bits);
}

async function deriveZipPassword(password: string): Promise<Uint8Array> {
  const pwBytes = new Uint8Array(password.length * 2);
  for (let i = 0; i < password.length; i++) {
    const c = password.charCodeAt(i);
    pwBytes[2 * i] = c & 0xff;
    pwBytes[2 * i + 1] = c >> 8;
  }
  const derived = await pbkdf2(pwBytes, new TextEncoder().encode(ETS_SALT), 65536, 32, "SHA-256");
  let bin = "";
  for (let i = 0; i < derived.length; i++) bin += String.fromCharCode(derived[i]);
  const b64 = btoa(bin);
  const out = new Uint8Array(b64.length);
  for (let i = 0; i < b64.length; i++) out[i] = b64.charCodeAt(i);
  return out;
}

function leCounter(n: number): Uint8Array {
  const c = new Uint8Array(16);
  let v = n;
  for (let i = 0; i < 16; i++) {
    c[i] = v & 0xff;
    v = Math.floor(v / 256);
  }
  return c;
}

function incrLE(counter: Uint8Array): void {
  for (let i = 0; i < counter.length; i++) {
    counter[i] = (counter[i] + 1) & 0xff;
    if (counter[i] !== 0) break;
  }
}

async function aesCtrEncrypt(enckey: Uint8Array, plaintext: Uint8Array): Promise<Uint8Array> {
  const keyObj = await crypto.subtle.importKey("raw", new Uint8Array(enckey), { name: "AES-CTR" }, false, ["encrypt"]);
  const counter = leCounter(1);
  const out = new Uint8Array(plaintext.length);
  const padded = new Uint8Array(16);
  for (let i = 0; i < plaintext.length; i += 16) {
    const n = Math.min(16, plaintext.length - i);
    padded.fill(0);
    padded.set(plaintext.subarray(i, i + n));
    const block = await crypto.subtle.encrypt({ name: "AES-CTR", counter: counter as unknown as BufferSource, length: 128 }, keyObj, padded as unknown as BufferSource);
    out.set(new Uint8Array(block).subarray(0, n), i);
    incrLE(counter);
  }
  return out;
}

async function hmacSha1(macKey: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const keyObj = await crypto.subtle.importKey("raw", new Uint8Array(macKey), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const sig = await crypto.subtle.sign({ name: "HMAC" }, keyObj, data as unknown as BufferSource);
  return new Uint8Array(sig);
}

function le16(v: number): Uint8Array {
  return new Uint8Array([v & 0xff, (v >> 8) & 0xff]);
}
function le32(v: number): Uint8Array {
  return new Uint8Array([v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff]);
}

/**
 * Build a WinZip-AES encrypted ZIP containing one XML file, so we can test
 * the decryption path end-to-end without external fixtures.
 */
async function buildEncryptedZip(name: string, xml: string, password: string): Promise<Uint8Array> {
  const xmlBytes = new TextEncoder().encode(xml);
  const deflated = deflateSync(xmlBytes); // raw DEFLATE, compression method 8

  const zipPwd = await deriveZipPassword(password);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await pbkdf2(zipPwd, salt, 1000, 66, "SHA-1");
  const enckey = keyMaterial.subarray(0, 32);
  const macKey = keyMaterial.subarray(32, 64);
  const pwdVerify = keyMaterial.subarray(64, 66);

  const ciphertext = await aesCtrEncrypt(enckey, deflated);
  const mac = await hmacSha1(macKey, ciphertext);
  const encryptedData = new Uint8Array(
    salt.length + pwdVerify.length + ciphertext.length + 10
  );
  encryptedData.set(salt, 0);
  encryptedData.set(pwdVerify, salt.length);
  encryptedData.set(ciphertext, salt.length + pwdVerify.length);
  encryptedData.set(mac.subarray(0, 10), salt.length + pwdVerify.length + ciphertext.length);

  const nameBytes = new TextEncoder().encode(name);
  const aesExtra = new Uint8Array([
    0x01, 0x99, // header id 0x9901 (little-endian)
    0x07, 0x00, // body size = 7
    0x01, 0x00, // version
    0x41, 0x45, // vendor "AE"
    0x03,       // strength 3 (AES-256)
    0x08, 0x00, // actual method = 8 (deflate)
  ]);

  // Local header layout: sig(4) ver(2) flags(2) method(2) time(2) date(2) crc(4) comp(4) uncomp(4) nameLen(2) extraLen(2) = 30
  const lh = new Uint8Array(30);
  lh[0] = 0x50; lh[1] = 0x4b; lh[2] = 0x03; lh[3] = 0x04;
  lh[4] = 0x14; lh[5] = 0x00;
  lh[6] = 0x00; lh[7] = 0x00;
  lh[8] = 0x63; lh[9] = 0x00;
  lh.set(le32(0), 18);
  lh.set(le32(encryptedData.length), 22);
  lh.set(le32(xmlBytes.length), 26);
  lh.set(le16(nameBytes.length), 26); // nameLen at offset 26
  lh.set(le16(aesExtra.length), 28); // extraLen at offset 28

  const local = concat(lh, nameBytes, aesExtra, encryptedData);

  // central directory entry
  const c = new Uint8Array(46);
  c[0] = 0x50; c[1] = 0x4b; c[2] = 0x01; c[3] = 0x02;
  c.set(le16(0x0014), 6); // version needed
  c.set(le16(0), 8); // flags
  c.set(le16(99), 10); // method
  c.set(le32(0), 16); // crc
  c.set(le32(encryptedData.length), 20);
  c.set(le32(xmlBytes.length), 24);
  c.set(le16(nameBytes.length), 28);
  c.set(le16(aesExtra.length), 30);
  c.set(le32(0), 42); // local offset
  const central = concat(c, nameBytes, aesExtra);

  // EOCD
  const eocd = new Uint8Array(22);
  eocd[0] = 0x50; eocd[1] = 0x4b; eocd[2] = 0x05; eocd[3] = 0x06;
  eocd.set(le16(1), 8); // total entries
  eocd.set(le16(1), 10);
  eocd.set(le32(central.length), 12); // cd size
  eocd.set(le32(local.length), 16); // cd offset

  return concat(local, central, eocd);
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const a of arrays) total += a.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) {
    out.set(a, off);
    off += a.length;
  }
  return out;
}

describe("extractNestedXml", () => {
  it("decrypts an ETS6-style WinZip AES archive with the correct password", async () => {
    const xml = `<?xml version="1.0"?>
<Project Name="Secret">
  <GroupAddress Id="ga-1" Name="Door" Address="1/0/5" />
</Project>`;
    const archive = await buildEncryptedZip("project.xml", xml, "1234");

    // without password -> rejected
    await expect(extractNestedXml(archive, undefined)).rejects.toThrow(/password/i);
    // wrong password -> rejected
    await expect(extractNestedXml(archive, "9999")).rejects.toThrow(/password/i);

    const result = await extractNestedXml(archive, "1234");
    expect(Object.keys(result)).toEqual(["project.xml"]);
    const text = new TextDecoder().decode(result["project.xml"]);
    expect(text).toContain('Name="Secret"');
    expect(text).toContain('Address="1/0/5"');
  });

  it("returns XML from an unencrypted (passwordless) nested archive", async () => {
    const xml = `<?xml version="1.0"?>
<Project Name="Open"><GroupAddress Id="a1" Address="1/1/1" /></Project>`;
    const inner = zipSync({ "project.xml": new TextEncoder().encode(xml) });
    const result = await extractNestedXml(inner, undefined);
    expect(Object.keys(result)).toEqual(["project.xml"]);
    expect(new TextDecoder().decode(result["project.xml"])).toContain('Name="Open"');
  });
});

describe("parseKnxproj passwordless P-*.zip integration", () => {
  it("finds entries when project XML lives inside a nested P-*.zip", async () => {
    const { parseKnxproj } = await import("@/lib/knx/parse");
    const xml = `<?xml version="1.0"?>
<Project Name="Nested">
  <GroupAddress Id="ga-1" Name="Lamp" Address="1/1/2" />
  <GroupAddress Id="ga-2" Name="Sensor" Address="1/1/3" />
</Project>`;

    // Outer knxproj: a P-*.zip entry that itself contains the XML.
    const inner = zipSync({ "project.xml": new TextEncoder().encode(xml) });
    const outer = zipSync({ "P-0F6A.zip": inner, "house.knxproj": new Uint8Array(0) });

    class MemoryFile implements File {
      readonly lastModified = Date.now();
      readonly type = "application/zip";
      readonly webkitRelativePath = "";
      constructor(readonly name: string, private buf: Uint8Array) {}
      get size() { return this.buf.byteLength; }
      arrayBuffer() { return Promise.resolve(this.buf.slice().buffer); }
      bytes() { return Promise.resolve(this.buf.slice() as Uint8Array<ArrayBuffer>); }
      stream(): ReadableStream<Uint8Array<ArrayBuffer>> {
        return new ReadableStream({ start: (c) => { c.enqueue(this.buf.slice() as Uint8Array<ArrayBuffer>); c.close(); } });
      }
      slice(start?: number, end?: number, contentType?: string): Blob {
        return new Blob([this.buf.slice(start, end)], { type: contentType ?? "application/zip" });
      }
      text() { return Promise.resolve(new TextDecoder().decode(this.buf)); }
    }

    const catalog = await parseKnxproj(new MemoryFile("house.knxproj.zip", outer));
    expect(catalog.meta.name).toBe("Nested"); // XML project name wins over outer filename
    expect(catalog.group_addresses).toHaveLength(2);
    const addresses = catalog.group_addresses.map((g) => g.address).sort();
    expect(addresses).toEqual(["1/1/2", "1/1/3"]);
  });
});


