/**
 * Per-profile key-value store for sync cursors (last_message, last_avatar_ts,
 * last_ham_ts, etc.). Stored in the active profile's database so switching
 * profiles resets these cursors to zero, causing a full re-sync with the new
 * server rather than incorrectly inheriting cursors from a different server.
 */
import { db } from "./index.js";

export function getProfileMeta(key: string): string | null {
  const row = db.prepare("SELECT value FROM profile_meta WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setProfileMeta(key: string, value: string): void {
  db.prepare(
    "INSERT INTO profile_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(key, value);
}

export function getProfileMetaNumber(key: string, fallback = 0): number {
  const v = getProfileMeta(key);
  return v === null ? fallback : Number(v);
}

export function bumpProfileMeta(key: string, value: number): void {
  const current = getProfileMetaNumber(key, 0);
  if (value > current) setProfileMeta(key, String(value));
}
