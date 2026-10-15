import { inflateSync, deflateSync } from 'zlib';
// jpeg-js ships as CommonJS. This compiles to require().
// eslint-disable-next-line @typescript-eslint/no-require-imports
import jpeg = require('../../vendor/jpeg-js/index.js');

export type InspectedImage = {
  width: number;
  height: number;
  mimeType: 'image/png' | 'image/jpeg';
};

export type ProcessedImage = InspectedImage & {
  thumbnail: Buffer;
  thumbWidth: number;
  thumbHeight: number;
  thumbMimeType: 'image/png';
};

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Inspect a PNG or JPEG buffer and build a real downscaled PNG thumbnail.
 * PNG is decoded with zlib. JPEG is decoded with jpeg-js (pure JS baseline/progressive).
 */
export function processCaptureImage(bytes: Buffer, maxEdge = 480): ProcessedImage {
  const inspected = inspectImage(bytes);
  const rgba =
    inspected.mimeType === 'image/png' ? decodePng(bytes) : decodeJpegRgba(bytes);

  const scale = Math.min(1, maxEdge / Math.max(rgba.width, rgba.height));
  const thumbWidth = Math.max(1, Math.round(rgba.width * scale));
  const thumbHeight = Math.max(1, Math.round(rgba.height * scale));
  const resized =
    scale < 1
      ? resizeRgba(rgba.pixels, rgba.width, rgba.height, thumbWidth, thumbHeight)
      : rgba.pixels;

  return {
    ...inspected,
    thumbnail: encodePng(resized, thumbWidth, thumbHeight),
    thumbWidth,
    thumbHeight,
    thumbMimeType: 'image/png',
  };
}

export function inspectImage(bytes: Buffer): InspectedImage {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    const ihdr = readPngIhdr(bytes);
    return { width: ihdr.width, height: ihdr.height, mimeType: 'image/png' };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    const size = readJpegSize(bytes);
    return { width: size.width, height: size.height, mimeType: 'image/jpeg' };
  }
  throw new Error('Unsupported image. Expected PNG or JPEG.');
}

type RgbaImage = { width: number; height: number; pixels: Uint8Array };

function decodeJpegRgba(bytes: Buffer): RgbaImage {
  const decoded = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 128 });
  return { width: decoded.width, height: decoded.height, pixels: decoded.data };
}

type PngHeader = { width: number; height: number; bitDepth: number; colorType: number; interlace: number };

function readPngIhdr(bytes: Buffer): PngHeader {
  if (bytes.length < 33 || bytes.toString('ascii', 12, 16) !== 'IHDR') {
    throw new Error('PNG missing IHDR');
  }
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    bitDepth: bytes[24] ?? 0,
    colorType: bytes[25] ?? 0,
    interlace: bytes[28] ?? 0,
  };
}

function decodePng(bytes: Buffer): RgbaImage {
  const header = readPngIhdr(bytes);
  if (header.bitDepth !== 8) throw new Error('Only 8-bit PNG is supported');
  if (header.interlace !== 0) throw new Error('Interlaced PNG is not supported');
  const channels = channelsFor(header.colorType);
  const idat = concatIdat(bytes);
  const inflated = inflateSync(idat);
  const raw = unfilter(inflated, header.width, header.height, channels);
  return {
    width: header.width,
    height: header.height,
    pixels: expandToRgba(raw, header.width, header.height, header.colorType),
  };
}

function channelsFor(colorType: number): number {
  if (colorType === 0) return 1;
  if (colorType === 2) return 3;
  if (colorType === 4) return 2;
  if (colorType === 6) return 4;
  throw new Error(`Unsupported PNG color type ${colorType}`);
}

function concatIdat(bytes: Buffer): Buffer {
  const parts: Buffer[] = [];
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const start = offset + 8;
    const end = start + length;
    if (end + 4 > bytes.length) throw new Error('Truncated PNG chunk');
    if (type === 'IDAT') parts.push(bytes.subarray(start, end));
    if (type === 'IEND') break;
    offset = end + 4;
  }
  if (!parts.length) throw new Error('PNG has no IDAT');
  return Buffer.concat(parts);
}

