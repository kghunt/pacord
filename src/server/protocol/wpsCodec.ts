/**
 * WPS application-layer framing and compression.
 *
 * Frames are line-delimited JSON. Outgoing frames terminate with `\r\n`.
 * Incoming frames may terminate with either `\r\n` or a bare `\r` (the
 * server's own send path emits only `\r`).
 *
 * Compression is applied per-frame when the compressed form is shorter than
 * the plain JSON. Wire format: `<DELIM> base64(zlib(json)) <DELIM> <CRLF>`.
 * The server emits the 2-byte delimiter (0xC3 0x80) outbound; we tolerate
 * the 1/2/4-byte variants on decode (ported from whatspyc's wps/codec.py,
 * which documents the asymmetry in detail). We never need to emit the
 * compressed form ourselves — sending plain JSON is always valid — so
 * `encode` always returns plain JSON here, keeping this side simple.
 */

import { deflateSync, inflateSync } from "node:zlib";

const DELIM_SINGLE = Buffer.from([0xc0]);
const DELIM_UTF8 = Buffer.from([0xc3, 0x80]);
const DELIM_DOUBLE = Buffer.from([0xc3, 0x83, 0xc2, 0x80]);
const LINE_END = Buffer.from("\r\n", "latin1");

export function encode(obj: unknown): Buffer {
  const text = JSON.stringify(obj);
  return Buffer.concat([Buffer.from(text, "utf-8"), LINE_END]);
}

export class FrameDecodeError extends Error {
  payload: Buffer;
  constructor(message: string, payload: Buffer) {
    super(message);
    this.name = "FrameDecodeError";
    this.payload = payload;
  }
}

function stripDelim(payload: Buffer): Buffer | null {
  if (
    payload.length >= 8 &&
    payload.subarray(0, 4).equals(DELIM_DOUBLE) &&
    payload.subarray(-4).equals(DELIM_DOUBLE)
  ) {
    return payload.subarray(4, payload.length - 4);
  }
  if (
    payload.length >= 4 &&
    payload.subarray(0, 2).equals(DELIM_UTF8) &&
    payload.subarray(-2).equals(DELIM_UTF8)
  ) {
    return payload.subarray(2, payload.length - 2);
  }
  if (
    payload.length >= 2 &&
    payload.subarray(0, 1).equals(DELIM_SINGLE) &&
    payload.subarray(-1).equals(DELIM_SINGLE)
  ) {
    return payload.subarray(1, payload.length - 1);
  }
  return null;
}

function decodeOne(payload: Buffer): unknown {
  const inner = stripDelim(payload);
  try {
    if (inner !== null) {
      const compressed = Buffer.from(inner.toString("utf-8"), "base64");
      const decompressed = inflateSync(compressed);
      return JSON.parse(decompressed.toString("utf-8"));
    }
    return JSON.parse(payload.toString("utf-8"));
  } catch (exc) {
    const snippet = payload.subarray(0, 120);
    throw new FrameDecodeError(
      `could not decode WPS frame (${(exc as Error).message}); first ${snippet.length} bytes: ${snippet.toString(
        "latin1"
      )}`,
      payload
    );
  }
}

/** Buffered frame splitter. Feed bytes; get back complete decoded JSON objects. */
export class FrameDecoder {
  private buf: Buffer = Buffer.alloc(0);

  feed(data: Buffer): unknown[] {
    this.buf = Buffer.concat([this.buf, data]);
    const out: unknown[] = [];
    while (true) {
      const i = this.buf.indexOf(0x0d); // '\r'
      if (i === -1) break;
      let frame = this.buf.subarray(0, i);
      let rest = this.buf.subarray(i + 1);
      if (rest.length > 0 && rest[0] === 0x0a) {
        rest = rest.subarray(1);
      }
      this.buf = Buffer.from(rest);
      const trimmed = Buffer.from(frame.toString("latin1").trim(), "latin1");
      if (trimmed.length === 0) continue;
      out.push(decodeOne(trimmed));
    }
    return out;
  }
}

// Exposed for callers that want to force zlib-compressed encoding (unused
// by default — kept for parity/testing against servers that reject plain
// frames, though none observed in practice).
export function encodeCompressed(obj: unknown): Buffer {
  const text = JSON.stringify(obj);
  const raw = Buffer.from(text, "utf-8");
  const compressed = deflateSync(raw, { level: 9 });
  const b64 = Buffer.from(compressed.toString("base64"), "utf-8");
  const framedCompressed = Buffer.concat([DELIM_DOUBLE, b64, DELIM_DOUBLE, LINE_END]);
  const framedPlain = Buffer.concat([raw, LINE_END]);
  return framedCompressed.length < framedPlain.length ? framedCompressed : framedPlain;
}
