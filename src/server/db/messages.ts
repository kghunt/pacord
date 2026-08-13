import { db } from "./index.js";
import type { MessageRow, ReactionEntry } from "../../shared/types.js";

interface MsgRow {
  msg_id: string;
  from_call: string;
  to_call: string;
  body: string;
  ts: number;
  reply_id: string | null;
  edit_ts: number | null;
  delivered_ts: number | null;
  received_ts: number | null;
}

function reactionsFor(msgId: string): ReactionEntry[] {
  const rows = db
    .prepare("SELECT emoji, callsign, ts FROM message_reactions WHERE msg_id = ? ORDER BY ts")
    .all(msgId) as unknown as Array<{ emoji: string; callsign: string; ts: number }>;
  return rows.map((r) => ({ emoji: r.emoji, callsign: r.callsign, ts: r.ts }));
}

function rowToMessage(row: MsgRow): MessageRow {
  return {
    msgId: row.msg_id,
    fromCall: row.from_call,
    toCall: row.to_call,
    body: row.body,
    ts: row.ts,
    replyId: row.reply_id,
    editTs: row.edit_ts,
    deliveredTs: row.delivered_ts,
    receivedTs: row.received_ts,
    reactions: reactionsFor(row.msg_id),
  };
}

export interface UpsertMessageInput {
  msgId: string;
  fromCall: string;
  toCall: string;
  body: string;
  ts: number;
  replyId?: string | null;
  deliveredTs?: number | null;
  receivedTs?: number | null;
}

export function upsertMessage(m: UpsertMessageInput): MessageRow {
  db.prepare(
    `INSERT INTO messages (msg_id, from_call, to_call, body, ts, reply_id, delivered_ts, received_ts)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(msg_id) DO UPDATE SET
       delivered_ts = COALESCE(excluded.delivered_ts, messages.delivered_ts),
       received_ts = COALESCE(excluded.received_ts, messages.received_ts)`
  ).run(
    m.msgId,
    m.fromCall,
    m.toCall,
    m.body,
    m.ts,
    m.replyId ?? null,
    m.deliveredTs ?? null,
    m.receivedTs ?? null
  );
  const row = lookupMessageRow(m.msgId);
  if (!row) throw new Error("failed to read back upserted message");
  return row;
}

export function markMessageDelivered(msgId: string, deliveredTs: number): void {
  db.prepare("UPDATE messages SET delivered_ts = ? WHERE msg_id = ?").run(deliveredTs, msgId);
}

export function applyMessageEdit(msgId: string, body: string, editTs: number): void {
  db.prepare("UPDATE messages SET body = ?, edit_ts = ? WHERE msg_id = ?").run(body, editTs, msgId);
}

export function lookupMessageRow(msgId: string): MessageRow | null {
  const row = db.prepare("SELECT * FROM messages WHERE msg_id = ?").get(msgId) as MsgRow | undefined;
  return row ? rowToMessage(row) : null;
}

export function listMessagesForPeer(myCall: string, peerCall: string, limit = 200): MessageRow[] {
  const rows = db
    .prepare(
      `SELECT * FROM messages
       WHERE (from_call = ? AND to_call = ?) OR (from_call = ? AND to_call = ?)
       ORDER BY ts DESC LIMIT ?`
    )
    .all(myCall, peerCall, peerCall, myCall, limit) as unknown as MsgRow[];
  return rows.map(rowToMessage).reverse();
}

export function listRecentPeers(myCall: string, limit = 50): string[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT CASE WHEN from_call = ? THEN to_call ELSE from_call END AS peer, MAX(ts) as last_ts
       FROM messages WHERE from_call = ? OR to_call = ?
       GROUP BY peer ORDER BY last_ts DESC LIMIT ?`
    )
    .all(myCall, myCall, myCall, limit) as unknown as Array<{ peer: string }>;
  return rows.map((r) => r.peer);
}

// `mem`/real-time DM reaction: full-list replace for whichever party (self or
// peer) the update is attributed to — mirrors whatspyc's apply_message_emoji_list.
export function applyMessageEmojiList(msgId: string, attributedTo: string, emojis: string[], ts: number): void {
  db.prepare("DELETE FROM message_reactions WHERE msg_id = ? AND callsign = ?").run(msgId, attributedTo);
  const insert = db.prepare(
    "INSERT OR REPLACE INTO message_reactions (msg_id, emoji, callsign, ts) VALUES (?, ?, ?, ?)"
  );
  for (const emoji of emojis) {
    insert.run(msgId, emoji, attributedTo, ts);
  }
}

export function upsertMessageEmoji(msgId: string, emoji: string, callsign: string, ts: number): void {
  db.prepare(
    "INSERT OR REPLACE INTO message_reactions (msg_id, emoji, callsign, ts) VALUES (?, ?, ?, ?)"
  ).run(msgId, emoji, callsign, ts);
}

export function removeMessageEmoji(msgId: string, emoji: string, callsign: string): void {
  db.prepare("DELETE FROM message_reactions WHERE msg_id = ? AND emoji = ? AND callsign = ?").run(
    msgId,
    emoji,
    callsign
  );
}
