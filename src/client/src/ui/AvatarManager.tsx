import { useRef, useState } from "react";
import { useConnectionStore } from "../state/connectionStore";
import { sendAction } from "../api/socket";
import { uploadAvatar } from "../api/rest";

const MAX_PX = 128;
const JPEG_QUALITY = 0.8;

function formatBytes(n: number): string {
  return n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`;
}

function resizeToBase64(file: File): Promise<{ base64: string; dataUrl: string; bytes: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onerror = reject;
    img.onload = () => {
      const scale = Math.min(1, MAX_PX / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
      const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
      const base64 = dataUrl.split(",")[1]!;
      resolve({ base64, dataUrl, bytes: Math.round(base64.length * 0.75) });
    };
    img.src = URL.createObjectURL(file);
  });
}

export function AvatarManager({ onClose }: { onClose: () => void }) {
  const avatarCount = useConnectionStore((s) => s.avatarCount);
  const avatarsReceived = useConnectionStore((s) => s.avatarsReceived);
  const startAvatarDownload = useConnectionStore((s) => s.startAvatarDownload);
  const connected = useConnectionStore((s) => s.connectionState.status === "connected");

  const [preview, setPreview] = useState<{ base64: string; dataUrl: string; bytes: number } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<"idle" | "ok" | "error">("idle");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const downloading = avatarsReceived !== null;
  const total = avatarCount ?? null;
  const likelyDone = downloading && total !== null && avatarsReceived >= total && total > 0;

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadStatus("idle");
    setUploadError(null);
    try {
      const result = await resizeToBase64(file);
      setPreview(result);
    } catch {
      setUploadError("Could not read image.");
    }
  }

  async function handleUpload() {
    if (!preview) return;
    setUploading(true);
    setUploadStatus("idle");
    setUploadError(null);
    try {
      await uploadAvatar(preview.base64);
      setUploadStatus("ok");
      setPreview(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      setUploadStatus("error");
      setUploadError((err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Avatars</h2>

        {/* ── Download section ── */}
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
          <button className="btn" onClick={onClose}>Close</button>
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

        {/* ── Upload section ── */}
        <hr style={{ border: "none", borderTop: "1px solid var(--border)", margin: "20px 0" }} />
        <h3 style={{ margin: "0 0 4px", fontSize: 16 }}>Upload your avatar</h3>
        <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "0 0 12px" }}>
          Image is resized to {MAX_PX}×{MAX_PX}px max and sent over the radio link as your avatar.
        </p>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={handleFileChange}
        />
        <button
          className="btn"
          onClick={() => fileInputRef.current?.click()}
        >
          Choose image…
        </button>

        {preview && (
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 16 }}>
            <img
              src={preview.dataUrl}
              alt="Preview"
              style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 6, border: "1px solid var(--border)" }}
            />
            <div>
              <div style={{ fontSize: 13 }}>Ready to upload</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                {formatBytes(preview.bytes)} — will be sent over the radio link
              </div>
            </div>
            <button
              className="btn primary"
              style={{ marginLeft: "auto" }}
              disabled={!connected || uploading}
              onClick={handleUpload}
            >
              {uploading ? "Sending…" : "Upload"}
            </button>
          </div>
        )}

        {uploadStatus === "ok" && (
          <p style={{ color: "var(--online)", fontSize: 13, marginTop: 12 }}>
            ✓ Sent — other users will see your new avatar once their client fetches it.
          </p>
        )}
        {uploadStatus === "error" && (
          <p style={{ color: "var(--danger)", fontSize: 13, marginTop: 12 }}>
            Upload failed: {uploadError}
          </p>
        )}
      </div>
    </div>
  );
}
