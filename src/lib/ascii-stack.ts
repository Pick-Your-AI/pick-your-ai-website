export type StackFrame = { columns: number; rows: number; rotation: number; spread: number };

type Vec3 = [number, number, number];
type Block = { centre: Vec3; half: Vec3; layer: number; chip?: boolean };

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** An original orthographic ray-cast scene. Output is plain text, never HTML. */
export function renderStack(frame: StackFrame): string {
  const columns = clamp(Math.round(frame.columns) || 96, 32, 120);
  const rows = clamp(Math.round(frame.rows) || 68, 24, 80);
  const spread = clamp(frame.spread || 0, 0, 1);
  const yaw = Number.isFinite(frame.rotation) ? frame.rotation : 0.62;
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  // A shallow viewing angle keeps the exploded slabs visually separate.
  const pitch = 0.1;
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const direction: Vec3 = [sy * cp, -sp, -cy * cp];
  const blocks: Block[] = [];

  for (let layer = 0; layer < 7; layer++) {
    const y = (layer - 3) * (0.48 + spread * 0.64);
    blocks.push({ centre: [0, y, 0], half: [1.9, 0.095, 1.28], layer });
    blocks.push({
      centre: [-0.73, y + 0.28, layer % 2 ? 0.35 : -0.28],
      half: [0.38, 0.18, 0.34],
      layer,
      chip: true,
    });
    blocks.push({
      centre: [0.76, y + 0.22, layer % 2 ? -0.42 : 0.36],
      half: [0.5, 0.12, 0.26],
      layer,
      chip: true,
    });
  }

  const lines: string[] = [];
  for (let row = 0; row < rows; row++) {
    let line = '';
    const viewY = (0.5 - row / (rows - 1)) * 9.1;
    for (let column = 0; column < columns; column++) {
      const viewX = (column / (columns - 1) - 0.5) * 6.4;
      const rz = -viewY * sp + 12 * cp;
      const origin: Vec3 = [viewX * cy - rz * sy, viewY * cp + 12 * sp, viewX * sy + rz * cy];
      let closest = Infinity;
      let char = ' ';

      for (const block of blocks) {
        let near = -Infinity;
        let far = Infinity;
        let face = 0;
        for (let axis = 0; axis < 3; axis++) {
          const component = direction[axis]!;
          const local = origin[axis]! - block.centre[axis]!;
          const half = block.half[axis]!;
          if (Math.abs(component) < 0.000001) {
            if (Math.abs(local) > half) far = -Infinity;
            continue;
          }
          const t0 = (-half - local) / component;
          const t1 = (half - local) / component;
          const entry = Math.min(t0, t1);
          if (entry > near) {
            near = entry;
            face = axis;
          }
          far = Math.min(far, Math.max(t0, t1));
        }
        if (near > far || near < 0 || near >= closest) continue;
        closest = near;
        const x = origin[0] + direction[0] * near - block.centre[0];
        const z = origin[2] + direction[2] * near - block.centre[2];
        const edge = Math.abs(x) > block.half[0] - 0.07 || Math.abs(z) > block.half[2] - 0.07;
        if (face === 1) {
          const circuit = Math.abs(x * 5 - Math.round(x * 5)) < 0.12;
          const track = Math.abs(z * 4 - Math.round(z * 4)) < 0.12;
          char = edge ? '+' : block.chip ? '=' : circuit && track ? 'o' : circuit ? ':' : '.';
        } else {
          char = block.chip ? (face === 0 ? '#' : '*') : face === 0 ? '+' : ':';
        }
      }
      line += char;
    }
    lines.push(line);
  }
  return lines.join('\n');
}
