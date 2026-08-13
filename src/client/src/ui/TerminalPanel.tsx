import { useConnectionStore } from "../state/connectionStore";

// Embeds the XRouter/XrPi node's own built-in web terminal (its live
// AX.25/NET-ROM monitor + sysop console) directly inside Pacord, so you
// don't have to keep a separate tab open to watch what's actually
// happening on the radio side while testing a connection.
export function TerminalPanel({ onClose }: { onClose: () => void }) {
  const { connectionState, profiles } = useConnectionStore();
  const profile =
    profiles.find((p) => p.id === connectionState.activeProfileId) ??
    profiles.find((p) => p.isDefault) ??
    profiles[0];

  if (!profile) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <h2>Terminal</h2>
          <p className="modal-subtitle">No connection profile configured yet.</p>
          <div className="form-actions">
            <button className="btn" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!profile.adminPort) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <h2>Terminal</h2>
          <p className="modal-subtitle">
            &ldquo;{profile.name}&rdquo; doesn&apos;t have an admin/terminal port set. Add one via Edit on that
            profile (&ldquo;Admin/Terminal port&rdquo; — usually 8086).
          </p>
          <div className="form-actions">
            <button className="btn" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  const url = `http://${profile.host}:${profile.adminPort}/terminal`;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal terminal-modal" onClick={(e) => e.stopPropagation()}>
        <div className="terminal-modal-header">
          <h2>Terminal — {profile.name}</h2>
          <button className="btn small" onClick={onClose}>
            Close
          </button>
        </div>
        <iframe src={url} className="terminal-iframe" title="Node terminal" />
      </div>
    </div>
  );
}
