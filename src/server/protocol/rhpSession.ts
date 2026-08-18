/**
 * Shared RHP v2 message-level state machine, ported from whatspyc's
 * `transport/rhp_session.py`. Wire-format-agnostic: the transport supplies
 * `sendMessage`/`recvMessage` callbacks that (de)serialize one JSON object
 * per underlying frame (one WS frame each, for RHP-over-WebSocket).
 *
 * Owns: OPEN/OPENREPLY exchange (obtains the socket handle), SEND wrapping
 * of outbound application bytes, RECV unwrapping of inbound bytes, optional
 * AUTH, and CLOSE on shutdown.
 */
import { AsyncQueue } from "./asyncQueue.js";

export interface RhpConfig {
  pfam: "ax25" | "netrom";
  local: string;
  remote: string;
  port: number | null;
  flags?: number;
  authUser?: string | null;
  authPass?: string | null;
  // How long to wait for the openReply before giving up. RF links vary
  // wildly — sometimes near-instant, sometimes 30-60s — so this is
  // profile-configurable rather than a fixed constant.
  responseTimeoutMs: number;
}

type SendMessageFn = (obj: Record<string, unknown>) => Promise<void>;
type RecvMessageFn = () => Promise<Record<string, unknown>>;

export class RhpSession {
  private cfg: RhpConfig;
  private sendMessage: SendMessageFn;
  private recvMessage: RecvMessageFn;
  private handle: number | null = null;
  private closed = false;
  private nextId = 1;
  private inbox = new AsyncQueue<Buffer | null>();
  private readerLoopPromise: Promise<void> | null = null;
  private openReplyResolve: ((v: Record<string, unknown>) => void) | null = null;
  private openReplyReject: ((e: Error) => void) | null = null;
  private openReplyPromise: Promise<Record<string, unknown>> | null = null;

  constructor(cfg: RhpConfig, sendMessage: SendMessageFn, recvMessage: RecvMessageFn) {
    this.cfg = cfg;
    this.sendMessage = sendMessage;
    this.recvMessage = recvMessage;
  }

  private id(): number {
    return this.nextId++;
  }

  async open(): Promise<void> {
    if (this.cfg.authUser) {
      await this.sendMessage({
        type: "auth",
        id: this.id(),
        user: this.cfg.authUser,
        pass: this.cfg.authPass ?? "",
      });
      const reply = await this.recvMessage();
      const err = (reply.errCode ?? reply.errcode ?? 0) as number;
      if (err !== 0) {
        throw new Error(`RHP auth failed: ${JSON.stringify(reply)}`);
      }
    }

    const openId = this.id();
    this.openReplyPromise = new Promise<Record<string, unknown>>((resolve, reject) => {
      this.openReplyResolve = resolve;
      this.openReplyReject = reject;
    });
    this.readerLoopPromise = this.readerLoop();

    const openMsg: Record<string, unknown> = {
      type: "open",
      id: openId,
      pfam: this.cfg.pfam,
      mode: "stream",
      local: this.cfg.local,
      remote: this.cfg.remote,
      flags: this.cfg.flags ?? 0x80,
    };
    if (this.cfg.port !== null) {
      // Wire shape expects `port` as a string ("1") — some RHP stacks
      // silently drop the OPEN if it arrives as a JSON number.
      openMsg.port = String(this.cfg.port);
    }
    await this.sendMessage(openMsg);
    const timeoutMs = this.cfg.responseTimeoutMs;
    const reply = await Promise.race([
      this.openReplyPromise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`RHP open timed out waiting for openReply (${timeoutMs}ms)`)), timeoutMs)
      ),
    ]);
    const err = (reply.errcode ?? reply.errCode ?? 0) as number;
    if (err !== 0) {
      throw new Error(`RHP open failed: ${JSON.stringify(reply)}`);
    }
    this.handle = reply.handle as number;
  }

  async send(data: Buffer): Promise<void> {
    if (this.handle === null || this.closed) {
      throw new Error("RHP socket not open");
    }
    await this.sendMessage({
      type: "send",
      id: this.id(),
      handle: this.handle,
      data: data.toString("latin1"),
    });
  }

  async recv(): Promise<Buffer> {
    const item = await this.inbox.pop();
    return item ?? Buffer.alloc(0);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.handle !== null) {
      try {
        await this.sendMessage({ type: "close", id: this.id(), handle: this.handle });
      } catch {
        // best-effort
      }
    }
    if (this.readerLoopPromise) {
      // The reader loop may be blocked on `recvMessage()` waiting for bytes
      // that will never arrive (the far end doesn't always close the socket
      // after an OPEN error) — the transport-level socket doesn't get
      // destroyed until *after* this call returns, so waiting unbounded
      // here would deadlock forever. readerLoop's own try/catch always
      // resolves (never rejects), so this is just a safety cap.
      try {
        await Promise.race([this.readerLoopPromise, new Promise((resolve) => setTimeout(resolve, 3000))]);
      } catch {
        // reader loop already reports failures via the inbox
      }
    }
  }

  private async readerLoop(): Promise<void> {
    try {
      while (!this.closed) {
        const msg = await this.recvMessage();
        const t = msg.type as string | undefined;
        if (t === "openReply") {
          this.openReplyResolve?.(msg);
        } else if (t === "status") {
          // Diagnostics only.
        } else if (t === "sendReply") {
          const err = (msg.errcode ?? msg.errCode ?? 0) as number;
          if (err !== 0) {
            console.warn("RHP send error:", msg);
          }
        } else if (t === "recv") {
          const data = msg.data;
          const buf = typeof data === "string" ? Buffer.from(data, "latin1") : Buffer.alloc(0);
          this.inbox.push(buf);
        } else if (t === "close") {
          this.inbox.push(null);
          return;
        }
        // else: closeReply, statusReply, accept — ignored.
      }
    } catch (exc) {
      this.openReplyReject?.(exc as Error);
      this.inbox.push(null);
    }
  }
}
