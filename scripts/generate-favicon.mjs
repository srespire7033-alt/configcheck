// Generate favicon from the exact Lucide ShieldCheck SVG icon
// Blue rounded-rect background with white shield-check — matches the app's branding

import sharp from 'sharp';
import { writeFileSync } from 'fs';

// Exact Lucide ShieldCheck icon paths on a blue rounded-rect background
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="112" fill="#2563eb"/>
  <g transform="translate(128, 108) scale(10.67)">
    <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 .5-.87l7-4a1 1 0 0 1 1 0l7 4A1 1 0 0 1 20 6z"
          fill="none" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="m9 12 2 2 4-4"
          fill="none" stroke="white" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
</svg>`;

// Generate multiple sizes
const sizes = [
  { size: 32, name: 'favicon-32.png' },
  { size: 16, name: 'favicon-16.png' },
  { size: 180, name: 'apple-touch-icon.png' },
  { size: 192, name: 'icon-192.png' },
  { size: 512, name: 'icon-512.png' },
];

const svgBuffer = Buffer.from(svg);

for (const { size, name } of sizes) {
  const png = await sharp(svgBuffer)
    .resize(size, size)
    .png()
    .toBuffer();
  writeFileSync(`public/${name}`, png);
  console.log(`Generated public/${name} (${size}x${size})`);
}

// Generate favicon.ico (using 32x32 PNG wrapped in ICO format)
const png32 = await sharp(svgBuffer).resize(32, 32).png().toBuffer();

function createICO(pngData, width, height) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  const entry = Buffer.alloc(16);
  entry[0] = width >= 256 ? 0 : width;
  entry[1] = height >= 256 ? 0 : height;
  entry[2] = 0;
  entry[3] = 0;
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(pngData.length, 8);
  entry.writeUInt32LE(22, 12);
  return Buffer.concat([header, entry, pngData]);
}

const ico = createICO(png32, 32, 32);
writeFileSync('src/app/favicon.ico', ico);
console.log('Generated src/app/favicon.ico');

// Also save the main PNG for reference
writeFileSync('public/favicon.png', png32);
console.log('Generated public/favicon.png');

console.log('\nDone! All favicons generated from Lucide ShieldCheck SVG.');
