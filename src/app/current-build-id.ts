const CURRENT_KEY = 'pyai.currentBuildId';

export function readCurrentId(): string | null {
  try {
    return localStorage.getItem(CURRENT_KEY);
  } catch {
    return null;
  }
}

export function writeCurrentId(id: string | null): void {
  try {
    if (id === null) localStorage.removeItem(CURRENT_KEY);
    else localStorage.setItem(CURRENT_KEY, id);
  } catch {
    /* storage unavailable: the current draft lives in memory only */
  }
}

/** Clear only the removed identity, preserving a different current selection. */
export function forgetCurrentId(buildId: string): boolean {
  if (readCurrentId() !== buildId) return false;
  writeCurrentId(null);
  return true;
}
