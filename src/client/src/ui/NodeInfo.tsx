import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConnectionStore } from "../state/connectionStore";
import { fetchNodeProxy, fetchNodeCmd } from "../api/rest";
import { sendAction } from "../api/socket";

// ---------------------------------------------------------------------------
// Data normalisation — handles BPQ32, XRouter, and XrPi response shapes
// ---------------------------------------------------------------------------

interface NormalizedNode {
  callsign: string;
  alias: string;
  quality: number;
  obscount: number;
  rtt: number | null;
  via: string | null;
}

interface NormalizedHeard {
  callsign: string;
  port: string | null;
  direction: string | null;
  count: number | null;
  lastHeard: string | null;
}

interface RouteEntry {
  callsign: string;
  port: number | null;
  quality: number;
  obscount: number;
}

function normalizeNodes(raw: unknown): NormalizedNode[] {
  const arr: unknown[] = Array.isArray(raw) ? raw : (raw as any)?.nodes ?? (raw as any)?.Nodes ?? [];
  return arr.map((r: any) => ({
    callsign: String(r.Callsign ?? r.callsign ?? r.call ?? r.CALLSIGN ?? "?").toUpperCase().trim(),
    alias: String(r.Alias ?? r.alias ?? r.ALIAS ?? "").toUpperCase().trim(),
    quality: Number(r.Quality ?? r.quality ?? r.qual ?? r.Qual ?? 0),
    obscount: Number(r.Obscount ?? r.obscount ?? r.obs ?? r.Obs ?? 0),
    rtt: r.RoundTrip !== undefined ? Number(r.RoundTrip)
       : r.roundtrip !== undefined ? Number(r.roundtrip)
       : r.rtt !== undefined ? Number(r.rtt)
       : r.RTT !== undefined ? Number(r.RTT) : null,
    via: r.Via != null ? String(r.Via).toUpperCase().trim()
       : r.via != null ? String(r.via).toUpperCase().trim() : null,
  })).filter((n) => n.callsign && n.callsign !== "?");
}

function normalizeHeard(raw: unknown): NormalizedHeard[] {
  const arr: unknown[] = Array.isArray(raw) ? raw : (raw as any)?.mheard ?? (raw as any)?.heard ?? [];
  return arr.map((r: any) => ({
    callsign: String(r.Callsign ?? r.callsign ?? r.call ?? "?").toUpperCase().trim(),
    port: r.Port != null ? String(r.Port) : r.port != null ? String(r.port) : null,
    direction: r.Direction ?? r.direction ?? null,
    count: r.Count !== undefined ? Number(r.Count) : r.count !== undefined ? Number(r.count) : null,
    lastHeard: r.LastHeard ?? r.lastHeard ?? r.last ?? r.ts ?? null,
  })).filter((h) => h.callsign && h.callsign !== "?");
}

// ---------------------------------------------------------------------------
// XRouter /exec?cmd= plain-text parsers
// ---------------------------------------------------------------------------

function colMapFromHeader(header: string): Record<string, number> {
  const map: Record<string, number> = {};
  header.trim().split(/\s+/).forEach((tok, i) => { map[tok.toLowerCase()] = i; });
  return map;
}

function parseXRouterNodes(text: string): NormalizedNode[] {
  const lines = text.split(/\r?\n/);
  let headerIdx = -1;
  let colMap: Record<string, number> = {};

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (/(alias|callsign)/i.test(l) && /\b(qual|qlty|qua)\b/i.test(l)) {
      headerIdx = i;
      colMap = colMapFromHeader(l);
      break;
    }
  }

  if (headerIdx >= 0) {
    const aliasIdx = colMap["alias"] ?? -1;
    const callIdx = colMap["callsign"] ?? -1;
    const qualIdx = colMap["quality"] ?? colMap["qual"] ?? colMap["qua"] ?? colMap["qlty"] ?? -1;
    const obsIdx = colMap["obsco"] ?? colMap["obs"] ?? colMap["obscount"] ?? -1;
    const rttIdx = colMap["rtt(ms)"] ?? colMap["rtt"] ?? colMap["roundtrip"] ?? -1;

    let combinedColIdx = -1;
    if (aliasIdx < 0 && callIdx < 0) {
      for (const [k, v] of Object.entries(colMap)) {
        if (/alias.{0,3}callsign|callsign.{0,3}alias/i.test(k)) { combinedColIdx = v; break; }
      }
    }

    const result: NormalizedNode[] = [];
    for (let i = headerIdx + 1; i < lines.length; i++) {
      const l = lines[i]!.trim();
      if (!l || /^[-=]{3,}/.test(l) || /^[}\]>$#:;]/.test(l)) continue;
      const tokens = l.split(/\s+/);

      let alias = "";
      let callsign = "";
      if (combinedColIdx >= 0) {
        const combined = tokens[combinedColIdx] ?? "";
        const ci = combined.indexOf(":");
        if (ci <= 0) continue;
        alias = combined.slice(0, ci);
        callsign = combined.slice(ci + 1);
      } else {
        alias = aliasIdx >= 0 ? (tokens[aliasIdx] ?? "") : "";
        callsign = callIdx >= 0 ? (tokens[callIdx] ?? "") : "";
      }

      const cs = (callsign || alias).toUpperCase();
      if (!cs || cs === "?" || cs === "--") continue;
      const qualStr = qualIdx >= 0 ? (tokens[qualIdx] ?? "0") : "0";
      const obsStr = obsIdx >= 0 ? (tokens[obsIdx] ?? "0") : "0";
      const rttStr = rttIdx >= 0 ? (tokens[rttIdx] ?? "") : "";
      const rttMatch = rttStr.replace("--", "").match(/\d+/);
      result.push({
        callsign: cs,
        alias: alias && alias.toUpperCase() !== cs ? alias.toUpperCase() : "",
        quality: parseInt(qualStr) || 0,
        obscount: parseInt(obsStr) || 0,
        rtt: rttMatch ? parseInt(rttMatch[0]!) : null,
        via: null,
      });
    }
    if (result.length > 0) return result;
  }

  // Fallback: XRouter compact format — "ALIAS:CALLSIGN" pairs, multiple per line.
  const TOKEN_RE = /^([A-Za-z0-9#][A-Za-z0-9#-]{0,10}):([A-Za-z0-9][A-Za-z0-9-]{1,9})$/;
  const compact: NormalizedNode[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const stripped = line.trim();
    if (!stripped || /}\s*Nodes:/i.test(stripped) || /\d+\s+nodes?\s+found/i.test(stripped)) continue;
    if (/(alias|callsign)/i.test(stripped)) continue;
    for (const tok of stripped.split(/\s+/)) {
      const m = tok.match(TOKEN_RE);
      if (!m) continue;
      const alias = m[1]!.toUpperCase();
      const callsign = m[2]!.toUpperCase();
      if (seen.has(callsign)) continue;
      seen.add(callsign);
      compact.push({ callsign, alias, quality: 0, obscount: 0, rtt: null, via: null });
    }
  }
  return compact;
}

