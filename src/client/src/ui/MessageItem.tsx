import { useState } from "react";
import EmojiPicker, { EmojiStyle, type EmojiClickData } from "emoji-picker-react";
import type { ReactionEntry } from "@shared/types";
import { wireToEmoji } from "@shared/emoji";
import { fullDisplayFor } from "../state/connectionStore";
import { formatTime, COMMON_REACTIONS } from "../utils";
import { AvatarImg } from "./AvatarImg";

export interface DisplayItem {
  key: string;
  fromCall: string;
  body: string;
  tsMs: number;
  editTs: number | null;
  reactions: ReactionEntry[];
  replyPreview: { fromCall: string; body: string } | null;
  isMine: boolean;
  isMention: boolean;
  grouped: boolean;
  deliveredTs: number | null;
}

export function MessageItem({
  item,
  myCall,
  onReply,
  onEdit,
  onReact,
}: {
  item: DisplayItem;
  myCall: string | null;
  onReply: () => void;
  onEdit: () => void;
  onReact: (emoji: string, add: boolean) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const reactionGroups = new Map<string, ReactionEntry[]>();
  for (const r of item.reactions) {
    const arr = reactionGroups.get(r.emoji) ?? [];
    arr.push(r);
    reactionGroups.set(r.emoji, arr);
  }

  function pickEmoji(data: EmojiClickData) {
    onReact(data.emoji, true);
    setPickerOpen(false);
  }

  return (
    <div className={`message-row ${item.grouped ? "grouped" : ""}${item.isMention ? " mention" : ""}`}>
      <AvatarImg callsign={item.fromCall} className="avatar" />
      <div className="message-content">
        {item.replyPreview && (
          <div className="reply-quote">
            <span className="reply-line" />
            <span>
              <strong>{fullDisplayFor(item.replyPreview.fromCall)}</strong> {item.replyPreview.body.slice(0, 80)}
            </span>
          </div>
        )}
        {!item.grouped && (
          <div className="message-header-line">
            <span className="message-author">{fullDisplayFor(item.fromCall)}</span>
            <span className="message-ts">{formatTime(item.tsMs, "ms")}</span>
          </div>
        )}
        <div className="message-body">
          {item.body}
          {item.editTs && <span className="message-edited">(edited)</span>}
          {item.isMine && (
            <span
              className={`delivery-tick${item.deliveredTs !== null ? " delivered" : ""}`}
              title={item.deliveredTs !== null ? "Delivered to WPS" : "Sending…"}
            >
              {item.deliveredTs !== null ? "✓" : "○"}
            </span>
          )}
        </div>
        {reactionGroups.size > 0 && (
          <div className="reactions-row">
            {Array.from(reactionGroups.entries()).map(([emoji, entries]) => {
              const mine = myCall ? entries.some((e) => e.callsign === myCall) : false;
              return (
                <button
                  key={emoji}
                  className={`reaction-chip ${mine ? "mine" : ""}`}
                  onClick={() => onReact(emoji, !mine)}
                  title={entries.map((e) => fullDisplayFor(e.callsign)).join(", ")}
                >
                  <span>{wireToEmoji(emoji)}</span>
                  <span>{entries.length}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
      <div className="message-actions">
        {COMMON_REACTIONS.map((e) => (
          <button key={e} onClick={() => onReact(e, true)} title="React">
            {e}
          </button>
        ))}
        <button onClick={() => setPickerOpen((v) => !v)} title="More reactions">
          +
        </button>
        <button onClick={onReply}>Reply</button>
        {item.isMine && <button onClick={onEdit}>Edit</button>}
      </div>
      {pickerOpen && (
        <>
          <div className="emoji-picker-backdrop" onClick={() => setPickerOpen(false)} />
          <div className="emoji-picker-popover">
            <EmojiPicker onEmojiClick={pickEmoji} emojiStyle={EmojiStyle.NATIVE} autoFocusSearch={false} />
          </div>
        </>
      )}
    </div>
  );
}
