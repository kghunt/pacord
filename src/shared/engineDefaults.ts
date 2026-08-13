import type { Engine, Transport } from "./types.js";

// Mirrors whatspyc's config.py per-engine defaults, simplified: our profile
// form always shows explicit fields (no implicit TOML-migration concerns),
// so this just seeds sensible starting values rather than tracking which
// fields the user "explicitly" overrode.

export function defaultPort(engine: Engine, transport: Transport): number | null {
  if (transport === "rhp-tcp") return 9000;
  if (transport === "rhp-ws") {
    if (engine === "xrouter") return 8086;
    if (engine === "bpq") return 8008;
    return null;
  }
  if (transport === "direct-tcp") return 63001;
  return null;
}

export function defaultRemote(engine: Engine): string {
  // XRouter's RHP AX.25 OPEN does the SABM itself against a destination
  // callsign — for a direct LAN connection to the local WPS service, the
  // conventional destination is "WPS". BPQ instead lands you at its
  // SWITCH interpreter first.
  if (engine === "bpq") return "SWITCH";
  return "WPS";
}

export function defaultRadioPort(engine: Engine): number {
  return 1;
}
