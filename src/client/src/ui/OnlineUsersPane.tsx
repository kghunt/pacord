import { useState } from "react";
import { useConnectionStore, displayNameFor } from "../state/connectionStore";
import { useChatStore } from "../state/chatStore";
import { AvatarImg } from "./AvatarImg";

function lastSeenText(ts: number): string {
  const msTs = ts < 1_000_000_000_000 ? ts * 1000 : ts;
  const diff = Date.now() - msTs;
  if (diff < 60_000) return "Last seen just now";
  if (diff < 3_600_000) return `Last seen ${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `Last seen ${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 7 * 86_400_000) return `Last seen ${Math.floor(diff / 86_400_000)}d ago`;
  return `Last seen ${new Date(msTs).toLocaleDateString()}`;
}

export function OnlineUsersPane({
  mobileOpen,
  onMobileClose,
}: {
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}) {
  const { connectionState, hams } = useConnectionStore();
  const { setActiveTarget, loadMessages } = useChatStore();
  const [offlineOpen, setOfflineOpen] = useState(false);
  const [search, setSearch] = useState("");

  const onlineSet = new Set(connectionState.onlineUsers);
  const toMs = (ts: number) => (ts < 1_000_000_000_000 ? ts * 1000 : ts);
  const q = search.trim().toLowerCase();

  const matchesSearch = (call: string) => {
    if (!q) return true;
    const name = (hams[call]?.name ?? "").toLowerCase();
    return call.toLowerCase().includes(q) || name.includes(q);
  };

  const visibleOnline = connectionState.onlineUsers.filter(matchesSearch);

  const offlineHams = Object.values(hams)
    .filter((h) => !onlineSet.has(h.callsign) && matchesSearch(h.callsign))
    .sort((a, b) => toMs(b.ts) - toMs(a.ts));

  function openDm(call: string) {
    setActiveTarget({ type: "dm", peer: call });
    loadMessages(call);
    onMobileClose?.();
  }

  return (
    <div className={`online-pane${mobileOpen ? " mobile-open" : ""}`}>
      <div className="online-pane-title" style={{ display: "flex", alignItems: "center" }}>
        <span>Online &mdash; {connectionState.onlineUsers.length}</span>
        {onMobileClose && <button className="icon-button" style={{ marginLeft: "auto", fontSize: 18 }} onClick={onMobileClose}>×</button>}
      </div>

      <input
        className="online-search"
        type="search"
        placeholder="Search…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {visibleOnline.map((call) => (
        <div key={call} className="online-user" onClick={() => openDm(call)} title="Online now">
          <AvatarImg callsign={call} className="avatar-sm">
            <span className="presence-dot" />
          </AvatarImg>
          <div>
            <div className="name">{displayNameFor(call)}</div>
            {displayNameFor(call) !== call && <div className="call">{call}</div>}
          </div>
        </div>
      ))}

      {offlineHams.length > 0 && (
        <>
          <div
            className="online-pane-title offline-toggle"
            onClick={() => setOfflineOpen((v) => !v)}
            title={offlineOpen ? "Hide offline users" : "Show offline users"}
          >
            {offlineOpen ? "▾" : "▸"} Offline &mdash; {offlineHams.length}{q ? " (filtered)" : ""}
          </div>

          {offlineOpen && offlineHams.map((h) => (
            <div
              key={h.callsign}
              className="online-user offline"
              onClick={() => openDm(h.callsign)}
              title={h.ts > 0 ? lastSeenText(h.ts) : "Offline"}
            >
              <AvatarImg callsign={h.callsign} className="avatar-sm">
                <span className="presence-dot offline" />
              </AvatarImg>
              <div>
                <div className="name">{displayNameFor(h.callsign)}</div>
                {displayNameFor(h.callsign) !== h.callsign && <div className="call">{h.callsign}</div>}
                {h.ts > 0 && <div className="last-seen">{lastSeenText(h.ts)}</div>}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
