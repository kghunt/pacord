import type { FastifyInstance } from "fastify";
import * as channelsDb from "../db/channels.js";
import type { NtfyLevel } from "../../shared/types.js";

const VALID_NTFY_LEVELS: NtfyLevel[] = ["none", "mentions", "replies", "all"];

export async function registerChannelRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/channels", async () => channelsDb.listChannels());

  app.post("/api/channels", async (req, reply) => {
    const b = req.body as { cid: number; name?: string; description?: string };
    if (typeof b.cid !== "number") {
      reply.code(400);
      return { error: "cid is required" };
    }
    const created = channelsDb.upsertChannel({ cid: b.cid, name: b.name ?? "", description: b.description ?? "" });
    reply.code(201);
    return created;
  });

  app.put("/api/channels/:cid", async (req) => {
    const cid = Number((req.params as { cid: string }).cid);
    const b = req.body as { name?: string; description?: string };
    return channelsDb.upsertChannel({ cid, name: b.name ?? "", description: b.description ?? "" });
  });

  app.delete("/api/channels/:cid", async (req, reply) => {
    const cid = Number((req.params as { cid: string }).cid);
    channelsDb.deleteChannel(cid);
    reply.code(204);
  });

  app.patch("/api/channels/:cid/ntfy-level", async (req, reply) => {
    const cid = Number((req.params as { cid: string }).cid);
    const { level } = req.body as { level?: unknown };
    if (!VALID_NTFY_LEVELS.includes(level as NtfyLevel)) {
      reply.code(400);
      return { error: `level must be one of: ${VALID_NTFY_LEVELS.join(", ")}` };
    }
    channelsDb.setChannelNtfyLevel(cid, level as NtfyLevel);
    return { cid, ntfyLevel: level };
  });
}
