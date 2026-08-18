/**
 * WPS over a raw TCP socket — no RHP/AX.25 wrapper at all. This is what a
 * WPS server's own `direct-tcp` listener speaks (e.g. whatspyc's reference
 * server, or an XRouter `APPLTYPE=TCP,host:port` backend reached directly
 * rather than proxied through a real AX.25 link). Bytes are the raw WPS
 * frame stream — `wpsCodec`'s `\r`-delimited framing applies with nothing
 * else wrapped around it, so this transport is just a pass-through socket.
 */
import net from "node:net";
import { AsyncQueue } from "./asyncQueue.js";
import type { ByteStreamTransport } from "./transport.js";

export class DirectTcpTransport implements ByteStreamTransport {
  // No RHP OPEN pre-sends our callsign to WPS, so WpsClient must still send
  // the raw `<CALL>\r\n` line itself before the type-`c` connect record.
  readonly injectsCallsign = false;

  private host: string;
  private port: number;
  private socket: net.Socket | null = null;
  private chunks = new AsyncQueue<Buffer | null>();
  private closedError: Error | null = null;

  constructor(host: string, port: number) {
    this.host = host;
    this.port = port;
  }

  async open(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const socket = net.connect(this.port, this.host);
      this.socket = socket;
      socket.once("connect", () => {
        socket.off("error", reject);
        resolve();
      });
      socket.once("error", reject);
    });
    this.socket!.on("data", (d) => this.chunks.push(Buffer.from(d)));
    this.socket!.on("close", () => this.chunks.push(null));
    this.socket!.on("error", (err) => {
      this.closedError = err;
      this.chunks.push(null);
    });
  }

  async send(data: Buffer): Promise<void> {
    if (!this.socket) throw new Error("transport not open");
    await new Promise<void>((resolve, reject) => {
      this.socket!.write(data, (err) => (err ? reject(err) : resolve()));
    });
  }

  async recv(): Promise<Buffer> {
    const chunk = await this.chunks.pop();
    if (chunk === null) {
      throw this.closedError ?? new Error("connection closed");
    }
    return chunk;
  }

  async close(): Promise<void> {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
  }
}
