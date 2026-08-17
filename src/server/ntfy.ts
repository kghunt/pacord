import * as metaDb from "./db/meta.js";

export async function sendNtfy(title: string, body: string, tags = "bell"): Promise<void> {
  const url = metaDb.getMeta("ntfy_url")?.trim();
  if (!url) return;
  const token = metaDb.getMeta("ntfy_token")?.trim();

  const headers: Record<string, string> = {
    "Title": title,
    "Tags": tags,
    "Content-Type": "text/plain; charset=utf-8",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  try {
    await fetch(url, {
      method: "POST",
      headers,
      body: body.slice(0, 4096),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // best-effort — ntfy failure must not affect the main message flow
  }
}
