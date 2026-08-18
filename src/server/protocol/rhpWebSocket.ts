/**
 * RHP v2 over WebSocket — ported from whatspyc's `transport/rhp_ws.py`.
 *
 * Endpoint is `ws://{host}:{port}/rhp`. Each WS frame carries one RHP JSON
 * message, compact-encoded, with an `Origin: <scheme>://<host>:<port>`
 * upgrade header (some RHP server stacks drop connections without it).
 * No WS-level ping — RHP servers aren't required to answer them and some
 * don't; liveness is covered by the application-level `{"t":"k"}` keepalive.
 */
import WebSocket from "ws";
import { AsyncQueue } from "./asyncQueue.js";
import { RhpConfig, RhpSession } from "./rhpSession.js";
import type { ByteStreamTransport } from "./transport.js";

export class RhpWebSocketTransport implements ByteStreamTransport {
  readonly injectsCallsign = true;

  private url: string;
  private origin: string;
  private cfg: RhpConfig;
  private ws: WebSocket | null = null;
  private session: RhpSession | null = null;
  private inbox = new AsyncQueue<Record<string, unknown>>();

  constructor(host: string, port: number, cfg: RhpConfig, scheme: "ws" | "wss" = "ws") {
    this.url = `${scheme}://${host}:${port}/rhp`;
    this.origin = `${scheme}://${host}:${port}`;
    this.cfg = cfg;
  }

  async open(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.url, {
        headers: { Origin: this.origin },
        perMessageDeflate: false,
      });
      this.ws = ws;
      ws.once("open", () => resolve());
      ws.once("error", (err) => reject(err));
      ws.on("message", (data, isBinary) => {
        try {
          const text = isBinary ? Buffer.from(data as Buffer).toString("utf-8") : data.toString();
          this.inbox.push(JSON.parse(text));
        } catch {
          // Ignore malformed frames — the RHP session layer will time out
          // waiting on its openReply/inbox if this becomes a real problem.
        }
      });
      ws.on("close", () => {
        this.inbox.push({ type: "close" });
      });
    });

    this.session = new RhpSession(
      this.cfg,
      async (obj) => {
        this.ws!.send(JSON.stringify(obj));
      },
      async () => this.inbox.pop()
    );
    await this.session.open();
  }

  async send(data: Buffer): Promise<void> {
    if (!this.session) throw new Error("transport not open");
    // BPQ's RHP-over-WebSocket miscodes a trailing \n in the data field,
    // so strip it and send only the bare \r frame terminator.
    let payload = data;
    if (payload.length >= 2 && payload[payload.length - 2] === 0x0d && payload[payload.length - 1] === 0x0a) {
      payload = payload.subarray(0, payload.length - 1);
    }
    await this.session.send(payload);
  }

  async recv(): Promise<Buffer> {
    if (!this.session) throw new Error("transport not open");
    return this.session.recv();
  }

  async close(): Promise<void> {
    if (this.session) {
      await this.session.close();
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // best-effort
      }
    }
  }
}
