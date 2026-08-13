/**
 * Fan-out hub for the browser-facing /ws endpoint. Every connected browser
 * gets every `ServerEvent`; inbound `ClientAction`s are routed to whichever
 * WpsClient is currently active (see connectionManager.ts).
 */
import type { WebSocket } from "ws";
import type { ClientAction, ServerEvent } from "../shared/types.js";
import * as channelsDb from "./db/channels.js";
import { getActiveClient, getConnectionState } from "./connectionManager.js";

const sockets = new Set<WebSocket>();

export function broadcast(ev: ServerEvent): void {
  const text = JSON.stringify(ev);
  for (const ws of sockets) {
    if (ws.readyState === ws.OPEN) {
      ws.send(text);
    }
  }
}

export function attachClient(ws: WebSocket): void {
  sockets.add(ws);
  ws.send(JSON.stringify({ type: "connection_state", state: getConnectionState() } satisfies ServerEvent));

  ws.on("message", (raw) => {
    let action: ClientAction;
    try {
      action = JSON.parse(raw.toString());
    } catch {
      return;
    }
    handleAction(action).catch((err) => {
      console.error("action failed:", action.type, err);
    });
  });

  ws.on("close", () => {
    sockets.delete(ws);
  });
}

async function handleAction(action: ClientAction): Promise<void> {
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
  }
}
