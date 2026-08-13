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

  setActiveTarget: (t: ChatTarget) => void;
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
}

export const useChatStore = create<ChatStore>((set, get) => ({
  channels: [],
  peers: [],
  messagesByPeer: {},
  postsByChannel: {},
  activeTarget: null,

  setActiveTarget: (t) => set({ activeTarget: t }),

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
}));
