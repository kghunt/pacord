import { useEffect } from "react";
import { connectSocket, onServerEvent } from "./socket";
import { useConnectionStore } from "../state/connectionStore";
import { useChatStore } from "../state/chatStore";

/** Opens the shared backend WebSocket once and fans out ServerEvents into
 * the zustand stores. Mount once near the app root. */
export function useBackendSocket(): void {
  useEffect(() => {
    connectSocket();
    const unsubscribe = onServerEvent((ev) => {
      switch (ev.type) {
        case "connection_state":
          useConnectionStore.getState().setConnectionState(ev.state);
          break;
        case "message": {
          useChatStore.getState().upsertMessage(ev.row);
          const { activeProfileId } = useConnectionStore.getState().connectionState;
          const myCall = useConnectionStore
            .getState()
            .profiles.find((p) => p.id === activeProfileId)?.myCall.toUpperCase().split("-", 1)[0];
          if (myCall) {
            const peer = ev.row.fromCall === myCall ? ev.row.toCall : ev.row.fromCall;
            useChatStore.getState().addPeer(peer);
          }
          break;
        }
        case "message_batch":
          useChatStore.getState().upsertMessageBatch(ev.rows);
          break;
        case "post":
          useChatStore.getState().upsertPost(ev.row);
          break;
        case "post_batch":
          useChatStore.getState().upsertPostBatch(ev.cid, ev.rows);
          break;
        case "ham":
          useConnectionStore.getState().upsertHam(ev.ham);
          break;
        case "channel_subscribed":
          useChatStore.getState().setChannels(
            useChatStore
              .getState()
              .channels.map((c) => (c.cid === ev.cid ? { ...c, subscribed: ev.subscribed } : c))
          );
          break;
        case "paused_channel":
          // Surfaced via connection_state.pausedChannels already broadcast
          // alongside; nothing additional to store here.
          break;
        case "avatar_count":
          useConnectionStore.getState().setAvatarCount(ev.count);
          break;
        case "avatar":
          // Bumps a cache-busting counter so <img> tags for this callsign
          // (and any other) re-fetch instead of showing a stale 404 — this
          // is what makes avatars appear on messages immediately as each
          // one arrives, rather than waiting for the whole batch.
          useConnectionStore.getState().bumpAvatarVersion();
          useConnectionStore.getState().recordAvatarReceived();
          break;
      }
    });
    return unsubscribe;
  }, []);
}
