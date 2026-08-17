import { useEffect, useState } from "react";
import type { NtfyLevel } from "@shared/types";
import { useChatStore } from "../state/chatStore";
import { fetchSettings, saveSettings, setChannelNtfyLevel, testNtfy, type AppSettings } from "../api/rest";

export function NotificationSettings({ onClose }: { onClose: () => void }) {
  const { channels, setChannels } = useChatStore();

  const [notifPerm, setNotifPerm] = useState<NotificationPermission>(
    typeof Notification !== "undefined" ? Notification.permission : "denied"
  );
  const [serverUrl, setServerUrl] = useState("");
  const [ntfyUrl, setNtfyUrl] = useState("");
  const [ntfyToken, setNtfyToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [ntfyTesting, setNtfyTesting] = useState(false);
  const [ntfyTestResult, setNtfyTestResult] = useState<"ok" | "error" | null>(null);

  useEffect(() => {
    fetchSettings().then((s: AppSettings) => {
      setServerUrl(s.serverUrl);
      setNtfyUrl(s.ntfyUrl);
      setNtfyToken(s.ntfyToken);
    }).catch(() => {});
  }, []);

  async function requestBrowserNotifications() {
    if (typeof Notification === "undefined") return;
    const result = await Notification.requestPermission();
    setNotifPerm(result);
  }

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      // Fetch current idle/avatar settings so we don't clobber them.
      const current = await fetchSettings();
      await saveSettings({
        idleDisconnectMinutes: current.idleDisconnectMinutes,
        avatarCheckIntervalMinutes: current.avatarCheckIntervalMinutes,
        serverUrl,
        ntfyUrl,
        ntfyToken,
      });
      setSaved(true);
      setNtfyTestResult(null);
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setNtfyTesting(true);
    setNtfyTestResult(null);
    try {
      await testNtfy();
      setNtfyTestResult("ok");
    } catch {
      setNtfyTestResult("error");
    } finally {
      setNtfyTesting(false);
    }
  }

  async function handleChannelLevel(cid: number, level: NtfyLevel) {
    try {
      await setChannelNtfyLevel(cid, level);
      setChannels(channels.map((c) => c.cid === cid ? { ...c, ntfyLevel: level } : c));
    } catch { /* ignore */ }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Notification Settings</h2>

        {/* ── Browser notifications ─────────────────────────────────── */}
        <div className="settings-section">
          <h3>Browser notifications</h3>
          <p className="form-hint" style={{ marginTop: 0 }}>
            In-browser alerts and sound when a message arrives while the tab is open.
          </p>
          {notifPerm === "granted" ? (
            <p style={{ color: "var(--online)", fontSize: 13 }}>Notifications enabled</p>
          ) : notifPerm === "denied" ? (
            <p style={{ color: "var(--danger)", fontSize: 13 }}>
              Blocked by the browser — enable them in your browser's site settings and reload.
            </p>
          ) : (
            <button className="btn small primary" onClick={requestBrowserNotifications}>
              Enable browser notifications
            </button>
          )}
        </div>

        {/* ── ntfy push notifications ───────────────────────────────── */}
        <div className="settings-section">
          <h3>Push notifications via ntfy</h3>
          <p className="form-hint" style={{ marginTop: 0 }}>
            Sends push notifications to your phone even when the app isn't open.
            Install the <a href="https://ntfy.sh" target="_blank" rel="noopener noreferrer">ntfy app</a>,
            subscribe to your topic, paste the URL below. Leave blank to disable.
          </p>

          <div className="form-row" style={{ marginBottom: 6 }}>
            <label>Pacord server URL</label>
            <input
              type="url"
              placeholder="http://192.168.1.50:3000"
              value={serverUrl}
              onChange={(e) => { setServerUrl(e.target.value); setSaved(false); }}
            />
            <p className="form-hint" style={{ marginTop: 4 }}>
              Used to add a deep link so tapping a notification opens Pacord at the right channel or DM.
              Use the URL you'd type in a browser on your phone.
            </p>
          </div>

          <div className="form-row" style={{ marginBottom: 6 }}>
            <label>ntfy topic URL</label>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="url"
                placeholder="https://ntfy.sh/my-pacord-abc123"
                value={ntfyUrl}
                style={{ flex: 1 }}
                onChange={(e) => { setNtfyUrl(e.target.value); setSaved(false); setNtfyTestResult(null); }}
              />
              <button
                className="btn small"
                onClick={handleTest}
                disabled={ntfyTesting || !ntfyUrl.trim()}
                title="Send a test notification to verify your ntfy setup"
              >
                {ntfyTesting ? "Sending…" : "Test"}
              </button>
            </div>
            {ntfyTestResult === "ok" && (
              <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--online)" }}>
                Test sent — check your ntfy app.
              </p>
            )}
            {ntfyTestResult === "error" && (
              <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--danger)" }}>
                Failed to send — check the URL and that the server can reach ntfy.
              </p>
            )}
          </div>

          <div className="form-row" style={{ marginBottom: 8 }}>
            <label>Access token (optional)</label>
            <input
              type="password"
              placeholder="tk_xxxxxxxxxxxx"
              value={ntfyToken}
              onChange={(e) => { setNtfyToken(e.target.value); setSaved(false); }}
            />
            <p className="form-hint" style={{ marginTop: 4 }}>
              Only needed for access-controlled topics. Generate one in the ntfy web UI under
              Account &rarr; Access tokens.
            </p>
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button className="btn small primary" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
            {saved && <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Saved</span>}
          </div>
        </div>

        {/* ── Per-channel levels ────────────────────────────────────── */}
        {channels.length > 0 && (
          <div className="settings-section">
            <h3>Channel notifications</h3>
            <p className="form-hint" style={{ marginTop: 0 }}>
              Direct messages always send a notification when ntfy is configured.
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "6px 12px", alignItems: "center" }}>
              {channels.map((ch) => (
                <>
                  <span key={`lbl-${ch.cid}`} style={{ fontSize: 13 }}>#{ch.name || `channel-${ch.cid}`}</span>
                  <select
                    key={`sel-${ch.cid}`}
                    value={ch.ntfyLevel}
                    style={{ fontSize: 13 }}
                    onChange={(e) => handleChannelLevel(ch.cid, e.target.value as NtfyLevel)}
                  >
                    <option value="all">All messages</option>
                    <option value="replies">Replies &amp; mentions</option>
                    <option value="mentions">Mentions only</option>
                    <option value="none">Off</option>
                  </select>
                </>
              ))}
            </div>
          </div>
        )}

        <div className="form-actions">
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
