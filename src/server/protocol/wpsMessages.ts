/**
 * Wire-shape interfaces for WPS messages, ported from whatspyc's
 * `wps/messages.py` (KEY_MAP / dataclasses). Only the fields WpsClient
 * actually reads or writes are modeled — WPS is loosely typed enough that
 * over-modeling here would just be busywork the server can't enforce.
 */

export interface WireConnectAck {
  t: "c";
  mc?: number; // msg_count
  pc?: number; // post_count
  w?: number; // welcome
  v?: number; // version
}

export interface WireMessage {
  t: "m";
  _id?: string;
  fc: string;
  tc: string;
  m: string;
  ts: number; // seconds
  r?: string; // reply_id
  ms?: number; // msg_status (server-only on inbound)
  lts?: number; // logged_ts (server-only on inbound)
}

export interface WireMessageBatch {
  t: "mb";
  md?: Record<string, unknown>;
  m: WireMessage[];
}

export interface WireMessageEdit {
  t: "med";
  _id: string;
  m: string;
  edts?: number;
}

export interface WireMessageEditBatch {
  t: "medb";
  med: Array<{ _id: string; m: string; edts: number }>;
}

export interface WireMessageResponse {
  t: "mr";
  _id: string;
}

export interface WireMessageEmoji {
  t: "mem";
  _id: string;
  e: string | string[];
  ets: number;
  a?: number; // action: 1 add, 0 remove
}

export interface WireMessageEmojiBatch {
  t: "memb";
  mem: Array<{ _id: string; e: string[]; ets: number }>;
}

export interface WireChannelPost {
  t: "cp";
  cid: number;
  fc: string;
  ts: number; // ms
  p: string;
  rts?: number;
  rfc?: string;
  at?: string[];
  dts?: number;
  ets?: number;
  e?: Array<{ e: string; c: string[] }>;
}

export interface WireChannelPostBatch {
  t: "cpb";
  cid: number;
  m?: Record<string, unknown>;
  p?: WireChannelPost[];
}

export interface WireChannelPostEdit {
  t: "cped";
  cid: number;
  ts: number;
  p: string;
  edts?: number;
}

export interface WireChannelPostEditBatch {
  t: "cpedb";
  ed: Array<{ cid: number; ts: number; p: string; edts: number }>;
}

export interface WireChannelPostResponse {
  t: "cpr";
  ts: number;
  dts?: number;
}

export interface WireChannelPostEmoji {
  t: "cpem";
  cid: number;
  ts: number;
  ets: number;
  e: string;
  a?: number;
  fc?: string;
}

export interface WireChannelPostEmojiBatch {
  t: "cpemb";
  e: Array<{ cid: number; ts: number; ets: number; e: Array<{ e: string; c: string[] }> }>;
}

export interface WireChannelSubscribeAck {
  t: "cs";
  cid: number;
  s: number; // 1 subscribed, 0 unsubscribed
  pc?: number; // historic post count
}

export interface WirePausedChannelHeaders {
  t: "pch";
  ch: Array<{ cid: number; pt: number }>;
}

export interface WireHamEnquiry {
  t: "he";
  h: Array<{ c: string; n: string; ts: number }>;
}

export interface WireOnlineUsers {
  t: "o";
  o: string[];
}

export interface WireUserConnect {
  t: "uc";
  c: string;
}

export interface WireUserDisconnect {
  t: "ud";
  c: string;
}

export interface WireKeepAlive {
  t: "k";
}
