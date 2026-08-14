import { useEffect, useMemo, useRef, useState } from "react";
import type { MessageRow, PostRow } from "@shared/types";
import { useChatStore } from "../state/chatStore";
import { useConnectionStore, displayNameFor } from "../state/connectionStore";
import { sendAction } from "../api/socket";
import { MessageItem, type DisplayItem } from "./MessageItem";
import { Composer, type MentionCandidate } from "./Composer";

const GROUP_WINDOW_MS = 5 * 60 * 1000;

type ReplyState = { label: string; target: { msgId?: string; postTs?: number; fromCall?: string } } | null;
type EditState = { text: string; target: { msgId?: string; postTs?: number } } | null;

export function ChatPane() {
  const { activeTarget, setActiveTarget, channels, messagesByPeer, postsByChannel, peers } = useChatStore();
  const { connectionState, profiles } = useConnectionStore();
  const rawMyCall = profiles.find((p) => p.id === connectionState.activeProfileId)?.myCall.toUpperCase() ?? null;
  // WPS strips SSIDs at the application layer; messages store bare callsigns.
  const myCall = rawMyCall ? rawMyCall.split("-")[0]! : null;

  const mentions = useMemo<MentionCandidate[]>(() => {
    const seen = new Set<string>();
    const out: MentionCandidate[] = [];
    const add = (call: string) => {
      if (seen.has(call)) return;
      seen.add(call);
      const label = displayNameFor(call);
      out.push({ call, label });
    };
    for (const c of connectionState.onlineUsers) add(c);
    for (const p of peers) add(p);
    return out;
  }, [connectionState.onlineUsers, peers]);

  const jumpToKey = useChatStore((s) => s.jumpToKey);
  const setJumpToKey = useChatStore((s) => s.setJumpToKey);

  const [reply, setReply] = useState<ReplyState>(null);
  const [edit, setEdit] = useState<EditState>(null);
  const [historyCount, setHistoryCount] = useState(50);
  const messageListRef = useRef<HTMLDivElement>(null);
  const wasNearBottomRef = useRef(true);

  const activeTargetKey = activeTarget
    ? activeTarget.type === "dm"
      ? `dm:${activeTarget.peer}`
      : `channel:${activeTarget.cid}`
    : null;

  useEffect(() => {
    setReply(null);
    setEdit(null);
  }, [activeTargetKey]);

  // Jump to the newest message whenever the target changes — otherwise the
  // pane opens scrolled to the oldest cached history, which is backwards
  // for a chat UI.
  useEffect(() => {
    const el = messageListRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [activeTargetKey]);

  // Auto-scroll on new arrivals only if the user was already near the
  // bottom — otherwise a live message would yank them away from history
  // they scrolled up to read.
  const itemCount = useChatStore((s) =>
    activeTarget?.type === "dm"
      ? (s.messagesByPeer[activeTarget.peer]?.length ?? 0)
      : activeTarget?.type === "channel"
        ? (s.postsByChannel[activeTarget.cid]?.length ?? 0)
        : 0
  );
  useEffect(() => {
    const el = messageListRef.current;
    if (el && wasNearBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [itemCount]);

  const items: DisplayItem[] = useMemo(() => {
    if (!activeTarget) return [];
    if (activeTarget.type === "dm") {
      const rows = messagesByPeer[activeTarget.peer] ?? [];
      const byId = new Map(rows.map((m) => [m.msgId, m]));
      return rows.map((m, i) => {
        const source = m.replyId ? byId.get(m.replyId) : undefined;
        return toDisplayFromMessage(m, rows[i - 1], myCall, source ?? null);
      });
    }
    const rows = postsByChannel[activeTarget.cid] ?? [];
    const byTs = new Map(rows.map((p) => [p.ts, p]));
    return rows.map((p, i) => {
      const source = p.replyTs ? byTs.get(p.replyTs) : undefined;
      return toDisplayFromPost(p, rows[i - 1], myCall, source ?? null);
    });
  }, [activeTarget, messagesByPeer, postsByChannel, myCall]);

  // Scroll to a specific message key once it appears in the rendered list.
  // Used both for reply-quote clicks and search-result navigation.
  useEffect(() => {
    if (!jumpToKey) return;
    if (!items.some((item) => item.key === jumpToKey)) return;
    const raf = requestAnimationFrame(() => {
      const el = messageListRef.current?.querySelector(`[data-msg-key="${CSS.escape(jumpToKey)}"]`);
      if (el) {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
        el.classList.add("jump-highlight");
        el.addEventListener("animationend", () => el.classList.remove("jump-highlight"), { once: true });
      }
      setJumpToKey(null);
    });
    return () => cancelAnimationFrame(raf);
  }, [jumpToKey, items, setJumpToKey]);

  function handleJumpToReply(key: string) {
    const el = messageListRef.current?.querySelector(`[data-msg-key="${CSS.escape(key)}"]`);
    if (!el) return;
    el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    el.classList.add("jump-highlight");
    el.addEventListener("animationend", () => el.classList.remove("jump-highlight"), { once: true });
  }

  function handleReply(item: DisplayItem, raw: MessageRow | PostRow) {
    if (!activeTarget) return;
    if (activeTarget.type === "dm") {
      const m = raw as MessageRow;
      setReply({ label: displayNameFor(m.fromCall), target: { msgId: m.msgId } });
    } else {
      const p = raw as PostRow;
      setReply({ label: displayNameFor(p.fromCall), target: { postTs: p.ts, fromCall: p.fromCall } });
    }
  }

  function handleEdit(raw: MessageRow | PostRow) {
    if (!activeTarget) return;
    if (activeTarget.type === "dm") {
      const m = raw as MessageRow;
      setEdit({ text: m.body, target: { msgId: m.msgId } });
    } else {
      const p = raw as PostRow;
      setEdit({ text: p.body, target: { postTs: p.ts } });
    }
  }

  function handleReact(raw: MessageRow | PostRow, emoji: string, add: boolean) {
    if (!activeTarget) return;
    if (activeTarget.type === "dm") {
      const m = raw as MessageRow;
      sendAction({ type: "react_message", msgId: m.msgId, emoji, add });
    } else {
      const p = raw as PostRow;
      sendAction({ type: "react_post", cid: p.cid, ts: p.ts, emoji, add });
    }
  }

  function handleSubmit(text: string) {
    if (!activeTarget) return;
    if (edit) {
      if (activeTarget.type === "dm" && edit.target.msgId) {
        sendAction({ type: "edit_message", msgId: edit.target.msgId, text });
      } else if (activeTarget.type === "channel" && edit.target.postTs) {
        sendAction({ type: "edit_post", cid: activeTarget.cid, ts: edit.target.postTs, text });
      }
      setEdit(null);
      return;
    }
    if (activeTarget.type === "dm") {
      sendAction({ type: "send_message", toCall: activeTarget.peer, text, replyId: reply?.target.msgId });
    } else {
      const atCalls = [...text.matchAll(/@([A-Z0-9]+-?[A-Z0-9]*)/gi)].map((m) => m[1]!.toUpperCase());
      sendAction({
        type: "post",
        cid: activeTarget.cid,
        text,
        replyTs: reply?.target.postTs,
        replyFrom: reply?.target.fromCall,
        atCalls: atCalls.length > 0 ? atCalls : undefined,
      });
    }
    setReply(null);
  }

  if (!activeTarget) {
    return (
      <div className="chat-pane">
        <div className="empty-state">
          <div style={{ fontSize: 40 }}>📻</div>
          <div>Pick a channel or a direct message to get started.</div>
        </div>
      </div>
    );
  }

  const rawRows =
    activeTarget.type === "dm" ? messagesByPeer[activeTarget.peer] ?? [] : postsByChannel[activeTarget.cid] ?? [];

  const activeChannel = activeTarget.type === "channel" ? channels.find((c) => c.cid === activeTarget.cid) : undefined;
  const title =
    activeTarget.type === "dm" ? displayNameFor(activeTarget.peer) : `# ${activeChannel?.name || activeTarget.cid}`;
  const subtitle = activeTarget.type === "channel" ? activeChannel?.description : activeTarget.peer;

  return (
    <div className="chat-pane">
      <div className="chat-header">
        <button className="mobile-back-btn icon-button" onClick={() => setActiveTarget(null)} title="Back">
          ‹
        </button>
        <span>{title}</span>
        {subtitle && <span className="subtitle">{subtitle}</span>}
        {activeTarget.type === "channel" && (
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
            <button
              className={`btn small ${activeChannel?.subscribed ? "" : "primary"}`}
              onClick={() =>
                sendAction(
                  activeChannel?.subscribed
                    ? { type: "unsubscribe", cid: activeTarget.cid }
                    : { type: "subscribe", cid: activeTarget.cid }
                )
              }
              title={
                activeChannel?.subscribed
                  ? "Stop receiving live updates for this channel"
                  : "Get live updates for this channel (pulls history over the radio link)"
              }
            >
              {activeChannel?.subscribed ? "Subscribed" : "Subscribe"}
            </button>
            <div className="history-load-controls">
              <input
                type="number"
                min={1}
                max={1000}
                value={historyCount}
                onChange={(e) => setHistoryCount(Number(e.target.value))}
                style={{ width: 60, background: "var(--bg-tertiary)", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text-normal)", padding: "4px 6px" }}
                title="Number of historic messages to fetch"
                disabled={!activeChannel?.subscribed}
              />
              <button
                className="btn small"
                disabled={!activeChannel?.subscribed}
                title={activeChannel?.subscribed ? undefined : "Subscribe first to fetch history"}
                onClick={() =>
                  sendAction({ type: "request_post_batch", cid: activeTarget.cid, count: historyCount })
                }
              >
                Load history
              </button>
            </div>
          </div>
        )}
      </div>
      <div
        className="message-list"
        ref={messageListRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          wasNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 150;
        }}
      >
        {items.length === 0 && <div className="message-empty">No messages yet — say hello!</div>}
        {items.map((item, i) => (
          <MessageItem
            key={item.key}
            item={item}
            myCall={myCall}
            onReply={() => handleReply(item, rawRows[i]!)}
            onEdit={() => handleEdit(rawRows[i]!)}
            onReact={(emoji, add) => handleReact(rawRows[i]!, emoji, add)}
            onJumpToReply={item.replyKey ? () => handleJumpToReply(item.replyKey!) : null}
          />
        ))}
      </div>
      <Composer
        placeholder={`Message ${title}`}
        replyLabel={reply?.label ?? null}
        onCancelReply={() => setReply(null)}
        editingText={edit?.text ?? null}
        onCancelEdit={() => setEdit(null)}
        onSubmit={handleSubmit}
        mentions={mentions}
      />
    </div>
  );
}

function toDisplayFromMessage(
  m: MessageRow,
  prev: MessageRow | undefined,
  myCall: string | null,
  replySource: MessageRow | null
): DisplayItem {
  const grouped = !!prev && prev.fromCall === m.fromCall && m.ts * 1000 - prev.ts * 1000 < GROUP_WINDOW_MS && !m.replyId;
  const isMine = myCall !== null && m.fromCall === myCall;
  return {
    key: m.msgId,
    fromCall: m.fromCall,
    body: m.body,
    tsMs: m.ts * 1000,
    editTs: m.editTs,
    reactions: m.reactions,
    replyPreview: replySource ? { fromCall: replySource.fromCall, body: replySource.body } : null,
    replyKey: replySource ? replySource.msgId : null,
    isMine,
    isMention: false, // DMs don't use @mentions; every incoming message is already directed at you
    grouped,
    deliveredTs: m.deliveredTs ?? null,
  };
}

function toDisplayFromPost(
  p: PostRow,
  prev: PostRow | undefined,
  myCall: string | null,
  replySource: PostRow | null
): DisplayItem {
  const grouped = !!prev && prev.fromCall === p.fromCall && p.ts - prev.ts < GROUP_WINDOW_MS && !p.replyTs;
  const isMine = myCall !== null && p.fromCall === myCall;
  return {
    key: String(p.ts),
    fromCall: p.fromCall,
    body: p.body,
    tsMs: p.ts,
    editTs: p.editTs,
    reactions: p.reactions,
    replyPreview: replySource
      ? { fromCall: replySource.fromCall, body: replySource.body }
      : p.replyFrom
        ? { fromCall: p.replyFrom, body: "(original message not loaded)" }
        : null,
    replyKey: replySource ? String(replySource.ts) : null,
    isMine,
    isMention: !isMine && myCall !== null && (p.atCalls ?? []).includes(myCall),
    grouped,
    deliveredTs: p.deliveredTs ?? null,
  };
}
