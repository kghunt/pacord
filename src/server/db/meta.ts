import { db } from "./index.js";

export function getMeta(key: string): string | null {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setMeta(key: string, value: string): void {
  db.prepare(
    "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(key, value);
}

export function getMetaNumber(key: string, fallback = 0): number {
  const v = getMeta(key);
  return v === null ? fallback : Number(v);
}

// Only overwrite if the new value is higher — mirrors whatspyc's bump_meta
// cursor semantics (last_message / last_emoji / last_edit / last_ham_ts).
export function bumpMeta(key: string, value: number): void {
  const current = getMetaNumber(key, 0);
  if (value > current) {
    setMeta(key, String(value));
  }
}
