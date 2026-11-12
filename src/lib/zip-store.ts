/** Minimal stored (uncompressed) ZIP writer — no dependency. Pure. */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

/** Build a valid ZIP (store method) from named byte entries. */
export function buildZip(entries: ZipEntry[]): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const u16 = (v: number) => new Uint8Array([v & 0xff, (v >>> 8) & 0xff]);
  const u32 = (v: number) => new Uint8Array([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]);
  const push = (u: Uint8Array) => { chunks.push(u); offset += u.length; };
  for (const e of entries) {
    const name = enc.encode(e.name.replace(/\\/g, "/"));
    const crc = crc32(e.data);
    const localOffset = offset;
    push(u32(0x04034b50)); push(u16(20)); push(u16(0)); push(u16(0)); push(u16(0)); push(u16(0));
    push(u32(crc)); push(u32(e.data.length)); push(u32(e.data.length)); push(u16(name.length)); push(u16(0));
    push(name); push(e.data);
    const c = [u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(e.data.length), u32(e.data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(localOffset), name];
    central.push(...c);
  }
  const centralStart = offset;
  for (const c of central) push(c);
  const centralSize = offset - centralStart;
  push(u32(0x06054b50)); push(u16(0)); push(u16(0)); push(u16(entries.length)); push(u16(entries.length));
  push(u32(centralSize)); push(u32(centralStart)); push(u16(0));
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of chunks) { out.set(c, p); p += c.length; }
  return out;
}