function unfilter(inflated: Buffer, width: number, height: number, bpp: number): Uint8Array {
  const stride = width * bpp;
  const expected = height * (stride + 1);
  if (inflated.length < expected) throw new Error('PNG pixel data is truncated');
  const out = new Uint8Array(height * stride);
  let offset = 0;
  for (let y = 0; y < height; y++) {
    const filter = inflated[offset] ?? 0;
    offset += 1;
    for (let x = 0; x < stride; x++) {
      const raw = inflated[offset] ?? 0;
      offset += 1;
      const left = x >= bpp ? out[y * stride + x - bpp]! : 0;
      const up = y > 0 ? out[(y - 1) * stride + x]! : 0;
      const upLeft = y > 0 && x >= bpp ? out[(y - 1) * stride + x - bpp]! : 0;
      let value = raw;
      if (filter === 1) value = (raw + left) & 255;
      else if (filter === 2) value = (raw + up) & 255;
      else if (filter === 3) value = (raw + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) value = (raw + paeth(left, up, upLeft)) & 255;
      else if (filter !== 0) throw new Error(`Unknown PNG filter ${filter}`);
      out[y * stride + x] = value;
    }
  }
  return out;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function expandToRgba(raw: Uint8Array, width: number, height: number, colorType: number): Uint8Array {
  const pixels = new Uint8Array(width * height * 4);
  const bpp = channelsFor(colorType);
  for (let i = 0; i < width * height; i++) {
    const s = i * bpp;
    const d = i * 4;
    if (colorType === 0) {
      const g = raw[s] ?? 0;
      pixels[d] = g;
      pixels[d + 1] = g;
      pixels[d + 2] = g;
      pixels[d + 3] = 255;
    } else if (colorType === 2) {
      pixels[d] = raw[s] ?? 0;
      pixels[d + 1] = raw[s + 1] ?? 0;
      pixels[d + 2] = raw[s + 2] ?? 0;
      pixels[d + 3] = 255;
    } else if (colorType === 4) {
      const g = raw[s] ?? 0;
      pixels[d] = g;
      pixels[d + 1] = g;
      pixels[d + 2] = g;
      pixels[d + 3] = raw[s + 1] ?? 255;
    } else {
      pixels[d] = raw[s] ?? 0;
      pixels[d + 1] = raw[s + 1] ?? 0;
      pixels[d + 2] = raw[s + 2] ?? 0;
      pixels[d + 3] = raw[s + 3] ?? 255;
    }
  }
  return pixels;
}

function resizeRgba(
  src: Uint8Array,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
): Uint8Array {
  const dst = new Uint8Array(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    const sy = ((y + 0.5) * sh) / dh - 0.5;
    const y0 = Math.max(0, Math.floor(sy));
    const y1 = Math.min(sh - 1, y0 + 1);
    const fy = Math.max(0, sy - y0);
    for (let x = 0; x < dw; x++) {
      const sx = ((x + 0.5) * sw) / dw - 0.5;
      const x0 = Math.max(0, Math.floor(sx));
      const x1 = Math.min(sw - 1, x0 + 1);
      const fx = Math.max(0, sx - x0);
      for (let c = 0; c < 4; c++) {
        const p00 = src[(y0 * sw + x0) * 4 + c] ?? 0;
        const p10 = src[(y0 * sw + x1) * 4 + c] ?? 0;
        const p01 = src[(y1 * sw + x0) * 4 + c] ?? 0;
        const p11 = src[(y1 * sw + x1) * 4 + c] ?? 0;
        const value =
          p00 * (1 - fx) * (1 - fy) +
          p10 * fx * (1 - fy) +
          p01 * (1 - fx) * fy +
          p11 * fx * fy;
        dst[(y * dw + x) * 4 + c] = Math.round(value);
      }
    }
  }
  return dst;
}

function encodePng(pixels: Uint8Array, width: number, height: number): Buffer {
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    const row = y * (stride + 1);
    raw[row] = 0;
    Buffer.from(pixels.buffer, pixels.byteOffset + y * stride, stride).copy(raw, row + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])) >>> 0, 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i] ?? 0;
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
  }
  return ~c >>> 0;
}

function readJpegSize(bytes: Buffer): { width: number; height: number } {
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1] ?? 0;
    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2;
      continue;
    }
    const length = bytes.readUInt16BE(offset + 2);
    const isSof =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isSof) {
      return {
        height: bytes.readUInt16BE(offset + 5),
        width: bytes.readUInt16BE(offset + 7),
      };
    }
    offset += 2 + length;
  }
  throw new Error('JPEG frame header not found');
}
