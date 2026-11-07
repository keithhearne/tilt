// Draws the app icons as PNGs with no dependencies. Run: node tools/make-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
const crc32 = (buf) => { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };

function png(size, pixel) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  const SS = 4; // supersampling per axis
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const acc = [0, 0, 0, 0];
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const c = pixel((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size);
        for (let i = 0; i < 4; i++) acc[i] += c[i];
      }
      const o = y * (size * 4 + 1) + 1 + x * 4;
      for (let i = 0; i < 4; i++) raw[o + i] = Math.round(acc[i] / (SS * SS));
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * Math.max(0, Math.min(1, t)));
const BG = [20, 23, 27, 255];

// u, v in 0..1. pad shrinks the plate for maskable icons.
function scene(pad) {
  const plateR = 0.5 - pad;
  const holes = [[0.5, 0.33], [0.66, 0.6], [0.34, 0.6]];
  const balls = [[0.66, 0.6, 0.075], [0.27, 0.27, 0.075]];
  return (u, v) => {
    const dx = u - 0.5, dy = v - 0.5, r = Math.hypot(dx, dy);
    let c = BG;
    if (r < plateR) c = mix([225, 229, 234, 255], [70, 76, 84, 255], (dx + dy) / (2 * plateR) + 0.5);
    if (r < plateR * 0.92) c = mix([206, 211, 217, 255], [128, 135, 144, 255], r / plateR + (dx + dy) * 0.6);
    for (const [hx, hy] of holes) {
      const d = Math.hypot(u - hx, v - hy);
      if (d < 0.09 * (plateR / 0.46)) c = mix([30, 34, 40, 255], [70, 76, 84, 255], d / 0.09);
    }
    for (const [bx, by, br0] of balls) {
      const br = br0 * (plateR / 0.46);
      const sd = Math.hypot(u - bx - br * 0.3, v - by - br * 0.35);
      if (sd < br && r < plateR) c = mix([0, 0, 0, 255], c, 0.55 + 0.45 * (sd / br));
      const d = Math.hypot(u - bx, v - by);
      if (d < br) {
        const hl = Math.hypot(u - (bx - br * 0.38), v - (by - br * 0.42)) / (br * 1.4);
        c = hl < 0.15 ? mix([255, 255, 255, 255], [232, 236, 240, 255], hl / 0.15) : mix([232, 236, 240, 255], [42, 47, 53, 255], (hl - 0.15) / 0.85);
      }
    }
    return c;
  };
}

mkdirSync(new URL('../icons/', import.meta.url), { recursive: true });
const out = (name, size, pad) => writeFileSync(new URL(`../icons/${name}`, import.meta.url), png(size, scene(pad)));
out('icon-192.png', 192, 0.04);
out('icon-512.png', 512, 0.04);
out('apple-touch-icon.png', 180, 0.07);
out('icon-maskable-512.png', 512, 0.14);
console.log('icons written');
