// Generate a 32x32 PNG favicon — white shield-check on blue rounded-rect
// Matches the ShieldCheck icon used in the ConfigCheck landing page

import { writeFileSync } from 'fs';
import { deflateSync } from 'zlib';

const W = 32, H = 32;
const pixels = Buffer.alloc(W * H * 4);

const bgR = 0x25, bgG = 0x63, bgB = 0xeb; // #2563eb

// --- Helpers ---
function setPixel(x, y, r, g, b, a = 255) {
  x = Math.round(x); y = Math.round(y);
  if (x >= 0 && x < W && y >= 0 && y < H) {
    const idx = (y * W + x) * 4;
    pixels[idx] = r; pixels[idx+1] = g; pixels[idx+2] = b; pixels[idx+3] = a;
  }
}

function getAlpha(x, y) {
  x = Math.round(x); y = Math.round(y);
  if (x >= 0 && x < W && y >= 0 && y < H) return pixels[(y * W + x) * 4 + 3];
  return 0;
}

function drawThickLine(x0, y0, x1, y1, thickness, r, g, b) {
  const dx = x1 - x0, dy = y1 - y0;
  const steps = Math.max(Math.abs(dx), Math.abs(dy)) * 3;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const cx = x0 + dx * t, cy = y0 + dy * t;
    for (let py = Math.floor(cy - thickness - 1); py <= Math.ceil(cy + thickness + 1); py++) {
      for (let px = Math.floor(cx - thickness - 1); px <= Math.ceil(cx + thickness + 1); px++) {
        if (px >= 0 && px < W && py >= 0 && py < H) {
          const dist = Math.sqrt((px - cx) ** 2 + (py - cy) ** 2);
          if (dist <= thickness) {
            setPixel(px, py, r, g, b);
          }
        }
      }
    }
  }
}

// --- Fill blue rounded rect background ---
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const r = 7;
    let inside = true;
    if (x < r && y < r && ((x - r) ** 2 + (y - r) ** 2) > r * r) inside = false;
    if (x >= W - r && y < r && ((x - (W - r - 1)) ** 2 + (y - r) ** 2) > r * r) inside = false;
    if (x < r && y >= H - r && ((x - r) ** 2 + (y - (H - r - 1)) ** 2) > r * r) inside = false;
    if (x >= W - r && y >= H - r && ((x - (W - r - 1)) ** 2 + (y - (H - r - 1)) ** 2) > r * r) inside = false;
    if (inside) setPixel(x, y, bgR, bgG, bgB);
  }
}

// --- Draw shield outline ---
// Shield shape: pointed at bottom center, curved top edges
// Using bezier-like point sampling for the shield path
const shieldPoints = [];
const cx = 16, topY = 4, bottomY = 28, midY = 18;
const halfW = 10; // half-width of shield at widest

// Left side: top-left corner down to bottom point
// Top edge curves
for (let t = 0; t <= 1; t += 0.01) {
  // Top-left to top curve
  const x = cx - halfW + halfW * t;
  const y = topY + (t < 0.15 ? (1 - t/0.15) * 2 : 0); // slight curve up at edges
  shieldPoints.push([x, y]);
}

// Right side top
for (let t = 0; t <= 1; t += 0.01) {
  const x = cx + halfW * t;
  const y = topY + (t > 0.85 ? (1 - (1-t)/0.15) * 2 : 0);
  shieldPoints.push([x, y]);
}

// Now draw the actual shield using parametric path
// Shield path points (Lucide ShieldCheck style):
// Top center, curves out to sides, straight down to ~60%, then tapers to bottom point
function shieldOutlineX(t) {
  // t goes from 0 (top-center) clockwise
  // 0-0.25: top-center to right side
  // 0.25-0.5: right side down
  // 0.5: bottom point
  // 0.5-0.75: left side up
  // 0.75-1.0: left top back to center

  if (t <= 0.25) {
    // Top center to right
    const s = t / 0.25;
    return cx + halfW * Math.sin(s * Math.PI / 2);
  } else if (t <= 0.5) {
    // Right side down to bottom point
    const s = (t - 0.25) / 0.25;
    return cx + halfW * (1 - s * s); // curve inward
  } else if (t <= 0.75) {
    // Bottom point to left side up
    const s = (t - 0.5) / 0.25;
    return cx - halfW * (1 - (1-s) * (1-s));
  } else {
    // Left top back to center
    const s = (t - 0.75) / 0.25;
    return cx - halfW * Math.sin((1-s) * Math.PI / 2);
  }
}

function shieldOutlineY(t) {
  if (t <= 0.25) {
    const s = t / 0.25;
    return topY + s * (midY - topY) * 0.3; // slight downward at top
  } else if (t <= 0.5) {
    const s = (t - 0.25) / 0.25;
    return topY + (midY - topY) * 0.3 + s * (bottomY - topY - (midY - topY) * 0.3);
  } else if (t <= 0.75) {
    const s = (t - 0.5) / 0.25;
    return bottomY - s * (bottomY - topY - (midY - topY) * 0.3);
  } else {
    const s = (t - 0.75) / 0.25;
    return topY + (1-s) * (midY - topY) * 0.3;
  }
}

// Draw shield outline with thick white lines
const prevPoints = [];
for (let t = 0; t <= 1; t += 0.005) {
  prevPoints.push([shieldOutlineX(t), shieldOutlineY(t)]);
}
for (let i = 0; i < prevPoints.length - 1; i++) {
  drawThickLine(prevPoints[i][0], prevPoints[i][1], prevPoints[i+1][0], prevPoints[i+1][1], 1.3, 255, 255, 255);
}

// --- Draw checkmark inside shield ---
// Small check inside: scaled to fit within shield
drawThickLine(11, 16, 14.5, 19.5, 1.3, 255, 255, 255);
drawThickLine(14.5, 19.5, 21, 12, 1.3, 255, 255, 255);

// --- PNG encoding ---
function createPNG(width, height, rgbaData) {
  const rawData = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    rawData[y * (1 + width * 4)] = 0;
    rgbaData.copy(rawData, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const compressed = deflateSync(rawData);
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

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', compressed), chunk('IEND', Buffer.alloc(0))]);
}

const png = createPNG(W, H, pixels);

function createICO(pngData, width, height) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  const entry = Buffer.alloc(16);
  entry[0] = width >= 256 ? 0 : width;
  entry[1] = height >= 256 ? 0 : height;
  entry[2] = 0; entry[3] = 0;
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(pngData.length, 8);
  entry.writeUInt32LE(22, 12);
  return Buffer.concat([header, entry, pngData]);
}

const ico = createICO(png, W, H);

writeFileSync('src/app/favicon.ico', ico);
writeFileSync('public/favicon.png', png);
console.log('Generated src/app/favicon.ico and public/favicon.png');
