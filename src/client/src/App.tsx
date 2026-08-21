import { useEffect } from "react";
import { useBackendSocket } from "./api/useBackendSocket";
import { useConnectionStore } from "./state/connectionStore";
import { useChatStore } from "./state/chatStore";
import { Shell } from "./ui/Shell";

export default function App() {
  useBackendSocket();

  const loadProfiles = useConnectionStore((s) => s.loadProfiles);
  const loadRoster = useConnectionStore((s) => s.loadRoster);
  const connectionStatus = useConnectionStore((s) => s.connectionState.status);
  const loadChannels = useChatStore((s) => s.loadChannels);
  const loadPeers = useChatStore((s) => s.loadPeers);

  useEffect(() => {
    loadProfiles();
    loadChannels();
  }, [loadProfiles, loadChannels]);

  useEffect(() => {
    if (connectionStatus === "connected") {
      loadChannels();
      loadPeers();
      loadRoster();
    }
  }, [connectionStatus, loadChannels, loadPeers, loadRoster]);

  return <Shell />;
}
