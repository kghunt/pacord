/**
 * Fan-out hub for the browser-facing /ws endpoint. Every connected browser
 * gets every `ServerEvent`; inbound `ClientAction`s are routed to whichever
 * WpsClient is currently active (see connectionManager.ts).
 */
import type { WebSocket } from "ws";
import type { ClientAction, ServerEvent } from "../shared/types.js";
import * as channelsDb from "./db/channels.js";
import * as metaDb from "./db/meta.js";
import { getActiveClient, getConnectionState, disconnect } from "./connectionManager.js";

const sockets = new Set<WebSocket>();
const debugSockets = new Set<WebSocket>();

// ---------------------------------------------------------------------------
// Server-side unread counts — single source of truth across all sessions.
// Keys follow the same convention as the client store:
//   channel post  → "channel:<cid>"
//   direct message → "<callsign>"
// ---------------------------------------------------------------------------
const serverUnread: Record<string, number> = {};

export function incrementUnread(key: string): void {
  serverUnread[key] = (serverUnread[key] ?? 0) + 1;
  broadcast({ type: "unread_counts", counts: { ...serverUnread } });
}

export function clearAllUnread(): void {
  for (const key of Object.keys(serverUnread)) delete serverUnread[key];
  broadcast({ type: "unread_counts", counts: {} });
}

function clearUnread(key: string): void {
  if (!serverUnread[key]) return;
  serverUnread[key] = 0;
  broadcast({ type: "unread_counts", counts: { ...serverUnread } });
}

// Server-side rolling buffer so the frame log shows history from before the
// debug terminal was opened (or before the client connected).
const FRAME_HISTORY_SIZE = 100;
const frameHistory: Array<{ direction: "in" | "out"; frame: string; tsMs: number }> = [];

export function getFrameHistory() {
  return [...frameHistory];
}

export function broadcastDebug(ev: ServerEvent): void {
  if (ev.type === "debug_frame") {
    frameHistory.push({ direction: ev.direction, frame: ev.frame, tsMs: ev.tsMs });
    if (frameHistory.length > FRAME_HISTORY_SIZE) frameHistory.shift();
  }
  const text = JSON.stringify(ev);
  for (const ws of debugSockets) {
    if (ws.readyState === ws.OPEN) ws.send(text);
  }
}

function syncDebugMode(): void {
  getActiveClient()?.setDebug(debugSockets.size > 0);
}

let idleTimer: ReturnType<typeof setTimeout> | null = null;

function cancelIdleTimer() {
  if (idleTimer !== null) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
}

function startIdleTimer() {
  cancelIdleTimer();
  const minutes = metaDb.getMetaNumber("idle_disconnect_minutes", 0);
  if (minutes <= 0) return;
  idleTimer = setTimeout(() => {
    idleTimer = null;
    disconnect();
  }, minutes * 60 * 1000);
}

export function broadcast(ev: ServerEvent): void {
  const text = JSON.stringify(ev);
  for (const ws of sockets) {
    if (ws.readyState === ws.OPEN) {
      ws.send(text);
    }
  }
}

export function attachClient(ws: WebSocket): void {
  cancelIdleTimer();
  sockets.add(ws);
  ws.send(JSON.stringify({ type: "connection_state", state: getConnectionState() } satisfies ServerEvent));
  ws.send(JSON.stringify({ type: "unread_counts", counts: { ...serverUnread } } satisfies ServerEvent));

  ws.on("message", (raw) => {
    let action: ClientAction;
    try {
      action = JSON.parse(raw.toString());
    } catch {
      return;
    }
    handleAction(ws, action).catch((err) => {
      console.error("action failed:", action.type, err);
    });
  });

  ws.on("close", () => {
    sockets.delete(ws);
    debugSockets.delete(ws);
    syncDebugMode();
    if (sockets.size === 0) startIdleTimer();
  });
}

async function handleAction(ws: WebSocket, action: ClientAction): Promise<void> {
  const client = getActiveClient();
  switch (action.type) {
    case "send_message":
      if (!client) throw new Error("not connected");
      await client.sendMessage(action.toCall, action.text, action.replyId);
      break;
    case "edit_message":
      if (!client) throw new Error("not connected");
      await client.editMessage(action.msgId, action.text);
      break;
    case "react_message":
      if (!client) throw new Error("not connected");
      await client.reactMessage(action.msgId, action.emoji, action.add);
      break;
    case "post":
      if (!client) throw new Error("not connected");
      await client.post(action.cid, action.text, {
        replyTs: action.replyTs,
        replyFrom: action.replyFrom,
        atCalls: action.atCalls,
      });
      break;
    case "edit_post":
      if (!client) throw new Error("not connected");
      await client.editPost(action.cid, action.ts, action.text);
      break;
    case "react_post":
      if (!client) throw new Error("not connected");
      await client.reactPost(action.cid, action.ts, action.emoji, action.add);
      break;
    case "subscribe":
      channelsDb.setChannelSubscribed(action.cid, true);
      if (client?.isConnected) await client.subscribe(action.cid, action.lastPost ?? 0);
      break;
    case "unsubscribe":
      channelsDb.setChannelSubscribed(action.cid, false);
      if (client?.isConnected) await client.unsubscribe(action.cid);
      break;
    case "unpause_channel":
      if (!client) throw new Error("not connected");
      await client.unpauseChannel(action.cid, action.postCount);
      break;
    case "request_post_batch":
      if (!client) throw new Error("not connected");
      await client.requestPostBatch(action.cid, action.count);
      break;
    case "request_avatars":
      if (!client) throw new Error("not connected");
      await client.requestAvatars(action.countOnly);
      break;
    case "request_stats":
      if (!client) throw new Error("not connected");
      await client.requestStats();
      break;
    case "mark_read":
      clearUnread(action.key);
      break;
    case "set_debug":
      if (action.enabled) {
        debugSockets.add(ws);
      } else {
        debugSockets.delete(ws);
      }
      syncDebugMode();
      break;
  }
}
