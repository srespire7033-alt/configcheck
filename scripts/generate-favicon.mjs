// Generate a 32x32 PNG favicon with blue background and white checkmark
// Uses raw PNG encoding - no external dependencies needed

import { writeFileSync } from 'fs';
import { deflateSync } from 'zlib';

const W = 32, H = 32;

// Create RGBA pixel data
const pixels = Buffer.alloc(W * H * 4);

// Background color: #2563eb (blue)
const bgR = 0x25, bgG = 0x63, bgB = 0xeb;

// Fill with blue, with rounded corners
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const idx = (y * W + x) * 4;
    const r = 7; // corner radius

    // Check rounded corners
    let inside = true;
    // Top-left
    if (x < r && y < r && ((x - r) ** 2 + (y - r) ** 2) > r * r) inside = false;
    // Top-right
    if (x >= W - r && y < r && ((x - (W - r - 1)) ** 2 + (y - r) ** 2) > r * r) inside = false;
    // Bottom-left
    if (x < r && y >= H - r && ((x - r) ** 2 + (y - (H - r - 1)) ** 2) > r * r) inside = false;
    // Bottom-right
    if (x >= W - r && y >= H - r && ((x - (W - r - 1)) ** 2 + (y - (H - r - 1)) ** 2) > r * r) inside = false;

    if (inside) {
      pixels[idx] = bgR;
      pixels[idx + 1] = bgG;
      pixels[idx + 2] = bgB;
      pixels[idx + 3] = 255;
    } else {
      pixels[idx + 3] = 0; // transparent
    }
  }
}

// Draw white checkmark using thick line (Bresenham-style)
function drawThickLine(x0, y0, x1, y1, thickness, r, g, b) {
  const dx = x1 - x0, dy = y1 - y0;
  const steps = Math.max(Math.abs(dx), Math.abs(dy)) * 2;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const cx = x0 + dx * t;
    const cy = y0 + dy * t;
    for (let py = Math.floor(cy - thickness); py <= Math.ceil(cy + thickness); py++) {
      for (let px = Math.floor(cx - thickness); px <= Math.ceil(cx + thickness); px++) {
        if (px >= 0 && px < W && py >= 0 && py < H) {
          const dist = Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
          if (dist <= thickness) {
            const idx = (py * W + px) * 4;
            if (pixels[idx + 3] > 0) { // only draw on non-transparent
              pixels[idx] = r;
              pixels[idx + 1] = g;
              pixels[idx + 2] = b;
              pixels[idx + 3] = 255;
            }
          }
        }
      }
    }
  }
}

// Checkmark: short arm from (8,16) to (13,21), long arm from (13,21) to (24,10)
drawThickLine(8, 17, 13, 22, 1.8, 255, 255, 255);
drawThickLine(13, 22, 24, 10, 1.8, 255, 255, 255);

// Encode as PNG
function createPNG(width, height, rgbaData) {
  // Add filter byte (0 = None) to each row
  const rawData = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    rawData[y * (1 + width * 4)] = 0; // filter: None
    rgbaData.copy(rawData, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4);
  }

  const compressed = deflateSync(rawData);

  // PNG signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  function crc32(buf) {
    let c = 0xffffffff;
    const table = [];
    for (let n = 0; n < 256; n++) {
      let val = n;
      for (let k = 0; k < 8; k++) val = (val & 1) ? (0xedb88320 ^ (val >>> 1)) : (val >>> 1);
      table[n] = val;
    }
    for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const typeData = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typeData));
    return Buffer.concat([len, typeData, crc]);
  }

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const png = createPNG(W, H, pixels);

// Write as favicon.ico (ICO format wrapping PNG)
function createICO(pngData, width, height) {
  // ICO header: 6 bytes
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);    // reserved
  header.writeUInt16LE(1, 2);    // type: ICO
  header.writeUInt16LE(1, 4);    // count: 1

  // ICO directory entry: 16 bytes
  const entry = Buffer.alloc(16);
  entry[0] = width >= 256 ? 0 : width;
  entry[1] = height >= 256 ? 0 : height;
  entry[2] = 0;   // palette
  entry[3] = 0;   // reserved
  entry.writeUInt16LE(1, 4);     // color planes
  entry.writeUInt16LE(32, 6);    // bits per pixel
  entry.writeUInt32LE(pngData.length, 8);  // size
  entry.writeUInt32LE(22, 12);   // offset (6 + 16 = 22)

  return Buffer.concat([header, entry, pngData]);
}

const ico = createICO(png, W, H);

writeFileSync('src/app/favicon.ico', ico);
writeFileSync('public/favicon.png', png);

console.log('Generated src/app/favicon.ico and public/favicon.png');
