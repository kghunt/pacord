import { create } from "zustand";
import type { ChannelInfo, MessageRow, PostRow } from "@shared/types";
import * as api from "../api/rest";

export type ChatTarget = { type: "dm"; peer: string } | { type: "channel"; cid: number } | null;

function mergeMessages(existing: MessageRow[], incoming: MessageRow[]): MessageRow[] {
  const byId = new Map(existing.map((m) => [m.msgId, m]));
  for (const m of incoming) byId.set(m.msgId, m);
  return Array.from(byId.values()).sort((a, b) => a.ts - b.ts);
}

function mergePosts(existing: PostRow[], incoming: PostRow[]): PostRow[] {
  const byTs = new Map(existing.map((p) => [p.ts, p]));
  for (const p of incoming) byTs.set(p.ts, p);
  return Array.from(byTs.values()).sort((a, b) => a.ts - b.ts);
}

interface ChatStore {
  channels: ChannelInfo[];
  peers: string[];
  messagesByPeer: Record<string, MessageRow[]>;
  postsByChannel: Record<number, PostRow[]>;
  activeTarget: ChatTarget;
  unreadCounts: Record<string, number>;
  firstUnreadMs: Record<string, number>;
  jumpToKey: string | null;

  setActiveTarget: (t: ChatTarget) => void;
  setJumpToKey: (key: string | null) => void;
  loadChannels: () => Promise<void>;
  setChannels: (channels: ChannelInfo[]) => void;
  loadPeers: () => Promise<void>;
  addPeer: (call: string) => void;
  loadMessages: (peer: string) => Promise<void>;
  loadPosts: (cid: number) => Promise<void>;
  upsertMessage: (row: MessageRow) => void;
  upsertMessageBatch: (rows: MessageRow[]) => void;
  upsertPost: (row: PostRow) => void;
  upsertPostBatch: (cid: number, rows: PostRow[]) => void;
  setServerUnreadCounts: (counts: Record<string, number>) => void;
  recordFirstUnread: (key: string, tsMs: number) => void;
  resetData: () => void;
}

export const useChatStore = create<ChatStore>((set, get) => ({
  channels: [],
  peers: [],
  messagesByPeer: {},
  postsByChannel: {},
  activeTarget: null,
  unreadCounts: {},
  firstUnreadMs: {},
  jumpToKey: null,

  setJumpToKey: (key) => set({ jumpToKey: key }),

  setActiveTarget: (t) => {
    const key = t?.type === "dm" ? t.peer : t?.type === "channel" ? `channel:${t.cid}` : null;
    set((s) => ({
      activeTarget: t,
      unreadCounts: key ? { ...s.unreadCounts, [key]: 0 } : s.unreadCounts,
      firstUnreadMs: key ? { ...s.firstUnreadMs, [key]: 0 } : s.firstUnreadMs,
    }));
  },

  loadChannels: async () => {
    const channels = await api.fetchChannels();
    set({ channels });
  },

  setChannels: (channels) => set({ channels }),

  loadPeers: async () => {
    const peers = await api.fetchPeers();
    set({ peers });
  },

  addPeer: (call) =>
    set((s) => (s.peers.includes(call) ? s : { peers: [...s.peers, call].sort() })),

  loadMessages: async (peer) => {
    const rows = await api.fetchMessages(peer);
    set((s) => ({ messagesByPeer: { ...s.messagesByPeer, [peer]: mergeMessages(s.messagesByPeer[peer] ?? [], rows) } }));
  },

  loadPosts: async (cid) => {
    const rows = await api.fetchPosts(cid);
    set((s) => ({ postsByChannel: { ...s.postsByChannel, [cid]: mergePosts(s.postsByChannel[cid] ?? [], rows) } }));
  },

  upsertMessage: (row) => {
    set((s) => {
      // The peer key is whichever side of the DM isn't "us" — but the store
      // doesn't know our callsign, so callers key by the *other* party.
      // We instead key by both possible parties so lookups from either
      // direction find the row; App.tsx picks the peer key when routing.
      const peerKeys = [row.fromCall, row.toCall];
      const next = { ...s.messagesByPeer };
      for (const key of peerKeys) {
        next[key] = mergeMessages(next[key] ?? [], [row]);
      }
      return { messagesByPeer: next };
    });
  },

  upsertMessageBatch: (rows) => {
    for (const row of rows) get().upsertMessage(row);
  },

  upsertPost: (row) =>
    set((s) => ({
      postsByChannel: { ...s.postsByChannel, [row.cid]: mergePosts(s.postsByChannel[row.cid] ?? [], [row]) },
    })),

  upsertPostBatch: (cid, rows) =>
    set((s) => ({
      postsByChannel: { ...s.postsByChannel, [cid]: mergePosts(s.postsByChannel[cid] ?? [], rows) },
    })),

  // Apply the server's authoritative counts. The local zero for the currently
  // active target wins over the broadcast so we don't flicker a badge back
  // while mark_read is in flight. Keys for targets no longer active are not
  // preserved — if a new post arrives after navigating away the server count
  // correctly shows the badge.
  setServerUnreadCounts: (counts) =>
    set((s) => {
      const activeKey =
        s.activeTarget?.type === "dm"
          ? s.activeTarget.peer
          : s.activeTarget?.type === "channel"
            ? `channel:${s.activeTarget.cid}`
            : null;
      const localZeros =
        activeKey !== null && s.unreadCounts[activeKey] === 0
          ? { [activeKey]: 0 }
          : {};
      const merged = { ...counts, ...localZeros };
      // Seed firstUnreadMs for newly-discovered unread keys.
      const firstUnreadMs = { ...s.firstUnreadMs };
      for (const [key, count] of Object.entries(merged)) {
        if (count > 0 && !firstUnreadMs[key]) firstUnreadMs[key] = Date.now();
        else if (count === 0) firstUnreadMs[key] = 0;
      }
      return { unreadCounts: merged, firstUnreadMs };
    }),

  recordFirstUnread: (key, tsMs) =>
    set((s) =>
      s.firstUnreadMs[key]
        ? s
        : { firstUnreadMs: { ...s.firstUnreadMs, [key]: tsMs } }
    ),

  resetData: () =>
    set({
      channels: [],
      peers: [],
      messagesByPeer: {},
      postsByChannel: {},
      activeTarget: null,
      unreadCounts: {},
      firstUnreadMs: {},
      jumpToKey: null,
    }),
}));
