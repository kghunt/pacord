import { useEffect, useRef, useState } from "react";

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
  const ref = useRef<HTMLTextAreaElement>(null);

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
      <div className="composer" style={editingText !== null || replyLabel ? { borderRadius: "0 0 8px 8px" } : undefined}>
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
        />
        <button className="send" disabled={!text.trim()} onClick={submit}>
          {editingText !== null ? "Save" : "Send"}
        </button>
      </div>
    </div>
  );
}
