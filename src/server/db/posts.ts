import { db } from "./index.js";
import type { PostRow, ReactionEntry } from "../../shared/types.js";

interface PostDbRow {
  cid: number;
  ts: number;
  from_call: string;
  body: string;
  reply_ts: number | null;
  reply_from: string | null;
  at_calls: string | null;
  edit_ts: number | null;
  delivered_ts: number | null;
  received_ts: number | null;
}

function reactionsFor(cid: number, ts: number): ReactionEntry[] {
  const rows = db
    .prepare("SELECT emoji, callsign, ets FROM post_reactions WHERE cid = ? AND ts = ? ORDER BY ets")
    .all(cid, ts) as unknown as Array<{ emoji: string; callsign: string; ets: number }>;
  return rows.map((r) => ({ emoji: r.emoji, callsign: r.callsign, ts: r.ets }));
}

function rowToPost(row: PostDbRow): PostRow {
  return {
    cid: row.cid,
    ts: row.ts,
    fromCall: row.from_call,
    body: row.body,
    replyTs: row.reply_ts,
    replyFrom: row.reply_from,
    atCalls: row.at_calls ? (JSON.parse(row.at_calls) as string[]) : [],
    editTs: row.edit_ts,
    deliveredTs: row.delivered_ts,
    receivedTs: row.received_ts,
    reactions: reactionsFor(row.cid, row.ts),
  };
}

export interface UpsertPostInput {
  cid: number;
  ts: number;
  fromCall: string;
  body: string;
  replyTs?: number | null;
  replyFrom?: string | null;
  atCalls?: string[] | null;
  deliveredTs?: number | null;
  receivedTs?: number | null;
}

export function upsertPost(p: UpsertPostInput): PostRow {
  db.prepare(
    `INSERT INTO posts (cid, ts, from_call, body, reply_ts, reply_from, at_calls, delivered_ts, received_ts)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(cid, ts) DO UPDATE SET
       delivered_ts = COALESCE(excluded.delivered_ts, posts.delivered_ts),
       received_ts = COALESCE(excluded.received_ts, posts.received_ts)`
  ).run(
    p.cid,
    p.ts,
    p.fromCall,
    p.body,
    p.replyTs ?? null,
    p.replyFrom ?? null,
    p.atCalls && p.atCalls.length ? JSON.stringify(p.atCalls) : null,
    p.deliveredTs ?? null,
    p.receivedTs ?? null
  );
  const row = lookupPost(p.cid, p.ts);
  if (!row) throw new Error("failed to read back upserted post");
  return row;
}

export function markPostDelivered(cid: number, ts: number, deliveredTs: number): void {
  db.prepare("UPDATE posts SET delivered_ts = ? WHERE cid = ? AND ts = ?").run(deliveredTs, cid, ts);
}

export function applyPostEdit(cid: number, ts: number, body: string, editTs: number): void {
  db.prepare("UPDATE posts SET body = ?, edit_ts = ? WHERE cid = ? AND ts = ?").run(body, editTs, cid, ts);
}

export function lookupPost(cid: number, ts: number): PostRow | null {
  const row = db.prepare("SELECT * FROM posts WHERE cid = ? AND ts = ?").get(cid, ts) as PostDbRow | undefined;
  return row ? rowToPost(row) : null;
}

// `cpr` acks carry only `ts` (no `cid`) — locate the row by (from_call, ts)
// instead, mirroring whatspyc's lookup_post_by_from_ts.
export function lookupPostByFromTs(fromCall: string, ts: number): PostRow | null {
  const row = db.prepare("SELECT * FROM posts WHERE from_call = ? AND ts = ?").get(fromCall, ts) as
    | PostDbRow
    | undefined;
  return row ? rowToPost(row) : null;
}

export function markPostDeliveredByTs(fromCall: string, ts: number, deliveredTs: number): void {
  db.prepare("UPDATE posts SET delivered_ts = ? WHERE from_call = ? AND ts = ?").run(deliveredTs, fromCall, ts);
}

export function listPostsForChannel(cid: number, limit = 200): PostRow[] {
  const rows = db
    .prepare("SELECT * FROM posts WHERE cid = ? ORDER BY ts DESC LIMIT ?")
    .all(cid, limit) as unknown as PostDbRow[];
  return rows.map(rowToPost).reverse();
}

export function upsertPostEmoji(cid: number, ts: number, emoji: string, callsign: string, ets: number): void {
  db.prepare(
    "INSERT OR REPLACE INTO post_reactions (cid, ts, emoji, callsign, ets) VALUES (?, ?, ?, ?, ?)"
  ).run(cid, ts, emoji, callsign, ets);
}

export function removePostEmoji(cid: number, ts: number, emoji: string, callsign: string): void {
  db.prepare("DELETE FROM post_reactions WHERE cid = ? AND ts = ? AND emoji = ? AND callsign = ?").run(
    cid,
    ts,
    emoji,
    callsign
  );
}

// `cpb`/`cpemb` carry the full current reaction state for a post as
// [{e: emoji, c: [callsigns]}, ...] — replace wholesale, mirroring
// whatspyc's apply_post_emoji_batch.
export function getChannelWatermarks(cid: number): { lastPost: number; lastEmoji: number; lastEdit: number } {
  const postRow = db.prepare("SELECT MAX(ts) as v FROM posts WHERE cid = ?").get(cid) as { v: number | null };
  const emojiRow = db.prepare("SELECT MAX(ets) as v FROM post_reactions WHERE cid = ?").get(cid) as { v: number | null };
  const editRow = db.prepare("SELECT MAX(edit_ts) as v FROM posts WHERE cid = ? AND edit_ts IS NOT NULL").get(cid) as { v: number | null };
  return { lastPost: postRow?.v ?? 0, lastEmoji: emojiRow?.v ?? 0, lastEdit: editRow?.v ?? 0 };
}

export function applyPostEmojiBatch(
  cid: number,
  ts: number,
  entries: Array<{ e: string; c: string[] }>,
  ets: number
): void {
  db.prepare("DELETE FROM post_reactions WHERE cid = ? AND ts = ?").run(cid, ts);
  const insert = db.prepare(
    "INSERT OR REPLACE INTO post_reactions (cid, ts, emoji, callsign, ets) VALUES (?, ?, ?, ?, ?)"
  );
  for (const entry of entries) {
    for (const callsign of entry.c ?? []) {
      insert.run(cid, ts, entry.e, callsign, ets);
    }
  }
}
