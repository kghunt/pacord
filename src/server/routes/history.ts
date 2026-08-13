import type { FastifyInstance } from "fastify";
import * as messagesDb from "../db/messages.js";
import * as postsDb from "../db/posts.js";
import * as hamsDb from "../db/hams.js";
import * as connectionManager from "../connectionManager.js";

export async function registerHistoryRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/peers", async (_req, reply) => {
    const profile = connectionManager.getActiveProfile();
    if (!profile) {
      reply.code(409);
      return { error: "no active connection profile" };
    }
    return messagesDb.listRecentPeers(profile.myCall.toUpperCase().split("-", 1)[0]!);
  });

  app.get("/api/messages/:peer", async (req, reply) => {
    const profile = connectionManager.getActiveProfile();
    if (!profile) {
      reply.code(409);
      return { error: "no active connection profile" };
    }
    const peer = (req.params as { peer: string }).peer.toUpperCase();
    return messagesDb.listMessagesForPeer(profile.myCall.toUpperCase().split("-", 1)[0]!, peer);
  });

  app.get("/api/posts/:cid", async (req) => {
    const cid = Number((req.params as { cid: string }).cid);
    return postsDb.listPostsForChannel(cid);
  });

  app.get("/api/roster", async () => {
    const client = connectionManager.getActiveClient();
    return {
      online: client?.onlineUsers ?? [],
      hams: hamsDb.listHams(),
    };
  });
}
