import { useEffect, useMemo, useRef, useState } from "react";
import { useConnectionStore } from "../state/connectionStore";
import { fetchNodeProxy, fetchNodeCmd } from "../api/rest";
import { sendAction } from "../api/socket";

// ---------------------------------------------------------------------------
// Data normalisation — handles BPQ32, XRouter, and XrPi response shapes
// ---------------------------------------------------------------------------

interface NormalizedNode {
  callsign: string;
  alias: string;
  quality: number;   // 0–255
  obscount: number;  // 0–6; lower = more obsolete
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
    if (/(alias|callsign)/i.test(l) && /qual/i.test(l)) {
      headerIdx = i;
      colMap = colMapFromHeader(l);
      break;
    }
  }

  if (headerIdx < 0) return [];

  const aliasIdx = colMap["alias"] ?? -1;
  const callIdx = colMap["callsign"] ?? -1;
  const qualIdx = colMap["quality"] ?? colMap["qual"] ?? -1;
  const obsIdx = colMap["obsco"] ?? colMap["obs"] ?? colMap["obscount"] ?? -1;
  const rttIdx = colMap["rtt(ms)"] ?? colMap["rtt"] ?? colMap["roundtrip"] ?? -1;

  const result: NormalizedNode[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const l = lines[i]!.trim();
    if (!l || /^[}\]>$#:;]/.test(l)) continue;
    const tokens = l.split(/\s+/);
    const alias = aliasIdx >= 0 ? (tokens[aliasIdx] ?? "") : "";
    const callsign = callIdx >= 0 ? (tokens[callIdx] ?? "") : "";
    const cs = (callsign || alias).toUpperCase();
    if (!cs || cs === "?" || cs === "--") continue;
    const qualStr = qualIdx >= 0 ? (tokens[qualIdx] ?? "0") : "0";
    const obsStr = obsIdx >= 0 ? (tokens[obsIdx] ?? "0") : "0";
    const rttStr = rttIdx >= 0 ? (tokens[rttIdx] ?? "") : "";
    const rttMatch = rttStr.replace("--", "").match(/\d+/);
    result.push({
      callsign: cs,
      alias: alias && alias !== callsign ? alias.toUpperCase() : "",
      quality: parseInt(qualStr) || 0,
      obscount: parseInt(obsStr) || 0,
      rtt: rttMatch ? parseInt(rttMatch[0]!) : null,
      via: null,
    });
  }
  return result;
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

  // Pin our node at centre
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

type Tab = "nodes" | "heard" | "map" | "stats";

type FetchResult<T> =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "ok"; data: T }
  | { state: "error"; message: string }
  | { state: "html" };

