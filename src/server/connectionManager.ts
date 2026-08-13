/**
 * Owns the single live XRouter connection (v1 keeps it to one at a time —
 * see the plan). Persists which profile is active in `meta` so the backend
 * reconnects on its own restart, and retries the *initial* connect attempt
 * with backoff if XRouter isn't reachable yet (WpsClient itself only
 * handles reconnecting after a session that was already up gets dropped).
 */
import type { ConnectionState, ServerEvent } from "../shared/types.js";
import * as profilesDb from "./db/profiles.js";
import * as metaDb from "./db/meta.js";
import { WpsClient } from "./protocol/wpsClient.js";
import { broadcast, broadcastDebug } from "./wsHub.js";

const ACTIVE_PROFILE_META_KEY = "active_profile_id";
const RETRY_INITIAL_MS = 2000;
const RETRY_MAX_MS = 60_000;

let activeClient: WpsClient | null = null;
let activeProfileId: number | null = null;
let connectToken = 0;
let lastError: string | null = null;

export function getActiveClient(): WpsClient | null {
  return activeClient;
}

export function getActiveProfile() {
  return activeProfileId !== null ? profilesDb.getProfile(activeProfileId) : null;
}

export function getConnectionState(): ConnectionState {
  if (!activeClient) {
    return { status: "disconnected", activeProfileId, error: lastError, onlineUsers: [], pausedChannels: {} };
  }
  return {
    status: activeClient.isConnected ? "connected" : "connecting",
    activeProfileId,
    error: lastError,
    onlineUsers: activeClient.onlineUsers,
    pausedChannels: activeClient.pausedChannelsSnapshot,
  };
}

export function connectProfile(id: number): void {
  const profile = profilesDb.getProfile(id);
  if (!profile) throw new Error(`profile ${id} not found`);
  teardownActive();

  activeProfileId = id;
  lastError = null;
  metaDb.setMeta(ACTIVE_PROFILE_META_KEY, String(id));

  const token = ++connectToken;
  const client = new WpsClient(profile);
  client.on("event", (ev: ServerEvent) => {
    if (ev.type === "debug_frame") broadcastDebug(ev);
    else broadcast(ev);
  });
  activeClient = client;
  attemptConnect(client, token, RETRY_INITIAL_MS);
}

export function disconnect(): void {
  connectToken++; // supersede any pending retry loop
  teardownActive();
  activeProfileId = null;
  lastError = null;
  metaDb.setMeta(ACTIVE_PROFILE_META_KEY, "");
  broadcast({ type: "connection_state", state: getConnectionState() });
}

export function autoConnectOnStartup(): void {
  const raw = metaDb.getMeta(ACTIVE_PROFILE_META_KEY);
  if (!raw) return;
  const id = Number(raw);
  if (!Number.isFinite(id)) return;
  if (!profilesDb.getProfile(id)) return;
  connectProfile(id);
}

function teardownActive(): void {
  if (activeClient) {
    activeClient.close().catch(() => {
      // best-effort
    });
    activeClient = null;
  }
}

function attemptConnect(client: WpsClient, token: number, delay: number): void {
  if (token !== connectToken) return; // superseded by a newer connect/disconnect
  client.open().catch((err) => {
    if (token !== connectToken) return;
    lastError = (err as Error).message;
    broadcast({ type: "connection_state", state: getConnectionState() });
    setTimeout(() => attemptConnect(client, token, Math.min(delay * 2, RETRY_MAX_MS)), delay);
  });
}
