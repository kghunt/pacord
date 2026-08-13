import { db } from "./index.js";
import type { HamInfo } from "../../shared/types.js";

export function upsertHam(callsign: string, name: string, ts: number): void {
  if (!callsign) return;
  db.prepare(
    `INSERT INTO hams (callsign, name, ts) VALUES (?, ?, ?)
     ON CONFLICT(callsign) DO UPDATE SET name = excluded.name, ts = excluded.ts`
  ).run(callsign.toUpperCase(), name, ts);
}

export function lookupHam(callsign: string): HamInfo | null {
  const row = db.prepare("SELECT * FROM hams WHERE callsign = ?").get(callsign.toUpperCase()) as
    | HamInfo
    | undefined;
  return row ?? null;
}

export function listHams(): HamInfo[] {
  return db.prepare("SELECT * FROM hams ORDER BY callsign").all() as unknown as HamInfo[];
}
