import { useEffect, useRef, useState } from "react";
import { debugFrameBuffer, onDebugBufferChange, type DebugFrame } from "../api/useBackendSocket";

export function DebugTerminal({ onClose }: { onClose: () => void }) {
  const [frames, setFrames] = useState<DebugFrame[]>(() => [...debugFrameBuffer]);
  const [filter, setFilter] = useState("");
  const [paused, setPaused] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(false);

  pausedRef.current = paused;

  useEffect(() => {
    const unsub = onDebugBufferChange(() => {
      if (pausedRef.current) return;
      setFrames([...debugFrameBuffer]);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!paused) bottomRef.current?.scrollIntoView({ block: "end" });
  }, [frames, paused]);

  const visible = filter
    ? frames.filter((f) => f.frame.toLowerCase().includes(filter.toLowerCase()))
    : frames;

  function formatTime(tsMs: number) {
    const d = new Date(tsMs);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}.${String(d.getMilliseconds()).padStart(3, "0")}`;
  }

  function prettyFrame(raw: string) {
    try {
      return JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      return raw;
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal debug-modal" onClick={(e) => e.stopPropagation()}>
        <div className="debug-toolbar">
          <span className="debug-title">WPS Frame Log</span>
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{frames.length}/100</span>
          <input
            className="debug-filter"
            placeholder="Filter…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <button className="btn small" onClick={() => setPaused((v) => !v)}>
            {paused ? "Resume" : "Pause"}
          </button>
          <button className="btn small" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="debug-log">
          {visible.length === 0 && (
            <div className="debug-empty">No frames yet — connect to WPS to see traffic.</div>
          )}
          {visible.map((f) => (
            <div key={f.id} className={`debug-frame ${f.direction}`}>
              <span className="debug-meta">
                <span className={`debug-dir ${f.direction}`}>{f.direction === "in" ? "▼ IN " : "▲ OUT"}</span>
                <span className="debug-ts">{formatTime(f.tsMs)}</span>
              </span>
              <pre className="debug-body">{prettyFrame(f.frame)}</pre>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  );
}
