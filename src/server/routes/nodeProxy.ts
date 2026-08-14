import type { FastifyInstance } from "fastify";
import { getActiveProfile } from "../connectionManager.js";
import * as profilesDb from "../db/profiles.js";

// Read-only XRouter terminal commands we allow proxying.
const ALLOWED_CMDS = new Set(["N", "NODES", "MH", "MHEARD", "R", "ROUTES", "P", "PORTS", "S", "STATS", "AX", "AXROUTES", "V", "VERSION", "INFO"]);

function stripHtml(html: string): string {
  // Prefer <pre> content as XRouter wraps output in it.
  const preMatch = html.match(/<pre[^>]*>([\s\S]*?)<\/pre>/i);
  const raw = preMatch ? preMatch[1]! : html.replace(/<[^>]+>/g, "\n");
  return raw
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\r\n/g, "\n")
    .trim();
}

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

  // Execute a read-only XRouter terminal command via the /exec?cmd= HTTP endpoint.
  // Returns the plain-text output extracted from the HTML response.
  app.get("/api/node-cmd", async (req, reply) => {
    const profile =
      getActiveProfile() ??
      profilesDb.listProfiles().find((p) => p.adminPort != null) ??
      null;

    if (!profile?.adminPort) {
      reply.code(409);
      return { error: "No admin port configured on any connection profile." };
    }

    const qs = req.query as Record<string, string>;
    const cmd = (qs.cmd ?? "").trim().toUpperCase();
    if (!cmd) {
      reply.code(400);
      return { error: "Missing cmd query parameter." };
    }

    const baseCmd = cmd.split(/\s+/)[0] ?? "";
    if (!ALLOWED_CMDS.has(baseCmd)) {
      reply.code(403);
      return { error: `Command '${baseCmd}' is not permitted.` };
    }

    const url = `http://${profile.host}:${profile.adminPort}/exec?cmd=${encodeURIComponent(cmd)}`;

    let response: Response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    } catch (err) {
      reply.code(502);
      return { error: `Could not reach node at ${url}: ${(err as Error).message}` };
    }

    const html = await response.text();
    return { text: stripHtml(html), cmd };
  });
}
