/**
 * Validating an uploaded reference image, before anything else sees it.
 *
 * An image arriving here is untrusted input in three different ways, and each
 * one is checked rather than assumed:
 *
 * 1. It claims a type. The claim is ignored — the bytes are read, and a file
 *    whose magic number does not match a format we accept is refused. A
 *    `.png` that is really something else never reaches the provider.
 * 2. It has a size. A base64 payload inflates by a third, the request body
 *    cap and the provider's own 20 MB limit are both real, and a model
 *    charges about two thousand tokens for an image regardless. So the limit
 *    is enforced on the decoded bytes, where it means something.
 * 3. It has dimensions, read out of the format's own header. A 2-pixel image
 *    and a 20,000-pixel one are both answerable by a vision model and neither
 *    tells us anything about a design.
 *
 * The headers are parsed by hand because the alternative is a dependency for
 * three number reads. PNG, JPEG and WebP are the formats the request named,
 * and each one's size lives at a well-defined offset.
 *
 * Nothing here interprets the image's *content*. An image that says "ignore
 * your instructions" in large friendly letters is still just an image: the
 * reading prompt treats it as a thing to describe, never as an instruction.
 */

export type ImageKind = 'reference' | 'mockup' | 'asset';

export const IMAGE_KINDS: readonly ImageKind[] = ['reference', 'mockup', 'asset'];

export interface AcceptedImage {
  /** The `data:` URL to hand the provider, rebuilt from the verified bytes. */
  dataUrl: string;
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp';
  kind: ImageKind;
  name: string;
  bytes: number;
  width: number;
  height: number;
}

export class ImageRejected extends Error {}

/** Decoded, not encoded: the base64 is a third larger and nobody means that. */
const MAX_BYTES = 4 * 1024 * 1024;
const MIN_EDGE = 64;
const MAX_EDGE = 8_000;

const DATA_URL = /^data:(image\/[a-z+]+);base64,([A-Za-z0-9+/=\s]+)$/;

function sniff(bytes: Buffer): AcceptedImage['mediaType'] | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

/** PNG keeps width and height as big-endian 32-bit values in its IHDR chunk. */
function pngSize(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 24 || bytes.subarray(12, 16).toString('ascii') !== 'IHDR') return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/**
 * JPEG is a chain of segments; the frame header that carries the size is one
 * of the SOF markers, and everything before it has to be walked past.
 */
function jpegSize(bytes: Buffer): { width: number; height: number } | null {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    if (marker === undefined) return null;
    // SOF0..SOF15, excluding the four markers in that range that are not frames.
    const isFrame = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isFrame) {
      return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
    }
    const length = bytes.readUInt16BE(offset + 2);
    if (length < 2) return null;
    offset += 2 + length;
  }
  return null;
}

/** WebP has three container flavours and each states its size differently. */
function webpSize(bytes: Buffer): { width: number; height: number } | null {
  const format = bytes.subarray(12, 16).toString('ascii');
  if (format === 'VP8X' && bytes.length >= 30) {
    return {
      width: 1 + bytes.readUIntLE(24, 3),
      height: 1 + bytes.readUIntLE(27, 3),
    };
  }
  if (format === 'VP8L' && bytes.length >= 25) {
    const bits = bytes.readUInt32LE(21);
    return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
  }
  if (format === 'VP8 ' && bytes.length >= 30) {
    return {
      width: bytes.readUInt16LE(26) & 0x3fff,
      height: bytes.readUInt16LE(28) & 0x3fff,
    };
  }
  return null;
}

function sizeOf(mediaType: AcceptedImage['mediaType'], bytes: Buffer) {
  if (mediaType === 'image/png') return pngSize(bytes);
  if (mediaType === 'image/jpeg') return jpegSize(bytes);
  return webpSize(bytes);
}

export interface RawImage {
  dataUrl: string;
  kind: string;
  name?: string;
}

/**
 * Accept an image, or explain precisely why not.
 *
 * Every refusal names the real reason and the real limit, because "invalid
 * image" tells a user nothing about what to do next.
 */
export function acceptImage(raw: RawImage): AcceptedImage {
  const kind = IMAGE_KINDS.find((candidate) => candidate === raw.kind);
  if (!kind) {
    throw new ImageRejected(
      `Say what the image is: one of ${IMAGE_KINDS.join(', ')}. A reference is read for style, an asset is meant to appear in the app.`,
    );
  }

  const match = DATA_URL.exec(raw.dataUrl.trim());
  if (!match) {
    throw new ImageRejected('The image must be sent as a base64 `data:image/...` URL.');
  }

  const declared = match[1] ?? '';
  const payload = (match[2] ?? '').replace(/\s+/g, '');
  const bytes = Buffer.from(payload, 'base64');
  if (bytes.length === 0) throw new ImageRejected('The image data is empty.');
  if (bytes.length > MAX_BYTES) {
    throw new ImageRejected(
      `The image is ${(bytes.length / 1024 / 1024).toFixed(1)} MB; the limit is ${String(MAX_BYTES / 1024 / 1024)} MB. Export it smaller or screenshot a region.`,
    );
  }

  const mediaType = sniff(bytes);
  if (!mediaType) {
    throw new ImageRejected(
      `That file is not a PNG, JPEG or WebP image${declared === '' ? '' : ` (it was sent as ${declared})`}. Those three are what the vision model accepts.`,
    );
  }

  const size = sizeOf(mediaType, bytes);
  if (!size) {
    throw new ImageRejected(
      `The ${mediaType} header is damaged, so the image cannot be read. Try re-exporting it.`,
    );
  }
  const { width, height } = size;
  if (width < MIN_EDGE || height < MIN_EDGE) {
    throw new ImageRejected(
      `The image is ${String(width)}×${String(height)}; anything under ${String(MIN_EDGE)} pixels on a side shows no design worth reading.`,
    );
  }
  if (width > MAX_EDGE || height > MAX_EDGE) {
    throw new ImageRejected(
      `The image is ${String(width)}×${String(height)}; the limit is ${String(MAX_EDGE)} pixels on a side.`,
    );
  }

  return {
    // Rebuilt from the verified bytes with the sniffed type, so the provider
    // never sees the caller's claim about what this file is.
    dataUrl: `data:${mediaType};base64,${bytes.toString('base64')}`,
    mediaType,
    kind,
    name: (raw.name ?? 'reference').slice(0, 80),
    bytes: bytes.length,
    width,
    height,
  };
}
