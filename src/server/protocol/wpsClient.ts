/**
 * High-level WPS application client — ported from whatspyc's `wps/client.py`.
 * Owns a transport, runs the connect handshake, reads/dispatches inbound
 * frames, and exposes send helpers. Writes go straight to SQLite; every
 * dispatched event is also re-emitted as a `ServerEvent` for the backend to
 * broadcast to connected browsers.
 */
import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import type { ConnectProfile, ServerEvent, ReactionEntry } from "../../shared/types.js";
import { emojiToWire } from "../../shared/emoji.js";
import { RhpWebSocketTransport } from "./rhpWebSocket.js";
import { RhpTcpTransport } from "./rhpTcp.js";
import type { ByteStreamTransport } from "./transport.js";
import { runConnectScript, type HopStep } from "./hopScript.js";
import { FrameDecoder } from "./wpsCodec.js";
import * as codec from "./wpsCodec.js";
import * as messagesDb from "../db/messages.js";
import * as postsDb from "../db/posts.js";
import * as hamsDb from "../db/hams.js";
import * as metaDb from "../db/meta.js";
import * as channelsDb from "../db/channels.js";
import * as avatarsDb from "../db/avatars.js";

const CLIENT_VERSION = 0.92;
const KEEPALIVE_INTERVAL_MS = 9 * 60 * 1000;
const AUTO_BACKFILL_POST_COUNT = 50;
const RECONNECT_INITIAL_MS = 2000;
const RECONNECT_MAX_MS = 60_000;
// A handshake "succeeding" only means we sent our connect record — on a
// flaky RF link the underlying circuit can still die seconds later with no
// real data ever having arrived. Only trust a connection enough to reset
// the backoff once it's stayed up this long; otherwise a link that keeps
// briefly opening and dying repeats at the fast initial delay forever
// instead of backing off, hammering the radio.
const RECONNECT_STABILITY_MS = 15_000;

export class WpsClient extends EventEmitter {
  private profile: ConnectProfile;
  private stream: ByteStreamTransport | null = null;
  private decoder = new FrameDecoder();
  private readerLoopPromise: Promise<void> | null = null;
  private keepaliveTimer: ReturnType<typeof setInterval> | null = null;
  private closed = false;
  private connected = false;
  private online = new Set<string>();
  private pausedChannels = new Map<number, number>();
  private reconnectDelay = RECONNECT_INITIAL_MS;
  private reconnecting = false;
  private stabilityTimer: ReturnType<typeof setTimeout> | null = null;
  private debugEnabled = false;

  setDebug(enabled: boolean): void {
    this.debugEnabled = enabled;
  }

  constructor(profile: ConnectProfile) {
    super();
    this.profile = profile;
  }

  get isConnected(): boolean {
    return this.connected && !this.closed;
  }

  // WPS strips any SSID off the callsign after the initial handshake — the
  // user's identity inside the *application* layer (connect record, message
  // fc/tc, reaction attribution, self-comparisons in dispatch) is always
  // bare, even though the RHP/AX.25 *link* layer keeps the full SSID-bearing
  // form (used for `local` in the OPEN). Every WPS-layer site below must use
  // this, not the raw profile callsign, or messages/reactions we send show
  // up under e.g. "M7KGH-2" instead of "M7KGH" — mismatching every other
  // client on the network and breaking ham-directory name lookups.
  private get appCall(): string {
    return this.profile.myCall.toUpperCase().split("-", 1)[0]!;
  }

  get onlineUsers(): string[] {
    return Array.from(this.online).sort();
  }

  get pausedChannelsSnapshot(): Record<number, number> {
    return Object.fromEntries(this.pausedChannels);
  }

  async open(): Promise<void> {
    this.closed = false;
    await this.handshake();
    this.readerLoopPromise = this.readerLoop();
    this.spawnKeepalive();
  }

