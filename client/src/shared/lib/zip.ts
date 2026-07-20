/**
 * Minimal in-browser ZIP writer — no dependency, store method only (no
 * compression). Good enough for exporting a generated project's source
 * files, which are already small text; correctness matters more than
 * ratio, and "store" keeps this file under 150 lines with no DEFLATE
 * implementation to get subtly wrong.
 *
 * Implements just enough of the ZIP spec (PKWARE APPNOTE) for any unzip
 * tool to open the result: local file headers, central directory, and the
 * end-of-central-directory record.
 */
export interface ZipEntry {
  path: string;
  content: string;
}

const CRC_TABLE = buildCrcTable();

function buildCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? (0xedb88320 ^ (c >>> 1)) >>> 0 : c >>> 1;
    }
    table[n] = c;
  }
  return table;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = ((CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

class ByteWriter {
  private readonly chunks: Uint8Array[] = [];
  private length = 0;

  push(bytes: Uint8Array): void {
    this.chunks.push(bytes);
    this.length += bytes.length;
  }

  get size(): number {
    return this.length;
  }

  u16(value: number): void {
    const buf = new Uint8Array(2);
    new DataView(buf.buffer).setUint16(0, value, true);
    this.push(buf);
  }

  u32(value: number): void {
    const buf = new Uint8Array(4);
    new DataView(buf.buffer).setUint32(0, value, true);
    this.push(buf);
  }

  build(): Uint8Array {
    const out = new Uint8Array(this.length);
    let offset = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }
}

interface PreparedEntry {
  nameBytes: Uint8Array;
  dataBytes: Uint8Array;
  crc: number;
  localHeaderOffset: number;
}

/** Build a ZIP archive from a flat file list and return it as a Blob. */
export function buildZip(entries: readonly ZipEntry[]): Blob {
  const encoder = new TextEncoder();
  const writer = new ByteWriter();
  const prepared: PreparedEntry[] = [];

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.path);
    const dataBytes = encoder.encode(entry.content);
    const crc = crc32(dataBytes);
    const localHeaderOffset = writer.size;

    writer.u32(0x04034b50); // local file header signature
    writer.u16(20); // version needed
    writer.u16(0); // flags
    writer.u16(0); // compression: store
    writer.u16(0); // mod time
    writer.u16(0); // mod date
    writer.u32(crc);
    writer.u32(dataBytes.length); // compressed size
    writer.u32(dataBytes.length); // uncompressed size
    writer.u16(nameBytes.length);
    writer.u16(0); // extra field length
    writer.push(nameBytes);
    writer.push(dataBytes);

    prepared.push({ nameBytes, dataBytes, crc, localHeaderOffset });
  }

  const centralDirStart = writer.size;

  for (const entry of prepared) {
    writer.u32(0x02014b50); // central directory header signature
    writer.u16(20); // version made by
    writer.u16(20); // version needed
    writer.u16(0); // flags
    writer.u16(0); // compression: store
    writer.u16(0); // mod time
    writer.u16(0); // mod date
    writer.u32(entry.crc);
    writer.u32(entry.dataBytes.length);
    writer.u32(entry.dataBytes.length);
    writer.u16(entry.nameBytes.length);
    writer.u16(0); // extra field length
    writer.u16(0); // comment length
    writer.u16(0); // disk number start
    writer.u16(0); // internal attributes
    writer.u32(0); // external attributes
    writer.u32(entry.localHeaderOffset);
    writer.push(entry.nameBytes);
  }

  const centralDirSize = writer.size - centralDirStart;

  writer.u32(0x06054b50); // end of central directory signature
  writer.u16(0); // disk number
  writer.u16(0); // disk with central directory
  writer.u16(prepared.length); // entries on this disk
  writer.u16(prepared.length); // total entries
  writer.u32(centralDirSize);
  writer.u32(centralDirStart);
  writer.u16(0); // comment length

  const bytes = writer.build();
  // Copy into a freshly-allocated ArrayBuffer: bytes.buffer types as
  // ArrayBufferLike (it could in principle back onto a SharedArrayBuffer),
  // which BlobPart rejects — `new ArrayBuffer(...)` is concrete.
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return new Blob([buffer], { type: 'application/zip' });
}

export function downloadZip(filename: string, entries: readonly ZipEntry[]): void {
  const blob = buildZip(entries);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
