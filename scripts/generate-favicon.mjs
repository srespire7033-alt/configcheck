// Generate favicon assets from the OrgPrism brand mark.
// White rounded-rect background with the four-faced hollow hex prism logo.
// Run: node scripts/generate-favicon.mjs

import sharp from 'sharp';
import { writeFileSync } from 'fs';

// OrgPrism logo on a white rounded-rect background.
// We render the prism mark inside a 512×512 canvas with ~80px padding so the
// silhouette is generous at small sizes. Stroke gaps are pure white to merge
// with the rounded-rect background — clean at every size.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="112" fill="#ffffff"/>
  <g transform="translate(80, 80) scale(5.5)">
    <polygon points="32,4 8,18 20,25 32,18" fill="#A855F7" stroke="#ffffff" stroke-width="0.7" stroke-linejoin="round"/>
    <polygon points="32,4 32,18 44,25 56,18" fill="#F97316" stroke="#ffffff" stroke-width="0.7" stroke-linejoin="round"/>
    <polygon points="8,18 8,46 32,60 32,46 20,39 20,25" fill="#38BDF8" stroke="#ffffff" stroke-width="0.7" stroke-linejoin="round"/>
    <polygon points="56,18 44,25 44,39 32,46 32,60 56,46" fill="#1E40AF" stroke="#ffffff" stroke-width="0.7" stroke-linejoin="round"/>
  </g>
</svg>`;

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

// Also write the SVG sources so .svg consumers stay in sync.
writeFileSync('public/favicon.svg', svg);
writeFileSync('public/apple-touch-icon.svg', svg);
console.log('Generated public/favicon.svg + public/apple-touch-icon.svg');

// Generate favicon.ico (32x32 PNG wrapped in ICO format).
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

writeFileSync('public/favicon.png', png32);
console.log('Generated public/favicon.png');

console.log('\nDone! All favicons generated from OrgPrism brand mark.');
