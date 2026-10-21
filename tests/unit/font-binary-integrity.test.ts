/*
 * Integrity of the shipped font binaries.
 *
 * Subsetting is a binary transformation, so the things that can silently break are not visible in the
 * CSS or in a screenshot:
 *
 *  - **The variable axes must still be the upstream ones.** Clipping `wght` rewrites the retained
 *    masters into the axis endpoints, which changes interpolated advances. The bounds are asserted
 *    against the values the pristine faces declare.
 *  - **The licence records must survive.** The harfbuzz subsetter drops most of the `name` table by
 *    default, and the pristine faces carry their SIL OFL licence URL in name ID 14. Removing it would
 *    strip the licence notice from the file being redistributed, which the OFL does not permit.
 *  - **The charset must be printable characters only.** It previously ran to U+007F (DEL), a control
 *    character that no UI can render.
 *
 * The `fontverter` dependency is used to decode woff2 to sfnt so the tables can be read.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { convert } from 'fontverter';
import { describe, expect, it } from 'vitest';
import { subsetCodepoints } from '../../scripts/font-charset.mjs';

const SRC_DIR = 'fonts-src';
const OUT_DIR = 'public/fonts';

/** Table directory of an sfnt (ttf/otf) buffer. */
function tables(buf: Buffer) {
  const numTables = buf.readUInt16BE(4);
  const out = new Map<string, { offset: number; length: number }>();
  for (let i = 0; i < numTables; i++) {
    const off = 12 + i * 16;
    out.set(buf.toString('latin1', off, off + 4), {
      offset: buf.readUInt32BE(off + 8),
      length: buf.readUInt32BE(off + 12),
    });
  }
  return out;
}

/** `fvar` axes with their declared bounds. */
function readAxes(buf: Buffer, t: { offset: number }) {
  const b = t.offset;
  const axesArrayOffset = buf.readUInt16BE(b + 4);
  const axisCount = buf.readUInt16BE(b + 8);
  const axisSize = buf.readUInt16BE(b + 10);
  const axes: { tag: string; min: number; default: number; max: number }[] = [];
  for (let i = 0; i < axisCount; i++) {
    const a = b + axesArrayOffset + i * axisSize;
    axes.push({
      tag: buf.toString('latin1', a, a + 4),
      min: buf.readInt32BE(a + 4) / 65536,
      default: buf.readInt32BE(a + 8) / 65536,
      max: buf.readInt32BE(a + 12) / 65536,
    });
  }
  return axes;
}

/** name table records keyed by name ID (Windows/Unicode platform preferred). */
function readNames(buf: Buffer, t: { offset: number }) {
  const base = t.offset;
  const count = buf.readUInt16BE(base + 2);
  const stringOffset = buf.readUInt16BE(base + 4);
  const names = new Map<number, string>();
  for (let i = 0; i < count; i++) {
    const r = base + 6 + i * 12;
    const platformID = buf.readUInt16BE(r);
    const nameID = buf.readUInt16BE(r + 6);
    const length = buf.readUInt16BE(r + 8);
    const offset = buf.readUInt16BE(r + 10);
    const raw = buf.subarray(base + stringOffset + offset, base + stringOffset + offset + length);
    if (platformID === 3 || platformID === 0) {
      let s = '';
      for (let k = 0; k + 1 < raw.length; k += 2) s += String.fromCharCode(raw.readUInt16BE(k));
      if (!names.has(nameID)) names.set(nameID, s);
    }
  }
  return names;
}

async function readFace(dir: string, file: string) {
  /*
   * fontverter's signature detection calls `buffer.toString('ascii')`, which only a Node Buffer has,
   * while the wawoff2 binding it delegates to rejects a Buffer and wants a plain Uint8Array. A
   * Buffer IS a Uint8Array subclass but the binding checks the constructor, so pass a Buffer for
   * detection and a copy for decompression.
   */
  const raw = readFileSync(join(dir, file));
  const sfnt = Buffer.from(await convert(Uint8Array.from(raw), 'truetype', 'woff2'));
  const t = tables(sfnt);
  return {
    axes: t.has('fvar') ? readAxes(sfnt, t.get('fvar')!) : [],
    names: t.has('name') ? readNames(sfnt, t.get('name')!) : new Map<number, string>(),
  };
}

const shipped = readdirSync(OUT_DIR).filter((f) => f.endsWith('.woff2'));

describe('shipped font binaries', () => {
  it('are all present in both trees', () => {
    const sources = readdirSync(SRC_DIR).filter((f) => f.endsWith('.woff2'));
    expect(shipped.sort()).toEqual(sources.sort());
  });

  it('keep the upstream variable axis bounds', async () => {
    for (const file of shipped) {
      const source = await readFace(SRC_DIR, file);
      const out = await readFace(OUT_DIR, file);
      expect(out.axes, `${file}: axis bounds changed by subsetting`).toEqual(source.axes);
    }
  });

  it('keep the copyright and licence records', async () => {
    for (const file of shipped) {
      const source = await readFace(SRC_DIR, file);
      const out = await readFace(OUT_DIR, file);
      // name ID 0 (copyright) and 14 (licence URL) are the OFL-required notices.
      for (const id of [0, 14]) {
        const original = source.names.get(id);
        if (original === undefined) continue;
        expect(out.names.get(id), `${file}: name ID ${id} was dropped by subsetting`).toBe(
          original,
        );
      }
    }
  });

  it('subset only printable characters', () => {
    const points = subsetCodepoints();
    // No control characters: 0x00-0x1F, and not DEL (0x7F).
    expect(points.filter((cp) => cp < 0x20 || cp === 0x7f)).toEqual([]);
    expect(points[0]).toBe(0x20);
    expect(points).toContain(0x7e);
    expect(points).not.toContain(0x7f);
  });
});
