/**
 * Transport abstraction — hides whichever wire protocol carries WPS bytes.
 * Only RHP-over-WebSocket is implemented (matches the XRouter/BPQ web-client
 * endpoint, `ws://host:port/rhp`); the interface leaves room for RHP-TCP /
 * direct-TCP transports later without touching WpsClient.
 */
export interface ByteStreamTransport {
  open(): Promise<void>;
  send(data: Buffer): Promise<void>;
  recv(): Promise<Buffer>;
  close(): Promise<void>;
  /**
   * True if the link already supplies WPS with the originating callsign
   * (an RHP host node pre-sends it on the WPS-facing socket) — RHP
   * transports are always true, so WpsClient skips the raw `<CALL>\r\n`
   * line and goes straight to the type-`c` connect record.
   */
  readonly injectsCallsign: boolean;
}
