import { useEffect, useRef, useState } from "react";
import type { AxLevel, ConnectProfile, Engine, HopStep, NewConnectProfile, Transport } from "@shared/types";
import { defaultPort, defaultRadioPort, defaultRemote } from "@shared/engineDefaults";
import { useConnectionStore } from "../state/connectionStore";
import { fetchSettings, saveSettings, type AppSettings } from "../api/rest";

export function ProfileManager({ onClose }: { onClose: () => void }) {
  const { profiles, connectionState, createProfile, deleteProfile, connect, disconnect } = useConnectionStore();
  const [editing, setEditing] = useState<ConnectProfile | "new" | null>(null);
  const [idleMinutes, setIdleMinutes] = useState<number>(0);
  const [avatarCheckMinutes, setAvatarCheckMinutes] = useState<number>(0);
  const [ntfyUrl, setNtfyUrl] = useState("");
  const [ntfyToken, setNtfyToken] = useState("");
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState(false);

  useEffect(() => {
    fetchSettings().then((s: AppSettings) => {
      setIdleMinutes(s.idleDisconnectMinutes);
      setAvatarCheckMinutes(s.avatarCheckIntervalMinutes);
      setNtfyUrl(s.ntfyUrl);
      setNtfyToken(s.ntfyToken);
    }).catch(() => {});
  }, []);

  async function saveAllSettings() {
    setSettingsSaving(true);
    setSettingsSaved(false);
    try {
      await saveSettings({
        idleDisconnectMinutes: idleMinutes,
        avatarCheckIntervalMinutes: avatarCheckMinutes,
        ntfyUrl,
        ntfyToken,
      });
      setSettingsSaved(true);
    } finally {
      setSettingsSaving(false);
    }
  }

  if (editing) {
    return <ProfileForm profile={editing === "new" ? null : editing} onDone={() => setEditing(null)} />;
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Connection Profiles</h2>
        <p className="modal-subtitle">
          Saved here on the server — visible to everyone on the LAN who opens this app.
        </p>

        {profiles.length === 0 && (
          <p style={{ color: "var(--text-muted)" }}>No profiles yet — add one to connect to your XRouter node.</p>
        )}

        {profiles.map((p) => {
          const isActive = connectionState.activeProfileId === p.id;
          return (
            <div key={p.id} className="profile-list-item">
              <div>
                <div>
                  {p.name}
                  {isActive && (
                    <span className="status-pill" style={{ marginLeft: 8 }}>
                      <span className={`status-dot ${connectionState.status}`} />
                      {connectionState.status}
                    </span>
                  )}
                </div>
                <div className="meta">
                  {p.myCall} &middot; {p.host}:{p.port} &middot; {p.engine}
                </div>
              </div>
              <div className="actions">
                {isActive ? (
                  <button className="btn small" onClick={() => disconnect()}>
                    Disconnect
                  </button>
                ) : (
                  <button className="btn small primary" onClick={() => connect(p.id)}>
                    Connect
                  </button>
                )}
                <button className="btn small" onClick={() => setEditing(p)}>
                  Edit
                </button>
                <button
                  className="btn small"
                  onClick={() => {
                    const { id: _id, ...rest } = p;
                    createProfile({ ...rest, name: `${p.name} (copy)`, isDefault: false });
                  }}
                >
                  Duplicate
                </button>
                <button
                  className="btn small danger"
                  onClick={() => {
                    if (isActive) disconnect();
                    deleteProfile(p.id);
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          );
        })}

        <div className="settings-section">
          <h3>Server Settings</h3>
          <div className="form-row" style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <label style={{ flex: "none", marginBottom: 0 }}>Auto-disconnect from WPS after</label>
            <input
              type="number"
              min={0}
              style={{ width: 70 }}
              value={idleMinutes}
              onChange={(e) => { setIdleMinutes(Number(e.target.value)); setSettingsSaved(false); }}
            />
            <span style={{ color: "var(--text-muted)" }}>minutes idle (0 = never)</span>
          </div>
          <p className="form-hint">
            If no browser has the app open for this many minutes the server will disconnect from WPS, marking
            you offline on the network. Reconnects automatically when you next open the app.
          </p>
          <div className="form-row" style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
            <label style={{ flex: "none", marginBottom: 0 }}>Check for new avatars every</label>
            <input
              type="number"
              min={0}
              style={{ width: 70 }}
              value={avatarCheckMinutes}
              onChange={(e) => { setAvatarCheckMinutes(Number(e.target.value)); setSettingsSaved(false); }}
            />
            <span style={{ color: "var(--text-muted)" }}>minutes (0 = never)</span>
          </div>
          <p className="form-hint">
            Periodically asks WPS how many new avatars are available. A banner appears in the app if any are
            waiting — click it to open the avatar download panel.
          </p>

          <h4 style={{ margin: "16px 0 8px" }}>Push notifications via ntfy</h4>
          <p className="form-hint" style={{ marginTop: 0 }}>
            ntfy is a free, self-hostable service that delivers push notifications to your phone without needing
            HTTPS or browser permissions. Install the ntfy app, subscribe to your topic, then paste the full topic
            URL here. Leave blank to disable.
          </p>
          <div className="form-row" style={{ marginBottom: 6 }}>
            <label>ntfy topic URL</label>
            <input
              type="url"
              placeholder="https://ntfy.sh/my-pacord-abc123"
              value={ntfyUrl}
              onChange={(e) => { setNtfyUrl(e.target.value); setSettingsSaved(false); }}
            />
          </div>
          <div className="form-row" style={{ marginBottom: 6 }}>
            <label>Access token (optional)</label>
            <input
              type="password"
              placeholder="tk_xxxxxxxxxxxx"
              value={ntfyToken}
              onChange={(e) => { setNtfyToken(e.target.value); setSettingsSaved(false); }}
            />
            <p className="form-hint" style={{ marginTop: 4 }}>
              Only needed if your topic is protected. For a private self-hosted ntfy server, generate one in
              ntfy's web UI under Account &rarr; Access tokens.
            </p>
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
            <button className="btn small primary" onClick={saveAllSettings} disabled={settingsSaving}>
              {settingsSaving ? "Saving…" : "Save settings"}
            </button>
            {settingsSaved && <span style={{ color: "var(--text-muted)", fontSize: 12 }}>Saved</span>}
          </div>
        </div>

        <div className="form-actions">
          <button className="btn" onClick={onClose}>
            Close
          </button>
          <button className="btn primary" onClick={() => setEditing("new")}>
            + New profile
          </button>
        </div>
      </div>
    </div>
  );
}

function ProfileForm({ profile, onDone }: { profile: ConnectProfile | null; onDone: () => void }) {
  const { createProfile, updateProfile } = useConnectionStore();
  const [name, setName] = useState(profile?.name ?? "");
  const [myCall, setMyCall] = useState(profile?.myCall ?? "");
  const [displayName, setDisplayName] = useState(profile?.displayName ?? "");
  const [engine, setEngine] = useState<Engine>(profile?.engine ?? "xrouter");
  const [transport, setTransport] = useState<Transport>(profile?.transport ?? "rhp-ws");
  const [host, setHost] = useState(profile?.host ?? "");
  const [port, setPort] = useState(profile?.port ?? defaultPort("xrouter", "rhp-ws") ?? 8086);
  const [radioPort, setRadioPort] = useState<number | null>(profile?.radioPort ?? defaultRadioPort("xrouter"));
  const [remote, setRemote] = useState(profile?.remote ?? defaultRemote("xrouter"));
  const [axLevel, setAxLevel] = useState<AxLevel>(profile?.axLevel ?? "L2");
  const [adminPort, setAdminPort] = useState<number | null>(profile?.adminPort ?? 8086);
  const [authUser, setAuthUser] = useState(profile?.authUser ?? "");
  const [authPass, setAuthPass] = useState(profile?.authPass ?? "");
  const [connectScript, setConnectScript] = useState<HopStep[]>(profile?.connectScript ?? []);
  const [responseTimeoutS, setResponseTimeoutS] = useState((profile?.responseTimeoutMs ?? 30000) / 1000);
  const [isDefault, setIsDefault] = useState(profile?.isDefault ?? false);
  const [advanced, setAdvanced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const dragIndex = useRef<number | null>(null);

  function onEngineChange(next: Engine) {
    setEngine(next);
    setPort(defaultPort(next, transport) ?? 8086);
    setRadioPort(defaultRadioPort(next));
    setRemote(defaultRemote(next));
  }

  function onTransportChange(next: Transport) {
    setTransport(next);
    setPort(defaultPort(engine, next) ?? (next === "rhp-tcp" ? 9000 : 8086));
  }

  async function submit() {
    setError(null);
    if (!name.trim() || !myCall.trim()) {
      setError("Name and callsign are required.");
      return;
    }
    const body: NewConnectProfile = {
      name: name.trim(),
      transport,
      host: host.trim(),
      port: Number(port),
      engine,
      axLevel,
      radioPort: radioPort === null ? null : Number(radioPort),
      remote: remote.trim(),
      myCall: myCall.trim().toUpperCase(),
      displayName: displayName.trim() || myCall.trim().toUpperCase(),
      authUser: authUser.trim() || null,
      authPass: authPass.trim() || null,
      connectScript,
      responseTimeoutMs: Math.round(Number(responseTimeoutS) * 1000),
      adminPort: adminPort === null ? null : Number(adminPort),
      isDefault,
    };
    setSaving(true);
    try {
      if (profile) {
        await updateProfile(profile.id, body);
      } else {
        await createProfile(body);
      }
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function updateStep(i: number, patch: Partial<HopStep>) {
    setConnectScript((steps) => steps.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }

  return (
    <div className="modal-overlay" onClick={onDone}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{profile ? "Edit profile" : "New connection profile"}</h2>
        <p className="modal-subtitle">Details for reaching your XRouter node's WPS chat service.</p>

        {error && <p style={{ color: "var(--danger)" }}>{error}</p>}

        <div className="form-row two-col">
          <div className="form-row">
            <label>Profile name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Home XRouter" />
          </div>
          <div className="form-row">
            <label>Your callsign</label>
            <input value={myCall} onChange={(e) => setMyCall(e.target.value.toUpperCase())} placeholder="M0ABC-7" />
          </div>
        </div>

        <div className="form-row">
          <label>Display name</label>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Shown to other WhatsPac users"
          />
        </div>

        <div className="form-row two-col">
          <div className="form-row">
            <label>Engine</label>
            <select value={engine} onChange={(e) => onEngineChange(e.target.value as Engine)}>
              <option value="xrouter">XRouter</option>
              <option value="bpq">BPQ</option>
              <option value="custom">Custom</option>
            </select>
          </div>
          <div className="form-row">
            <label>Host</label>
            <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="192.168.1.50 or xrouter.local" />
          </div>
        </div>

        <div className="form-row two-col">
          <div className="form-row">
            <label>Transport</label>
            <select value={transport} onChange={(e) => onTransportChange(e.target.value as Transport)}>
              <option value="rhp-ws">RHP over WebSocket (node's web admin port)</option>
              <option value="rhp-tcp">RHP over raw TCP (RHPPORT in XROUTER.CFG)</option>
            </select>
          </div>
          <div className="form-row">
            <label>Port</label>
            <input type="number" value={port} onChange={(e) => setPort(Number(e.target.value))} />
          </div>
        </div>

        <div className="form-row two-col">
          <div className="form-row">
            <label>Radio port</label>
            <input
              type="number"
              value={radioPort ?? ""}
              onChange={(e) => setRadioPort(e.target.value === "" ? null : Number(e.target.value))}
            />
          </div>
          <div className="form-row">
            <label>Admin/Terminal port (optional)</label>
            <input
              type="number"
              value={adminPort ?? ""}
              placeholder="8086"
              onChange={(e) => setAdminPort(e.target.value === "" ? null : Number(e.target.value))}
            />
          </div>
        </div>

        <div className="form-row">
          <label>
            <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} /> Default
            profile (auto-selected)
          </label>
        </div>

        <button type="button" className="advanced-toggle" onClick={() => setAdvanced((v) => !v)}>
          {advanced ? "Hide advanced settings" : "Show advanced settings (remote, auth, multi-hop)"}
        </button>

        {advanced && (
          <>
            <div className="form-row" style={{ maxWidth: 220 }}>
              <label>Link level</label>
              <select value={axLevel} onChange={(e) => setAxLevel(e.target.value as AxLevel)}>
                <option value="L2">L2 — direct AX.25</option>
                <option value="L4">L4 — NET-ROM routed</option>
              </select>
            </div>

            <div className="form-row">
              <label>Connect sequence</label>
              <p className="form-hint" style={{ marginTop: 0, marginBottom: 8 }}>
                The app makes these connections in order. Step 0 is always the initial AX.25/NET-ROM
                connect. Add further hops only if WPS lives on a different node beyond your first hop.
              </p>

              {/* Step 0 — the Remote field, shown as the first row of the sequence */}
              <div style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
                <span className="connect-step-label">Step 0</span>
                <span style={{ fontSize: 13, color: "var(--text-muted)", flexShrink: 0 }}>Connect to</span>
                <input
                  style={{ flex: 1, minWidth: 0 }}
                  placeholder="WPS or WHATSPAC"
                  value={remote}
                  onChange={(e) => setRemote(e.target.value)}
                />
                <span style={{ fontSize: 13, color: "var(--text-muted)", flexShrink: 0, width: 80 }}>(auto)</span>
                <div style={{ width: 28, flexShrink: 0 }} />
              </div>

              {/* Subsequent hop steps */}
              {connectScript.map((step, i) => (
                <div
                  key={i}
                  draggable
                  onDragStart={() => { dragIndex.current = i; }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (dragIndex.current === null || dragIndex.current === i) return;
                    setConnectScript((s) => {
                      const next = [...s];
                      const [moved] = next.splice(dragIndex.current!, 1);
                      next.splice(i, 0, moved!);
                      dragIndex.current = i;
                      return next;
                    });
                  }}
                  onDragEnd={() => { dragIndex.current = null; }}
                  style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center", cursor: "grab" }}
                >
                  <span className="drag-handle" title="Drag to reorder">⠿</span>
                  <span className="connect-step-label">Step {i + 1}</span>
                  <input
                    style={{ flex: 1, minWidth: 0 }}
                    placeholder="command (e.g. C FARNODE)"
                    value={step.cmd}
                    onChange={(e) => updateStep(i, { cmd: e.target.value })}
                  />
                  <input
                    style={{ flex: 1, minWidth: 0 }}
                    placeholder="wait for (e.g. Connected)"
                    value={step.val}
                    onChange={(e) => updateStep(i, { val: e.target.value })}
                  />
                  <button
                    type="button"
                    className="btn small danger"
                    style={{ flexShrink: 0 }}
                    onClick={() => setConnectScript((s) => s.filter((_, idx) => idx !== i))}
                  >
                    &times;
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="btn small"
                onClick={() => setConnectScript((s) => [...s, { cmd: "", val: "" }])}
              >
                + Add hop
              </button>
            </div>

            <div className="form-row">
              <label>Response timeout (seconds)</label>
              <input
                type="number"
                min={1}
                value={responseTimeoutS}
                style={{ maxWidth: 100 }}
                onChange={(e) => setResponseTimeoutS(Number(e.target.value))}
              />
              <p className="form-hint" style={{ marginTop: 4 }}>
                How long to wait for a reply at each step before giving up. RF links can take 30–60 s on a
                busy channel — increase this if you get timeouts.
              </p>
            </div>

            <div className="form-row two-col">
              <div className="form-row">
                <label>Auth user (optional)</label>
                <input value={authUser} onChange={(e) => setAuthUser(e.target.value)} />
              </div>
              <div className="form-row">
                <label>Auth password (optional)</label>
                <input type="password" value={authPass} onChange={(e) => setAuthPass(e.target.value)} />
              </div>
            </div>
          </>
        )}

        <div className="form-actions">
          <button className="btn" onClick={onDone} disabled={saving}>
            Cancel
          </button>
          <button className="btn primary" onClick={submit} disabled={saving}>
            {saving ? "Saving..." : "Save profile"}
          </button>
        </div>
      </div>
    </div>
  );
}