function parseXRouterRoutes(text: string): RouteEntry[] {
  const lines = text.split(/\r?\n/);

  // Try tabular format with a header row
  let headerIdx = -1;
  let colMap: Record<string, number> = {};
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (/callsign/i.test(l) && /qual/i.test(l)) {
      headerIdx = i;
      colMap = colMapFromHeader(l);
      break;
    }
  }

  if (headerIdx >= 0) {
    const callIdx = colMap["callsign"] ?? 0;
    const qualIdx = colMap["quality"] ?? colMap["qual"] ?? colMap["qlty"] ?? -1;
    const obsIdx = colMap["obsco"] ?? colMap["obs"] ?? colMap["obscount"] ?? -1;
    const portIdx = colMap["port"] ?? -1;

    const result: RouteEntry[] = [];
    for (let i = headerIdx + 1; i < lines.length; i++) {
      const l = lines[i]!.trim();
      if (!l || /^[-=]{3,}/.test(l)) continue;
      const tokens = l.split(/\s+/);
      const callsign = (tokens[callIdx] ?? "").toUpperCase();
      if (!callsign || callsign === "?") continue;
      const quality = qualIdx >= 0 ? parseInt(tokens[qualIdx] ?? "0") || 0 : 0;
      const obscount = obsIdx >= 0 ? parseInt(tokens[obsIdx] ?? "0") || 0 : 0;
      const portStr = portIdx >= 0 ? tokens[portIdx] ?? "" : "";
      const port = parseInt(portStr) || null;
      result.push({ callsign, quality, obscount, port });
    }
    if (result.length > 0) return result;
  }

  // Fallback: try "KEY:VALUE KEY:VALUE" style lines
  const result: RouteEntry[] = [];
  for (const line of lines) {
    const callMatch = line.match(/(?:callsign|call)[:\s]+([A-Z0-9-]+)/i);
    const qualMatch = line.match(/qual(?:ity)?[:\s]+(\d+)/i);
    const obsMatch = line.match(/obs(?:count)?[:\s]+(\d+)/i);
    const portMatch = line.match(/port[:\s]+(\d+)/i);
    if (callMatch) {
      result.push({
        callsign: callMatch[1]!.toUpperCase(),
        quality: qualMatch ? parseInt(qualMatch[1]!) || 0 : 0,
        obscount: obsMatch ? parseInt(obsMatch[1]!) || 0 : 0,
        port: portMatch ? parseInt(portMatch[1]!) || null : null,
      });
    }
  }
  return result;
}

interface NodeEnrichment {
  quality: number;
  obscount: number;
  via: string | null;
  rtt: number | null;
}

// Parse the output of "N <callsign>" to extract quality/obs/via/rtt.
// XRouter formats vary; we use broad regexes against the whole text block.
function parseNodeDetail(text: string): NodeEnrichment | null {
  const qualMatch = text.match(/qual(?:ity)?[:\s=]+(\d+)/i);
  const obsMatch = text.match(/obs(?:count|olesc\w+)?[:\s=]+(\d+)/i);
  const viaMatch = text.match(/(?:route\s+via|via\s*:?\s*)([A-Z0-9][A-Z0-9-]{1,9})/i);
  const rttMatch = text.match(/rtt[:\s=]+(\d+)/i);
  if (!qualMatch && !obsMatch) return null;
  return {
    quality: qualMatch ? parseInt(qualMatch[1]!) || 0 : 0,
    obscount: obsMatch ? parseInt(obsMatch[1]!) || 0 : 0,
    via: viaMatch ? viaMatch[1]!.toUpperCase() : null,
    rtt: rttMatch ? parseInt(rttMatch[1]!) || null : null,
  };
}

