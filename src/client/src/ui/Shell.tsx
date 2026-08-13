import { useEffect, useState } from "react";
import { Sidebar } from "./Sidebar";
import { ChatPane } from "./ChatPane";
import { OnlineUsersPane } from "./OnlineUsersPane";
import { ProfileManager } from "./ProfileManager";
import { TerminalPanel } from "./TerminalPanel";
import { AvatarManager } from "./AvatarManager";
import { DebugTerminal } from "./DebugTerminal";
import { useConnectionStore } from "../state/connectionStore";
import { useChatStore } from "../state/chatStore";
import { fetchVersion } from "../api/rest";

export function Shell() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [avatarsOpen, setAvatarsOpen] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const [updateDismissed, setUpdateDismissed] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<{ latest: string; version: string } | null>(null);
  const profiles = useConnectionStore((s) => s.profiles);
  const profilesLoaded = useConnectionStore((s) => s.profilesLoaded);
  const activeTarget = useChatStore((s) => s.activeTarget);
  const unreadCounts = useChatStore((s) => s.unreadCounts);

  useEffect(() => {
    const total = Object.values(unreadCounts).reduce((sum, n) => sum + n, 0);
    document.title = total > 0 ? `(${total > 99 ? "99+" : total}) Pacord` : "Pacord";
  }, [unreadCounts]);

  useEffect(() => {
    if (profilesLoaded && profiles.length === 0) setSettingsOpen(true);
  }, [profilesLoaded, profiles.length]);

  useEffect(() => {
    fetchVersion().then((v) => {
      if (v.updateAvailable && v.latest) setUpdateInfo({ latest: v.latest, version: v.version });
    }).catch(() => {});
  }, []);

  return (
    <>
      {updateInfo && !updateDismissed && (
        <div className="update-banner">
          <span>Pacord v{updateInfo.latest} is available (running v{updateInfo.version})</span>
          <code>sudo docker compose pull && sudo docker compose up -d</code>
          <button onClick={() => setUpdateDismissed(true)} title="Dismiss">×</button>
        </div>
      )}
    <div className={`app-shell${activeTarget ? " mobile-chat-active" : ""}`}>
      <Sidebar
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenTerminal={() => setTerminalOpen(true)}
        onOpenAvatars={() => setAvatarsOpen(true)}
        onOpenDebug={() => setDebugOpen(true)}
      />
      <ChatPane />
      <OnlineUsersPane />
      {settingsOpen && <ProfileManager onClose={() => setSettingsOpen(false)} />}
      {terminalOpen && <TerminalPanel onClose={() => setTerminalOpen(false)} />}
      {avatarsOpen && <AvatarManager onClose={() => setAvatarsOpen(false)} />}
      {debugOpen && <DebugTerminal onClose={() => setDebugOpen(false)} />}
    </div>
    </>
  );
}
