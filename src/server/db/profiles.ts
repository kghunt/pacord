import { mainDb as db } from "./index.js";
import type { ConnectProfile, NewConnectProfile, HopStep } from "../../shared/types.js";

interface ProfileRow {
  id: number;
  name: string;
  transport: string;
  host: string;
  port: number;
  engine: string;
  ax_level: string;
  radio_port: number | null;
  remote: string;
  my_call: string;
  display_name: string;
  auth_user: string | null;
  auth_pass: string | null;
  connect_script: string;
  response_timeout_ms: number;
  admin_port: number | null;
  is_default: number;
}

function rowToProfile(row: ProfileRow): ConnectProfile {
  return {
    id: row.id,
    name: row.name,
    transport: row.transport as ConnectProfile["transport"],
    host: row.host,
    port: row.port,
    engine: row.engine as ConnectProfile["engine"],
    axLevel: (row.ax_level as ConnectProfile["axLevel"]) ?? "L2",
    radioPort: row.radio_port,
    remote: row.remote,
    myCall: row.my_call,
    displayName: row.display_name,
    authUser: row.auth_user,
    authPass: row.auth_pass,
    connectScript: JSON.parse(row.connect_script) as HopStep[],
    responseTimeoutMs: row.response_timeout_ms ?? 30000,
    adminPort: row.admin_port,
    isDefault: row.is_default === 1,
  };
}

export function listProfiles(): ConnectProfile[] {
  const rows = db.prepare("SELECT * FROM connect_profiles ORDER BY name").all() as unknown as ProfileRow[];
  return rows.map(rowToProfile);
}

export function getProfile(id: number): ConnectProfile | null {
  const row = db.prepare("SELECT * FROM connect_profiles WHERE id = ?").get(id) as ProfileRow | undefined;
  return row ? rowToProfile(row) : null;
}

export function createProfile(p: NewConnectProfile): ConnectProfile {
  if (p.isDefault) {
    db.prepare("UPDATE connect_profiles SET is_default = 0").run();
  }
  const result = db
    .prepare(
      `INSERT INTO connect_profiles
        (name, transport, host, port, engine, ax_level, radio_port, remote, my_call, display_name, auth_user, auth_pass, connect_script, response_timeout_ms, admin_port, is_default)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      p.name,
      p.transport,
      p.host,
      p.port,
      p.engine,
      p.axLevel,
      p.radioPort,
      p.remote,
      p.myCall,
      p.displayName,
      p.authUser,
      p.authPass,
      JSON.stringify(p.connectScript),
      p.responseTimeoutMs,
      p.adminPort,
      p.isDefault ? 1 : 0
    );
  const id = Number(result.lastInsertRowid);
  const created = getProfile(id);
  if (!created) throw new Error("failed to read back created profile");
  return created;
}

export function updateProfile(id: number, p: NewConnectProfile): ConnectProfile {
  if (p.isDefault) {
    db.prepare("UPDATE connect_profiles SET is_default = 0").run();
  }
  db.prepare(
    `UPDATE connect_profiles SET
      name = ?, transport = ?, host = ?, port = ?, engine = ?, ax_level = ?, radio_port = ?,
      remote = ?, my_call = ?, display_name = ?, auth_user = ?, auth_pass = ?,
      connect_script = ?, response_timeout_ms = ?, admin_port = ?, is_default = ?
     WHERE id = ?`
  ).run(
    p.name,
    p.transport,
    p.host,
    p.port,
    p.engine,
    p.axLevel,
    p.radioPort,
    p.remote,
    p.myCall,
    p.displayName,
    p.authUser,
    p.authPass,
    JSON.stringify(p.connectScript),
    p.responseTimeoutMs,
    p.adminPort,
    p.isDefault ? 1 : 0,
    id
  );
  const updated = getProfile(id);
  if (!updated) throw new Error(`profile ${id} not found after update`);
  return updated;
}

export function deleteProfile(id: number): void {
  db.prepare("DELETE FROM connect_profiles WHERE id = ?").run(id);
}

export function getDefaultProfile(): ConnectProfile | null {
  const row = db.prepare("SELECT * FROM connect_profiles WHERE is_default = 1 LIMIT 1").get() as
    | ProfileRow
    | undefined;
  return row ? rowToProfile(row) : null;
}
