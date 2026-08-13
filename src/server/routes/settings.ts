import type { FastifyInstance } from "fastify";
import * as metaDb from "../db/meta.js";

export async function registerSettingsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/settings", async () => ({
    idleDisconnectMinutes: metaDb.getMetaNumber("idle_disconnect_minutes", 0),
  }));

  app.put("/api/settings", async (req, reply) => {
    const { idleDisconnectMinutes } = req.body as { idleDisconnectMinutes?: unknown };
    if (typeof idleDisconnectMinutes !== "number" || idleDisconnectMinutes < 0) {
      reply.code(400);
      return { error: "idleDisconnectMinutes must be a non-negative number" };
    }
    metaDb.setMeta("idle_disconnect_minutes", String(Math.round(idleDisconnectMinutes)));
    return { idleDisconnectMinutes: Math.round(idleDisconnectMinutes) };
  });
}
