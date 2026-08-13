import type { ClientAction, ServerEvent } from "@shared/types";

type Listener = (ev: ServerEvent) => void;

let ws: WebSocket | null = null;
const listeners = new Set<Listener>();
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function wsUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}/ws`;
}

export function connectSocket(): void {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  ws = new WebSocket(wsUrl());
  ws.onmessage = (ev) => {
    try {
      const data = JSON.parse(ev.data as string) as ServerEvent;
      listeners.forEach((l) => l(data));
    } catch {
      // ignore malformed frames
    }
  };
  ws.onclose = () => {
    ws = null;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connectSocket, 2000);
  };
  ws.onerror = () => {
    ws?.close();
  };
}

export function onServerEvent(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function sendAction(action: ClientAction): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(action));
  }
}
