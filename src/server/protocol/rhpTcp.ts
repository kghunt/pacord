/**
 * RHP v2 over a raw TCP connection — ported from whatspyc's
 * `transport/rhp_tcp.py`. Each JSON message on the wire is preceded by a
 * 2-byte big-endian length prefix (no WebSocket framing at all).
 *
 * This is what a plain `RHPPORT=<flags> <port>` XRouter config directive
 * exposes — distinct from the WebSocket variant served by the embedded
 * admin webserver (`HTTPPORT`/`/rhp`), which is a separate, optional route
 * that may not be registered even when RHP itself is enabled.
 */
import net from "node:net";
import { AsyncQueue } from "./asyncQueue.js";
import { RhpConfig, RhpSession } from "./rhpSession.js";
import type { ByteStreamTransport } from "./transport.js";

class TcpFrameStream {
  private buf = Buffer.alloc(0);
  private chunks = new AsyncQueue<Buffer | null>();
  private ended = false;
  private closedError: Error | null = null;

  constructor(socket: net.Socket) {
    socket.on("data", (d) => this.chunks.push(Buffer.from(d)));
    socket.on("close", () => this.chunks.push(null));
    socket.on("error", (err) => {
      this.closedError = err;
      this.chunks.push(null);
    });
  }

  async readExactly(n: number): Promise<Buffer> {
    while (this.buf.length < n) {
      if (this.ended) {
        throw this.closedError ?? new Error("connection closed");
      }
      const next = await this.chunks.pop();
      if (next === null) {
        this.ended = true;
        throw this.closedError ?? new Error("connection closed");
      }
      this.buf = Buffer.concat([this.buf, next]);
    }
    const out = Buffer.from(this.buf.subarray(0, n));
    this.buf = Buffer.from(this.buf.subarray(n));
    return out;
  }
}

export class RhpTcpTransport implements ByteStreamTransport {
  readonly injectsCallsign = true;

  private host: string;
  private port: number;
  private cfg: RhpConfig;
  private socket: net.Socket | null = null;
  private frameStream: TcpFrameStream | null = null;
  private session: RhpSession | null = null;

  constructor(host: string, port: number, cfg: RhpConfig) {
    this.host = host;
    this.port = port;
    this.cfg = cfg;
  }

  async open(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const socket = net.connect(this.port, this.host);
      this.socket = socket;
      socket.once("connect", () => resolve());
      socket.once("error", (err) => reject(err));
    });
    this.frameStream = new TcpFrameStream(this.socket!);

    this.session = new RhpSession(
      this.cfg,
      async (obj) => {
        const body = Buffer.from(JSON.stringify(obj), "utf-8");
        if (body.length > 0xffff) {
          throw new Error("RHP message exceeds 65535 bytes");
        }
        const header = Buffer.alloc(2);
        header.writeUInt16BE(body.length, 0);
        this.socket!.write(Buffer.concat([header, body]));
      },
      async () => {
        const header = await this.frameStream!.readExactly(2);
        const length = header.readUInt16BE(0);
        const body = await this.frameStream!.readExactly(length);
        return JSON.parse(body.toString("utf-8"));
      }
    );
    await this.session.open();
  }

  async send(data: Buffer): Promise<void> {
    if (!this.session) throw new Error("transport not open");
    await this.session.send(data);
  }

  async recv(): Promise<Buffer> {
    if (!this.session) throw new Error("transport not open");
    return this.session.recv();
  }

  async close(): Promise<void> {
    if (this.session) {
      await this.session.close();
    }
    if (this.socket) {
      this.socket.destroy();
    }
  }
}
