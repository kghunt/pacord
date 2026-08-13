/**
 * Multi-hop node-prompt connect sequence, for engines (BPQ, or manual
 * multi-hop XRouter setups) that land at an intermediate node prompt before
 * reaching WPS. Ported conceptually from whatspyc's `wps/hop_script.py`.
 *
 * Each step optionally sends a command (`cmd`, empty = wait-only) then
 * waits for `val` to appear in the accumulated inbound bytes before moving
 * to the next step. Must complete fully before the WPS frame decoder starts
 * consuming — the transport is still emitting a plain-text node prompt at
 * this point, not JSON.
 */
import type { ByteStreamTransport } from "./transport.js";

export interface HopStep {
  cmd: string;
  val: string;
  timeoutMs?: number;
}

export type HopProgressFn = (step: number, total: number, step_: HopStep) => void;

const FALLBACK_TIMEOUT_MS = 30_000;

export async function runConnectScript(
  transport: ByteStreamTransport,
  script: HopStep[],
  onProgress?: HopProgressFn,
  defaultTimeoutMs = FALLBACK_TIMEOUT_MS
): Promise<void> {
  let buffered = "";
  for (let i = 0; i < script.length; i++) {
    const step = script[i]!;
    onProgress?.(i, script.length, step);
    if (step.cmd) {
      await transport.send(Buffer.from(`${step.cmd}\r\n`, "utf-8"));
    }
    if (!step.val) continue;
    // A step-level timeoutMs override always wins; otherwise fall back to
    // the profile's configured response timeout — RF replies can take
    // anywhere from under a second to 30-60s depending on conditions.
    const timeoutMs = step.timeoutMs ?? defaultTimeoutMs;
    const deadline = Date.now() + timeoutMs;
    while (!buffered.includes(step.val)) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new Error(
          `connect_sequence step ${i} timed out waiting for ${JSON.stringify(step.val)}; ` +
            `received so far: ${JSON.stringify(buffered.slice(-200))}`
        );
      }
      const chunk = await Promise.race([
        transport.recv(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), remaining)),
      ]);
      if (chunk === null) continue; // loop re-checks the deadline
      if (chunk.length === 0) {
        throw new Error(`connect_sequence step ${i}: link closed while waiting for ${JSON.stringify(step.val)}`);
      }
      buffered += chunk.toString("latin1");
    }
  }
}
