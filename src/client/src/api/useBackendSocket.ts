import { useEffect } from "react";
import { connectSocket, onServerEvent, onSocketOpen, sendAction } from "./socket";
import { useConnectionStore, displayNameFor } from "../state/connectionStore";
import { useChatStore } from "../state/chatStore";

// ---------------------------------------------------------------------------
// Persistent rolling frame buffer — kept alive regardless of whether the
// debug modal is open, so you can always inspect the last 100 frames.
// ---------------------------------------------------------------------------
export interface DebugFrame {
  id: number;
  direction: "in" | "out";
  frame: string;
  tsMs: number;
}

const DEBUG_BUFFER_SIZE = 100;
let _debugSeq = 0;
export const debugFrameBuffer: DebugFrame[] = [];
const _debugListeners = new Set<() => void>();

export function onDebugBufferChange(fn: () => void): () => void {
  _debugListeners.add(fn);
  return () => _debugListeners.delete(fn);
}

function pushDebugFrame(f: Omit<DebugFrame, "id">): void {
  debugFrameBuffer.push({ ...f, id: _debugSeq++ });
  if (debugFrameBuffer.length > DEBUG_BUFFER_SIZE) debugFrameBuffer.shift();
  _debugListeners.forEach((fn) => fn());
}

// Seed the buffer with server-side history, prepending frames that predate
// whatever the client already received. Frames that overlap (same tsMs AND
// frame content) are deduplicated.
export function seedDebugFrames(
  serverFrames: Array<{ direction: "in" | "out"; frame: string; tsMs: number }>
): void {
  const existingKeys = new Set(debugFrameBuffer.map((f) => `${f.tsMs}:${f.frame}`));
  const toAdd = serverFrames.filter((f) => !existingKeys.has(`${f.tsMs}:${f.frame}`));
  if (toAdd.length === 0) return;
  const merged = [
    ...toAdd.map((f) => ({ ...f, id: _debugSeq++ })),
    ...debugFrameBuffer,
  ].slice(-DEBUG_BUFFER_SIZE);
  debugFrameBuffer.length = 0;
  debugFrameBuffer.push(...merged);
  _debugListeners.forEach((fn) => fn());
}

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
  // document.hasFocus() is omitted — it's unreliable on mobile (returns false
  // when the virtual keyboard is open, even though the user is actively typing).
  return document.hidden || isUserIdle();
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
    // Enable debug mode every time the socket (re)opens — sendAction drops
    // messages silently while the socket is still in CONNECTING state, so
    // sending here rather than immediately after connectSocket() is required.
    const unsubOpen = onSocketOpen(() => sendAction({ type: "set_debug", enabled: true }));
    const unsubscribe = onServerEvent((ev) => {
      if (ev.type === "debug_frame") {
        pushDebugFrame({ direction: ev.direction, frame: ev.frame, tsMs: ev.tsMs });
        return;
      }
      switch (ev.type) {
        case "connection_state": {
          const prevProfileId = useConnectionStore.getState().connectionState.activeProfileId;
          useConnectionStore.getState().setConnectionState(ev.state);
          if (ev.state.activeProfileId !== prevProfileId) {
            useChatStore.getState().resetData();
            useConnectionStore.getState().resetProfileData();
          }
          break;
        }
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
              if (isActiveDm && !userIsAway()) {
                // Viewing this DM — tell the server so all sessions clear the badge.
                sendAction({ type: "mark_read", key: peer });
              } else {
                useChatStore.getState().recordFirstUnread(peer, ev.row.ts * 1000);
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
              if (isActiveChannel && !isMention && !userIsAway()) {
                // Viewing this channel — tell the server so all sessions clear the badge.
                sendAction({ type: "mark_read", key: `channel:${ev.row.cid}` });
              } else {
                useChatStore.getState().recordFirstUnread(`channel:${ev.row.cid}`, ev.row.ts);
                ping();
                const ch = useChatStore.getState().channels.find((c) => c.cid === ev.row.cid);
                notify(`#${ch?.name ?? ev.row.cid}`, `${displayNameFor(ev.row.fromCall)}: ${ev.row.body}`);
              }
            }
          }
          break;
        case "unread_counts":
          useChatStore.getState().setServerUnreadCounts(ev.counts);
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
        case "wps_stats":
          useConnectionStore.getState().setWpsStats(ev.stats);
          break;
        case "welcome":
          useConnectionStore.getState().setWelcomeReceived(true);
          break;
      }
    });
    return () => { unsubscribe(); unsubOpen(); };
  }, []);
}