function parseXRouterMheard(text: string): NormalizedHeard[] {
  const lines = text.split(/\r?\n/);
  let headerIdx = -1;
  let colMap: Record<string, number> = {};

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (/callsign/i.test(l) && /time/i.test(l)) {
      headerIdx = i;
      colMap = colMapFromHeader(l);
      break;
    }
  }

  if (headerIdx < 0) return [];

  const csIdx = colMap["callsign"] ?? 0;
  const dateIdx = colMap["date"] ?? 1;
  const timeIdx = colMap["time"] ?? 2;
  const framesIdx = colMap["frames"] ?? 3;
  const typeIdx = colMap["type"] ?? -1;

  const result: NormalizedHeard[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const l = lines[i]!.trim();
    if (!l || /^[}\]>$#:;]/.test(l)) continue;
    const tokens = l.split(/\s+/);
    const callsign = (tokens[csIdx] ?? "").toUpperCase();
    if (!callsign || callsign === "?") continue;
    const date = tokens[dateIdx] ?? "";
    const time = tokens[timeIdx] ?? "";
    const framesStr = framesIdx >= 0 ? (tokens[framesIdx] ?? "") : "";
    const type = typeIdx >= 0 ? (tokens[typeIdx] ?? null) : null;
    result.push({
      callsign,
      port: null,
      direction: type,
      count: parseInt(framesStr) || null,
      lastHeard: date && time ? `${date} ${time}` : null,
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Force-directed network map
// ---------------------------------------------------------------------------

interface GraphNode { id: string; label: string; isOurs: boolean }
interface GraphEdge { source: number; target: number; quality: number; rtt: number | null }

function runForceLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
  w: number,
  h: number
): { x: number; y: number }[] {
  const pos = nodes.map((_, i) => ({
    x: w / 2 + Math.cos((i / nodes.length) * 2 * Math.PI) * 180,
    y: h / 2 + Math.sin((i / nodes.length) * 2 * Math.PI) * 180,
    vx: 0,
    vy: 0,
  }));

  const ourIdx = nodes.findIndex((n) => n.isOurs);
  if (ourIdx >= 0) { pos[ourIdx]!.x = w / 2; pos[ourIdx]!.y = h / 2; }

  const REPULSION = 12000;
  const SPRING_LEN = 160;
  const SPRING_K = 0.25;
  const DAMPING = 0.75;

  for (let iter = 0; iter < 200; iter++) {
    const fx = new Float64Array(nodes.length);
    const fy = new Float64Array(nodes.length);

    for (let i = 0; i < pos.length; i++) {
      for (let j = i + 1; j < pos.length; j++) {
        const dx = pos[j]!.x - pos[i]!.x;
        const dy = pos[j]!.y - pos[i]!.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const f = REPULSION / (dist * dist);
        fx[i]! -= (f * dx) / dist;
        fy[i]! -= (f * dy) / dist;
        fx[j]! += (f * dx) / dist;
        fy[j]! += (f * dy) / dist;
      }
    }

    for (const e of edges) {
      const dx = pos[e.target]!.x - pos[e.source]!.x;
      const dy = pos[e.target]!.y - pos[e.source]!.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = SPRING_K * (dist - SPRING_LEN);
      fx[e.source]! += (f * dx) / dist;
      fy[e.source]! += (f * dy) / dist;
      fx[e.target]! -= (f * dx) / dist;
      fy[e.target]! -= (f * dy) / dist;
    }

    for (let i = 0; i < pos.length; i++) {
      if (i === ourIdx) continue;
      pos[i]!.vx = (pos[i]!.vx + fx[i]!) * DAMPING;
      pos[i]!.vy = (pos[i]!.vy + fy[i]!) * DAMPING;
      pos[i]!.x = Math.max(60, Math.min(w - 60, pos[i]!.x + pos[i]!.vx));
      pos[i]!.y = Math.max(40, Math.min(h - 40, pos[i]!.y + pos[i]!.vy));
    }
  }

  return pos;
}

function qualColor(q: number): string {
  if (q >= 170) return "#3d8";
  if (q >= 85) return "#f90";
  return "#e05";
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

type Tab = "nodes" | "heard" | "map" | "stats" | "xrinfo";

type FetchResult<T> =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "ok"; data: T }
  | { state: "error"; message: string }
  | { state: "raw"; text: string; cmd: string };

async function tryJsonPaths(paths: string[]): Promise<{ data: unknown } | null> {
  for (const path of paths) {
    try {
      const raw = await fetchNodeProxy(path) as any;
      if (raw?.htmlResponse || raw?.error) continue;
      return { data: raw };
    } catch { /* try next */ }
  }
  return null;
}

export function NodeInfo({ onClose }: { onClose: () => void }) {
  const profiles = useConnectionStore((s) => s.profiles);
  const activeProfileId = useConnectionStore((s) => s.connectionState.activeProfileId);
  const wpsStats = useConnectionStore((s) => s.wpsStats);
  const profile = profiles.find((p) => p.id === activeProfileId)
    ?? profiles.find((p) => p.adminPort != null)
    ?? profiles[0]
    ?? null;

  const myCall = profile?.myCall.toUpperCase().split("-")[0] ?? null;

  const [tab, setTab] = useState<Tab>(profile?.adminPort ? "nodes" : "stats");
  const [statsLoading, setStatsLoading] = useState(false);
  const [nodes, setNodes] = useState<FetchResult<NormalizedNode[]>>({ state: "idle" });
  const [heard, setHeard] = useState<FetchResult<NormalizedHeard[]>>({ state: "idle" });
  const [routes, setRoutes] = useState<RouteEntry[]>([]);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [nodeDetail, setNodeDetail] = useState<{ text: string } | null>(null);
  const [nodeDetailLoading, setNodeDetailLoading] = useState(false);
  const [xrInfo, setXrInfo] = useState<{ version: string; ports: string; xrstats: string } | null>(null);
  const [xrInfoLoading, setXrInfoLoading] = useState(false);
  const [nodeSort, setNodeSort] = useState<{ col: "callsign" | "alias" | "quality" | "obscount"; dir: 1 | -1 }>({
    col: "callsign",
    dir: 1,
  });
  // Per-node enrichment from "N <callsign>" bulk fetch
  const [enrichedData, setEnrichedData] = useState<Map<string, NodeEnrichment>>(new Map());
  const [enrichProgress, setEnrichProgress] = useState<{ done: number; total: number } | null>(null);

  const fetchNodes = async () => {
    if (!profile?.adminPort) return;
    setNodes({ state: "loading" });

    let lastRawText: string | undefined;
    let lastRawCmd: string | undefined;
    for (const cmd of ["N", "NODES"]) {
      try {
        const { text } = await fetchNodeCmd(cmd);
        if (!text.trim()) continue;
        const parsed = parseXRouterNodes(text);
        if (parsed.length > 0) { setNodes({ state: "ok", data: parsed }); return; }
        lastRawText = text;
        lastRawCmd = cmd;
      } catch { /* try next */ }
    }
    if (lastRawText !== undefined) {
      setNodes({ state: "raw", text: lastRawText, cmd: lastRawCmd! });
      return;
    }

    const res = await tryJsonPaths(["/api/nodes", "/nodes", "/NetRom/Nodes", "/netrom/nodes"]);
    if (res) {
      const parsed = normalizeNodes(res.data);
      if (parsed.length > 0) { setNodes({ state: "ok", data: parsed }); return; }
    }

    setNodes({ state: "error", message: "No response from exec commands or JSON API. Check that the Admin/Terminal port is correct and the node is reachable." });
  };

  const fetchRoutes = async () => {
    if (!profile?.adminPort) return;
    try {
      for (const cmd of ["R", "ROUTES"]) {
        const { text } = await fetchNodeCmd(cmd);
        if (!text.trim()) continue;
        const parsed = parseXRouterRoutes(text);
        if (parsed.length > 0) { setRoutes(parsed); return; }
      }
    } catch { /* best effort */ }
  };

  const fetchHeard = async () => {
    if (!profile?.adminPort) return;
    setHeard({ state: "loading" });

    for (const cmd of ["MH ALL", "MHEARD"]) {
      try {
        const { text } = await fetchNodeCmd(cmd);
        if (!text.trim()) continue;
        const parsed = parseXRouterMheard(text);
        if (parsed.length > 0) { setHeard({ state: "ok", data: parsed }); return; }
        setHeard({ state: "raw", text, cmd });
        return;
      } catch { /* try next */ }
    }

    const res = await tryJsonPaths(["/api/mheard", "/mheard", "/MHeard", "/Heard"]);
    if (res) {
      const parsed = normalizeHeard(res.data);
      if (parsed.length > 0) { setHeard({ state: "ok", data: parsed }); return; }
    }

    setHeard({ state: "error", message: "No response from exec commands or JSON API." });
  };

  const fetchXrInfo = useCallback(async () => {
    if (!profile?.adminPort) return;
    setXrInfoLoading(true);
    const [vRes, pRes, sRes] = await Promise.allSettled([
      fetchNodeCmd("V"),
      fetchNodeCmd("P"),
      fetchNodeCmd("S"),
    ]);
    setXrInfo({
      version: vRes.status === "fulfilled" ? vRes.value.text : "Could not retrieve.",
      ports: pRes.status === "fulfilled" ? pRes.value.text : "Could not retrieve.",
      xrstats: sRes.status === "fulfilled" ? sRes.value.text : "Could not retrieve.",
    });
    setXrInfoLoading(false);
  }, [profile?.adminPort]);

  const fetchAllDetails = useCallback(async () => {
    if (nodes.state !== "ok" || enrichProgress !== null) return;
    const callsigns = nodes.data.map((n) => n.callsign);
    setEnrichProgress({ done: 0, total: callsigns.length });
    const newMap = new Map<string, NodeEnrichment>();

    // Fetch 5 at a time to avoid overwhelming XRouter's HTTP server.
    const BATCH = 5;
    for (let i = 0; i < callsigns.length; i += BATCH) {
      const batch = callsigns.slice(i, i + BATCH);
      await Promise.all(batch.map(async (cs) => {
        try {
          const { text } = await fetchNodeCmd(`N ${cs}`);
          const detail = parseNodeDetail(text);
          if (detail) newMap.set(cs, detail);
        } catch { /* skip */ }
      }));
      setEnrichProgress({ done: Math.min(i + BATCH, callsigns.length), total: callsigns.length });
    }
    setEnrichedData(new Map(newMap));
    setEnrichProgress(null);
  }, [nodes, enrichProgress]);

  const handleSelectNode = useCallback(async (callsign: string) => {
    if (selectedNode === callsign) {
      setSelectedNode(null);
      setNodeDetail(null);
      return;
    }
    setSelectedNode(callsign);
    setNodeDetail(null);
    setNodeDetailLoading(true);
    try {
      const { text } = await fetchNodeCmd(`N ${callsign}`);
      setNodeDetail({ text });
    } catch {
      setNodeDetail({ text: "Failed to fetch node detail." });
    } finally {
      setNodeDetailLoading(false);
    }
  }, [selectedNode]);

  useEffect(() => {
    fetchNodes();
    fetchHeard();
    fetchRoutes();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id]);

  useEffect(() => {
    if (tab !== "stats") return;
    setStatsLoading(true);
    sendAction({ type: "request_stats" });
    const t = setTimeout(() => setStatsLoading(false), 8000);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (tab === "xrinfo" && !xrInfo && !xrInfoLoading) fetchXrInfo();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const mergedNodes = useMemo(() => {
    if (nodes.state !== "ok") return [];
    return nodes.data.map((n) => {
      const e = enrichedData.get(n.callsign);
      return e ? { ...n, quality: e.quality, obscount: e.obscount, via: e.via, rtt: e.rtt } : n;
    });
  }, [nodes, enrichedData]);

  const isEnriched = enrichedData.size > 0;

  const sortedNodes = useMemo(() => {
    return [...mergedNodes].sort((a, b) => {
      const col = nodeSort.col;
      if (col === "quality" || col === "obscount") {
        return nodeSort.dir * ((a[col] ?? 0) - (b[col] ?? 0));
      }
      return nodeSort.dir * String(a[col] ?? "").localeCompare(String(b[col] ?? ""));
    });
  }, [mergedNodes, nodeSort]);

  function toggleSort(col: "callsign" | "alias" | "quality" | "obscount") {
    setNodeSort((prev) =>
      prev.col === col ? { col, dir: (prev.dir * -1) as 1 | -1 } : { col, dir: col === "quality" ? -1 : 1 }
    );
  }

  const mapSvgRef = useRef<SVGSVGElement>(null);
  const MAP_W = 700;
  const MAP_H = 440;

  const mapLayout = useMemo(() => {
    if (nodes.state !== "ok" || mergedNodes.length === 0) return null;
    const nd = mergedNodes;

    const graphNodes: GraphNode[] = myCall
      ? [{ id: myCall, label: myCall, isOurs: true }, ...nd.map((n) => ({ id: n.callsign, label: n.alias || n.callsign, isOurs: false }))]
      : nd.map((n) => ({ id: n.callsign, label: n.alias || n.callsign, isOurs: false }));

    const idxOf = (id: string) => graphNodes.findIndex((n) => n.id === id);
    const ourIdx = graphNodes.findIndex((n) => n.isOurs);

    const edges: GraphEdge[] = [];
    for (const n of nd) {
      const target = idxOf(n.callsign);
      if (target < 0) continue;
      const viaIdx = n.via ? idxOf(n.via) : ourIdx;
      const source = viaIdx >= 0 ? viaIdx : ourIdx;
      if (source >= 0 && source !== target) {
        edges.push({ source, target, quality: n.quality, rtt: n.rtt });
      }
    }

    const positions = runForceLayout(graphNodes, edges, MAP_W, MAP_H);
    return { graphNodes, edges, positions };
  }, [mergedNodes, myCall]);

  const TAB_LABELS: Record<Tab, string> = {
    nodes: "Nodes",
    heard: "Heard log",
    map: "Network map",
    stats: "WPS Stats",
    xrinfo: "XR Info",
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal node-info-modal" onClick={(e) => e.stopPropagation()}>
        <div className="node-info-header">
          <div>
            <h2 style={{ margin: 0 }}>Node Info</h2>
            {profile?.adminPort && (
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
                {profile.host}:{profile.adminPort} &mdash; {profile.name}
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {profile?.adminPort && (
              <>
                <button
                  className="btn small"
                  onClick={() => {
                    fetchNodes();
                    fetchHeard();
                    fetchRoutes();
                    if (tab === "xrinfo") fetchXrInfo();
                    setSelectedNode(null);
                    setNodeDetail(null);
                    setEnrichedData(new Map());
                    setEnrichProgress(null);
                  }}
                  title="Re-run node commands"
                >
                  Refresh
                </button>
                <a
                  href={`http://${profile.host}:${profile.adminPort}/`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn small"
                >
                  Open admin ↗
                </a>
              </>
            )}
            <button className="btn small" onClick={onClose}>Close</button>
          </div>
        </div>

        <div className="node-info-tabs">
          {(["nodes", "heard", "map", "xrinfo", "stats"] as Tab[]).map((t) => (
            <button
              key={t}
              className={`node-info-tab${tab === t ? " active" : ""}`}
              onClick={() => {
                setTab(t);
                if (t === "stats") {
                  setStatsLoading(true);
                  sendAction({ type: "request_stats" });
                  setTimeout(() => setStatsLoading(false), 8000);
                }
              }}
            >
              {TAB_LABELS[t]}
            </button>
          ))}
        </div>

        <div className="node-info-body">
          {tab === "nodes" && (profile?.adminPort
            ? <NodeTab
                result={nodes}
                sorted={sortedNodes}
                sort={nodeSort}
                onToggleSort={toggleSort}
                routes={routes}
                isEnriched={isEnriched}
                enrichProgress={enrichProgress}
                onFetchAllDetails={fetchAllDetails}
                selectedNode={selectedNode}
                nodeDetail={nodeDetail}
                nodeDetailLoading={nodeDetailLoading}
                onSelectNode={handleSelectNode}
              />
            : <NoAdminPort />
          )}
          {tab === "heard" && (profile?.adminPort
            ? <HeardLog result={heard} />
            : <NoAdminPort />
          )}
          {tab === "map" && (profile?.adminPort
            ? <MapTab layout={mapLayout} svgRef={mapSvgRef} w={MAP_W} h={MAP_H} />
            : <NoAdminPort />
          )}
          {tab === "xrinfo" && (profile?.adminPort
            ? <XrInfoTab info={xrInfo} loading={xrInfoLoading} onRefresh={fetchXrInfo} />
            : <NoAdminPort />
          )}
          {tab === "stats" && <WpsStatsTab stats={wpsStats} loading={statsLoading && !wpsStats} />}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SortArrow({ col, sort }: { col: string; sort: { col: string; dir: number } }) {
  if (sort.col !== col) return <span style={{ opacity: 0.3 }}> ⇅</span>;
  return <span>{sort.dir > 0 ? " ↑" : " ↓"}</span>;
}

function LoadState({ result }: { result: FetchResult<unknown> }) {
  const [rawOpen, setRawOpen] = useState(false);
  if (result.state === "loading") return <p className="node-info-placeholder">Loading…</p>;
  if (result.state === "error") return <p className="node-info-placeholder">{result.message}</p>;
  if (result.state === "idle") return <p className="node-info-placeholder">Not loaded yet.</p>;
  if (result.state === "raw") return (
    <div className="node-info-placeholder">
      <p>
        Got a response from <code>{result.cmd}</code> but couldn't parse the output into table rows.
        {" "}The raw text is shown below — if it looks like a valid node table, please report the format so the parser can be updated.
      </p>
      <button className="btn small" onClick={() => setRawOpen((v) => !v)}>
        {rawOpen ? "Hide raw output" : "Show raw output"}
      </button>
      {rawOpen && (
        <pre style={{ marginTop: 8, fontSize: 11, background: "var(--bg-primary)", padding: 8, borderRadius: 4, overflowX: "auto", whiteSpace: "pre" }}>
          {result.text}
        </pre>
      )}
    </div>
  );
  return null;
}

function NoAdminPort() {
  return (
    <p className="node-info-placeholder">
      No admin port is configured. Edit your connection profile and set the
      <strong> Admin/Terminal port</strong> to enable node data.
      The <strong>WPS Stats</strong> tab works without an admin port.
    </p>
  );
}

function RoutesBar({ routes }: { routes: RouteEntry[] }) {
  if (routes.length === 0) return null;
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
      {routes.map((r) => (
        <div
          key={r.callsign}
          title={`Quality: ${r.quality} · Obs: ${r.obscount}${r.port != null ? ` · Port ${r.port}` : ""}`}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 10px",
            borderRadius: 6,
            background: "var(--surface)",
            border: `1px solid ${qualColor(r.quality)}55`,
            fontSize: 12,
          }}
        >
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: qualColor(r.quality), flexShrink: 0 }} />
          <span style={{ fontWeight: 600 }}>{r.callsign}</span>
          <span style={{ color: "var(--text-muted)" }}>Q{r.quality}</span>
          {r.obscount > 0 && <span style={{ color: r.obscount >= 4 ? "var(--danger)" : "var(--text-muted)" }}>obs:{r.obscount}</span>}
          {r.port != null && <span style={{ color: "var(--text-muted)" }}>p{r.port}</span>}
        </div>
      ))}
      <span style={{ fontSize: 11, color: "var(--text-muted)", alignSelf: "center" }}>direct route{routes.length !== 1 ? "s" : ""}</span>
    </div>
  );
}

function NodeTab({
  result,
  sorted,
  sort,
  onToggleSort,
  routes,
  isEnriched,
  enrichProgress,
  onFetchAllDetails,
  selectedNode,
  nodeDetail,
  nodeDetailLoading,
  onSelectNode,
}: {
  result: FetchResult<NormalizedNode[]>;
  sorted: NormalizedNode[];
  sort: { col: string; dir: 1 | -1 };
  onToggleSort: (col: "callsign" | "alias" | "quality" | "obscount") => void;
  routes: RouteEntry[];
  isEnriched: boolean;
  enrichProgress: { done: number; total: number } | null;
  onFetchAllDetails: () => void;
  selectedNode: string | null;
  nodeDetail: { text: string } | null;
  nodeDetailLoading: boolean;
  onSelectNode: (callsign: string) => void;
}) {
  if (result.state !== "ok") return <LoadState result={result} />;
  if (sorted.length === 0) return <p className="node-info-placeholder">No nodes in routing table.</p>;

  const colSpan = isEnriched ? 6 : 3;

  return (
    <div>
      <RoutesBar routes={routes} />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
          {enrichProgress
            ? `Fetching node details… ${enrichProgress.done}/${enrichProgress.total}`
            : isEnriched
              ? `${sorted.length} nodes — quality/obs/via enriched`
              : `${sorted.length} nodes`}
        </span>
        {!isEnriched && !enrichProgress && (
          <button
            className="btn small"
            onClick={onFetchAllDetails}
            title={`Fetch N <callsign> for all ${sorted.length} nodes to get quality, obs, via, and RTT data`}
          >
            Fetch all details
          </button>
        )}
        {enrichProgress && (
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
            <div
              style={{
                width: 120, height: 6, background: "var(--surface)", borderRadius: 3, overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${(enrichProgress.done / enrichProgress.total) * 100}%`,
                  background: "var(--accent)",
                  transition: "width 0.2s",
                }}
              />
            </div>
          </div>
        )}
      </div>
      <div style={{ overflowX: "auto" }}>
        <table className="node-table">
          <thead>
            <tr>
              <th onClick={() => onToggleSort("callsign")}>Callsign<SortArrow col="callsign" sort={sort} /></th>
              <th onClick={() => onToggleSort("alias")}>Alias<SortArrow col="alias" sort={sort} /></th>
              {isEnriched && <>
                <th onClick={() => onToggleSort("quality")} title="0–255; higher is better">Quality<SortArrow col="quality" sort={sort} /></th>
                <th onClick={() => onToggleSort("obscount")} title="Obsolescence 0–6; lower is fresher">Obs<SortArrow col="obscount" sort={sort} /></th>
                <th>Via</th>
                <th>RTT</th>
              </>}
              <th style={{ width: 20, opacity: 0.4, fontSize: 11 }} title="Click row for node detail">▶</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((n) => (
              <>
                <tr
                  key={n.callsign}
                  style={{ cursor: "pointer", background: selectedNode === n.callsign ? "var(--surface)" : undefined }}
                  onClick={() => onSelectNode(n.callsign)}
                >
                  <td style={{ fontWeight: 600 }}>{n.callsign}</td>
                  <td style={{ color: "var(--text-muted)" }}>{n.alias || "—"}</td>
                  {isEnriched && <>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                        <div className="quality-bar">
                          <div className="quality-fill" style={{ width: `${(n.quality / 255) * 100}%`, background: qualColor(n.quality) }} />
                        </div>
                        <span style={{ fontSize: 11, color: "var(--text-muted)", minWidth: 22 }}>{n.quality}</span>
                      </div>
                    </td>
                    <td style={{ textAlign: "center", color: n.obscount >= 4 ? "var(--danger)" : "var(--text-muted)" }}>{n.obscount}</td>
                    <td style={{ color: "var(--text-muted)", fontSize: 11 }}>{n.via || "direct"}</td>
                    <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontSize: 11 }}>{n.rtt !== null ? `${n.rtt}ms` : "—"}</td>
                  </>}
                  <td style={{ color: "var(--text-muted)", fontSize: 11 }}>{selectedNode === n.callsign ? "▼" : "▶"}</td>
                </tr>
                {selectedNode === n.callsign && (
                  <tr key={`${n.callsign}-detail`}>
                    <td colSpan={colSpan} style={{ padding: "8px 12px", background: "var(--bg-primary)" }}>
                      {nodeDetailLoading
                        ? <span style={{ color: "var(--text-muted)", fontSize: 12 }}>Fetching…</span>
                        : nodeDetail
                          ? <pre style={{ margin: 0, fontSize: 11, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{nodeDetail.text}</pre>
                          : null
                      }
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function HeardLog({ result }: { result: FetchResult<NormalizedHeard[]> }) {
  if (result.state !== "ok") return <LoadState result={result} />;
  if (result.data.length === 0) return <p className="node-info-placeholder">No heard log data.</p>;

  return (
    <div style={{ overflowX: "auto" }}>
      <table className="node-table">
        <thead>
          <tr>
            <th>Callsign</th>
            <th>Port</th>
            <th>Direction</th>
            <th>Count</th>
            <th>Last heard</th>
          </tr>
        </thead>
        <tbody>
          {result.data.map((h, i) => (
            <tr key={i}>
              <td style={{ fontWeight: 600 }}>{h.callsign}</td>
              <td style={{ color: "var(--text-muted)", textAlign: "center" }}>{h.port ?? "—"}</td>
              <td style={{ color: "var(--text-muted)" }}>{h.direction ?? "—"}</td>
              <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{h.count ?? "—"}</td>
              <td style={{ color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                {h.lastHeard ? formatLastHeard(h.lastHeard) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function formatLastHeard(raw: string): string {
  try {
    const d = new Date(raw);
    if (isNaN(d.getTime())) return raw;
    const diff = Date.now() - d.getTime();
    if (diff < 60_000) return "just now";
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return d.toLocaleDateString();
  } catch {
    return raw;
  }
}

function XrInfoTab({
  info,
  loading,
  onRefresh,
}: {
  info: { version: string; ports: string; xrstats: string } | null;
  loading: boolean;
  onRefresh: () => void;
}) {
  if (loading) return <p className="node-info-placeholder">Loading XR Info…</p>;
  if (!info) return (
    <div className="node-info-placeholder">
      <p>XR Info not loaded.</p>
      <button className="btn small" onClick={onRefresh}>Load</button>
    </div>
  );

  const sections = [
    { title: "Version", text: info.version },
    { title: "Ports", text: info.ports },
    { title: "Stats", text: info.xrstats },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {sections.map(({ title, text }) => (
        <div key={title}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 4, textTransform: "uppercase", letterSpacing: 1 }}>
            {title}
          </div>
          <pre style={{ margin: 0, fontSize: 11, background: "var(--bg-primary)", padding: "8px 10px", borderRadius: 4, whiteSpace: "pre-wrap", wordBreak: "break-word", border: "1px solid var(--border)" }}>
            {text || "No data"}
          </pre>
        </div>
      ))}
    </div>
  );
}

function MapTab({
  layout,
  svgRef,
  w,
  h,
}: {
  layout: { graphNodes: GraphNode[]; edges: GraphEdge[]; positions: { x: number; y: number }[] } | null;
  svgRef: React.RefObject<SVGSVGElement>;
  w: number;
  h: number;
}) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null);

  if (!layout) {
    return <p className="node-info-placeholder">Load the Nodes tab first to generate the map.</p>;
  }
  if (layout.graphNodes.length === 0) {
    return <p className="node-info-placeholder">No node data to map.</p>;
  }

  const { graphNodes, edges, positions } = layout;

  return (
    <div style={{ position: "relative", overflowX: "auto" }}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${w} ${h}`}
        style={{ width: "100%", maxWidth: w, display: "block", background: "var(--bg-primary)", borderRadius: 6, border: "1px solid var(--border)" }}
      >
        <defs>
          <marker id="arr" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M0,0 L0,6 L6,3 z" fill="var(--text-muted)" opacity="0.4" />
          </marker>
        </defs>

        {edges.map((e, i) => {
          const s = positions[e.source]!;
          const t = positions[e.target]!;
          const mx = (s.x + t.x) / 2;
          const my = (s.y + t.y) / 2;
          const color = qualColor(e.quality);
          const thickness = 1 + (e.quality / 255) * 2.5;
          return (
            <g key={i}>
              <line
                x1={s.x} y1={s.y} x2={t.x} y2={t.y}
                stroke={color}
                strokeWidth={thickness}
                strokeOpacity={0.5}
              />
              {e.rtt !== null && (
                <text
                  x={mx} y={my - 4}
                  fontSize={10}
                  fill="var(--text-muted)"
                  textAnchor="middle"
                  style={{ pointerEvents: "none", userSelect: "none" }}
                >
                  {e.rtt}ms
                </text>
              )}
            </g>
          );
        })}

        {graphNodes.map((node, i) => {
          const p = positions[i]!;
          const r = node.isOurs ? 28 : 22;
          const nd = node.isOurs ? null : (edges.find((e) => {
            const idx = graphNodes.findIndex((n) => n.id === node.id);
            return e.target === idx;
          }) ?? null);
          const color = node.isOurs ? "var(--accent)" : (nd ? qualColor(nd.quality) : "#aaa");

          return (
            <g
              key={node.id}
              transform={`translate(${p.x},${p.y})`}
              style={{ cursor: "pointer" }}
              onMouseEnter={(ev) => {
                if (!nd) return;
                setTooltip({
                  x: ev.clientX,
                  y: ev.clientY,
                  text: `${node.id}${nd.rtt !== null ? ` · ${nd.rtt}ms` : ""} · Q${nd.quality}`,
                });
              }}
              onMouseLeave={() => setTooltip(null)}
            >
              <circle r={r} fill={color} fillOpacity={node.isOurs ? 0.9 : 0.25} stroke={color} strokeWidth={node.isOurs ? 2.5 : 1.5} />
              <text
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={node.isOurs ? 11 : 10}
                fontWeight={node.isOurs ? 700 : 500}
                fill={node.isOurs ? "#fff" : "var(--text-normal)"}
                style={{ pointerEvents: "none", userSelect: "none" }}
                dy={node.label !== node.id ? "-5" : "0"}
              >
                {node.id}
              </text>
              {node.label !== node.id && (
                <text
                  textAnchor="middle"
                  fontSize={9}
                  fill="var(--text-muted)"
                  style={{ pointerEvents: "none", userSelect: "none" }}
                  dy="8"
                >
                  {node.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {tooltip && (
        <div
          className="map-tooltip"
          style={{ top: tooltip.y - 36, left: tooltip.x + 8 }}
        >
          {tooltip.text}
        </div>
      )}
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>
        Line colour: <span style={{ color: "#3d8" }}>good</span> /&nbsp;
        <span style={{ color: "#f90" }}>fair</span> /&nbsp;
        <span style={{ color: "#e05" }}>poor</span> quality.
        {" "}Thickness proportional to quality. Edges show RTT where available.
      </div>
    </div>
  );
}

function WpsStatsTab({ stats, loading }: { stats: import("@shared/types").WpsStats | null; loading: boolean }) {
  if (loading) return <p className="node-info-placeholder">Requesting stats from WPS server…</p>;
  if (!stats) return (
    <p className="node-info-placeholder">
      No stats received yet. Click the <strong>WPS Stats</strong> tab to request them.
    </p>
  );

  const sections: Array<{ title: string; rows: import("@shared/types").WpsStatRow[] | undefined }> = [
    { title: "Posts", rows: stats.p },
    { title: "Messages", rows: stats.m },
    { title: "Server", rows: stats.s },
  ];

  return (
    <div style={{ padding: "8px 0" }}>
      {stats.h && Object.keys(stats.h).length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 6, textTransform: "uppercase", letterSpacing: 1 }}>Overview</div>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            {Object.entries(stats.h).map(([k, v]) => (
              <div key={k} style={{ background: "var(--surface)", borderRadius: 8, padding: "8px 16px", minWidth: 100, textAlign: "center" }}>
                <div style={{ fontSize: 22, fontWeight: 700, color: "var(--accent)" }}>{v.toLocaleString()}</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                  {k === "uculsd" ? "Users (7 days)" : k}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
        {sections.filter((s) => s.rows && s.rows.length > 0).map(({ title, rows }) => (
          <div key={title}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 6, textTransform: "uppercase", letterSpacing: 1 }}>{title}</div>
            <table className="node-table">
              <tbody>
                {rows!.map((row) => (
                  <tr key={row.s}>
                    <td>{row.s}</td>
                    <td style={{ textAlign: "right", fontWeight: 600 }}>{row.v.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}
