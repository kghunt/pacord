import { useEffect, useRef, useState } from "react";
import EmojiPicker, { EmojiStyle, type EmojiClickData } from "emoji-picker-react";

export function Composer({
  placeholder,
  replyLabel,
  onCancelReply,
  editingText,
  onCancelEdit,
  onSubmit,
}: {
  placeholder: string;
  replyLabel: string | null;
  onCancelReply: () => void;
  editingText: string | null;
  onCancelEdit: () => void;
  onSubmit: (text: string) => void;
}) {
  const [text, setText] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const cursorPos = useRef<number>(0);

  useEffect(() => {
    if (editingText !== null) {
      setText(editingText);
      ref.current?.focus();
    }
  }, [editingText]);

  function submit() {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    setText("");
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape" && editingText !== null) {
      onCancelEdit();
      setText("");
    }
  }

  function saveCursor() {
    cursorPos.current = ref.current?.selectionStart ?? text.length;
  }

  function insertEmoji(data: EmojiClickData) {
    const pos = cursorPos.current;
    const next = text.slice(0, pos) + data.emoji + text.slice(pos);
    setText(next);
    setPickerOpen(false);
    // restore focus and move cursor after the inserted emoji
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      const newPos = pos + data.emoji.length;
      el.setSelectionRange(newPos, newPos);
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    });
  }

  return (
    <div className="composer-wrap">
      {replyLabel && (
        <div className="reply-banner">
          <span>Replying to {replyLabel}</span>
          <button onClick={onCancelReply}>&times;</button>
        </div>
      )}
      {editingText !== null && (
        <div className="edit-banner">
          <span>Editing message — Escape to cancel</span>
          <button
            onClick={() => {
              onCancelEdit();
              setText("");
            }}
          >
            &times;
          </button>
        </div>
      )}
      <div
        className="composer"
        style={editingText !== null || replyLabel ? { borderRadius: "0 0 8px 8px" } : undefined}
      >
        <textarea
          ref={ref}
          rows={1}
          placeholder={placeholder}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            e.target.style.height = "auto";
            e.target.style.height = `${e.target.scrollHeight}px`;
          }}
          onKeyDown={onKeyDown}
          onSelect={saveCursor}
          onBlur={saveCursor}
        />
        <button
          className="emoji-toggle"
          title="Insert emoji"
          onClick={() => {
            saveCursor();
            setPickerOpen((v) => !v);
          }}
        >
          😊
        </button>
        <button className="send" disabled={!text.trim()} onClick={submit}>
          {editingText !== null ? "Save" : "Send"}
        </button>
      </div>
      {pickerOpen && (
        <>
          <div className="emoji-picker-backdrop" onClick={() => setPickerOpen(false)} />
          <div className="composer-emoji-picker">
            <EmojiPicker onEmojiClick={insertEmoji} emojiStyle={EmojiStyle.NATIVE} autoFocusSearch={false} />
          </div>
        </>
      )}
    </div>
  );
}
