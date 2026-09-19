import { describe, expect, it } from "@jest/globals";
import { zipSync } from "fflate";
import { readFileSync } from "fs";

import { parseKnxproj } from "@/lib/knx/parse";
import { buildHaEntities } from "@/lib/knx/export";

class MemoryFile implements File {
  readonly lastModified: number;
  readonly type: string;
  readonly webkitRelativePath = "";
  #buffer: ArrayBuffer;
  constructor(readonly name: string, data: Uint8Array, type = "application/zip") {
    const copy = new Uint8Array(data.byteLength);
    copy.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    this.#buffer = copy.buffer;
    this.lastModified = Date.now();
    this.type = type;
  }
  get size(): number { return this.#buffer.byteLength; }
  arrayBuffer(): Promise<ArrayBuffer> { return Promise.resolve(this.#buffer.slice(0)); }
  bytes(): Promise<Uint8Array<ArrayBuffer>> { return this.arrayBuffer().then((buf) => new Uint8Array(buf) as Uint8Array<ArrayBuffer>); }
  stream(): ReadableStream<Uint8Array<ArrayBuffer>> {
    return new ReadableStream<Uint8Array<ArrayBuffer>>({ start: (controller) => { controller.enqueue(new Uint8Array(this.#buffer) as Uint8Array<ArrayBuffer>); controller.close(); } });
  }
  slice(start?: number, end?: number, contentType?: string): Blob { return new Blob([this.#buffer], { type: this.type }).slice(start, end, contentType); }
  text(): Promise<string> { return this.bytes().then((buf) => new TextDecoder().decode(buf)); }
}

const FIXTURE = "src/lib/knx/__tests__/fixtures/0-lighting.xml";

function loadFixture(): Uint8Array {
  const xml = readFileSync(FIXTURE, "utf-8");
  return zipSync({ "0.xml": new TextEncoder().encode(xml) }, { level: 0 });
}

describe("ETS6 dimmer light aggregation (regression)", () => {
  it("maps a dimmer channel into a light with brightness instead of a switch", async () => {
    const file = new MemoryFile("fixture.knxproj.zip", loadFixture());
    const catalog = await parseKnxproj(file, {});
    const ent = buildHaEntities(catalog);

    // The on/off, dim, brightness and state GAs must be folded into light entities.
    expect(ent.lights).toHaveLength(4);

    const arbetsrum = ent.lights.find((l) => l.name === "Takbelysning arbetsrum");
    expect(arbetsrum).toBeDefined();
    expect(arbetsrum?.address).toBe("1/0/0");
    expect(arbetsrum?.state_address).toBe("1/3/0");
    expect(arbetsrum?.brightness_address).toBe("1/2/0");
    expect(arbetsrum?.brightness_state_address).toBe("1/4/0");

    // No standalone switches should be emitted for the light on/off (1/0/x) or
    // its on/off state (1/3/x), and no standalone percent sensors for 1/2/x / 1/4/x.
    const lightAddrs = new Set<string>(["1/0/0", "1/3/0", "1/2/0", "1/4/0"]);
    for (const s of ent.switches) {
      expect(lightAddrs.has(s.address)).toBe(false);
      expect(lightAddrs.has(s.state_address ?? "")).toBe(false);
    }
    for (const s of ent.sensors) {
      expect(lightAddrs.has(s.state_address)).toBe(false);
    }
  });
});
