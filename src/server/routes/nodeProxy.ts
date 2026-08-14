import type { FastifyInstance } from "fastify";
import { getActiveProfile } from "../connectionManager.js";
import * as profilesDb from "../db/profiles.js";

export async function registerNodeProxyRoutes(app: FastifyInstance): Promise<void> {
  // Proxy a GET request to the XRouter admin HTTP API.
  // Uses the active profile's host+adminPort; falls back to the first
  // profile that has an adminPort configured.
  app.get("/api/node-proxy", async (req, reply) => {
    const profile =
      getActiveProfile() ??
      profilesDb.listProfiles().find((p) => p.adminPort != null) ??
      null;

    if (!profile?.adminPort) {
      reply.code(409);
      return { error: "No admin port configured on any connection profile." };
    }

    const qs = req.query as Record<string, string>;
    const path = qs.path ?? "/";
    const url = `http://${profile.host}:${profile.adminPort}${path}`;

    let response: Response;
    try {
      response = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      });
    } catch (err) {
      reply.code(502);
      return { error: `Could not reach node admin API at ${url}: ${(err as Error).message}` };
    }

    const contentType = response.headers.get("content-type") ?? "";
    const body = await response.text();
    reply.code(response.status);

    if (contentType.includes("json")) {
      reply.type("application/json");
      return body;
    }

    // Non-JSON response — return as a wrapper so the client can detect it
    // and show a helpful message rather than a parse error.
    return { htmlResponse: true, status: response.status, snippet: body.slice(0, 500) };
  });
}
