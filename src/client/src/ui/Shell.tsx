import { useEffect, useState } from "react";
import { Sidebar } from "./Sidebar";
import { ChatPane } from "./ChatPane";
import { OnlineUsersPane } from "./OnlineUsersPane";
import { ProfileManager } from "./ProfileManager";
import { TerminalPanel } from "./TerminalPanel";
import { AvatarManager } from "./AvatarManager";
import { useConnectionStore } from "../state/connectionStore";
import { useChatStore } from "../state/chatStore";

export function Shell() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [avatarsOpen, setAvatarsOpen] = useState(false);
  const profiles = useConnectionStore((s) => s.profiles);
  const profilesLoaded = useConnectionStore((s) => s.profilesLoaded);
  const activeTarget = useChatStore((s) => s.activeTarget);

  useEffect(() => {
    if (profilesLoaded && profiles.length === 0) setSettingsOpen(true);
  }, [profilesLoaded, profiles.length]);

  return (
    <div className={`app-shell${activeTarget ? " mobile-chat-active" : ""}`}>
      <Sidebar
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenTerminal={() => setTerminalOpen(true)}
        onOpenAvatars={() => setAvatarsOpen(true)}
      />
      <ChatPane />
      <OnlineUsersPane />
      {settingsOpen && <ProfileManager onClose={() => setSettingsOpen(false)} />}
      {terminalOpen && <TerminalPanel onClose={() => setTerminalOpen(false)} />}
      {avatarsOpen && <AvatarManager onClose={() => setAvatarsOpen(false)} />}
    </div>
  );
}
