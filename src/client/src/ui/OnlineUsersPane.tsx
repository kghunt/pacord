import { useConnectionStore, displayNameFor } from "../state/connectionStore";
import { useChatStore } from "../state/chatStore";
import { AvatarImg } from "./AvatarImg";

export function OnlineUsersPane() {
  const { connectionState } = useConnectionStore();
  const { setActiveTarget, loadMessages } = useChatStore();

  function openDm(call: string) {
    setActiveTarget({ type: "dm", peer: call });
    loadMessages(call);
  }

  return (
    <div className="online-pane">
      <div className="online-pane-title">Online &mdash; {connectionState.onlineUsers.length}</div>
      {connectionState.onlineUsers.map((call) => (
        <div key={call} className="online-user" onClick={() => openDm(call)}>
          <AvatarImg callsign={call} className="avatar-sm">
            <span className="presence-dot" />
          </AvatarImg>
          <div>
            <div className="name">{displayNameFor(call)}</div>
            {displayNameFor(call) !== call && <div className="call">{call}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}
