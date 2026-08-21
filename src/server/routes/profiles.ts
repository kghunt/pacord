import type { FastifyInstance } from "fastify";
import * as profilesDb from "../db/profiles.js";
import { deleteProfileDb } from "../db/index.js";
import { defaultPort, defaultRemote, defaultRadioPort } from "../../shared/engineDefaults.js";
import type { HopStep, NewConnectProfile } from "../../shared/types.js";

function coerceProfileBody(body: unknown): NewConnectProfile {
  const b = body as Record<string, unknown>;
  if (!b.name || typeof b.name !== "string") throw new Error("name is required");
  if (!b.myCall || typeof b.myCall !== "string") throw new Error("myCall is required");
  const transport = (b.transport as NewConnectProfile["transport"]) ?? "rhp-ws";
  const engine = (b.engine as NewConnectProfile["engine"]) ?? "xrouter";
  return {
    name: b.name,
    transport,
    host: typeof b.host === "string" && b.host ? b.host : "localhost",
    port: typeof b.port === "number" ? b.port : defaultPort(engine, transport) ?? 8086,
    engine,
    axLevel: b.axLevel === "L4" ? "L4" : "L2",
    radioPort: typeof b.radioPort === "number" ? b.radioPort : defaultRadioPort(engine),
    remote: typeof b.remote === "string" && b.remote ? b.remote : defaultRemote(engine),
    myCall: b.myCall.toUpperCase(),
    displayName: typeof b.displayName === "string" && b.displayName ? b.displayName : b.myCall,
    authUser: (b.authUser as string | null) ?? null,
    authPass: (b.authPass as string | null) ?? null,
    connectScript: Array.isArray(b.connectScript) ? (b.connectScript as HopStep[]) : [],
    responseTimeoutMs: typeof b.responseTimeoutMs === "number" && b.responseTimeoutMs > 0 ? b.responseTimeoutMs : 30000,
    adminPort: typeof b.adminPort === "number" ? b.adminPort : b.adminPort === null ? null : 8086,
    isDefault: Boolean(b.isDefault),
  };
}

export async function registerProfileRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/profiles", async () => profilesDb.listProfiles());

  app.get("/api/profiles/defaults", async (req) => {
    const engine = ((req.query as Record<string, string>)?.engine as "xrouter" | "bpq" | "custom") ?? "xrouter";
    const transport = "rhp-ws" as const;
    return {
      port: defaultPort(engine, transport),
      remote: defaultRemote(engine),
      radioPort: defaultRadioPort(engine),
    };
  });

  app.post("/api/profiles", async (req, reply) => {
    try {
      const profile = coerceProfileBody(req.body);
      const created = profilesDb.createProfile(profile);
      reply.code(201);
      return created;
    } catch (err) {
      reply.code(400);
      return { error: (err as Error).message };
    }
  });

  app.put("/api/profiles/:id", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    try {
      const profile = coerceProfileBody(req.body);
      return profilesDb.updateProfile(id, profile);
    } catch (err) {
      reply.code(400);
      return { error: (err as Error).message };
    }
  });

  app.delete("/api/profiles/:id", async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    profilesDb.deleteProfile(id);
    deleteProfileDb(id);
    reply.code(204);
  });
}
