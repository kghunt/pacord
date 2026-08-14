import type { FastifyInstance } from "fastify";
import { db } from "../db/index.js";
import { getActiveProfile } from "../connectionManager.js";
import type { SearchResult } from "../../shared/types.js";

export async function registerSearchRoute(app: FastifyInstance): Promise<void> {
  app.get("/api/search", async (req, reply) => {
    const qs = req.query as Record<string, string>;
    const q = (qs.q ?? "").trim();
    if (q.length < 2) {
      reply.code(400);
      return { error: "Query too short (minimum 2 characters)." };
    }

    const limit = Math.min(Number(qs.limit ?? 50), 200);
    const pattern = `%${q}%`;

    // Determine the active user's bare callsign to resolve the DM peer.
    const profile = getActiveProfile();
    const myCall = profile?.myCall.toUpperCase().split("-")[0] ?? "";

    const msgRows = db
      .prepare(
        `SELECT msg_id, from_call, to_call, body, ts
         FROM messages
         WHERE body LIKE ? COLLATE NOCASE
         ORDER BY ts DESC LIMIT ?`
      )
      .all(pattern, limit) as Array<{
        msg_id: string;
        from_call: string;
        to_call: string;
        body: string;
        ts: number;
      }>;

    const postRows = db
      .prepare(
        `SELECT cid, ts, from_call, body
         FROM posts
         WHERE body LIKE ? COLLATE NOCASE
         ORDER BY ts DESC LIMIT ?`
      )
      .all(pattern, limit) as Array<{
        cid: number;
        ts: number;
        from_call: string;
        body: string;
      }>;

    const results: SearchResult[] = [];

    for (const m of msgRows) {
      const peer = m.from_call.toUpperCase() === myCall ? m.to_call : m.from_call;
      results.push({
        kind: "dm",
        fromCall: m.from_call,
        body: m.body,
        tsMs: m.ts * 1000,
        peer,
        msgId: m.msg_id,
      });
    }

    for (const p of postRows) {
      results.push({
        kind: "channel",
        fromCall: p.from_call,
        body: p.body,
        tsMs: p.ts,
        cid: p.cid,
        postTs: p.ts,
      });
    }

    // Merge and sort newest-first.
    results.sort((a, b) => b.tsMs - a.tsMs);

    return results.slice(0, limit);
  });
}
