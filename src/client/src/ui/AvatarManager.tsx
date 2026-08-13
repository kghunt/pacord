import { useConnectionStore } from "../state/connectionStore";
import { sendAction } from "../api/socket";

// Avatars are large (many KB each) and this WPS server sends each one as a
// single continuous frame over the radio link — a full download of many
// avatars can take minutes. Checking the count is cheap; downloading is
// explicit and separate so it's never triggered by accident.
export function AvatarManager({ onClose }: { onClose: () => void }) {
  const avatarCount = useConnectionStore((s) => s.avatarCount);
  const avatarsReceived = useConnectionStore((s) => s.avatarsReceived);
  const startAvatarDownload = useConnectionStore((s) => s.startAvatarDownload);
  const connected = useConnectionStore((s) => s.connectionState.status === "connected");

  const downloading = avatarsReceived !== null;
  const total = avatarCount ?? null;
  const likelyDone = downloading && total !== null && avatarsReceived >= total && total > 0;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Avatars</h2>
        <p className="modal-subtitle">
          Avatar images are fetched from WPS on request — each one is a large transfer over the radio link, so
          nothing downloads automatically.
        </p>

        {!connected && <p style={{ color: "var(--text-muted)" }}>Connect first to check or download avatars.</p>}

        {connected && !downloading && (
          <p>
            {avatarCount === null
              ? "Not checked yet this session."
              : `${avatarCount} avatar${avatarCount === 1 ? "" : "s"} available (new/updated since last download).`}
          </p>
        )}

        {connected && downloading && (
          <>
            <p>
              {likelyDone
                ? `Done — received ${avatarsReceived} of ${total}.`
                : total !== null
                  ? `Downloading… received ${avatarsReceived} of ${total} so far.`
                  : `Downloading… received ${avatarsReceived} so far (run "Check count" first to see a total).`}
            </p>
            <div className="progress-track">
              <div
                className="progress-fill"
                style={{
                  width: total ? `${Math.min(100, (avatarsReceived / total) * 100)}%` : downloading ? "100%" : "0%",
                }}
              />
            </div>
            <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
              Avatars appear on messages and the online list as each one finishes — no need to wait here.
            </p>
          </>
        )}

        <div className="form-actions">
          <button className="btn" onClick={onClose}>
            Close
          </button>
          <button
            className="btn"
            disabled={!connected}
            onClick={() => sendAction({ type: "request_avatars", countOnly: true })}
          >
            Check count
          </button>
          <button
            className="btn primary"
            disabled={!connected}
            onClick={() => {
              startAvatarDownload();
              sendAction({ type: "request_avatars", countOnly: false });
            }}
          >
            Download new avatars
          </button>
        </div>
      </div>
    </div>
  );
}
