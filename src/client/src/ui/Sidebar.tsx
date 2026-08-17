import { useState, useEffect } from "react";
import { useConnectionStore, displayNameFor, fullDisplayFor } from "../state/connectionStore";
import { useChatStore } from "../state/chatStore";
import { fetchVersion } from "../api/rest";
import { sendAction } from "../api/socket";

export function Sidebar({
  onOpenSettings,
  onOpenTerminal,
  onOpenAvatars,
  onOpenDebug,
  onOpenNodeInfo,
  onOpenSearch,
  onOpenNotifications,
}: {
  onOpenSettings: () => void;
  onOpenTerminal: () => void;
  onOpenAvatars: () => void;
  onOpenDebug: () => void;
  onOpenNodeInfo: () => void;
  onOpenSearch: () => void;
  onOpenNotifications: () => void;
}) {
  const { connectionState, profiles, connect, disconnect } = useConnectionStore();
  const { channels, peers, activeTarget, setActiveTarget, loadMessages, loadPosts, unreadCounts } = useChatStore();

  const activeProfile = profiles.find((p) => p.id === connectionState.activeProfileId);

  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    fetchVersion().then((v) => setVersion(v.version)).catch(() => {});
  }, []);

  async function handleStatusClick() {
    const status = connectionState.status;
    if (status === "connecting") return;
    if (status === "connected") {
      if (confirm("Disconnect from the radio network?")) {
        try { await disconnect(); } catch { /* ignore */ }
      }
    } else {
      const target = activeProfile ?? profiles[0];
      if (!target) { onOpenSettings(); return; }
      const name = target.name || target.myCall;
      if (confirm(`Connect using profile "${name}"?`)) {
        try { await connect(target.id); } catch { /* ignore */ }
      }
    }
  }

  function openChannel(cid: number) {
    setActiveTarget({ type: "channel", cid });
    loadPosts(cid);
    sendAction({ type: "mark_read", key: `channel:${cid}` });
  }

  function openDm(peer: string) {
    setActiveTarget({ type: "dm", peer });
    loadMessages(peer);
    sendAction({ type: "mark_read", key: peer });
  }

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <h1
          style={{ cursor: "pointer" }}
          title="View node info &amp; network map"
          onClick={onOpenNodeInfo}
        >
          {activeProfile ? activeProfile.name : "Pacord"}
        </h1>
        <span
          className="status-pill"
          style={{ cursor: connectionState.status !== "connecting" ? "pointer" : "default" }}
          title={
            connectionState.status === "connected" ? "Click to disconnect" :
            connectionState.status === "connecting" ? "Connecting…" :
            "Click to connect"
          }
          onClick={handleStatusClick}
        >
          <span className={`status-dot ${connectionState.status}`} />
          {connectionState.status}
        </span>
      </div>

      <div className="sidebar-scroll">
        <div className="sidebar-section">
          <div className="sidebar-section-title">Channels</div>
          {channels.map((ch) => {
            const unread = unreadCounts[`channel:${ch.cid}`] ?? 0;
            return (
              <div
                key={ch.cid}
                className={`sidebar-item ${activeTarget?.type === "channel" && activeTarget.cid === ch.cid ? "active" : ""} ${unread > 0 ? "has-unread" : ""}`}
                onClick={() => openChannel(ch.cid)}
                title={ch.description}
              >
                <span className="hash">#</span>
                {ch.name || `channel-${ch.cid}`}
                {unread > 0
                  ? <span className="unread-badge">{unread > 99 ? "99+" : unread}</span>
                  : ch.subscribed && (
                    <span
                      title="Subscribed — receiving live updates"
                      style={{ marginLeft: "auto", color: "var(--online)", fontSize: 10 }}
                    >
                      ●
                    </span>
                  )}
              </div>
            );
          })}
        </div>

        <div className="sidebar-section">
          <div className="sidebar-section-title">Direct Messages</div>
          {peers.length === 0 && (
            <div style={{ padding: "4px 8px", fontSize: 12, color: "var(--text-muted)" }}>
              No conversations yet.
            </div>
          )}
          {peers.map((peer) => {
            const unread = unreadCounts[peer] ?? 0;
            return (
              <div
                key={peer}
                className={`sidebar-item ${activeTarget?.type === "dm" && activeTarget.peer === peer ? "active" : ""} ${unread > 0 ? "has-unread" : ""}`}
                onClick={() => openDm(peer)}
              >
                <span
                  className="presence-dot"
                  style={{
                    position: "static",
                    border: "none",
                    background: connectionState.onlineUsers.includes(peer) ? "var(--online)" : "var(--text-muted)",
                    width: 8,
                    height: 8,
                  }}
                />
                {fullDisplayFor(peer)}
                {unread > 0 && <span className="unread-badge">{unread > 99 ? "99+" : unread}</span>}
              </div>
            );
          })}
        </div>
      </div>

      <div className="sidebar-footer">
        <div className="status-pill">
          <span className={`status-dot ${connectionState.status}`} />
          {activeProfile ? activeProfile.myCall : "Not connected"}
          {version && <span style={{ marginLeft: "auto", fontSize: 10 }}>v{version}</span>}
        </div>
        <div className="sidebar-footer-icons">
          <button className="icon-button" title="Search messages (Ctrl+K)" onClick={onOpenSearch}>
            🔍
          </button>
          <button className="icon-button" title="Avatars" onClick={onOpenAvatars}>
            🖼
          </button>
          <button className="icon-button" title="Notification settings" onClick={onOpenNotifications}>
            🔔
          </button>
          <button className="icon-button" title="Node terminal" onClick={onOpenTerminal}>
            ⌨
          </button>
          <button className="icon-button" title="WPS frame log" onClick={onOpenDebug}>
            🐛
          </button>
          <button className="icon-button" title="Connection profiles" onClick={onOpenSettings}>
            ⚙
          </button>
        </div>
      </div>
    </div>
  );
}
