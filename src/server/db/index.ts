import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { MAIN_SCHEMA, PROFILE_SCHEMA, DEFAULT_CHANNELS } from "./schema.js";

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
mkdirSync(DATA_DIR, { recursive: true });

function ensureColumn(database: DatabaseSync, table: string, column: string, ddl: string): void {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all() as unknown as Array<{ name: string }>;
  if (!columns.some((c) => c.name === column)) {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl};`);
  }
}

// ---------------------------------------------------------------------------
// Main database — app-level config only (connect_profiles, meta).
// This never changes on profile switch.
// ---------------------------------------------------------------------------
const MAIN_DB_PATH = path.join(DATA_DIR, "pacord.db");
export const mainDb = new DatabaseSync(MAIN_DB_PATH);
mainDb.exec("PRAGMA journal_mode = WAL;");
mainDb.exec("PRAGMA foreign_keys = ON;");
mainDb.exec(MAIN_SCHEMA);
ensureColumn(mainDb, "connect_profiles", "ax_level", "ax_level TEXT NOT NULL DEFAULT 'L2'");
ensureColumn(mainDb, "connect_profiles", "response_timeout_ms", "response_timeout_ms INTEGER NOT NULL DEFAULT 30000");
ensureColumn(mainDb, "connect_profiles", "admin_port", "admin_port INTEGER DEFAULT 8086");

// ---------------------------------------------------------------------------
// Per-profile database — all user data (messages, posts, channels, hams,
// avatars). Switched on every connectProfile() call.
//
// ES module named exports are live bindings: importers that do
//   import { db } from "./index.js"
// will see the new value the next time they access `db`, so no changes are
// needed in channels.ts, messages.ts, posts.ts, hams.ts, or avatars.ts.
// ---------------------------------------------------------------------------
export let db: DatabaseSync = null!;

function profileDbPath(id: number): string {
  return path.join(DATA_DIR, `profile-${id}.db`);
}

export function isProfileDbOpen(): boolean {
  return (db as unknown) !== null;
}

export function openProfileDb(id: number): void {
  if (db) {
    try { db.close(); } catch { /* ignore */ }
  }
  const profileDb = new DatabaseSync(profileDbPath(id));
  profileDb.exec("PRAGMA journal_mode = WAL;");
  profileDb.exec("PRAGMA foreign_keys = ON;");
  profileDb.exec(PROFILE_SCHEMA);
  ensureColumn(profileDb, "channels", "ntfy_level", "ntfy_level TEXT NOT NULL DEFAULT 'all'");

  // Seed default channel directory on first use of this profile DB.
  const channelCount = profileDb.prepare("SELECT COUNT(*) as n FROM channels").get() as { n: number };
  if (channelCount.n === 0) {
    const insert = profileDb.prepare(
      "INSERT INTO channels (cid, name, description, subscribed) VALUES (?, ?, ?, 0)"
    );
    for (const ch of DEFAULT_CHANNELS) {
      insert.run(ch.cid, ch.name, ch.description);
    }
  }

  db = profileDb;
}
