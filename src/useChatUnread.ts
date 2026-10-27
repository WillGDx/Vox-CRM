import { useCallback, useEffect, useRef, useState } from "react";
import { authorizedFetch, subscribeWorkspaceChanges } from "./auth-client";

export default function useChatUnread(userId: string, workspaceId: string | null) {
  const [unread, setUnread] = useState(0);
  const sequence = useRef(0);
  const updateUnread = useCallback((count: number) => {
    sequence.current += 1;
    if (Number.isSafeInteger(count) && count >= 0) setUnread(count);
  }, []);
  const refresh = useCallback(async () => {
    const request = ++sequence.current;
    try {
      const response = await authorizedFetch("/api/chat/conversations");
      if (!response.ok) return;
      const data = await response.json();
      if (request === sequence.current && Number.isSafeInteger(data.totalUnread) && data.totalUnread >= 0) {
        setUnread(data.totalUnread);
      }
    } catch { /* The chat page reports errors without blocking other modules. */ }
  }, [userId, workspaceId]);
  useEffect(() => {
    void refresh();
    let pending: ReturnType<typeof setTimeout> | undefined;
    const changed = () => {
      if (pending) clearTimeout(pending);
      pending = setTimeout(() => void refresh(), 250);
    };
    const unsubscribe = subscribeWorkspaceChanges(
      ["crm_chat_conversations", "crm_chat_messages", "crm_chat_reads"], changed, undefined, workspaceId,
    );
    const interval = window.setInterval(() => void refresh(), 30_000);
    window.addEventListener("focus", changed);
    return () => {
      sequence.current += 1;
      if (pending) clearTimeout(pending);
      unsubscribe();
      clearInterval(interval);
      window.removeEventListener("focus", changed);
    };
  }, [refresh]);
  return { unread, updateUnread };
}
