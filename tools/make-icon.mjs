// Generates a 64x64 solid-color PNG placeholder (icon.png). Regeneratable; replace with real art later.
import { deflateSync, crc32 } from "node:zlib";
import { writeFileSync } from "node:fs";

const W = 64;
const H = 64;
const RGB = [0x12, 0x8a, 0x8a]; // teal placeholder

function chunk(type, data) {
  const t = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])) >>> 0, 0);
  return Buffer.concat([len, t, data, crc]);
}

const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 2; // color type: truecolor RGB
ihdr[10] = 0; // compression
ihdr[11] = 0; // filter method
ihdr[12] = 0; // interlace

const row = Buffer.alloc(1 + W * 3);
row[0] = 0; // filter type: none
for (let x = 0; x < W; x++) {
  row[1 + x * 3] = RGB[0];
  row[2 + x * 3] = RGB[1];
  row[3 + x * 3] = RGB[2];
}
const raw = Buffer.concat(Array.from({ length: H }, () => row));
const idat = deflateSync(raw);

const png = Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
writeFileSync(new URL("../icon.png", import.meta.url), png);
console.log(`icon.png written: ${png.length} bytes (${W}x${H})`);
