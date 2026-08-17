import type { FastifyInstance } from "fastify";
import * as metaDb from "../db/meta.js";

export async function registerSettingsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/settings", async () => ({
    idleDisconnectMinutes: metaDb.getMetaNumber("idle_disconnect_minutes", 0),
    avatarCheckIntervalMinutes: metaDb.getMetaNumber("avatar_check_interval_minutes", 0),
    ntfyUrl: metaDb.getMeta("ntfy_url") ?? "",
    ntfyToken: metaDb.getMeta("ntfy_token") ?? "",
  }));

  app.put("/api/settings", async (req, reply) => {
    const { idleDisconnectMinutes, avatarCheckIntervalMinutes, ntfyUrl, ntfyToken } = req.body as {
      idleDisconnectMinutes?: unknown;
      avatarCheckIntervalMinutes?: unknown;
      ntfyUrl?: unknown;
      ntfyToken?: unknown;
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
    metaDb.setMeta("ntfy_url", typeof ntfyUrl === "string" ? ntfyUrl.trim() : "");
    metaDb.setMeta("ntfy_token", typeof ntfyToken === "string" ? ntfyToken.trim() : "");
    return {
      idleDisconnectMinutes: Math.round(idleDisconnectMinutes),
      avatarCheckIntervalMinutes: Math.round(avatarCheckIntervalMinutes),
      ntfyUrl: typeof ntfyUrl === "string" ? ntfyUrl.trim() : "",
      ntfyToken: typeof ntfyToken === "string" ? ntfyToken.trim() : "",
    };
  });
}
