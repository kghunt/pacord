import { useConnectionStore, displayNameFor } from "../state/connectionStore";
import { useChatStore } from "../state/chatStore";

export function Sidebar({
  onOpenSettings,
  onOpenTerminal,
  onOpenAvatars,
}: {
  onOpenSettings: () => void;
  onOpenTerminal: () => void;
  onOpenAvatars: () => void;
}) {
  const { connectionState, profiles } = useConnectionStore();
  const { channels, peers, activeTarget, setActiveTarget, loadMessages, loadPosts } = useChatStore();

  const activeProfile = profiles.find((p) => p.id === connectionState.activeProfileId);

  // Viewing a channel only loads whatever local history is already cached —
  // it does NOT subscribe. Subscribing (which triggers a live feed + a
  // history backfill over the radio link) is an explicit opt-in from the
  // chat header, so browsing channels never silently starts pulling data
  // over a bandwidth-constrained RF link.
  function openChannel(cid: number) {
    setActiveTarget({ type: "channel", cid });
    loadPosts(cid);
  }

  function openDm(peer: string) {
    setActiveTarget({ type: "dm", peer });
    loadMessages(peer);
  }

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <h1>{activeProfile ? activeProfile.name : "Pacord"}</h1>
        <span className="status-pill">
          <span className={`status-dot ${connectionState.status}`} />
          {connectionState.status}
        </span>
      </div>

      <div className="sidebar-scroll">
        <div className="sidebar-section">
          <div className="sidebar-section-title">Channels</div>
          {channels.map((ch) => (
            <div
              key={ch.cid}
              className={`sidebar-item ${activeTarget?.type === "channel" && activeTarget.cid === ch.cid ? "active" : ""}`}
              onClick={() => openChannel(ch.cid)}
              title={ch.description}
            >
              <span className="hash">#</span>
              {ch.name || `channel-${ch.cid}`}
              {ch.subscribed && (
                <span
                  title="Subscribed — receiving live updates"
                  style={{ marginLeft: "auto", color: "var(--online)", fontSize: 10 }}
                >
                  ●
                </span>
              )}
            </div>
          ))}
        </div>

        <div className="sidebar-section">
          <div className="sidebar-section-title">Direct Messages</div>
          {peers.length === 0 && (
            <div style={{ padding: "4px 8px", fontSize: 12, color: "var(--text-muted)" }}>
              No conversations yet.
            </div>
          )}
          {peers.map((peer) => (
            <div
              key={peer}
              className={`sidebar-item ${activeTarget?.type === "dm" && activeTarget.peer === peer ? "active" : ""}`}
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
              {displayNameFor(peer)}
            </div>
          ))}
        </div>
      </div>

      <div className="sidebar-footer">
        <div className="status-pill">
          <span className={`status-dot ${connectionState.status}`} />
          {activeProfile ? activeProfile.myCall : "Not connected"}
        </div>
        <button className="icon-button" title="Avatars" onClick={onOpenAvatars}>
          🖼
        </button>
        <button className="icon-button" title="Node terminal" onClick={onOpenTerminal}>
          ⌨
        </button>
        <button className="icon-button" title="Connection profiles" onClick={onOpenSettings}>
          ⚙
        </button>
      </div>
    </div>
  );
}
