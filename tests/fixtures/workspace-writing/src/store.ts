export interface Entry {
  key: string;
  value: string;
  updatedAt: number;
}

const entries = new Map<string, Entry>();

export function put(key: string, value: string, now: number): Entry {
  const entry = { key, value, updatedAt: now };
  entries.set(key, entry);
  return entry;
}

export function get(key: string): Entry | undefined {
  return entries.get(key);
}

export function expire(olderThanMs: number, now: number): number {
  let removed = 0;
  for (const [key, entry] of entries) {
    if (now - entry.updatedAt >= olderThanMs) {
      entries.delete(key);
      removed += 1;
    }
  }
  return removed;
}
