import type { BuildSnapshot } from '../contracts';

/** Canonical JSON without recursive traversal or stringification of containers. */
function snapshotIdentity(build: BuildSnapshot): string {
  const pending: ({ value: unknown } | { text: string })[] = [{ value: build }];
  const chunks: string[] = [];
  while (pending.length) {
    const task = pending.pop()!;
    if ('text' in task) {
      chunks.push(task.text);
      continue;
    }
    const value = task.value;
    if (value === null || typeof value !== 'object') {
      chunks.push(JSON.stringify(value) ?? 'null');
    } else if (Array.isArray(value)) {
      chunks.push('[');
      pending.push({ text: ']' });
      for (let i = value.length - 1; i >= 0; i--) {
        pending.push({ value: value[i] });
        if (i > 0) pending.push({ text: ',' });
      }
    } else {
      const record = value as Record<string, unknown>;
      // Local snapshots may include absent optional fields; match JSON's omission semantics.
      const keys = Object.keys(record)
        .filter((key) => !['undefined', 'function', 'symbol'].includes(typeof record[key]))
        .sort();
      chunks.push('{');
      pending.push({ text: '}' });
      for (let i = keys.length - 1; i >= 0; i--) {
        const key = keys[i]!;
        pending.push({ value: record[key] }, { text: `${JSON.stringify(key)}:` });
        if (i > 0) pending.push({ text: ',' });
      }
    }
  }
  return chunks.join('');
}

/**
 * Imported previews can declare the same ID and revision for different contents.
 * Keep complete JSON content in a scalar key: TanStack's recursive structural hash
 * cannot safely traverse the arbitrary nesting accepted in snapshot extensions.
 * Sorted object keys reuse results for equal JSON reparses without identity caching.
 */
export const buildQueryKey = (build: BuildSnapshot | null | undefined) =>
  [build?.id ?? 'none', build?.revision ?? 0, build ? snapshotIdentity(build) : null] as const;
