import { useEffect, useState, type ReactNode } from "react";
import { useConnectionStore } from "../state/connectionStore";
import { initials } from "../utils";

// Renders the real avatar image if we have one stored for this callsign,
// falling back to the initials circle otherwise (no avatar fetched yet, or
// a 404 from the server). avatarVersion busts the browser's cache of a
// prior 404 once a new avatar for this callsign actually arrives.
export function AvatarImg({
  callsign,
  className,
  children,
}: {
  callsign: string;
  className: string;
  children?: ReactNode;
}) {
  const avatarVersion = useConnectionStore((s) => s.avatarVersion);
  const [failed, setFailed] = useState(false);

  // A new avatar arriving (any callsign) bumps avatarVersion — retry once
  // rather than staying stuck on a stale "no avatar" fallback forever.
  useEffect(() => {
    setFailed(false);
  }, [avatarVersion]);

  if (failed) {
    return (
      <div className={className}>
        {initials(callsign)}
        {children}
      </div>
    );
  }

  return (
    <div className={className} style={{ padding: 0 }}>
      <img
        src={`/api/avatars/${callsign}?v=${avatarVersion}`}
        alt={callsign}
        style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "50%" }}
        onError={() => setFailed(true)}
      />
      {children}
    </div>
  );
}
