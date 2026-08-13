export function initials(callsign: string): string {
  return callsign.slice(0, 2).toUpperCase();
}

export function formatTime(msOrS: number, unit: "ms" | "s"): string {
  const ms = unit === "s" ? msOrS * 1000 : msOrS;
  const d = new Date(ms);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return `Today at ${time}`;
  return `${d.toLocaleDateString([], { month: "short", day: "numeric" })} at ${time}`;
}

// Matches the quick-react bar shown in the WhatsPac reference client.
const COMMON_REACTIONS = ["👍", "❤️", "😃", "😨", "🙏", "👎", "😠"];
export { COMMON_REACTIONS };
