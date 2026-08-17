import type { FastifyInstance } from "fastify";
import { getFrameHistory } from "../wsHub.js";

export async function registerDebugFramesRoute(app: FastifyInstance): Promise<void> {
  app.get("/api/debug-frames", async () => getFrameHistory());
}
