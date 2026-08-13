import { useState } from "react";
import type { AxLevel, ConnectProfile, Engine, HopStep, NewConnectProfile, Transport } from "@shared/types";
import { defaultPort, defaultRadioPort, defaultRemote } from "@shared/engineDefaults";
import { useConnectionStore } from "../state/connectionStore";

export function ProfileManager({ onClose }: { onClose: () => void }) {
  const { profiles, connectionState, deleteProfile, connect, disconnect } = useConnectionStore();
  const [editing, setEditing] = useState<ConnectProfile | "new" | null>(null);

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
            <div className="form-row two-col">
              <div className="form-row">
                <label>Link level</label>
                <select value={axLevel} onChange={(e) => setAxLevel(e.target.value as AxLevel)}>
                  <option value="L2">L2 — direct AX.25 (WPS on this node, or explicit hops below)</option>
                  <option value="L4">L4 — NET-ROM (routed to a WPS hosted on another node)</option>
                </select>
              </div>
              <div className="form-row">
                <label>Remote (AX.25/NET-ROM destination)</label>
                <input value={remote} onChange={(e) => setRemote(e.target.value)} />
              </div>
            </div>

            <div className="form-row">
              <label>Response timeout (seconds)</label>
              <input
                type="number"
                min={1}
                value={responseTimeoutS}
                onChange={(e) => setResponseTimeoutS(Number(e.target.value))}
              />
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                How long to wait for a reply (RHP open, hop-script text) before giving up. RF links vary — a
                reply can be near-instant or take 30-60s.
              </span>
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

            <div className="form-row">
              <label>Multi-hop connect script (BPQ / manual node hops)</label>
              {connectScript.map((step, i) => (
                <div key={i} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                  <input
                    style={{ flex: 1, minWidth: 0 }}
                    placeholder="cmd (e.g. C GB7BSK-9)"
                    value={step.cmd}
                    onChange={(e) => updateStep(i, { cmd: e.target.value })}
                  />
                  <input
                    style={{ flex: 1, minWidth: 0 }}
                    placeholder="wait for..."
                    value={step.val}
                    onChange={(e) => updateStep(i, { val: e.target.value })}
                  />
                  <button
                    type="button"
                    className="btn small danger"
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
