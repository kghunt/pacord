import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";

import "./db/index.js"; // ensures schema/seed run before anything else
import { registerProfileRoutes } from "./routes/profiles.js";
import { registerChannelRoutes } from "./routes/channels.js";
import { registerConnectionRoutes } from "./routes/connection.js";
import { registerHistoryRoutes } from "./routes/history.js";
import { registerAvatarRoutes } from "./routes/avatars.js";
import { registerVersionRoute } from "./routes/version.js";
import { attachClient } from "./wsHub.js";
import { autoConnectOnStartup } from "./connectionManager.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const CLIENT_DIST = path.resolve(__dirname, "../client");

process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});

const app = Fastify({ logger: true });

await app.register(fastifyWebsocket);
await app.register(fastifyStatic, {
  root: CLIENT_DIST,
  wildcard: false,
});

await registerProfileRoutes(app);
await registerChannelRoutes(app);
await registerConnectionRoutes(app);
await registerHistoryRoutes(app);
await registerAvatarRoutes(app);
await registerVersionRoute(app);

app.register(async (instance) => {
  instance.get("/ws", { websocket: true }, (socket) => {
    attachClient(socket);
  });
});

// SPA fallback: any non-API, non-asset GET serves index.html so client-side
// routing (if any is added later) and plain refreshes both work.
app.setNotFoundHandler((req, reply) => {
  if (req.method === "GET" && !req.url.startsWith("/api")) {
    reply.sendFile("index.html");
    return;
  }
  reply.code(404).send({ error: "not found" });
});

autoConnectOnStartup();

app.listen({ port: PORT, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
