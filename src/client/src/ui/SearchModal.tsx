import { useEffect, useRef, useState } from "react";
import type { SearchResult } from "@shared/types";
import { searchHistory } from "../api/rest";
import { useChatStore } from "../state/chatStore";
import { fullDisplayFor } from "../state/connectionStore";
import { formatTime } from "../utils";

function highlight(text: string, q: string): React.ReactNode {
  if (!q) return text;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="search-highlight">{text.slice(idx, idx + q.length)}</mark>
      {text.slice(idx + q.length)}
    </>
  );
}

export function SearchModal({ onClose, channelNames }: { onClose: () => void; channelNames: Record<number, string> }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { setActiveTarget, loadMessages, loadPosts, setJumpToKey } = useChatStore();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    debounceRef.current = setTimeout(() => {
      searchHistory(q)
        .then((r) => { setResults(r); setSelected(0); setLoading(false); })
        .catch((e: Error) => { setError(e.message); setLoading(false); });
    }, 280);
  }, [query]);

  function open(r: SearchResult) {
    if (r.kind === "dm" && r.peer) {
      loadMessages(r.peer);
      setActiveTarget({ type: "dm", peer: r.peer });
      if (r.msgId) setJumpToKey(r.msgId);
    } else if (r.kind === "channel" && r.cid !== undefined) {
      loadPosts(r.cid);
      setActiveTarget({ type: "channel", cid: r.cid });
      if (r.postTs !== undefined) setJumpToKey(String(r.postTs));
    }
    onClose();
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") { onClose(); return; }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter" && results[selected]) {
      open(results[selected]!);
    }
  }

  // Scroll the selected item into view when navigating with keyboard.
  useEffect(() => {
    const item = listRef.current?.querySelector(`[data-idx="${selected}"]`);
    item?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const q = query.trim();

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal search-modal" onClick={(e) => e.stopPropagation()}>
        <div className="search-input-row">
          <span className="search-icon">🔍</span>
          <input
            ref={inputRef}
            className="search-input"
            placeholder="Search messages and posts…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKey}
          />
          {loading && <span className="search-spinner" />}
        </div>

        <div className="search-results" ref={listRef}>
          {!loading && q.length >= 2 && results.length === 0 && !error && (
            <div className="search-empty">No results for &ldquo;{q}&rdquo;</div>
          )}
          {error && <div className="search-empty search-error">{error}</div>}
          {results.map((r, i) => (
            <div
              key={i}
              data-idx={i}
              className={`search-result${i === selected ? " selected" : ""}`}
              onClick={() => open(r)}
              onMouseEnter={() => setSelected(i)}
            >
              <div className="search-result-meta">
                <span className="search-result-where">
                  {r.kind === "dm"
                    ? `DM · ${fullDisplayFor(r.peer ?? "")}`
                    : `# ${channelNames[r.cid!] ?? r.cid}`}
                </span>
                <span className="search-result-from">{fullDisplayFor(r.fromCall)}</span>
                <span className="search-result-ts">{formatTime(r.tsMs, "ms")}</span>
              </div>
              <div className="search-result-body">{highlight(r.body, q)}</div>
            </div>
          ))}
        </div>

        {results.length > 0 && (
          <div className="search-footer">
            {results.length} result{results.length === 1 ? "" : "s"} &nbsp;·&nbsp;
            ↑↓ navigate &nbsp;·&nbsp; Enter open &nbsp;·&nbsp; Esc close
          </div>
        )}
      </div>
    </div>
  );
}
