import { useCallback, useEffect, useRef, useState } from "react";
import { Sidebar } from "./Sidebar";
import { ChatPane } from "./ChatPane";
import { OnlineUsersPane } from "./OnlineUsersPane";
import { ProfileManager } from "./ProfileManager";
import { TerminalPanel } from "./TerminalPanel";
import { AvatarManager } from "./AvatarManager";
import { DebugTerminal } from "./DebugTerminal";
import { NodeInfo } from "./NodeInfo";
import { NotificationSettings } from "./NotificationSettings";
import { SearchModal } from "./SearchModal";
import { useConnectionStore } from "../state/connectionStore";
import { useChatStore } from "../state/chatStore";
import { fetchSettings, fetchVersion } from "../api/rest";
import { sendAction } from "../api/socket";

export function Shell() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [avatarsOpen, setAvatarsOpen] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const [nodeInfoOpen, setNodeInfoOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileOnlineOpen, setMobileOnlineOpen] = useState(false);
  const [updateDismissed, setUpdateDismissed] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<{ latest: string; version: string } | null>(null);
  const [avatarCheckIntervalMinutes, setAvatarCheckIntervalMinutes] = useState(0);
  const [avatarBannerDismissed, setAvatarBannerDismissed] = useState(false);
  const prevAvatarCount = useRef<number | null>(null);

  const profiles = useConnectionStore((s) => s.profiles);
  const profilesLoaded = useConnectionStore((s) => s.profilesLoaded);
  const connected = useConnectionStore((s) => s.connectionState.status === "connected");
  const avatarCount = useConnectionStore((s) => s.avatarCount);
  const welcomeReceived = useConnectionStore((s) => s.welcomeReceived);
  const setWelcomeReceived = useConnectionStore((s) => s.setWelcomeReceived);
  const activeTarget = useChatStore((s) => s.activeTarget);
  const unreadCounts = useChatStore((s) => s.unreadCounts);
  const channels = useChatStore((s) => s.channels);
  const { setActiveTarget, loadPosts, loadMessages } = useChatStore();
  const channelNames = Object.fromEntries(channels.map((c) => [c.cid, c.name]));

  useEffect(() => {
    const total = Object.values(unreadCounts).reduce((sum, n) => sum + n, 0);
    document.title = total > 0 ? `(${total > 99 ? "99+" : total}) Pacord` : "Pacord";
  }, [unreadCounts]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (profilesLoaded && profiles.length === 0) setSettingsOpen(true);
  }, [profilesLoaded, profiles.length]);

  // Deep-link navigation from ntfy notification click URLs.
  // Hash format: #channel-{slug} or #dm-{callsign}
  const navigateToHash = useCallback((hash: string) => {
    if (!hash) return;
    if (hash.startsWith("#channel-")) {
      const slug = hash.slice("#channel-".length);
      const ch = channels.find(
        (c) => (c.name || `channel-${c.cid}`).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") === slug
      );
      if (ch) {
        setActiveTarget({ type: "channel", cid: ch.cid });
        loadPosts(ch.cid);
        sendAction({ type: "mark_read", key: `channel:${ch.cid}` });
        history.replaceState(null, "", window.location.pathname);
      }
    } else if (hash.startsWith("#dm-")) {
      const peer = hash.slice("#dm-".length).toUpperCase();
      if (peer) {
        setActiveTarget({ type: "dm", peer });
        loadMessages(peer);
        sendAction({ type: "mark_read", key: peer });
        history.replaceState(null, "", window.location.pathname);
      }
    }
  }, [channels, setActiveTarget, loadPosts, loadMessages]);

  // On initial load with channels available, process any hash in the URL.
  const deepLinkProcessed = useRef(false);
  useEffect(() => {
    if (deepLinkProcessed.current || channels.length === 0) return;
    const hash = window.location.hash;
    if (!hash) { deepLinkProcessed.current = true; return; }
    navigateToHash(hash);
    deepLinkProcessed.current = true;
  }, [channels, navigateToHash]);

  // When already open, handle notification taps that change the hash.
  useEffect(() => {
    function onHashChange() { navigateToHash(window.location.hash); }
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, [navigateToHash]);

  useEffect(() => {
    fetchVersion().then((v) => {
      if (v.updateAvailable && v.latest) setUpdateInfo({ latest: v.latest, version: v.version });
    }).catch(() => {});
  }, []);

  // Re-fetch settings whenever the settings modal closes so the interval
  // updates immediately after the user saves a new value.
  useEffect(() => {
    if (settingsOpen) return;
    fetchSettings().then((s) => {
      setAvatarCheckIntervalMinutes(s.avatarCheckIntervalMinutes);
    }).catch(() => {});
  }, [settingsOpen]);

  // Periodic avatar count check.
  useEffect(() => {
    if (avatarCheckIntervalMinutes <= 0 || !connected) return;
    const timer = setInterval(() => {
      sendAction({ type: "request_avatars", countOnly: true });
    }, avatarCheckIntervalMinutes * 60 * 1000);
    return () => clearInterval(timer);
  }, [avatarCheckIntervalMinutes, connected]);

  // Reset banner dismissal when the count increases.
  useEffect(() => {
    if (avatarCount !== null && avatarCount > (prevAvatarCount.current ?? 0)) {
      setAvatarBannerDismissed(false);
    }
    prevAvatarCount.current = avatarCount;
  }, [avatarCount]);

  const showAvatarBanner = avatarCount !== null && avatarCount > 0 && !avatarBannerDismissed;

  return (
    <>
      {updateInfo && !updateDismissed && (
        <div className="update-banner">
          <span>Pacord v{updateInfo.latest} is available (running v{updateInfo.version})</span>
          <code>sudo docker compose pull && sudo docker compose up -d</code>
          <button onClick={() => setUpdateDismissed(true)} title="Dismiss">×</button>
        </div>
      )}
      {welcomeReceived && (
        <div className="update-banner" style={{ background: "var(--online)" }}>
          <span>Welcome to WhatsPac! You're all set — start chatting by selecting a channel or sending a direct message.</span>
          <button onClick={() => setWelcomeReceived(false)} title="Dismiss">×</button>
        </div>
      )}
      {showAvatarBanner && (
        <div
          className="update-banner avatar-banner"
          onClick={() => { setAvatarsOpen(true); setAvatarBannerDismissed(true); }}
          style={{ cursor: "pointer" }}
        >
          <span>🖼 {avatarCount} new avatar{avatarCount === 1 ? "" : "s"} available — click to download</span>
          <button
            onClick={(e) => { e.stopPropagation(); setAvatarBannerDismissed(true); }}
            title="Dismiss"
          >
            ×
          </button>
        </div>
      )}
    <div className={`app-shell${activeTarget ? " mobile-chat-active" : ""}`}>
      <Sidebar
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenTerminal={() => setTerminalOpen(true)}
        onOpenAvatars={() => setAvatarsOpen(true)}
        onOpenDebug={() => setDebugOpen(true)}
        onOpenNodeInfo={() => setNodeInfoOpen(true)}
        onOpenSearch={() => setSearchOpen(true)}
        onOpenNotifications={() => setNotificationsOpen(true)}
      />
      <ChatPane onToggleOnline={() => setMobileOnlineOpen((v) => !v)} />
      <OnlineUsersPane mobileOpen={mobileOnlineOpen} onMobileClose={() => setMobileOnlineOpen(false)} />
      {settingsOpen && <ProfileManager onClose={() => setSettingsOpen(false)} />}
      {terminalOpen && <TerminalPanel onClose={() => setTerminalOpen(false)} />}
      {avatarsOpen && <AvatarManager onClose={() => setAvatarsOpen(false)} />}
      {debugOpen && <DebugTerminal onClose={() => setDebugOpen(false)} />}
      {nodeInfoOpen && <NodeInfo onClose={() => setNodeInfoOpen(false)} />}
      {notificationsOpen && <NotificationSettings onClose={() => setNotificationsOpen(false)} />}
      {searchOpen && <SearchModal onClose={() => setSearchOpen(false)} channelNames={channelNames} />}
    </div>
    </>
  );
}
