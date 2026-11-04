import { describe, expect, it } from 'vitest';
import { renderStack } from '../../src/lib/ascii-stack';

const frame = { columns: 96, rows: 68, rotation: 0.62, spread: 1 };

describe('ASCII stack artwork', () => {
  it('produces a nonempty character frame at the requested dimensions', () => {
    const text = renderStack(frame);
    const lines = text.split('\n');
    expect(lines).toHaveLength(68);
    expect(lines.every((line) => line.length === 96)).toBe(true);
    expect(text.replace(/\s/g, '').length).toBeGreaterThan(500);
    expect(text).not.toMatch(/undefined|NaN/);
    expect(text.includes(String.fromCharCode(27))).toBe(false);
  });

  it('changes the projected silhouette when the stack rotates', () => {
    const first = renderStack(frame).replace(/[^\s]/g, '#');
    const turned = renderStack({ ...frame, rotation: 1.25 }).replace(/[^\s]/g, '#');
    expect(turned).not.toBe(first);
    expect(renderStack(frame)).toBe(renderStack(frame));
  });

  it('makes the exploded stack taller than its compact form', () => {
    const occupiedRows = (text: string) => text.split('\n').filter((line) => line.trim()).length;
    expect(occupiedRows(renderStack(frame))).toBeGreaterThan(
      occupiedRows(renderStack({ ...frame, spread: 0 })),
    );
  });

  it('renders seven separated layer silhouettes, not a single band of noise', () => {
    const bands = (text: string) =>
      text.split('\n').reduce((result, line, index, lines) => {
        return result + (line.trim() && (index === 0 || !lines[index - 1]!.trim()) ? 1 : 0);
      }, 0);
    for (let step = 0; step < 24; step++) {
      expect(bands(renderStack({ ...frame, rotation: (step * Math.PI) / 12 }))).toBe(7);
    }
    expect(bands(renderStack({ ...frame, spread: 0 }))).toBeLessThan(7);
  });

  it('uses only the intended surface and chip glyphs', () => {
    expect(new Set(renderStack(frame).replace(/\s/g, ''))).toEqual(
      new Set(['+', ':', '.', 'o', '=', '#', '*']),
    );
  });

  it('caps rendering work even when given excessive dimensions', () => {
    const text = renderStack({ ...frame, columns: 10000, rows: 10000 });
    const lines = text.split('\n');
    expect(lines.length).toBeLessThanOrEqual(80);
    expect(lines.every((line) => line.length <= 120)).toBe(true);
    expect(text.trim().length).toBeGreaterThan(100);
  });
});
