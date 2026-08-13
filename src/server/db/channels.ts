import { db } from "./index.js";
import type { ChannelInfo } from "../../shared/types.js";

interface ChannelRow {
  cid: number;
  name: string;
  description: string;
  subscribed: number;
}

function rowToChannel(row: ChannelRow): ChannelInfo {
  return {
    cid: row.cid,
    name: row.name,
    description: row.description,
    subscribed: row.subscribed === 1,
  };
}

export function listChannels(): ChannelInfo[] {
  const rows = db.prepare("SELECT * FROM channels ORDER BY cid").all() as unknown as ChannelRow[];
  return rows.map(rowToChannel);
}

export function upsertChannel(ch: { cid: number; name: string; description: string }): ChannelInfo {
  db.prepare(
    `INSERT INTO channels (cid, name, description, subscribed) VALUES (?, ?, ?, 0)
     ON CONFLICT(cid) DO UPDATE SET name = excluded.name, description = excluded.description`
  ).run(ch.cid, ch.name, ch.description);
  const row = db.prepare("SELECT * FROM channels WHERE cid = ?").get(ch.cid) as unknown as ChannelRow;
  return rowToChannel(row);
}

export function deleteChannel(cid: number): void {
  db.prepare("DELETE FROM channels WHERE cid = ?").run(cid);
}

export function setChannelSubscribed(cid: number, subscribed: boolean): void {
  db.prepare("UPDATE channels SET subscribed = ? WHERE cid = ?").run(subscribed ? 1 : 0, cid);
}
