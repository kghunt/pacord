import { useEffect, useRef, useState } from "react";
import EmojiPicker, { EmojiStyle, type EmojiClickData } from "emoji-picker-react";

export type MentionCandidate = { call: string; label: string };

export function Composer({
  placeholder,
  replyLabel,
  onCancelReply,
  editingText,
  onCancelEdit,
  onSubmit,
  mentions = [],
}: {
  placeholder: string;
  replyLabel: string | null;
  onCancelReply: () => void;
  editingText: string | null;
  onCancelEdit: () => void;
  onSubmit: (text: string) => void;
  mentions?: MentionCandidate[];
}) {
  const [text, setText] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionStart, setMentionStart] = useState(0);
  const [mentionIndex, setMentionIndex] = useState(0);
  const ref = useRef<HTMLTextAreaElement>(null);
  const cursorPos = useRef<number>(0);

  const mentionMatches =
    mentionQuery !== null
      ? mentions
          .filter(
            (m) =>
              m.call.toLowerCase().startsWith(mentionQuery.toLowerCase()) ||
              m.label.toLowerCase().startsWith(mentionQuery.toLowerCase())
          )
          .slice(0, 6)
      : [];

  useEffect(() => {
    if (editingText !== null) {
      setText(editingText);
      ref.current?.focus();
    }
  }, [editingText]);

  function detectMention(value: string, selStart: number) {
    const before = value.slice(0, selStart);
    const match = before.match(/@(\w*)$/);
    if (match) {
      setMentionQuery(match[1]!);
      setMentionStart(selStart - match[0].length);
      setMentionIndex(0);
    } else {
      setMentionQuery(null);
    }
  }

  function selectMention(m: MentionCandidate) {
    const insert = `@${m.call} `;
    const end = mentionStart + 1 + (mentionQuery?.length ?? 0);
    const next = text.slice(0, mentionStart) + insert + text.slice(end);
    setText(next);
    setMentionQuery(null);
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      const pos = mentionStart + insert.length;
      el.setSelectionRange(pos, pos);
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    });
  }

  function submit() {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    setText("");
    setMentionQuery(null);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (mentionQuery !== null && mentionMatches.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionIndex((i) => Math.min(i + 1, mentionMatches.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        selectMention(mentionMatches[mentionIndex]!);
        return;
      }
      if (e.key === "Escape") {
        setMentionQuery(null);
        return;
      }
    }
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

      {mentionQuery !== null && mentionMatches.length > 0 && (
        <div className="mention-list">
          {mentionMatches.map((m, i) => (
            <div
              key={m.call}
              className={`mention-item ${i === mentionIndex ? "active" : ""}`}
              onMouseDown={(e) => {
                e.preventDefault(); // keep textarea focus
                selectMention(m);
              }}
            >
              <span className="mention-call">@{m.call}</span>
              {m.label !== m.call && <span className="mention-label">{m.label}</span>}
            </div>
          ))}
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
            detectMention(e.target.value, e.target.selectionStart);
          }}
          onKeyDown={onKeyDown}
          onSelect={(e) => {
            saveCursor();
            detectMention(text, (e.target as HTMLTextAreaElement).selectionStart);
          }}
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