  async close(): Promise<void> {
    this.closed = true;
    this.connected = false;
    if (this.stabilityTimer) {
      clearTimeout(this.stabilityTimer);
      this.stabilityTimer = null;
    }
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
    if (this.stream) {
      try {
        // Tell WPS we're leaving cleanly so it marks us offline immediately
        // rather than waiting for the keepalive timeout to expire.
        await this.stream.send(codec.encode({ t: "cd" }));
      } catch {
        // best-effort — stream may already be dead
      }
      try {
        await this.stream.close();
      } catch {
        // best-effort
      }
      this.stream = null;
    }
    if (this.readerLoopPromise) {
      try {
        await this.readerLoopPromise;
      } catch {
        // reported via events already
      }
    }
  }

  private emitEvent(ev: ServerEvent): void {
    this.emit("event", ev);
  }

  private emitConnectionState(status: "connecting" | "connected" | "disconnected" | "reconnecting" | "error", error: string | null = null): void {
    this.emitEvent({
      type: "connection_state",
      state: {
        status,
        activeProfileId: this.profile.id,
        error,
        onlineUsers: this.onlineUsers,
        pausedChannels: this.pausedChannelsSnapshot,
      },
    });
  }

  private buildTransport(): ByteStreamTransport {
    const p = this.profile;
    const cfg = {
      pfam: p.axLevel === "L4" ? ("netrom" as const) : ("ax25" as const),
      local: p.myCall.toUpperCase(),
      remote: p.remote,
      port: p.radioPort,
      authUser: p.authUser,
      authPass: p.authPass,
      responseTimeoutMs: p.responseTimeoutMs,
    };
    switch (p.transport) {
      case "rhp-ws":
        return new RhpWebSocketTransport(p.host, p.port, cfg);
      case "rhp-tcp":
        return new RhpTcpTransport(p.host, p.port, cfg);
      default:
        throw new Error(`transport ${p.transport} is not implemented`);
    }
  }

  private async handshake(): Promise<void> {
    this.emitConnectionState("connecting");
    this.decoder = new FrameDecoder();
    this.online.clear();
    this.pausedChannels.clear();
    const stream = this.buildTransport();
    try {
      await stream.open();
      if (this.profile.connectScript.length > 0) {
        await runConnectScript(stream, this.profile.connectScript as HopStep[], undefined, this.profile.responseTimeoutMs);
      }
      if (!stream.injectsCallsign) {
        await stream.send(Buffer.from(`${this.profile.myCall.toUpperCase()}\r\n`, "utf-8"));
      }
      const record = {
        t: "c",
        n: this.profile.displayName,
        c: this.appCall,
        lm: metaDb.getMetaNumber("last_message", 0),
        le: metaDb.getMetaNumber("last_emoji", 0),
        led: metaDb.getMetaNumber("last_edit", 0),
        lhts: metaDb.getMetaNumber("last_ham_ts", 0),
        v: CLIENT_VERSION,
      };
      await stream.send(codec.encode(record));
    } catch (exc) {
      try {
        await stream.close();
      } catch {
        // ignore
      }
      throw exc;
    }
    this.stream = stream;
    this.connected = true;
    this.emitConnectionState("connected");
    // Re-subscribe to every channel the user has previously subscribed to —
    // WPS doesn't remember subscriptions across connections. lastPost is
    // the newest post ts we already have locally, so the server only
    // backfills what we're missing.
    for (const ch of channelsDb.listChannels()) {
      if (ch.subscribed) {
        const rows = postsDb.listPostsForChannel(ch.cid, 1);
        const lastPost = rows.length > 0 ? rows[rows.length - 1]!.ts : 0;
        await this.subscribe(ch.cid, lastPost);
      }
    }
  }

  // ------------------------------------------------------------------
  // Outgoing
  // ------------------------------------------------------------------

  private async send(obj: Record<string, unknown>): Promise<void> {
    if (!this.stream || !this.connected) {
      throw new Error("not connected");
    }
    if (this.debugEnabled) {
      this.emitEvent({ type: "debug_frame", direction: "out", frame: JSON.stringify(obj), tsMs: Date.now() });
    }
    await this.stream.send(codec.encode(obj));
  }

