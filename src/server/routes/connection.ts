import type { FastifyInstance } from "fastify";
import * as connectionManager from "../connectionManager.js";

export async function registerConnectionRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/connection", async () => connectionManager.getConnectionState());

  app.post("/api/profiles/:id/connect", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    try {
      connectionManager.connectProfile(id);
      return { ok: true };
    } catch (err) {
      reply.code(400);
      return { error: (err as Error).message };
    }
  });

  app.post("/api/disconnect", async () => {
    connectionManager.disconnect();
    return { ok: true };
  });
}
