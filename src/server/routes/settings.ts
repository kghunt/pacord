import type { FastifyInstance } from "fastify";
import * as metaDb from "../db/meta.js";

export async function registerSettingsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/settings", async () => ({
    idleDisconnectMinutes: metaDb.getMetaNumber("idle_disconnect_minutes", 0),
    avatarCheckIntervalMinutes: metaDb.getMetaNumber("avatar_check_interval_minutes", 0),
  }));

  app.put("/api/settings", async (req, reply) => {
    const { idleDisconnectMinutes, avatarCheckIntervalMinutes } = req.body as {
      idleDisconnectMinutes?: unknown;
      avatarCheckIntervalMinutes?: unknown;
    };
    if (typeof idleDisconnectMinutes !== "number" || idleDisconnectMinutes < 0) {
      reply.code(400);
      return { error: "idleDisconnectMinutes must be a non-negative number" };
    }
    if (typeof avatarCheckIntervalMinutes !== "number" || avatarCheckIntervalMinutes < 0) {
      reply.code(400);
      return { error: "avatarCheckIntervalMinutes must be a non-negative number" };
    }
    metaDb.setMeta("idle_disconnect_minutes", String(Math.round(idleDisconnectMinutes)));
    metaDb.setMeta("avatar_check_interval_minutes", String(Math.round(avatarCheckIntervalMinutes)));
    return {
      idleDisconnectMinutes: Math.round(idleDisconnectMinutes),
      avatarCheckIntervalMinutes: Math.round(avatarCheckIntervalMinutes),
    };
  });
}