  async sendMessage(toCall: string, text: string, replyId?: string): Promise<string> {
    const nowMs = Date.now();
    const ts = Math.floor(nowMs / 1000);
    const msgId = `${nowMs}-${this.profile.myCall.toUpperCase()}`;
    const body: Record<string, unknown> = {
      t: "m",
      _id: msgId,
      fc: this.appCall,
      tc: toCall.toUpperCase(),
      m: text,
      ts,
      ms: 0,
    };
    if (replyId) body.r = replyId;
    await this.send(body);
    const row = messagesDb.upsertMessage({
      msgId,
      fromCall: this.appCall,
      toCall: toCall.toUpperCase(),
      body: text,
      ts,
      replyId: replyId ?? null,
    });
    this.emitEvent({ type: "message", row });
    return msgId;
  }

  async post(cid: number, text: string, opts?: { replyTs?: number; replyFrom?: string; atCalls?: string[] }): Promise<number> {
    const ts = Date.now();
    const body: Record<string, unknown> = { t: "cp", cid, fc: this.appCall, ts, p: text };
    if (opts?.replyTs) body.rts = opts.replyTs;
    if (opts?.replyFrom) body.rfc = opts.replyFrom.toUpperCase();
    if (opts?.atCalls?.length) body.at = opts.atCalls.map((c) => c.toUpperCase());
    await this.send(body);
    const row = postsDb.upsertPost({
      cid,
      ts,
      fromCall: this.appCall,
      body: text,
      replyTs: opts?.replyTs ?? null,
      replyFrom: opts?.replyFrom?.toUpperCase() ?? null,
      atCalls: opts?.atCalls ?? null,
    });
    this.emitEvent({ type: "post", row });
    return ts;
  }

  async subscribe(cid: number, lastPost = 0): Promise<void> {
    await this.send({ t: "cs", s: 1, cid, lcp: lastPost });
  }

  async unsubscribe(cid: number): Promise<void> {
    await this.send({ t: "cs", s: 0, cid, lcp: 0 });
  }

  async unpauseChannel(cid: number, postCount: number): Promise<void> {
    await this.send({ t: "cu", cid, pc: postCount });
    this.pausedChannels.delete(cid);
  }

  async requestPostBatch(cid: number, postCount: number): Promise<void> {
    await this.send({ t: "cpb", cid, pc: postCount });
  }

  // Avatar images are large (many KB) and this server sends them as one
  // continuous compressed frame per avatar — over a slow RF link that can
  // take a long time. countOnly=true just asks "how many are pending?"
  // (cheap); the full fetch pulls every avatar updated since our stored
  // cursor, so a repeat request only pulls what's new.
  async requestAvatars(countOnly: boolean): Promise<void> {
    const body: Record<string, unknown> = { t: "ae", lats: metaDb.getMetaNumber("last_avatar_ts", 0) };
    if (countOnly) body.co = 1;
    await this.send(body);
  }

  async editMessage(msgId: string, newText: string): Promise<void> {
    const edts = Date.now();
    await this.send({ t: "med", _id: msgId, m: newText, edts });
    messagesDb.applyMessageEdit(msgId, newText, edts);
    metaDb.bumpMeta("last_edit", edts);
    const row = messagesDb.lookupMessageRow(msgId);
    if (row) this.emitEvent({ type: "message", row });
  }

  async editPost(cid: number, ts: number, newText: string): Promise<void> {
    const edts = Date.now();
    await this.send({ t: "cped", cid, ts, p: newText, edts });
    postsDb.applyPostEdit(cid, ts, newText, edts);
    metaDb.bumpMeta("last_edit", edts);
    const row = postsDb.lookupPost(cid, ts);
    if (row) this.emitEvent({ type: "post", row });
  }

  async reactMessage(msgId: string, emoji: string, add: boolean): Promise<void> {
    const wire = emojiToWire(emoji);
    const ets = Math.floor(Date.now() / 1000);
    await this.send({ t: "mem", a: add ? 1 : 0, _id: msgId, e: wire, ets });
    // WPS doesn't echo DM reactions back to the sender — apply locally.
    if (add) {
      messagesDb.upsertMessageEmoji(msgId, wire, this.appCall, ets);
    } else {
      messagesDb.removeMessageEmoji(msgId, wire, this.appCall);
      metaDb.bumpMeta("last_emoji", ets);
    }
    const row = messagesDb.lookupMessageRow(msgId);
    if (row) this.emitEvent({ type: "message", row });
  }

