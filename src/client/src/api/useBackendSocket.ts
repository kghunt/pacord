import { useEffect } from "react";
import { connectSocket, onServerEvent } from "./socket";
import { useConnectionStore, displayNameFor } from "../state/connectionStore";
import { useChatStore } from "../state/chatStore";

let audioCtx: AudioContext | null = null;

// ---------------------------------------------------------------------------
// Idle / focus detection
// ---------------------------------------------------------------------------
let lastActivityMs = Date.now();

function recordActivity() {
  lastActivityMs = Date.now();
}

const IDLE_THRESHOLD_MS = 5 * 60 * 1000;

function isUserIdle(): boolean {
  return Date.now() - lastActivityMs > IDLE_THRESHOLD_MS;
}

// Returns true when we should treat the user as "not watching" even if a
// channel is currently open — i.e. the window has lost focus or the user
// hasn't touched the keyboard/mouse for 5 minutes.
function userIsAway(): boolean {
  return document.hidden || !document.hasFocus() || isUserIdle();
}

// Register once at module load — passive so they never block scroll/input.
for (const ev of ["mousemove", "mousedown", "keydown", "touchstart", "scroll"] as const) {
  window.addEventListener(ev, recordActivity, { passive: true });
}

function ping() {
  try {
    if (!audioCtx) audioCtx = new AudioContext();
    if (audioCtx.state === "suspended") audioCtx.resume();
    const ctx = audioCtx;
    const t = ctx.currentTime;
    // Two-note chime: A5 (880 Hz) then C#6 (1109 Hz)
    for (const [i, freq] of [[0, 880], [1, 1109]] as const) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.value = freq;
      const start = t + i * 0.13;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.linearRampToValueAtTime(0.22, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.38);
      osc.start(start);
      osc.stop(start + 0.4);
    }
  } catch {
    // AudioContext unavailable or blocked
  }
}

function notify(title: string, body: string) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  try {
    new Notification(title, { body: body.slice(0, 100), icon: "/icon.svg", badge: "/icon.svg" });
  } catch {
    // Notification constructor unavailable in some contexts (e.g. Firefox private mode)
  }
}

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
            if (ev.row.fromCall !== myCall) {
              const { activeTarget } = useChatStore.getState();
              const isActiveDm = activeTarget?.type === "dm" && activeTarget.peer === peer;
              if (!isActiveDm || userIsAway()) {
                useChatStore.getState().incrementUnread(peer);
                ping();
                notify(displayNameFor(peer), ev.row.body);
              }
            }
          }
          break;
        }
        case "message_batch":
          useChatStore.getState().upsertMessageBatch(ev.rows);
          break;
        case "post":
          useChatStore.getState().upsertPost(ev.row);
          {
            const { activeProfileId } = useConnectionStore.getState().connectionState;
            const myCall = useConnectionStore
              .getState()
              .profiles.find((p) => p.id === activeProfileId)?.myCall.toUpperCase().split("-", 1)[0];
            if (!myCall || ev.row.fromCall !== myCall) {
              const isMention = myCall ? (ev.row.atCalls ?? []).includes(myCall) : false;
              const { activeTarget } = useChatStore.getState();
              const isActiveChannel = activeTarget?.type === "channel" && activeTarget.cid === ev.row.cid;
              if (!isActiveChannel || isMention || userIsAway()) {
                useChatStore.getState().incrementUnread(`channel:${ev.row.cid}`);
                ping();
                const ch = useChatStore.getState().channels.find((c) => c.cid === ev.row.cid);
                notify(`#${ch?.name ?? ev.row.cid}`, `${displayNameFor(ev.row.fromCall)}: ${ev.row.body}`);
              }
            }
          }
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
          useConnectionStore.getState().bumpAvatarVersion(ev.callsign);
          useConnectionStore.getState().recordAvatarReceived();
          break;
      }
    });
    return unsubscribe;
  }, []);
}
