// WPS reactions travel on the wire as hex-codepoint strings (e.g. the
// literal "👍" is "1f44d"); compound emoji (skin tones, ZWJ sequences)
// become dash-joined codepoint sequences. Used by the backend when sending
// reactions to XRouter and by the frontend when rendering stored reactions.

export function emojiToWire(emoji: string): string {
  return Array.from(emoji)
    .map((ch) => ch.codePointAt(0)!.toString(16))
    .join("-");
}

export function wireToEmoji(wire: string): string {
  try {
    return wire
      .split("-")
      .map((hex) => String.fromCodePoint(parseInt(hex, 16)))
      .join("");
  } catch {
    return wire;
  }
}