async function tryPaths(paths: string[]): Promise<{ data: unknown } | { html: true } | { error: string }> {
  for (const path of paths) {
    try {
      const raw = await fetchNodeProxy(path) as any;
      if (raw?.htmlResponse) return { html: true };
      if (raw?.error) continue; // try next path
      return { data: raw };
    } catch {
      // try next
    }
  }
  return { error: "No known API endpoints responded with data. Check the admin port setting on your profile." };
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
  const [nodeSort, setNodeSort] = useState<{ col: keyof NormalizedNode; dir: 1 | -1 }>({
    col: "quality",
    dir: -1,
  });

  useEffect(() => {
    if (!profile?.adminPort) return;

    setNodes({ state: "loading" });
    tryPaths(["/api/nodes", "/nodes", "/NetRom/Nodes", "/netrom/nodes"]).then(async (res) => {
      if (!("error" in res) && !("html" in res)) {
        setNodes({ state: "ok", data: normalizeNodes(res.data) });
        return;
      }
      // Fall back to XRouter /exec?cmd= terminal endpoint
      try {
        const { text } = await fetchNodeCmd("N");
        const parsed = parseXRouterNodes(text);
        if (parsed.length > 0) { setNodes({ state: "ok", data: parsed }); return; }
      } catch { /* ignore */ }
      if ("error" in res) { setNodes({ state: "error", message: res.error }); return; }
      setNodes({ state: "html" });
    });

    setHeard({ state: "loading" });
    tryPaths(["/api/mheard", "/mheard", "/MHeard", "/Heard"]).then(async (res) => {
      if (!("error" in res) && !("html" in res)) {
        setHeard({ state: "ok", data: normalizeHeard(res.data) });
        return;
      }
      try {
        const { text } = await fetchNodeCmd("MH ALL");
        const parsed = parseXRouterMheard(text);
        if (parsed.length > 0) { setHeard({ state: "ok", data: parsed }); return; }
      } catch { /* ignore */ }
      if ("error" in res) { setHeard({ state: "error", message: res.error }); return; }
      setHeard({ state: "html" });
    });
  }, [profile?.id]);

  // Auto-fetch WPS stats on open when landing on the stats tab (no admin port → default tab).
  useEffect(() => {
    if (tab !== "stats") return;
    setStatsLoading(true);
    sendAction({ type: "request_stats" });
    const t = setTimeout(() => setStatsLoading(false), 8000);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sortedNodes = useMemo(() => {
    if (nodes.state !== "ok") return [];
    return [...nodes.data].sort((a, b) => {
      const av = a[nodeSort.col] ?? -1;
      const bv = b[nodeSort.col] ?? -1;
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      return typeof av === "string"
        ? nodeSort.dir * av.localeCompare(String(bv))
        : nodeSort.dir * (Number(av) - Number(bv));
    });
  }, [nodes, nodeSort]);

  function toggleSort(col: keyof NormalizedNode) {
    setNodeSort((prev) =>
      prev.col === col ? { col, dir: (prev.dir * -1) as 1 | -1 } : { col, dir: -1 }
    );
  }

  const mapSvgRef = useRef<SVGSVGElement>(null);
  const MAP_W = 700;
  const MAP_H = 440;

  const mapLayout = useMemo(() => {
    if (nodes.state !== "ok" || nodes.data.length === 0) return null;
    const nd = nodes.data;

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
  }, [nodes, myCall]);

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
              <a
                href={`http://${profile.host}:${profile.adminPort}/`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn small"
              >
                Open admin ↗
              </a>
            )}
            <button className="btn small" onClick={onClose}>Close</button>
          </div>
        </div>

        <div className="node-info-tabs">
          {(["nodes", "heard", "map", "stats"] as Tab[]).map((t) => (
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
              {t === "nodes" ? "Nodes" : t === "heard" ? "Heard log" : t === "map" ? "Network map" : "WPS Stats"}
            </button>
          ))}
        </div>

        <div className="node-info-body">
          {tab === "nodes" && (profile?.adminPort
            ? <NodeTable result={nodes} sorted={sortedNodes} sort={nodeSort} onToggleSort={toggleSort} />
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
  if (result.state === "loading") return <p className="node-info-placeholder">Loading…</p>;
  if (result.state === "html") return (
    <p className="node-info-placeholder">
      The admin interface returned an HTML page — XRouter does not expose a JSON REST API, so
      the Nodes, Heard log, and Network map tabs are unavailable.
      Use the <strong>WPS Stats</strong> tab for server statistics, or
      <strong> Open admin ↗</strong> above to browse the node directly.
    </p>
  );
  if (result.state === "error") return <p className="node-info-placeholder">{result.message}</p>;
  if (result.state === "idle") return <p className="node-info-placeholder">Not loaded yet.</p>;
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

function NodeTable({
  result,
  sorted,
  sort,
  onToggleSort,
}: {
  result: FetchResult<NormalizedNode[]>;
  sorted: NormalizedNode[];
  sort: { col: keyof NormalizedNode; dir: 1 | -1 };
  onToggleSort: (col: keyof NormalizedNode) => void;
}) {
  if (result.state !== "ok") return <LoadState result={result} />;
  if (sorted.length === 0) return <p className="node-info-placeholder">No nodes in routing table.</p>;

  return (
    <div style={{ overflowX: "auto" }}>
      <table className="node-table">
        <thead>
          <tr>
            <th onClick={() => onToggleSort("callsign")}>Callsign<SortArrow col="callsign" sort={sort} /></th>
            <th onClick={() => onToggleSort("alias")}>Alias<SortArrow col="alias" sort={sort} /></th>
            <th onClick={() => onToggleSort("quality")} title="0–255; higher is better">Quality<SortArrow col="quality" sort={sort} /></th>
            <th onClick={() => onToggleSort("obscount")} title="Obsolescence count 0–6; lower is fresher">Obs<SortArrow col="obscount" sort={sort} /></th>
            <th onClick={() => onToggleSort("rtt")} title="Round-trip time in ms">RTT<SortArrow col="rtt" sort={sort} /></th>
            <th onClick={() => onToggleSort("via")}>Via<SortArrow col="via" sort={sort} /></th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((n) => (
            <tr key={n.callsign}>
              <td style={{ fontWeight: 600 }}>{n.callsign}</td>
              <td style={{ color: "var(--text-muted)" }}>{n.alias || "—"}</td>
              <td>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <div className="quality-bar">
                    <div
                      className="quality-fill"
                      style={{
                        width: `${(n.quality / 255) * 100}%`,
                        background: qualColor(n.quality),
                      }}
                    />
                  </div>
                  <span style={{ fontSize: 12, color: "var(--text-muted)", minWidth: 24 }}>{n.quality}</span>
                </div>
              </td>
              <td style={{ color: n.obscount >= 4 ? "var(--danger)" : "var(--text-muted)", textAlign: "center" }}>
                {n.obscount}
              </td>
              <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                {n.rtt !== null ? `${n.rtt} ms` : "—"}
              </td>
              <td style={{ color: "var(--text-muted)" }}>{n.via || "direct"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8, textAlign: "right" }}>
        {sorted.length} node{sorted.length === 1 ? "" : "s"}
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

        {/* Edges */}
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

        {/* Nodes */}
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
