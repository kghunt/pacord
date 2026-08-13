import type { FastifyInstance } from "fastify";
import * as avatarsDb from "../db/avatars.js";
import { getActiveClient } from "../connectionManager.js";

export async function registerAvatarRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/avatar/upload", async (req, reply) => {
    const client = getActiveClient();
    if (!client?.isConnected) {
      reply.code(409);
      return { error: "not connected" };
    }
    const { imageBase64 } = req.body as { imageBase64?: string };
    if (!imageBase64) {
      reply.code(400);
      return { error: "imageBase64 required" };
    }
    await client.sendAvatar(imageBase64);
    return { ok: true };
  });

  app.get("/api/avatars/:callsign", async (req, reply) => {
    const callsign = (req.params as { callsign: string }).callsign;
    const row = avatarsDb.getAvatar(callsign);
    if (!row) {
      reply.code(404);
      return { error: "no avatar stored for this callsign" };
    }
    reply.header("Cache-Control", "private, max-age=3600");
    reply.type(row.mime);
    return Buffer.from(row.dataBase64, "base64");
  });

  app.get("/api/avatars", async () => avatarsDb.listAvatarCallsigns());
}
