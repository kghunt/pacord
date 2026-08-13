import type { FastifyInstance } from "fastify";
import * as avatarsDb from "../db/avatars.js";

export async function registerAvatarRoutes(app: FastifyInstance): Promise<void> {
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
