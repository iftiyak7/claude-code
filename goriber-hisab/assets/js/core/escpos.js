/**
 * Minimal ESC/POS encoder for 58mm (32 cols) and 80mm (48 cols) printers.
 * Produces a Uint8Array to send over any transport.
 *
 * Non-ASCII text (e.g. Bangla) can't be printed in the printer's built-in
 * fonts; such lines are rendered to a bitmap with <canvas> and sent as a
 * raster image (GS v 0), so every script prints correctly.
 */
const ESC = 0x1b;
const GS = 0x1d;

export class EscPos {
  constructor(width = 80) {
    this.cols = width === 58 ? 32 : 48;
    this.dots = width === 58 ? 384 : 576;
    this.bytes = [];
    this.raw(ESC, 0x40); // init
  }

  raw(...b) { this.bytes.push(...b); return this; }

  text(str) {
    if (/^[\x20-\x7e\n]*$/.test(str)) {
      for (const ch of str) this.bytes.push(ch.charCodeAt(0));
      return this;
    }
    return this.image(textBitmap(str, this.dots, this.boldOn));
  }

  line(str = '') { return this.text(str).raw(0x0a); }
  align(a) { return this.raw(ESC, 0x61, { left: 0, center: 1, right: 2 }[a] ?? 0); }
  bold(on = true) { this.boldOn = on; return this.raw(ESC, 0x45, on ? 1 : 0); }
  size(w = 1, hgt = 1) { return this.raw(GS, 0x21, ((w - 1) << 4) | (hgt - 1)); }
  rule(ch = '-') { return this.line(ch.repeat(this.cols)); }
  feed(n = 3) { return this.raw(ESC, 0x64, n); }
  cut() { return this.raw(GS, 0x56, 0x42, 0x00); }
  drawer() { return this.raw(ESC, 0x70, 0x00, 0x19, 0xfa); }

  /** Two columns: left text, right text, padded to the paper width. */
  pair(left, right) {
    left = String(left); right = String(right);
    const ascii = /^[\x20-\x7e]*$/.test(left + right);
    if (!ascii) return this.line(`${left}  ${right}`);
    const space = this.cols - right.length;
    if (left.length > space - 1) {
      this.line(left.slice(0, this.cols));
      return this.line(right.padStart(this.cols));
    }
    return this.line(left.padEnd(space) + right);
  }

  /** Code128 barcode (printer-native). */
  barcode(data) {
    const d = String(data).replace(/[^\x20-\x7e]/g, '').slice(0, 40);
    if (!d) return this;
    this.raw(GS, 0x68, 60, GS, 0x77, 2, GS, 0x48, 2); // height, width, HRI below
    return this.raw(GS, 0x6b, 73, d.length + 2, 0x7b, 0x42, ...[...d].map((c) => c.charCodeAt(0))).raw(0x0a);
  }

  /** Raster image from {width, height, data: Uint8Array of 0/1 per pixel}. */
  image(bmp) {
    const bytesPerRow = Math.ceil(bmp.width / 8);
    this.raw(GS, 0x76, 0x30, 0x00, bytesPerRow & 0xff, bytesPerRow >> 8, bmp.height & 0xff, bmp.height >> 8);
    for (let y = 0; y < bmp.height; y++) {
      for (let xb = 0; xb < bytesPerRow; xb++) {
        let byte = 0;
        for (let bit = 0; bit < 8; bit++) {
          const x = xb * 8 + bit;
          if (x < bmp.width && bmp.data[y * bmp.width + x]) byte |= 0x80 >> bit;
        }
        this.bytes.push(byte);
      }
    }
    return this.raw(0x0a);
  }

  encode() { return new Uint8Array(this.bytes); }
}

/** Render a line of any-script text into a 1-bit bitmap. */
function textBitmap(str, width, bold) {
  const canvas = document.createElement('canvas');
  const size = 24;
  canvas.width = width;
  canvas.height = size + 8;
  const c = canvas.getContext('2d');
  c.fillStyle = '#fff';
  c.fillRect(0, 0, canvas.width, canvas.height);
  c.fillStyle = '#000';
  c.font = `${bold ? 'bold ' : ''}${size}px "Noto Sans Bengali", system-ui, sans-serif`;
  c.textBaseline = 'top';
  c.fillText(str, 0, 4, width);
  const img = c.getImageData(0, 0, canvas.width, canvas.height).data;
  const data = new Uint8Array(canvas.width * canvas.height);
  for (let i = 0; i < data.length; i++) data[i] = img[i * 4] < 128 ? 1 : 0;
  return { width: canvas.width, height: canvas.height, data };
}