  async reactPost(cid: number, ts: number, emoji: string, add: boolean): Promise<void> {
    const wire = emojiToWire(emoji);
    const ets = Math.floor(Date.now() / 1000);
    await this.send({ t: "cpem", a: add ? 1 : 0, ts, cid, ets, e: wire });
    if (add) {
      postsDb.upsertPostEmoji(cid, ts, wire, this.appCall, ets);
    } else {
      postsDb.removePostEmoji(cid, ts, wire, this.appCall);
    }
    const row = postsDb.lookupPost(cid, ts);
    if (row) this.emitEvent({ type: "post", row });
  }

  async sendAvatar(imageBase64: string): Promise<void> {
    // WPS expects the 16-byte MD5 hash of the image prepended to the payload —
    // the same prefix it adds to outbound avatar frames. Without it, WPS treats
    // the first 16 bytes of the JPEG as the hash, strips them, and distributes
    // a truncated (corrupted) image to other clients.
    const imageBytes = Buffer.from(imageBase64, "base64");
    const md5 = createHash("md5").update(imageBytes).digest();
    const withPrefix = Buffer.concat([md5, imageBytes]);
    const ts = Date.now();
    await this.send({ t: "a", a: withPrefix.toString("base64"), ts });
    // WPS sends "ar" (ack) back to the uploader, not "a", so we would never
    // receive our own avatar back. Store it locally immediately.
    avatarsDb.upsertAvatar(this.appCall, withPrefix.toString("base64"), ts);
    this.emitEvent({ type: "avatar", callsign: this.appCall });
  }

  async keepAlive(): Promise<void> {
    await this.send({ t: "k" });
  }

  // ------------------------------------------------------------------
  // Reader / dispatch
  // ------------------------------------------------------------------

  private spawnKeepalive(): void {
    if (this.keepaliveTimer) return;
    this.keepaliveTimer = setInterval(() => {
      if (!this.connected || this.closed) return;
      this.keepAlive().catch(() => {
        // link loss will surface via the reader loop
      });
    }, KEEPALIVE_INTERVAL_MS);
  }

  private async readerLoop(): Promise<void> {
    try {
      while (!this.closed) {
        if (!this.stream) return;
        const chunk = await this.stream.recv();
        if (chunk.length === 0) {
          await this.handleLinkLoss("eof");
          return;
        }
        let objs: unknown[];
        try {
          objs = this.decoder.feed(chunk);
        } catch (exc) {
          await this.handleLinkLoss(`decode error: ${(exc as Error).message}`);
          return;
        }
        for (const obj of objs) {
          if (this.debugEnabled) {
            this.emitEvent({ type: "debug_frame", direction: "in", frame: JSON.stringify(obj), tsMs: Date.now() });
          }
          this.dispatch(obj as Record<string, unknown>);
        }
      }
    } catch (exc) {
      await this.handleLinkLoss((exc as Error).message);
    }
  }

