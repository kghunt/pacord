import { db } from "./index.js";

export interface AvatarRow {
  callsign: string;
  dataBase64: string;
  mime: string;
  ts: number;
}

interface Signature {
  bytes: number[];
  mime: string;
}

const SIGNATURES: Signature[] = [
  { bytes: [0xff, 0xd8, 0xff], mime: "image/jpeg" },
  { bytes: [0x89, 0x50, 0x4e, 0x47], mime: "image/png" },
  { bytes: [0x47, 0x49, 0x46, 0x38], mime: "image/gif" }, // "GIF8"
];

const PREFIX_SEARCH_WINDOW = 64;

// WPS prefixes avatar payloads with 16 extra bytes before the real image
// data (observed empirically — looks like an MD5 checksum, though the
// protocol docs don't say). Rather than assume a fixed 16-byte offset,
// search for a known image signature within the first few bytes and slice
// from there — robust to that prefix being absent or a different length.
function findImageStart(bytes: Buffer): { offset: number; mime: string } | null {
  const window = Math.min(bytes.length, PREFIX_SEARCH_WINDOW);
  for (let offset = 0; offset < window; offset++) {
    for (const sig of SIGNATURES) {
      if (offset + sig.bytes.length > bytes.length) continue;
      if (sig.bytes.every((b, i) => bytes[offset + i] === b)) {
        return { offset, mime: sig.mime };
      }
    }
  }
  return null;
}

export function upsertAvatar(callsign: string, dataBase64Raw: string, ts: number): AvatarRow {
  const rawBytes = Buffer.from(dataBase64Raw, "base64");
  const found = findImageStart(rawBytes);
  const imageBytes = found ? rawBytes.subarray(found.offset) : rawBytes;
  const mime = found ? found.mime : "application/octet-stream";
  const dataBase64 = imageBytes.toString("base64");
  db.prepare(
    `INSERT INTO avatars (callsign, data_base64, mime, ts) VALUES (?, ?, ?, ?)
     ON CONFLICT(callsign) DO UPDATE SET data_base64 = excluded.data_base64, mime = excluded.mime, ts = excluded.ts`
  ).run(callsign.toUpperCase(), dataBase64, mime, ts);
  return { callsign: callsign.toUpperCase(), dataBase64, mime, ts };
}

export function getAvatar(callsign: string): AvatarRow | null {
  const row = db.prepare("SELECT * FROM avatars WHERE callsign = ?").get(callsign.toUpperCase()) as
    | { callsign: string; data_base64: string; mime: string; ts: number }
    | undefined;
  return row ? { callsign: row.callsign, dataBase64: row.data_base64, mime: row.mime, ts: row.ts } : null;
}

export function listAvatarCallsigns(): string[] {
  const rows = db.prepare("SELECT callsign FROM avatars").all() as unknown as Array<{ callsign: string }>;
  return rows.map((r) => r.callsign);
}

// Re-derives mime + strips any leading junk for rows stored before this
// prefix-detection existed. Safe to run repeatedly.
export function refixAllStoredAvatars(): number {
  const rows = db.prepare("SELECT callsign, data_base64, ts FROM avatars").all() as unknown as Array<{
    callsign: string;
    data_base64: string;
    ts: number;
  }>;
  let fixed = 0;
  for (const row of rows) {
    const before = row.data_base64;
    const updated = upsertAvatar(row.callsign, before, row.ts);
    if (updated.dataBase64 !== before) fixed++;
  }
  return fixed;
}
