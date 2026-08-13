import type { FastifyInstance } from "fastify";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, "../../../package.json"), "utf-8")) as { version: string };
const LOCAL_VERSION = pkg.version;

const REPO = "kghunt/pacord";
const CACHE_TTL_MS = 60 * 60 * 1000;

let cache: { latest: string | null; fetchedAt: number } | null = null;

function semverNewer(running: string, latest: string): boolean {
  const a = running.split(".").map(Number);
  const b = latest.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((b[i] ?? 0) > (a[i] ?? 0)) return true;
    if ((b[i] ?? 0) < (a[i] ?? 0)) return false;
  }
  return false;
}

async function fetchLatest(): Promise<string | null> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return cache.latest;
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { "User-Agent": "pacord-update-check" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`GitHub API ${res.status}`);
    const data = await res.json() as { tag_name?: string };
    const latest = (data.tag_name ?? "").replace(/^v/, "") || null;
    cache = { latest, fetchedAt: Date.now() };
    return latest;
  } catch {
    cache = { latest: null, fetchedAt: Date.now() };
    return null;
  }
}

export async function registerVersionRoute(app: FastifyInstance): Promise<void> {
  app.get("/api/version", async () => {
    const latest = await fetchLatest();
    return {
      version: LOCAL_VERSION,
      latest,
      updateAvailable: latest ? semverNewer(LOCAL_VERSION, latest) : false,
    };
  });
}
