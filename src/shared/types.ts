// Types shared between the Node backend and the React frontend.
// The backend also has its own wire-protocol types (src/server/protocol/wpsMessages.ts)
// for talking to XRouter/WPS — these are the app-level shapes exchanged between
// the backend and the browser over REST + the /ws channel.

export type Engine = "xrouter" | "bpq" | "custom";
export type Transport = "rhp-ws" | "rhp-tcp" | "direct-tcp";
// "L2" = raw AX.25 (point-to-point / direct link or explicit digipeater
// path via connectScript). "L4" = NET-ROM — routed, lets XRouter's own
// routing tables deliver to a remote destination without a manual hop
// script. Needed when the WPS instance isn't hosted on the node you're
// connecting through.
export type AxLevel = "L2" | "L4";

export interface HopStep {
  cmd: string;
  val: string;
  timeoutMs?: number;
}

export interface ConnectProfile {
  id: number;
  name: string;
  transport: Transport;
  host: string;
  port: number;
  engine: Engine;
  axLevel: AxLevel;
  radioPort: number | null;
  remote: string;
  myCall: string;
  displayName: string;
  authUser: string | null;
  authPass: string | null;
  connectScript: HopStep[];
  // How long to wait for a reply (RHP openReply, or a hop-script step's
  // expected text) before giving up. RF links can be near-instant or take
  // 30-60s depending on conditions, so this needs to be tunable per profile
  // rather than a fixed client-side constant.
  responseTimeoutMs: number;
  // Port for the node's own web admin UI (XrPi/XRouter's built-in
  // /terminal, /nodes, /routes, etc. — separate from the RHP port above).
  // Null hides the in-app Terminal panel for this profile.
  adminPort: number | null;
  isDefault: boolean;
}

export type NewConnectProfile = Omit<ConnectProfile, "id">;

export interface ChannelInfo {
  cid: number;
  name: string;
  description: string;
  subscribed: boolean;
}

export interface ReactionEntry {
  emoji: string;
  callsign: string;
  ts: number;
}

export interface MessageRow {
  msgId: string;
  fromCall: string;
  toCall: string;
  body: string;
  ts: number; // seconds since epoch
  replyId: string | null;
  editTs: number | null;
  deliveredTs: number | null;
  receivedTs: number | null;
  reactions: ReactionEntry[];
}

export interface PostRow {
  cid: number;
  ts: number; // ms since epoch
  fromCall: string;
  body: string;
  replyTs: number | null;
  replyFrom: string | null;
  atCalls: string[];
  editTs: number | null;
  deliveredTs: number | null;
  receivedTs: number | null;
  reactions: ReactionEntry[];
}

export interface HamInfo {
  callsign: string;
  name: string;
  ts: number;
}

export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "error";

export interface ConnectionState {
  status: ConnectionStatus;
  activeProfileId: number | null;
  error: string | null;
  onlineUsers: string[];
  pausedChannels: Record<number, number>;
}

// ---------------------------------------------------------------------------
// Backend -> frontend events (pushed over /ws)
// ---------------------------------------------------------------------------

export type ServerEvent =
  | { type: "connection_state"; state: ConnectionState }
  | { type: "message"; row: MessageRow }
  | { type: "message_batch"; rows: MessageRow[] }
  | { type: "post"; row: PostRow }
  | { type: "post_batch"; cid: number; rows: PostRow[] }
  | { type: "ham"; ham: HamInfo }
  | { type: "channel_subscribed"; cid: number; subscribed: boolean; postCount: number }
  | { type: "paused_channel"; cid: number; pendingCount: number }
  | { type: "avatar_count"; count: number }
  | { type: "avatar"; callsign: string };

// ---------------------------------------------------------------------------
// Frontend -> backend actions (sent over /ws)
// ---------------------------------------------------------------------------

export type ClientAction =
  | { type: "send_message"; toCall: string; text: string; replyId?: string }
  | { type: "edit_message"; msgId: string; text: string }
  | { type: "react_message"; msgId: string; emoji: string; add: boolean }
  | { type: "post"; cid: number; text: string; replyTs?: number; replyFrom?: string; atCalls?: string[] }
  | { type: "edit_post"; cid: number; ts: number; text: string }
  | { type: "react_post"; cid: number; ts: number; emoji: string; add: boolean }
  | { type: "subscribe"; cid: number; lastPost?: number }
  | { type: "unsubscribe"; cid: number }
  | { type: "unpause_channel"; cid: number; postCount: number }
  | { type: "request_post_batch"; cid: number; count: number }
  | { type: "request_avatars"; countOnly: boolean };
