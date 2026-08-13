import { useEffect, useRef, useState } from "react";
import { sendAction } from "../api/socket";
import { onServerEvent } from "../api/socket";

interface DebugFrame {
  id: number;
  direction: "in" | "out";
  frame: string;
  tsMs: number;
}

let seq = 0;

export function DebugTerminal({ onClose }: { onClose: () => void }) {
  const [frames, setFrames] = useState<DebugFrame[]>([]);
  const [filter, setFilter] = useState("");
  const [paused, setPaused] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(false);

  pausedRef.current = paused;

  useEffect(() => {
    sendAction({ type: "set_debug", enabled: true });
    const unsub = onServerEvent((ev) => {
      if (ev.type !== "debug_frame") return;
      if (pausedRef.current) return;
      setFrames((prev) => {
        const next = [...prev, { id: seq++, direction: ev.direction, frame: ev.frame, tsMs: ev.tsMs }];
        return next.length > 500 ? next.slice(next.length - 500) : next;
      });
    });
    return () => {
      unsub();
      sendAction({ type: "set_debug", enabled: false });
    };
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
          <input
            className="debug-filter"
            placeholder="Filter…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <button className="btn small" onClick={() => setPaused((v) => !v)}>
            {paused ? "Resume" : "Pause"}
          </button>
          <button className="btn small" onClick={() => setFrames([])}>
            Clear
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
