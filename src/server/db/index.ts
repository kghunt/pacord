import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { SCHEMA, DEFAULT_CHANNELS } from "./schema.js";

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, "pacord.db");

export const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");
db.exec(SCHEMA);

// Migrations for columns added after the initial schema — SQLite's ALTER
// TABLE ADD COLUMN has no IF NOT EXISTS, so check first.
function ensureColumn(table: string, column: string, ddl: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as unknown as Array<{ name: string }>;
  if (!columns.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl};`);
  }
}
ensureColumn("connect_profiles", "ax_level", "ax_level TEXT NOT NULL DEFAULT 'L2'");
ensureColumn("connect_profiles", "response_timeout_ms", "response_timeout_ms INTEGER NOT NULL DEFAULT 30000");
ensureColumn("connect_profiles", "admin_port", "admin_port INTEGER DEFAULT 8086");

// Seed the default channel directory on first run only — never touch it
// again so user edits (add/remove/rename) survive restarts.
const channelCount = db.prepare("SELECT COUNT(*) as n FROM channels").get() as { n: number };
if (channelCount.n === 0) {
  const insert = db.prepare(
    "INSERT INTO channels (cid, name, description, subscribed) VALUES (?, ?, ?, 0)"
  );
  for (const ch of DEFAULT_CHANNELS) {
    insert.run(ch.cid, ch.name, ch.description);
  }
}
