import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { FormEvent, ReactNode } from "react";
import {
  ArrowLeft,
  Check,
  ChevronUp,
  LoaderCircle,
  LockKeyhole,
  MessageCircle,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Send,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { useAccess } from "./AccessGate";
import UserAvatar from "./UserAvatar";
import { authorizedFetch, subscribeWorkspaceChanges } from "./auth-client";
import {
  parseConversation,
  parseConversationList,
  parseHistory,
  parseMessage,
} from "./chat-types";
import type { ChatConversation, ChatMessage } from "./chat-types";
import "./chat.css";

async function request(path: string, options?: RequestInit): Promise<unknown> {
  const response = await authorizedFetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(body?.error || "Não foi possível concluir a ação no chat.");
  return body;
}

const failure = (cause: unknown) =>
  cause instanceof Error ? cause.message : "Não foi possível atualizar o chat.";
const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase() || "?";
const timeLabel = (date: string) =>
  new Date(date).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
const dayLabel = (date: string) =>
  new Date(date).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
const dayKey = (date: string) => new Date(date).toLocaleDateString("pt-BR");
const compareMessages = (a: ChatMessage, b: ChatMessage) =>
  Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id);
function mergeMessages(previous: ChatMessage[], incoming: ChatMessage[]) {
  const map = new Map(previous.map((item) => [item.id, item]));
  for (const item of incoming) map.set(item.id, item);
  return [...map.values()].sort(compareMessages);
}

function ChatDialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const items = () =>
      Array.from(
        container.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled),input:not(:disabled),textarea:not(:disabled),a[href]",
        ) || [],
      );
    (
      container.current?.querySelector<HTMLElement>("input,textarea") ||
      items()[0]
    )?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close.current();
      if (event.key !== "Tab") return;
      const list = items();
      const first = list[0];
      const last = list[list.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="chat-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="chat-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={container}
      >
        <header>
          <div>
            <span className="eyebrow">CONEXÕES QUE APROXIMAM</span>
            <h2 id={titleId}>{title}</h2>
          </div>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="Fechar conversa"
          >
            <X size={20} />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

export default function ChatPanel({
  onUnreadChange,
}: {
  onUnreadChange?: (count: number) => void;
}) {
  const { access } = useAccess();
  const [conversations, setConversations] = useState<ChatConversation[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState("");
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const activeRef = useRef<string | null>(null);
  activeRef.current = activeId;
  const [mobileActive, setMobileActive] = useState(false);
  const mobileActiveRef = useRef(false);
  mobileActiveRef.current = mobileActive;
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [olderLoading, setOlderLoading] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [historyError, setHistoryError] = useState("");
  const [actionError, setActionError] = useState("");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ChatMessage | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [peerQuery, setPeerQuery] = useState("");
  const [creatingPeer, setCreatingPeer] = useState<string | null>(null);
  const [newError, setNewError] = useState("");
  const [live, setLive] = useState(false);
  const onUnread = useRef(onUnreadChange);
  onUnread.current = onUnreadChange;
  const listVersion = useRef(0);
  const historyVersion = useRef(0);
  const disposed = useRef(false);
  const scroll = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const shouldScroll = useRef(false);
  const restoreScroll = useRef<{ height: number; top: number } | null>(null);
  const marked = useRef(new Map<string, string>());
  const refreshHistory = useRef<() => Promise<void>>(async () => {});
  const active = conversations.find((item) => item.id === activeId) || null;

  useEffect(() => {
    disposed.current = false;
    return () => {
      disposed.current = true;
      listVersion.current++;
      historyVersion.current++;
    };
  }, []);

  const loadConversations = useCallback(async () => {
    const version = ++listVersion.current;
    try {
      const result = parseConversationList(
        await request("/api/chat/conversations"),
      );
      if (disposed.current || version !== listVersion.current) return;
      setConversations(result.conversations);
      setListError("");
      onUnread.current?.(result.totalUnread);
      setActiveId((previous) =>
        previous && result.conversations.some((item) => item.id === previous)
          ? previous
          : result.conversations.find((item) => item.kind === "team")?.id ||
            result.conversations[0]?.id ||
            null,
      );
    } catch (cause) {
      if (!disposed.current && version === listVersion.current)
        setListError(failure(cause));
    } finally {
      if (!disposed.current && version === listVersion.current)
        setLoadingList(false);
    }
  }, []);

  const markRead = useCallback(
    async (id: string, items: ChatMessage[]) => {
      if (
        activeRef.current !== id ||
        document.visibilityState !== "visible" ||
        (window.matchMedia("(max-width: 700px)").matches &&
          !mobileActiveRef.current)
      )
        return;
      const incoming = [...items]
        .sort(compareMessages)
        .filter(
          (item) =>
            item.conversationId === id &&
            item.senderId !== access.userId &&
            !item.deletedAt,
        )
        .at(-1);
      if (!incoming || marked.current.get(id) === incoming.id) return;
      marked.current.set(id, incoming.id);
      try {
        await request(
          `/api/chat/conversations/${encodeURIComponent(id)}/read`,
          { method: "POST", body: "{}" },
        );
        if (!disposed.current) await loadConversations();
      } catch (cause) {
        if (marked.current.get(id) === incoming.id) marked.current.delete(id);
        if (!disposed.current && activeRef.current === id)
          setActionError(failure(cause));
      }
    },
    [access.userId, loadConversations],
  );

  const loadLatest = useCallback(
    async (id: string, initial = false) => {
      const version = ++historyVersion.current;
      if (initial) {
        setHistoryLoading(true);
        setHistoryError("");
      }
      try {
        const result = parseHistory(
          await request(
            `/api/chat/conversations/${encodeURIComponent(id)}/messages?limit=30`,
          ),
        );
        if (
          disposed.current ||
          activeRef.current !== id ||
          version !== historyVersion.current
        )
          return;
        if (result.items.some((item) => item.conversationId !== id))
          throw new Error(
            "As mensagens recebidas não pertencem à conversa selecionada.",
          );
        shouldScroll.current = initial || nearBottom.current;
        setMessages((previous) =>
          initial
            ? result.items.sort(compareMessages)
            : mergeMessages(previous, result.items),
        );
        if (initial) setNextCursor(result.nextCursor);
        setHistoryError("");
        void markRead(id, result.items);
      } catch (cause) {
        if (
          !disposed.current &&
          activeRef.current === id &&
          version === historyVersion.current
        )
          setHistoryError(failure(cause));
      } finally {
        if (
          !disposed.current &&
          activeRef.current === id &&
          version === historyVersion.current
        )
          setHistoryLoading(false);
      }
    },
    [markRead],
  );

  refreshHistory.current = async () => {
    if (activeRef.current) await loadLatest(activeRef.current);
  };

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);
  useEffect(() => {
    historyVersion.current++;
    setMessages([]);
    setNextCursor(null);
    setHistoryError("");
    setActionError("");
    setEditingId(null);
    setEditDraft("");
    setDraft("");
    nearBottom.current = true;
    restoreScroll.current = null;
    if (activeId) void loadLatest(activeId, true);
  }, [activeId, loadLatest]);

  useEffect(() => {
    if (mobileActive && activeId && messages.length)
      void markRead(activeId, messages);
  }, [mobileActive, activeId, messages, markRead]);

  useEffect(() => {
    let timer: number | undefined;
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void loadConversations();
        void refreshHistory.current();
      }, 180);
    };
    const unsubscribe = subscribeWorkspaceChanges(
      ["crm_chat_conversations", "crm_chat_messages", "crm_chat_reads"],
      refresh,
      setLive,
      access.workspaceId,
    );
    const interval = window.setInterval(refresh, 20_000);
    window.addEventListener("focus", refresh);
    window.addEventListener("resize", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      unsubscribe();
      window.clearInterval(interval);
      window.clearTimeout(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("resize", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [loadConversations, access.workspaceId]);

  useLayoutEffect(() => {
    const node = scroll.current;
    if (!node) return;
    if (restoreScroll.current) {
      node.scrollTop =
        restoreScroll.current.top +
        node.scrollHeight -
        restoreScroll.current.height;
      restoreScroll.current = null;
    } else if (shouldScroll.current) {
      node.scrollTop = node.scrollHeight;
      shouldScroll.current = false;
      nearBottom.current = true;
    }
  }, [messages, historyLoading]);

  const older = async () => {
    if (!activeId || !nextCursor || olderLoading) return;
    const id = activeId;
    const cursor = nextCursor;
    setOlderLoading(true);
    setHistoryError("");
    try {
      const result = parseHistory(
        await request(
          `/api/chat/conversations/${encodeURIComponent(id)}/messages?limit=30&before=${encodeURIComponent(cursor)}`,
        ),
      );
      if (disposed.current || activeRef.current !== id) return;
      if (result.items.some((item) => item.conversationId !== id))
        throw new Error("Não foi possível validar o histórico da conversa.");
      const node = scroll.current;
      if (node)
        restoreScroll.current = {
          height: node.scrollHeight,
          top: node.scrollTop,
        };
      shouldScroll.current = false;
      setMessages((previous) => mergeMessages(previous, result.items));
      setNextCursor(result.nextCursor);
    } catch (cause) {
      if (activeRef.current === id) setHistoryError(failure(cause));
    } finally {
      if (!disposed.current) setOlderLoading(false);
    }
  };

  const send = async (event?: FormEvent) => {
    event?.preventDefault();
    const body = draft.trim();
    if (!activeId || !body || sending) return;
    const id = activeId;
    setSending(true);
    setActionError("");
    try {
      const item = parseMessage(
        await request(
          `/api/chat/conversations/${encodeURIComponent(id)}/messages`,
          { method: "POST", body: JSON.stringify({ body }) },
        ),
      );
      if (item.conversationId !== id)
        throw new Error("Não foi possível validar a mensagem enviada.");
      if (disposed.current) return;
      if (activeRef.current === id) {
        shouldScroll.current = true;
        setMessages((previous) => mergeMessages(previous, [item]));
        setDraft((previous) => (previous.trim() === body ? "" : previous));
      }
      await loadConversations();
    } catch (cause) {
      if (activeRef.current === id) setActionError(failure(cause));
    } finally {
      if (!disposed.current) setSending(false);
    }
  };

  const saveEdit = async (event: FormEvent) => {
    event.preventDefault();
    if (!editingId || !editDraft.trim() || editing) return;
    const id = activeId;
    const messageId = editingId;
    setEditing(true);
    setActionError("");
    try {
      const item = parseMessage(
        await request(`/api/chat/messages/${encodeURIComponent(messageId)}`, {
          method: "PATCH",
          body: JSON.stringify({ body: editDraft.trim() }),
        }),
      );
      if (!disposed.current && activeRef.current === id) {
        setMessages((previous) => mergeMessages(previous, [item]));
        setEditingId(null);
        setEditDraft("");
      }
      await loadConversations();
    } catch (cause) {
      if (activeRef.current === id) setActionError(failure(cause));
    } finally {
      if (!disposed.current) setEditing(false);
    }
  };

  const removeMessage = async () => {
    if (!deleteTarget || deleting) return;
    const item = deleteTarget;
    setDeleting(true);
    setActionError("");
    try {
      await request(`/api/chat/messages/${encodeURIComponent(item.id)}`, {
        method: "DELETE",
      });
      if (!disposed.current) {
        setDeleteTarget(null);
        if (activeRef.current === item.conversationId) {
          setMessages((previous) =>
            previous.filter((entry) => entry.id !== item.id),
          );
          await loadLatest(item.conversationId);
        }
        await loadConversations();
      }
    } catch (cause) {
      if (!disposed.current) setActionError(failure(cause));
    } finally {
      if (!disposed.current) setDeleting(false);
    }
  };

  const openDirect = async (peerId: string) => {
    if (creatingPeer) return;
    setCreatingPeer(peerId);
    setNewError("");
    try {
      const conversation = parseConversation(
        await request("/api/chat/conversations", {
          method: "POST",
          body: JSON.stringify({ peerId }),
        }),
      );
      if (disposed.current) return;
      setConversations((previous) =>
        previous.some((entry) => entry.id === conversation.id)
          ? previous
          : [...previous, conversation],
      );
      setActiveId(conversation.id);
      setMobileActive(true);
      setNewOpen(false);
      setPeerQuery("");
      await loadConversations();
    } catch (cause) {
      if (!disposed.current) setNewError(failure(cause));
    } finally {
      if (!disposed.current) setCreatingPeer(null);
    }
  };

  const people = access.members.filter(
    (member) =>
      member.active &&
      member.userId !== access.userId &&
      member.displayName
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .includes(
          peerQuery
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase(),
        ),
  );
  const filtered = conversations.filter((entry) =>
    entry.title
      .toLocaleLowerCase("pt-BR")
      .includes(query.toLocaleLowerCase("pt-BR")),
  );
  const newConversation = () => {
    setNewError("");
    setNewOpen(true);
    setPeerQuery("");
  };
  const canRemove = (message: ChatMessage) =>
    message.senderId === access.userId ||
    (access.role === "admin" && active?.kind === "team");

  return (
    <section
      className="chat-shell"
      data-mobile-active={mobileActive ? "true" : "false"}
      aria-label="Chat da empresa"
    >
      <aside className="chat-sidebar" aria-label="Conversas">
        <div className="chat-sidebar-header">
          <div>
            <h2>Suas conversas</h2>
            <p>Boas ideias começam por aqui.</p>
          </div>
          <button
            className="icon-button"
            aria-label="Nova conversa"
            title="Nova conversa"
            onClick={newConversation}
          >
            <Plus size={20} />
          </button>
        </div>
        <label className="chat-search">
          <Search size={16} />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar conversa…"
            aria-label="Buscar conversa"
          />
        </label>
        {listError && (
          <div className="chat-error" role="alert">
            <span>{listError}</span>
            <button onClick={() => void loadConversations()}>
              <RefreshCw size={14} />
              Tentar novamente
            </button>
          </div>
        )}
        <div className="chat-conversation-list">
          {loadingList && (
            <div className="chat-state" role="status">
              <LoaderCircle size={23} className="spinner" />
              <p>Carregando conversas…</p>
            </div>
          )}
          {!loadingList && !filtered.length && (
            <div className="chat-state">
              <MessageCircle size={28} />
              <strong>
                {query
                  ? "Nenhuma conversa encontrada"
                  : "Tudo começa com um olá"}
              </strong>
              <p>
                {query
                  ? "Tente outro nome."
                  : "Escolha um colaborador para conversar."}
              </p>
              {!query && (
                <button className="btn btn-secondary" onClick={newConversation}>
                  Nova conversa
                </button>
              )}
            </div>
          )}
          {filtered.map((conversation) => (
            <button
              key={conversation.id}
              className={`chat-conversation${activeId === conversation.id ? " is-active" : ""}`}
              aria-pressed={activeId === conversation.id}
              aria-label={`${conversation.title}${conversation.unreadCount ? `, ${conversation.unreadCount} mensagens não lidas` : ""}`}
              onClick={() => {
                setActiveId(conversation.id);
                setMobileActive(true);
              }}
            >
              <span
                className={`chat-conversation-avatar${conversation.kind === "team" ? " is-team" : ""}`}
              >
                {conversation.kind === "team" ? (
                  <Users size={21} />
                ) : (
                  initials(conversation.title)
                )}
              </span>
              <span className="chat-conversation-copy">
                <span className="chat-conversation-heading">
                  <strong>{conversation.title}</strong>
                  <time>
                    {conversation.lastMessageAt
                      ? timeLabel(conversation.lastMessageAt)
                      : ""}
                  </time>
                </span>
                <span className="chat-preview">
                  <span>
                    {conversation.lastMessage ||
                      (conversation.kind === "team"
                        ? "Um espaço para toda a equipe"
                        : "Comece uma boa conversa")}
                  </span>
                  {conversation.unreadCount > 0 && (
                    <span className="chat-unread">
                      {conversation.unreadCount > 99
                        ? "99+"
                        : conversation.unreadCount}
                    </span>
                  )}
                </span>
              </span>
            </button>
          ))}
        </div>
        <p className="chat-local-note">
          <LockKeyhole size={13} />
          Mensagens diretas ficam entre os participantes.
        </p>
      </aside>
      <div className="chat-main">
        {active ? (
          <>
            <header className="chat-header">
              <button
                className="icon-button chat-back"
                onClick={() => setMobileActive(false)}
                aria-label="Voltar para conversas"
              >
                <ArrowLeft size={20} />
              </button>
              <span
                className={`chat-conversation-avatar${active.kind === "team" ? " is-team" : ""}`}
              >
                {active.kind === "team" ? (
                  <Users size={21} />
                ) : (
                  initials(active.title)
                )}
              </span>
              <div>
                <h2>{active.title}</h2>
                <p>
                  {active.kind === "team"
                    ? "O ponto de encontro da sua equipe"
                    : "Conversa privada entre colaboradores"}
                </p>
              </div>
              <span className={`chat-connection${live ? " is-live" : ""}`}>
                {live ? "Ao vivo" : "Atualização automática"}
              </span>
            </header>
            {historyError && (
              <div className="chat-error" role="alert">
                <span>{historyError}</span>
                <button
                  onClick={() => void loadLatest(active.id, !messages.length)}
                >
                  <RefreshCw size={14} />
                  Tentar novamente
                </button>
              </div>
            )}
            {actionError && (
              <div className="chat-error" role="alert">
                <span>{actionError}</span>
                <button
                  aria-label="Dispensar erro do chat"
                  onClick={() => setActionError("")}
                >
                  <X size={14} />
                </button>
              </div>
            )}
            <div
              className="chat-scroll"
              ref={scroll}
              role="log"
              aria-label={`Mensagens de ${active.title}`}
              aria-live="polite"
              aria-relevant="additions text"
              onScroll={() => {
                const node = scroll.current;
                if (node)
                  nearBottom.current =
                    node.scrollHeight - node.scrollTop - node.clientHeight <
                    110;
              }}
            >
              {historyLoading ? (
                <div className="chat-state" role="status">
                  <LoaderCircle className="spinner" size={25} />
                  <p>Carregando mensagens…</p>
                </div>
              ) : (
                <>
                  {nextCursor && (
                    <div className="chat-history-more">
                      <button
                        className="btn btn-ghost"
                        onClick={() => void older()}
                        disabled={olderLoading}
                      >
                        {olderLoading ? (
                          <LoaderCircle className="spinner" size={15} />
                        ) : (
                          <ChevronUp size={15} />
                        )}
                        Mensagens anteriores
                      </button>
                    </div>
                  )}
                  {!messages.length && !historyError && (
                    <div className="chat-state">
                      <MessageCircle size={34} />
                      <strong>Uma boa conversa pode começar agora.</strong>
                      <p>
                        {active.kind === "team"
                          ? "Compartilhe uma ideia ou diga olá para a equipe."
                          : `Envie a primeira mensagem para ${active.title}.`}
                      </p>
                    </div>
                  )}
                  {messages.map((message, index) => (
                    <div key={message.id}>
                      {(index === 0 ||
                        dayKey(messages[index - 1]!.createdAt) !==
                          dayKey(message.createdAt)) && (
                        <div className="chat-day-divider">
                          <span>{dayLabel(message.createdAt)}</span>
                        </div>
                      )}
                      <article
                        className={`chat-message${message.senderId === access.userId ? " is-own" : ""}${message.deletedAt ? " is-deleted" : ""}`}
                        aria-label={`Mensagem de ${message.senderName}`}
                      >
                        <UserAvatar
                          userId={message.senderId}
                          name={message.senderName}
                          className="chat-message-avatar"
                        />
                        <div className="chat-message-content">
                          <div className="chat-message-author">
                            {message.senderId === access.userId
                              ? "Você"
                              : message.senderName}
                          </div>
                          {editingId === message.id && !message.deletedAt ? (
                            <form
                              className="chat-edit-form"
                              onSubmit={(event) => void saveEdit(event)}
                            >
                              <label
                                className="sr-only"
                                htmlFor={`edit-${message.id}`}
                              >
                                Editar mensagem
                              </label>
                              <textarea
                                id={`edit-${message.id}`}
                                autoFocus
                                maxLength={4000}
                                value={editDraft}
                                onChange={(event) =>
                                  setEditDraft(event.target.value)
                                }
                                onKeyDown={(event) => {
                                  if (event.key === "Escape")
                                    setEditingId(null);
                                }}
                              />
                              <div>
                                <button
                                  type="button"
                                  className="btn btn-secondary"
                                  onClick={() => setEditingId(null)}
                                  disabled={editing}
                                >
                                  Cancelar
                                </button>
                                <button
                                  className="btn btn-primary"
                                  disabled={editing || !editDraft.trim()}
                                >
                                  {editing ? (
                                    <LoaderCircle
                                      className="spinner"
                                      size={14}
                                    />
                                  ) : (
                                    <Check size={14} />
                                  )}
                                  Salvar mensagem
                                </button>
                              </div>
                            </form>
                          ) : (
                            <div className="chat-bubble">
                              <p className="chat-message-text">
                                {message.deletedAt
                                  ? "Mensagem excluída"
                                  : message.body}
                              </p>
                            </div>
                          )}
                          <div className="chat-message-meta">
                            <time dateTime={message.createdAt}>
                              {timeLabel(message.createdAt)}
                            </time>
                            {message.editedAt && !message.deletedAt && (
                              <span>editada</span>
                            )}
                            {!message.deletedAt && (
                              <div className="chat-message-actions">
                                {message.senderId === access.userId && (
                                  <button
                                    className="icon-button"
                                    aria-label={`Editar mensagem de ${message.senderName}`}
                                    title="Editar mensagem"
                                    onClick={() => {
                                      setEditingId(message.id);
                                      setEditDraft(message.body);
                                      setActionError("");
                                    }}
                                  >
                                    <Pencil size={13} />
                                  </button>
                                )}
                                {canRemove(message) && (
                                  <button
                                    className="icon-button"
                                    aria-label={`Excluir mensagem de ${message.senderName}`}
                                    title="Excluir mensagem"
                                    onClick={() => {
                                      setDeleteTarget(message);
                                      setActionError("");
                                    }}
                                  >
                                    <Trash2 size={13} />
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </article>
                    </div>
                  ))}
                </>
              )}
            </div>
            <form
              className="chat-composer"
              onSubmit={(event) => void send(event)}
            >
              <label className="sr-only" htmlFor="chat-compose">
                Escreva uma mensagem
              </label>
              <textarea
                id="chat-compose"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                maxLength={4000}
                rows={2}
                placeholder={`Mensagem para ${active.kind === "team" ? "a equipe" : active.title}…`}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault();
                    void send();
                  }
                }}
              />
              <div className="chat-composer-footer">
                <small>
                  {draft.length > 3500
                    ? `${draft.length}/4000 caracteres`
                    : "Enter para enviar · Shift + Enter para nova linha"}
                </small>
                <button
                  className="btn btn-primary"
                  type="submit"
                  disabled={!draft.trim() || sending}
                >
                  {sending ? (
                    <LoaderCircle className="spinner" size={16} />
                  ) : (
                    <Send size={16} />
                  )}
                  {sending ? "Enviando…" : "Enviar mensagem"}
                </button>
              </div>
            </form>
          </>
        ) : (
          <div className="chat-state">
            <MessageCircle size={36} />
            <strong>Mais conexão. Menos distância.</strong>
            <p>Selecione uma conversa para se conectar com a equipe.</p>
            <button className="btn btn-primary" onClick={newConversation}>
              <Plus size={16} />
              Nova conversa
            </button>
          </div>
        )}
      </div>
      {newOpen && (
        <ChatDialog
          title="Nova conversa"
          onClose={() => {
            if (!creatingPeer) setNewOpen(false);
          }}
        >
          <p>Escolha um colaborador cadastrado e ativo no CRM.</p>
          <label className="chat-search">
            <Search size={16} />
            <input
              aria-label="Buscar colaborador"
              placeholder="Buscar pelo nome…"
              value={peerQuery}
              onChange={(event) => setPeerQuery(event.target.value)}
            />
          </label>
          {newError && (
            <div className="chat-error" role="alert">
              {newError}
            </div>
          )}
          <div className="chat-people-list">
            {people.map((person) => (
              <button
                className="chat-person"
                key={person.userId}
                onClick={() => void openDirect(person.userId)}
                disabled={!!creatingPeer}
              >
                <span className="chat-conversation-avatar">
                  {initials(person.displayName)}
                </span>
                <span>
                  <strong>{person.displayName}</strong>
                  <small>Mensagem direta</small>
                </span>
                {creatingPeer === person.userId ? (
                  <LoaderCircle className="spinner" size={17} />
                ) : (
                  <MessageCircle size={17} />
                )}
              </button>
            ))}
            {!people.length && (
              <div className="chat-state">
                <Users size={29} />
                <strong>Nenhum colaborador encontrado</strong>
                <p>
                  {access.storage === "sqlite"
                    ? "O ambiente local tem somente seu usuário. As conversas diretas ficam disponíveis com os membros cadastrados na organização Supabase."
                    : "O administrador pode adicionar colaboradores em Usuários e permissões."}
                </p>
              </div>
            )}
          </div>
        </ChatDialog>
      )}
      {deleteTarget && (
        <ChatDialog
          title="Excluir mensagem?"
          onClose={() => {
            if (!deleting) setDeleteTarget(null);
          }}
        >
          <div className="chat-delete-confirm">
            <p>
              O conteúdo será removido da conversa. Os participantes verão uma
              indicação de mensagem excluída.
            </p>
            {actionError && (
              <div className="chat-error" role="alert">
                {actionError}
              </div>
            )}
            <div>
              <button
                className="btn btn-secondary"
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
              >
                Cancelar
              </button>
              <button
                className="btn btn-danger"
                onClick={() => void removeMessage()}
                disabled={deleting}
              >
                {deleting ? (
                  <LoaderCircle className="spinner" size={15} />
                ) : (
                  <Trash2 size={15} />
                )}
                Excluir mensagem
              </button>
            </div>
          </div>
        </ChatDialog>
      )}
    </section>
  );
}
