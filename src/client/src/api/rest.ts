import type {
  ChannelInfo,
  ConnectProfile,
  ConnectionState,
  Engine,
  HamInfo,
  MessageRow,
  NewConnectProfile,
  PostRow,
} from "@shared/types";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      // ignore
    }
    throw new Error(message);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const fetchProfiles = () => fetch("/api/profiles").then((r) => json<ConnectProfile[]>(r));

export const fetchProfileDefaults = (engine: Engine) =>
  fetch(`/api/profiles/defaults?engine=${engine}`).then((r) =>
    json<{ port: number | null; remote: string; radioPort: number }>(r)
  );

export const createProfile = (p: NewConnectProfile) =>
  fetch("/api/profiles", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(p),
  }).then((r) => json<ConnectProfile>(r));

export const updateProfile = (id: number, p: NewConnectProfile) =>
  fetch(`/api/profiles/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(p),
  }).then((r) => json<ConnectProfile>(r));

export const deleteProfile = (id: number) =>
  fetch(`/api/profiles/${id}`, { method: "DELETE" }).then((r) => json<void>(r));

export const connectProfile = (id: number) =>
  fetch(`/api/profiles/${id}/connect`, { method: "POST" }).then((r) => json<{ ok: true }>(r));

export const disconnectProfile = () =>
  fetch("/api/disconnect", { method: "POST" }).then((r) => json<{ ok: true }>(r));

export const fetchConnectionState = () => fetch("/api/connection").then((r) => json<ConnectionState>(r));

export const fetchChannels = () => fetch("/api/channels").then((r) => json<ChannelInfo[]>(r));

export const upsertChannel = (cid: number, name: string, description: string) =>
  fetch(`/api/channels/${cid}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, description }),
  }).then((r) => json<ChannelInfo>(r));

export const createChannel = (cid: number, name: string, description: string) =>
  fetch("/api/channels", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cid, name, description }),
  }).then((r) => json<ChannelInfo>(r));

export const deleteChannel = (cid: number) =>
  fetch(`/api/channels/${cid}`, { method: "DELETE" }).then((r) => json<void>(r));

export const fetchPeers = () => fetch("/api/peers").then((r) => json<string[]>(r));

export const fetchMessages = (peer: string) => fetch(`/api/messages/${peer}`).then((r) => json<MessageRow[]>(r));

export const fetchPosts = (cid: number) => fetch(`/api/posts/${cid}`).then((r) => json<PostRow[]>(r));

export const fetchRoster = () => fetch("/api/roster").then((r) => json<{ online: string[]; hams: HamInfo[] }>(r));
