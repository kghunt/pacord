import { create } from "zustand";
import type { ConnectProfile, ConnectionState, HamInfo, NewConnectProfile, WpsStats } from "@shared/types";
import * as api from "../api/rest";

interface ConnectionStore {
  profiles: ConnectProfile[];
  profilesLoaded: boolean;
  connectionState: ConnectionState;
  hams: Record<string, HamInfo>;
  loadProfiles: () => Promise<void>;
  createProfile: (p: NewConnectProfile) => Promise<ConnectProfile>;
  updateProfile: (id: number, p: NewConnectProfile) => Promise<ConnectProfile>;
  deleteProfile: (id: number) => Promise<void>;
  connect: (id: number) => Promise<void>;
  disconnect: () => Promise<void>;
  setConnectionState: (s: ConnectionState) => void;
  upsertHam: (h: HamInfo) => void;
  loadRoster: () => Promise<void>;
  avatarCount: number | null;
  avatarVersions: Record<string, number>;
  // null = no download started this session; a number = actively/previously
  // tracking one, counting how many "avatar" events have arrived since the
  // last time "Download" was clicked. Compared against avatarCount (from
  // the last "Check count") to show real X-of-Y progress.
  avatarsReceived: number | null;
  setAvatarCount: (n: number) => void;
  bumpAvatarVersion: (callsign: string) => void;
  startAvatarDownload: () => void;
  recordAvatarReceived: () => void;
  wpsStats: WpsStats | null;
  setWpsStats: (s: WpsStats) => void;
  welcomeReceived: boolean;
  setWelcomeReceived: (v: boolean) => void;
  resetProfileData: () => void;
}

export const useConnectionStore = create<ConnectionStore>((set) => ({
  profiles: [],
  profilesLoaded: false,
  connectionState: {
    status: "disconnected",
    activeProfileId: null,
    error: null,
    onlineUsers: [],
    pausedChannels: {},
  },
  hams: {},
  avatarCount: null,
  avatarVersions: {},
  avatarsReceived: null,
  wpsStats: null,
  welcomeReceived: false,

  loadProfiles: async () => {
    const profiles = await api.fetchProfiles();
    set({ profiles, profilesLoaded: true });
  },

  createProfile: async (p) => {
    const created = await api.createProfile(p);
    set((s) => ({ profiles: [...s.profiles, created] }));
    return created;
  },

  updateProfile: async (id, p) => {
    const updated = await api.updateProfile(id, p);
    set((s) => ({ profiles: s.profiles.map((x) => (x.id === id ? updated : x)) }));
    return updated;
  },

  deleteProfile: async (id) => {
    await api.deleteProfile(id);
    set((s) => ({ profiles: s.profiles.filter((x) => x.id !== id) }));
  },

  connect: async (id) => {
    await api.connectProfile(id);
  },

  disconnect: async () => {
    await api.disconnectProfile();
  },

  setConnectionState: (s) => set({ connectionState: s }),

  upsertHam: (h) => set((s) => ({ hams: { ...s.hams, [h.callsign]: h } })),

  loadRoster: async () => {
    const roster = await api.fetchRoster();
    const hams: Record<string, HamInfo> = {};
    for (const h of roster.hams) hams[h.callsign] = h;
    set((s) => ({
      hams: { ...hams, ...s.hams },
      connectionState: { ...s.connectionState, onlineUsers: roster.online },
    }));
  },

  setAvatarCount: (n) => set({ avatarCount: n }),
  bumpAvatarVersion: (callsign) =>
    set((s) => ({ avatarVersions: { ...s.avatarVersions, [callsign]: (s.avatarVersions[callsign] ?? 0) + 1 } })),
  startAvatarDownload: () => set({ avatarsReceived: 0 }),
  recordAvatarReceived: () =>
    set((s) => ({ avatarsReceived: s.avatarsReceived === null ? 1 : s.avatarsReceived + 1 })),
  setWpsStats: (stats) => set({ wpsStats: stats }),
  setWelcomeReceived: (v) => set({ welcomeReceived: v }),

  resetProfileData: () =>
    set({
      hams: {},
      avatarVersions: {},
      avatarCount: null,
      avatarsReceived: null,
      wpsStats: null,
      welcomeReceived: false,
    }),
}));

export function displayNameFor(callsign: string): string {
  const hams = useConnectionStore.getState().hams;
  return hams[callsign]?.name || callsign;
}

// "Name, CALLSIGN" — matches WhatsPac's own author display convention.
// Falls back to just the callsign when no name is known for it.
export function fullDisplayFor(callsign: string): string {
  const hams = useConnectionStore.getState().hams;
  const name = hams[callsign]?.name;
  return name ? `${name}, ${callsign}` : callsign;
}