  private async handleLinkLoss(reason: string): Promise<void> {
    if (this.closed) return;
    this.connected = false;
    if (this.stabilityTimer) {
      // Didn't stay up long enough to be trusted — the pending backoff
      // reset never fires, so the next retry waits longer, not the same
      // fast initial delay.
      clearTimeout(this.stabilityTimer);
      this.stabilityTimer = null;
    }
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
    if (this.stream) {
      try {
        await this.stream.close();
      } catch {
        // ignore
      }
      this.stream = null;
    }
    this.emitConnectionState("disconnected", reason);
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.closed || this.reconnecting) return;
    this.reconnecting = true;
    const delay = this.reconnectDelay;
    this.emitConnectionState("reconnecting");
    setTimeout(() => {
      this.reconnecting = false;
      if (this.closed) return;
      this.handshake()
        .then(() => {
          this.readerLoopPromise = this.readerLoop();
          this.spawnKeepalive();
          if (this.stabilityTimer) clearTimeout(this.stabilityTimer);
          this.stabilityTimer = setTimeout(() => {
            this.stabilityTimer = null;
            this.reconnectDelay = RECONNECT_INITIAL_MS;
          }, RECONNECT_STABILITY_MS);
        })
        .catch(() => {
          this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
          this.scheduleReconnect();
        });
    }, delay);
  }

  private nowMs(): number {
    return Date.now();
  }

  private selfDeliveredTs(ts: unknown): number {
    if (typeof ts === "number") {
      return ts < 1_000_000_000_000 ? ts * 1000 : ts;
    }
    return this.nowMs();
  }

  private dispatch(obj: Record<string, unknown>): void {
    const t = obj.t as string | undefined;
    const myCall = this.appCall;
    switch (t) {
      case "c": {
        // Connect ack — informational only (msg/post counts, welcome flag).
        break;
      }
      case "m": {
        const fromCall = String(obj.fc ?? "").toUpperCase();
        const ts = Number(obj.ts ?? 0);
        const msgId = String(obj._id ?? `${ts}-${fromCall}`);
        const row = messagesDb.upsertMessage({
          msgId,
          fromCall,
          toCall: String(obj.tc ?? "").toUpperCase(),
          body: String(obj.m ?? ""),
          ts,
          replyId: (obj.r as string | undefined) ?? null,
          deliveredTs: fromCall === myCall ? this.selfDeliveredTs(ts) : null,
          receivedTs: fromCall === myCall ? null : this.nowMs(),
        });
        metaDb.bumpMeta("last_message", ts);
        // Acknowledge receipt to the sender so their delivery tick updates.
        if (fromCall !== myCall) {
          this.send({ t: "mr", _id: msgId }).catch(() => {});
        }
        this.emitEvent({ type: "message", row });
        break;
      }
      case "mb": {
        const arr = (obj.m as Array<Record<string, unknown>>) ?? [];
        let highestTs = 0;
        const rows = arr.map((m) => {
          const fromCall = String(m.fc ?? "").toUpperCase();
          const ts = Number(m.ts ?? 0);
          if (ts > highestTs) highestTs = ts;
          return messagesDb.upsertMessage({
            msgId: String(m._id ?? `${ts}-${fromCall}`),
            fromCall,
            toCall: String(m.tc ?? "").toUpperCase(),
            body: String(m.m ?? ""),
            ts,
            replyId: (m.r as string | undefined) ?? null,
            deliveredTs: fromCall === myCall ? this.selfDeliveredTs(ts) : null,
            receivedTs: fromCall === myCall ? null : this.nowMs(),
          });
        });
        if (highestTs) metaDb.bumpMeta("last_message", highestTs);
        if (rows.length) this.emitEvent({ type: "message_batch", rows });
        break;
      }
      case "med": {
        const msgId = obj._id as string | undefined;
        const body = obj.m as string | undefined;
        if (!msgId || body === undefined) break;
        const edts = typeof obj.edts === "number" ? obj.edts : this.nowMs();
        messagesDb.applyMessageEdit(msgId, body, edts);
        metaDb.bumpMeta("last_edit", edts);
        const row = messagesDb.lookupMessageRow(msgId);
        if (row) this.emitEvent({ type: "message", row });
        break;
      }
      case "medb": {
        const arr = (obj.med as Array<Record<string, unknown>>) ?? [];
        let highest = 0;
        for (const m of arr) {
          const msgId = m._id as string | undefined;
          const body = m.m as string | undefined;
          const edts = m.edts as number | undefined;
          if (!msgId || body === undefined || typeof edts !== "number") continue;
          messagesDb.applyMessageEdit(msgId, body, edts);
          if (edts > highest) highest = edts;
          const row = messagesDb.lookupMessageRow(msgId);
          if (row) this.emitEvent({ type: "message", row });
        }
        if (highest) metaDb.bumpMeta("last_edit", highest);
        break;
      }
      case "mr": {
        const msgId = obj._id as string | undefined;
        if (msgId) {
          messagesDb.markMessageDelivered(msgId, this.nowMs());
          const row = messagesDb.lookupMessageRow(msgId);
          if (row) this.emitEvent({ type: "message", row });
        }
        break;
      }
      case "mem": {
        const msgId = obj._id as string | undefined;
        const ets = obj.ets as number | undefined;
        if (!msgId || typeof ets !== "number") break;
        const e = obj.e;
        const emojis = Array.isArray(e) ? (e as string[]) : typeof e === "string" ? [e] : [];
        const row = messagesDb.lookupMessageRow(msgId);
        if (!row) break;
        const peer = row.fromCall === myCall ? row.toCall : row.fromCall;
        messagesDb.applyMessageEmojiList(msgId, peer, emojis, ets);
        metaDb.bumpMeta("last_emoji", ets);
        const updated = messagesDb.lookupMessageRow(msgId);
        if (updated) this.emitEvent({ type: "message", row: updated });
        break;
      }
      case "memb": {
        const arr = (obj.mem as Array<Record<string, unknown>>) ?? [];
        let highest = 0;
        for (const entry of arr) {
          const msgId = entry._id as string | undefined;
          const ets = entry.ets as number | undefined;
          const e = (entry.e as string[]) ?? [];
          if (!msgId || typeof ets !== "number") continue;
          const row = messagesDb.lookupMessageRow(msgId);
          if (!row) continue;
          const peer = row.fromCall === myCall ? row.toCall : row.fromCall;
          messagesDb.applyMessageEmojiList(msgId, peer, e, ets);
          if (ets > highest) highest = ets;
          const updated = messagesDb.lookupMessageRow(msgId);
          if (updated) this.emitEvent({ type: "message", row: updated });
        }
        if (highest) metaDb.bumpMeta("last_emoji", highest);
        break;
      }
      case "cp": {
        const cid = obj.cid as number;
        const fromCall = String(obj.fc ?? "").toUpperCase();
        const row = postsDb.upsertPost({
          cid,
          ts: Number(obj.ts ?? 0),
          fromCall,
          body: String(obj.p ?? ""),
          replyTs: (obj.rts as number | undefined) ?? null,
          replyFrom: (obj.rfc as string | undefined) ?? null,
          atCalls: (obj.at as string[] | undefined) ?? null,
          deliveredTs: fromCall === myCall ? this.selfDeliveredTs(obj.ts) : null,
          receivedTs: fromCall === myCall ? null : this.nowMs(),
        });
        this.emitEvent({ type: "post", row });
        break;
      }
      case "cpb": {
        const cid = obj.cid as number | undefined;
        if (cid === undefined) break;
        const arr = (obj.p as Array<Record<string, unknown>>) ?? [];
        const rows = arr.map((p) => {
          const fromCall = String(p.fc ?? "").toUpperCase();
          const row = postsDb.upsertPost({
            cid,
            ts: Number(p.ts ?? 0),
            fromCall,
            body: String(p.p ?? ""),
            replyTs: (p.rts as number | undefined) ?? null,
            replyFrom: (p.rfc as string | undefined) ?? null,
            atCalls: (p.at as string[] | undefined) ?? null,
            deliveredTs: fromCall === myCall ? this.selfDeliveredTs(p.ts) : null,
            receivedTs: fromCall === myCall ? null : this.nowMs(),
          });
          // cpb rows may carry inline current reaction state.
          const ts = p.ts as number | undefined;
          const ets = p.ets as number | undefined;
          const e = p.e as Array<{ e: string; c: string[] }> | undefined;
          if (typeof ts === "number" && typeof ets === "number") {
            postsDb.applyPostEmojiBatch(cid, ts, e ?? [], ets);
          }
          return postsDb.lookupPost(cid, row.ts) ?? row;
        });
        if (rows.length) this.emitEvent({ type: "post_batch", cid, rows });
        break;
      }
      case "cped": {
        const cid = obj.cid as number | undefined;
        const ts = obj.ts as number | undefined;
        const body = obj.p as string | undefined;
        if (cid === undefined || ts === undefined || body === undefined) break;
        const edts = typeof obj.edts === "number" ? obj.edts : this.nowMs();
        postsDb.applyPostEdit(cid, ts, body, edts);
        const row = postsDb.lookupPost(cid, ts);
        if (row) this.emitEvent({ type: "post", row });
        break;
      }
      case "cpedb": {
        const arr = (obj.ed as Array<Record<string, unknown>>) ?? [];
        for (const entry of arr) {
          const cid = entry.cid as number | undefined;
          const ts = entry.ts as number | undefined;
          const body = entry.p as string | undefined;
          const edts = entry.edts as number | undefined;
          if (cid === undefined || ts === undefined || body === undefined || typeof edts !== "number") continue;
          postsDb.applyPostEdit(cid, ts, body, edts);
          const row = postsDb.lookupPost(cid, ts);
          if (row) this.emitEvent({ type: "post", row });
        }
        break;
      }
      case "cpr": {
        const ts = obj.ts as number | undefined;
        const dts = obj.dts as number | undefined;
        if (typeof ts !== "number") break;
        const deliveredTs = typeof dts === "number" ? dts : this.nowMs();
        postsDb.markPostDeliveredByTs(myCall, ts, deliveredTs);
        const row = postsDb.lookupPostByFromTs(myCall, ts);
        if (row) this.emitEvent({ type: "post", row });
        break;
      }
      case "cs": {
        const cid = obj.cid as number;
        const subscribed = Number(obj.s ?? 0) === 1;
        channelsDb.setChannelSubscribed(cid, subscribed);
        const pc = typeof obj.pc === "number" ? obj.pc : 0;
        this.emitEvent({ type: "channel_subscribed", cid, subscribed, postCount: pc });
        if (subscribed && pc > 0) {
          this.requestPostBatch(cid, Math.min(pc, AUTO_BACKFILL_POST_COUNT)).catch(() => {});
        }
        break;
      }
      case "pch": {
        const arr = (obj.ch as Array<{ cid: number; pt: number }>) ?? [];
        for (const ch of arr) {
          this.pausedChannels.set(ch.cid, ch.pt);
          this.emitEvent({ type: "paused_channel", cid: ch.cid, pendingCount: ch.pt });
          // Auto-unpause with a sane cap so history shows up without
          // requiring a manual action — mirrors the auto-backfill above.
          this.unpauseChannel(ch.cid, Math.min(ch.pt, AUTO_BACKFILL_POST_COUNT)).catch(() => {});
        }
        break;
      }
      case "he": {
        const arr = (obj.h as Array<{ c: string; n: string; ts: number }>) ?? [];
        let highestHamTs = 0;
        for (const h of arr) {
          if (!h.c) continue;
          hamsDb.upsertHam(h.c, h.n ?? "", h.ts ?? 0);
          this.emitEvent({ type: "ham", ham: { callsign: h.c.toUpperCase(), name: h.n ?? "", ts: h.ts ?? 0 } });
          if ((h.ts ?? 0) > highestHamTs) highestHamTs = h.ts ?? 0;
        }
        if (highestHamTs) metaDb.bumpMeta("last_ham_ts", highestHamTs);
        break;
      }
      case "ar": {
        // Server acknowledged our avatar upload — nothing to do client-side.
        break;
      }
      case "a": {
        const ac = obj.ac as number | undefined;
        const avatarB64 = obj.a as string | undefined;
        const callsign = obj.c as string | undefined;
        if (avatarB64 && callsign) {
          const ts = typeof obj.ts === "number" ? obj.ts : this.nowMs();
          avatarsDb.upsertAvatar(callsign, avatarB64, ts);
          metaDb.bumpMeta("last_avatar_ts", ts);
          this.emitEvent({ type: "avatar", callsign: callsign.toUpperCase() });
        } else if (typeof ac === "number") {
          this.emitEvent({ type: "avatar_count", count: ac });
        }
        break;
      }
      case "o": {
        const arr = (obj.o as string[]) ?? [];
        this.online = new Set(arr.filter(Boolean).map((c) => c.toUpperCase()));
        this.emitConnectionState("connected");
        break;
      }
      case "uc": {
        const call = String(obj.c ?? "").toUpperCase();
        if (call) this.online.add(call);
        this.emitConnectionState("connected");
        break;
      }
      case "ud": {
        const call = String(obj.c ?? "").toUpperCase();
        this.online.delete(call);
        this.emitConnectionState("connected");
        break;
      }
      default:
        break;
    }
  }
}

// Re-exported for callers that only need reaction typing.
export type { ReactionEntry };
