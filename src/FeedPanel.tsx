import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  Check,
  ChevronDown,
  LoaderCircle,
  Megaphone,
  MessageCircle,
  Pencil,
  Pin,
  PinOff,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  Users,
} from "lucide-react";
import { authorizedFetch, subscribeWorkspaceChanges } from "./auth-client";
import { useAccess } from "./AccessGate";
import { accountName, useWorkspaceAuth } from "./AuthGate";
import UserAvatar from "./UserAvatar";
import type {
  FeedComment,
  FeedPage,
  FeedPost,
  FeedReaction,
} from "./feed-types";
import "./feed.css";

const REACTIONS: { id: FeedReaction; emoji: string; label: string }[] = [
  { id: "like", emoji: "👍", label: "Curtir" },
  { id: "celebrate", emoji: "🎉", label: "Celebrar" },
  { id: "heart", emoji: "❤️", label: "Apoiar" },
];

function Avatar({ name, userId }: { name: string; userId?: string | null }) {
  const colors = ["#def2ef", "#e8e7fa", "#e6effd", "#f9eddf", "#f8e4ee"];
  const index =
    [...name].reduce((total, character) => total + character.charCodeAt(0), 0) %
    colors.length;
  return (
    <UserAvatar
      userId={userId}
      name={name}
      className="feed-avatar"
      style={{ background: colors[index] }}
    />
  );
}

function timestamp(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date
        .toLocaleString("pt-BR", {
          day: "2-digit",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        })
        .replace(".", "")
    : "Data indisponível";
}

async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await authorizedFetch(path, {
    method,
    ...(body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      result?.error || "Não foi possível atualizar o feed. Tente novamente.",
    );
  return result as T;
}

function pageOf<T>(value: FeedPage<T>): FeedPage<T> {
  if (
    !value ||
    !Array.isArray(value.items) ||
    !(value.nextCursor === null || typeof value.nextCursor === "string")
  )
    throw new Error(
      "O feed retornou uma resposta inválida. Tente atualizar a página.",
    );
  return value;
}

const postPath = (id: string) => `/api/feed/posts/${encodeURIComponent(id)}`;
const commentPath = (id: string) =>
  `/api/feed/comments/${encodeURIComponent(id)}`;

interface RemoveTarget {
  kind: "post" | "comment";
  id: string;
}

function RemoveConfirmation({
  target,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  target: RemoveTarget;
  busy: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    cancel.current?.focus();
    return () => {
      document.body.style.overflow = oldOverflow;
      previous?.focus();
    };
  }, []);
  const label = target.kind === "post" ? "publicação" : "comentário";
  return (
    <div
      className="feed-confirm-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <div
        className="feed-confirm-card"
        ref={container}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="feed-remove-title"
        onKeyDown={(event) => {
          if (event.key === "Escape" && !busy) onCancel();
          if (event.key !== "Tab") return;
          const buttons = [
            ...(container.current?.querySelectorAll<HTMLButtonElement>(
              "button:not(:disabled)",
            ) || []),
          ];
          const first = buttons[0];
          const last = buttons[buttons.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          }
          if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
      >
        <Trash2 size={26} />
        <h2 id="feed-remove-title">Excluir {label}?</h2>
        <p>
          O conteúdo será removido do feed da empresa. Esta ação não pode ser
          desfeita.
        </p>
        {error && (
          <p className="feed-error" role="alert">
            {error}
          </p>
        )}
        <div className="feed-editor-actions">
          <button
            ref={cancel}
            className="btn btn-secondary"
            disabled={busy}
            onClick={onCancel}
          >
            Cancelar
          </button>
          <button
            className="btn btn-danger"
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? (
              <LoaderCircle size={16} className="spinner" />
            ) : (
              <Trash2 size={16} />
            )}
            {busy ? "Excluindo…" : "Excluir conteúdo"}
          </button>
        </div>
      </div>
    </div>
  );
}

function PostCard({
  post,
  revision,
  pending,
  onChange,
  onRemove,
  onReaction,
  onPin,
}: {
  post: FeedPost;
  revision: number;
  pending: boolean;
  onChange: (path: string, method: string, body?: unknown) => Promise<void>;
  onRemove: (target: RemoveTarget) => void;
  onReaction: (post: FeedPost, reaction: FeedReaction) => void;
  onPin: (post: FeedPost) => void;
}) {
  const { access } = useAccess();
  const own = post.authorId === access.userId;
  const moderate = own || access.role === "admin";
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(post.body);
  const [postError, setPostError] = useState("");
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [comments, setComments] = useState<FeedComment[]>([]);
  const [commentCursor, setCommentCursor] = useState<string | null>(null);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentsError, setCommentsError] = useState("");
  const [commentDraft, setCommentDraft] = useState("");
  const [commentBusy, setCommentBusy] = useState(false);
  const [commentEditor, setCommentEditor] = useState<{
    id: string;
    body: string;
  } | null>(null);
  const commentPages = useRef(1);
  const commentRequest = useRef(0);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      commentRequest.current += 1;
    };
  }, []);
  const loadComments = useCallback(
    async (older = false) => {
      const requestId = ++commentRequest.current;
      setCommentsLoading(true);
      setCommentsError("");
      try {
        if (older) {
          if (!commentCursor) return;
          const result = pageOf(
            await api<FeedPage<FeedComment>>(
              `${postPath(post.id)}/comments?limit=20&before=${encodeURIComponent(commentCursor)}`,
            ),
          );
          if (!active.current || requestId !== commentRequest.current) return;
          setComments((previous) => [
            ...previous,
            ...result.items.filter(
              (item) => !previous.some((entry) => entry.id === item.id),
            ),
          ]);
          setCommentCursor(result.nextCursor);
          commentPages.current += 1;
        } else {
          let cursor: string | null = null;
          const items: FeedComment[] = [];
          for (let page = 0; page < commentPages.current; page += 1) {
            const result: FeedPage<FeedComment> = pageOf(
              await api<FeedPage<FeedComment>>(
                `${postPath(post.id)}/comments?limit=20${cursor ? `&before=${encodeURIComponent(cursor)}` : ""}`,
              ),
            );
            items.push(...result.items);
            cursor = result.nextCursor;
            if (!cursor) break;
          }
          if (!active.current || requestId !== commentRequest.current) return;
          setComments(items);
          setCommentCursor(cursor);
        }
      } catch (cause) {
        if (active.current && requestId === commentRequest.current)
          setCommentsError(
            cause instanceof Error
              ? cause.message
              : "Não foi possível carregar os comentários.",
          );
      } finally {
        if (active.current && requestId === commentRequest.current)
          setCommentsLoading(false);
      }
    },
    [post.id, commentCursor],
  );
  const loadCommentsRef = useRef(loadComments);
  loadCommentsRef.current = loadComments;
  useEffect(() => {
    if (commentsOpen && !post.deletedAt) void loadCommentsRef.current();
  }, [commentsOpen, revision, post.deletedAt]);
  const savePost = async (event: FormEvent) => {
    event.preventDefault();
    setPostError("");
    if (!draft.trim()) {
      setPostError("Escreva o conteúdo da publicação.");
      return;
    }
    try {
      await onChange(postPath(post.id), "PATCH", { body: draft.trim() });
      setEditing(false);
    } catch (cause) {
      setPostError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível salvar a publicação.",
      );
    }
  };
  const saveComment = async (event: FormEvent) => {
    event.preventDefault();
    setCommentsError("");
    if (!commentDraft.trim()) {
      setCommentsError("Escreva um comentário antes de enviar.");
      return;
    }
    setCommentBusy(true);
    try {
      await onChange(`${postPath(post.id)}/comments`, "POST", {
        body: commentDraft.trim(),
      });
      setCommentDraft("");
    } catch (cause) {
      setCommentsError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível enviar o comentário.",
      );
    } finally {
      setCommentBusy(false);
    }
  };
  const saveCommentEdit = async (event: FormEvent) => {
    event.preventDefault();
    if (!commentEditor) return;
    if (!commentEditor.body.trim()) {
      setCommentsError("Escreva o conteúdo do comentário.");
      return;
    }
    setCommentBusy(true);
    setCommentsError("");
    try {
      await onChange(commentPath(commentEditor.id), "PATCH", {
        body: commentEditor.body.trim(),
      });
      setCommentEditor(null);
    } catch (cause) {
      setCommentsError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível salvar o comentário.",
      );
    } finally {
      setCommentBusy(false);
    }
  };
  return (
    <article
      className={`feed-card${post.pinned ? " is-pinned" : ""}`}
      aria-label={`Publicação de ${post.authorName}`}
    >
      <div className="feed-card-head">
        <Avatar name={post.authorName} userId={post.authorId} />
        <div className="feed-author">
          <strong>{post.authorName || "Ex-colaborador"}</strong>
          <div className="feed-author-meta">
            <time
              className="feed-timestamp"
              dateTime={post.createdAt}
              title={timestamp(post.createdAt)}
            >
              {timestamp(post.createdAt)}
            </time>
            {post.editedAt && !post.deletedAt && (
              <span className="feed-edited">editado</span>
            )}
          </div>
        </div>
        <div className="feed-card-actions">
          {!post.deletedAt && (
            <>
              {access.role === "admin" && (
                <button
                  className="feed-icon-button"
                  title={
                    post.pinned ? "Desafixar publicação" : "Fixar publicação"
                  }
                  aria-label={
                    post.pinned ? "Desafixar publicação" : "Fixar publicação"
                  }
                  disabled={pending}
                  onClick={() => onPin(post)}
                >
                  {post.pinned ? <PinOff size={16} /> : <Pin size={16} />}
                </button>
              )}
              {own && (
                <button
                  className="feed-icon-button"
                  aria-label="Editar publicação"
                  title="Editar publicação"
                  disabled={pending}
                  onClick={() => {
                    setDraft(post.body);
                    setPostError("");
                    setEditing(true);
                  }}
                >
                  <Pencil size={16} />
                </button>
              )}
              {moderate && (
                <button
                  className="feed-icon-button"
                  aria-label="Excluir publicação"
                  title="Excluir publicação"
                  disabled={pending}
                  onClick={() => onRemove({ kind: "post", id: post.id })}
                >
                  <Trash2 size={16} />
                </button>
              )}
            </>
          )}
        </div>
      </div>
      {post.pinned && !post.deletedAt && (
        <span className="feed-pin-badge">
          <Pin size={12} />
          Comunicado fixado
        </span>
      )}
      {post.deletedAt ? (
        <p className="feed-deleted">Publicação excluída.</p>
      ) : editing ? (
        <form
          className="feed-editor"
          onSubmit={(event) => void savePost(event)}
        >
          <label>
            <span className="sr-only">Editar conteúdo da publicação</span>
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              maxLength={8000}
              rows={4}
              autoFocus
              disabled={pending}
            />
          </label>
          {postError && (
            <p className="feed-error" role="alert">
              {postError}
            </p>
          )}
          <div className="feed-editor-actions">
            <span className="feed-character-count">{draft.length}/8.000</span>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={pending}
              onClick={() => setEditing(false)}
            >
              Cancelar edição
            </button>
            <button
              className="btn btn-primary"
              disabled={pending || !draft.trim()}
            >
              {pending ? (
                <LoaderCircle size={15} className="spinner" />
              ) : (
                <Check size={15} />
              )}
              Salvar publicação
            </button>
          </div>
        </form>
      ) : (
        <p className="feed-body">{post.body}</p>
      )}
      {!post.deletedAt && (
        <>
          <div className="feed-card-footer">
            <div className="feed-reactions" aria-label="Reações à publicação">
              {REACTIONS.map((reaction) => (
                <button
                  key={reaction.id}
                  className="feed-reaction"
                  data-active={post.myReaction === reaction.id}
                  aria-pressed={post.myReaction === reaction.id}
                  aria-label={`${reaction.label}: ${post.reactions[reaction.id] || 0}`}
                  disabled={pending}
                  onClick={() => onReaction(post, reaction.id)}
                >
                  <span aria-hidden="true">{reaction.emoji}</span>
                  <span>{reaction.label}</span>
                  <strong>{post.reactions[reaction.id] || 0}</strong>
                </button>
              ))}
            </div>
            <button
              className="feed-comment-toggle"
              aria-expanded={commentsOpen}
              disabled={pending}
              onClick={() => setCommentsOpen((value) => !value)}
            >
              <MessageCircle size={16} />
              {post.commentCount}{" "}
              {post.commentCount === 1 ? "comentário" : "comentários"}
              <ChevronDown size={14} />
            </button>
          </div>
          {commentsOpen && (
            <section
              className="feed-comments"
              aria-label="Comentários da publicação"
            >
              {commentsError && (
                <div className="feed-error" role="alert">
                  <span>{commentsError}</span>
                  <button
                    className="feed-icon-button"
                    aria-label="Atualizar comentários"
                    onClick={() => void loadCommentsRef.current()}
                  >
                    <RefreshCw size={15} />
                  </button>
                </div>
              )}
              {commentsLoading && !comments.length && (
                <p className="feed-loading" role="status">
                  <LoaderCircle className="spinner" size={16} />
                  Carregando comentários…
                </p>
              )}
              {!commentsLoading && !comments.length && !commentsError && (
                <p className="feed-deleted">
                  Seja a primeira pessoa a participar desta conversa.
                </p>
              )}
              {comments.map((comment) => (
                <div className="feed-comment" key={comment.id}>
                  <Avatar name={comment.authorName} userId={comment.authorId} />
                  <div className="feed-comment-content">
                    <div className="feed-comment-head">
                      <strong className="feed-comment-author">
                        {comment.authorName || "Ex-colaborador"}
                      </strong>
                      <time
                        className="feed-timestamp"
                        dateTime={comment.createdAt}
                      >
                        {timestamp(comment.createdAt)}
                      </time>
                      {comment.editedAt && !comment.deletedAt && (
                        <span className="feed-edited">editado</span>
                      )}
                      <div className="feed-comment-actions">
                        {!comment.deletedAt && (
                          <>
                            {comment.authorId === access.userId && (
                              <button
                                className="feed-icon-button"
                                aria-label={`Editar comentário de ${comment.authorName}`}
                                disabled={commentBusy || pending}
                                onClick={() => {
                                  setCommentEditor({
                                    id: comment.id,
                                    body: comment.body,
                                  });
                                  setCommentsError("");
                                }}
                              >
                                <Pencil size={13} />
                              </button>
                            )}
                            {(comment.authorId === access.userId ||
                              access.role === "admin") && (
                              <button
                                className="feed-icon-button"
                                aria-label={`Excluir comentário de ${comment.authorName}`}
                                disabled={commentBusy || pending}
                                onClick={() =>
                                  onRemove({ kind: "comment", id: comment.id })
                                }
                              >
                                <Trash2 size={13} />
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                    {comment.deletedAt ? (
                      <p className="feed-deleted">Comentário excluído.</p>
                    ) : commentEditor?.id === comment.id ? (
                      <form
                        className="feed-editor"
                        onSubmit={(event) => void saveCommentEdit(event)}
                      >
                        <label>
                          <span className="sr-only">
                            Editar conteúdo do comentário
                          </span>
                          <textarea
                            value={commentEditor.body}
                            onChange={(event) =>
                              setCommentEditor({
                                id: comment.id,
                                body: event.target.value,
                              })
                            }
                            maxLength={2000}
                            rows={2}
                            autoFocus
                            disabled={commentBusy || pending}
                          />
                        </label>
                        <div className="feed-editor-actions">
                          <button
                            className="btn btn-secondary"
                            type="button"
                            disabled={commentBusy || pending}
                            onClick={() => setCommentEditor(null)}
                          >
                            Cancelar edição
                          </button>
                          <button
                            className="btn btn-primary"
                            disabled={
                              commentBusy ||
                              pending ||
                              !commentEditor.body.trim()
                            }
                          >
                            Salvar comentário
                          </button>
                        </div>
                      </form>
                    ) : (
                      <p className="feed-comment-body">{comment.body}</p>
                    )}
                  </div>
                </div>
              ))}
              {commentCursor && (
                <button
                  className="feed-load-more"
                  disabled={commentsLoading}
                  onClick={() => void loadCommentsRef.current(true)}
                >
                  {commentsLoading ? (
                    <LoaderCircle size={15} className="spinner" />
                  ) : (
                    <ChevronDown size={15} />
                  )}
                  Carregar comentários anteriores
                </button>
              )}
              <form
                className="feed-comment-form"
                onSubmit={(event) => void saveComment(event)}
              >
                <label className="feed-comment-input">
                  <span className="sr-only">Escrever comentário</span>
                  <textarea
                    value={commentDraft}
                    onChange={(event) => setCommentDraft(event.target.value)}
                    placeholder="Participe da conversa…"
                    maxLength={2000}
                    rows={2}
                    disabled={commentBusy || pending}
                  />
                </label>
                <button
                  className="btn btn-primary"
                  disabled={commentBusy || pending || !commentDraft.trim()}
                  aria-label="Enviar comentário"
                >
                  {commentBusy ? (
                    <LoaderCircle className="spinner" size={16} />
                  ) : (
                    <Send size={16} />
                  )}
                </button>
              </form>
            </section>
          )}
        </>
      )}
    </article>
  );
}

export default function FeedPanel() {
  const { access } = useAccess();
  const { user } = useWorkspaceAuth();
  const myName = user
    ? accountName(user)
    : access.members.find((member) => member.userId === access.userId)
        ?.displayName || "Você";
  const collaboratorCount = Math.max(
    1,
    access.members.filter((member) => member.active).length,
  );
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [draft, setDraft] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [revision, setRevision] = useState(0);
  const [live, setLive] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<RemoveTarget | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeError, setRemoveError] = useState("");
  const pages = useRef(1);
  const busy = useRef(false);
  const queued = useRef(false);
  const active = useRef(true);
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  const refresh = useCallback(async () => {
    if (busy.current) {
      queued.current = true;
      return;
    }
    busy.current = true;
    setRefreshing(true);
    try {
      const all: FeedPost[] = [];
      let before: string | null = null;
      for (let page = 0; page < pages.current; page += 1) {
        const result: FeedPage<FeedPost> = pageOf(
          await api<FeedPage<FeedPost>>(
            `/api/feed/posts?limit=20${before ? `&before=${encodeURIComponent(before)}` : ""}`,
          ),
        );
        all.push(...result.items);
        before = result.nextCursor;
        if (!before) break;
      }
      if (active.current) {
        setPosts(all);
        setCursor(before);
        setError("");
        setRevision((value) => value + 1);
      }
    } catch (cause) {
      if (active.current)
        setError(
          cause instanceof Error
            ? cause.message
            : "Não foi possível carregar o feed.",
        );
    } finally {
      busy.current = false;
      if (active.current) {
        setLoading(false);
        setRefreshing(false);
        if (queued.current) {
          queued.current = false;
          void refreshRef.current();
        }
      }
    }
  }, []);
  refreshRef.current = refresh;
  useEffect(() => {
    active.current = true;
    void refresh();
    let debounce: ReturnType<typeof setTimeout> | undefined;
    const changed = () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        void refreshRef.current();
      }, 250);
    };
    const unsubscribe = subscribeWorkspaceChanges(
      ["crm_feed_posts", "crm_feed_comments", "crm_feed_reactions"],
      changed,
      setLive,
      access.workspaceId,
    );
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") void refreshRef.current();
    }, 20_000);
    const focus = () => {
      void refreshRef.current();
    };
    window.addEventListener("focus", focus);
    return () => {
      active.current = false;
      clearTimeout(debounce);
      clearInterval(interval);
      window.removeEventListener("focus", focus);
      unsubscribe();
    };
  }, [refresh, access.workspaceId]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(timer);
  }, [notice]);
  const older = async () => {
    if (!cursor || busy.current) return;
    busy.current = true;
    setLoadingMore(true);
    setError("");
    try {
      const result = pageOf(
        await api<FeedPage<FeedPost>>(
          `/api/feed/posts?limit=20&before=${encodeURIComponent(cursor)}`,
        ),
      );
      if (active.current) {
        setPosts((previous) => [
          ...previous,
          ...result.items.filter(
            (item) => !previous.some((entry) => entry.id === item.id),
          ),
        ]);
        setCursor(result.nextCursor);
        pages.current += 1;
      }
    } catch (cause) {
      if (active.current)
        setError(
          cause instanceof Error
            ? cause.message
            : "Não foi possível carregar as publicações anteriores.",
        );
    } finally {
      busy.current = false;
      if (active.current) {
        setLoadingMore(false);
        if (queued.current) {
          queued.current = false;
          void refreshRef.current();
        }
      }
    }
  };
  const publish = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft.trim()) {
      setError("Escreva uma mensagem para publicar.");
      return;
    }
    setPublishing(true);
    setError("");
    try {
      await api("/api/feed/posts", "POST", { body: draft.trim() });
      setDraft("");
      setNotice("Publicação compartilhada com a equipe.");
      await refresh();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Não foi possível publicar.",
      );
    } finally {
      setPublishing(false);
    }
  };
  const change = async (path: string, method: string, body?: unknown) => {
    await api(path, method, body);
    await refresh();
  };
  const postAction = async (
    post: FeedPost,
    path: string,
    body: unknown,
    message: string,
  ) => {
    setPending((value) => ({ ...value, [post.id]: true }));
    setError("");
    try {
      await change(path, "POST", body);
      setNotice(message);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível atualizar a publicação.",
      );
    } finally {
      setPending((value) => ({ ...value, [post.id]: false }));
    }
  };
  const remove = async () => {
    if (!removeTarget) return;
    setRemoveBusy(true);
    setRemoveError("");
    try {
      await change(
        removeTarget.kind === "post"
          ? postPath(removeTarget.id)
          : commentPath(removeTarget.id),
        "DELETE",
      );
      setRemoveTarget(null);
      setNotice("Conteúdo removido do feed.");
    } catch (cause) {
      setRemoveError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível excluir o conteúdo.",
      );
    } finally {
      setRemoveBusy(false);
    }
  };
  return (
    <div className="feed-layout">
      <div className="feed-main">
        <section className="feed-composer" aria-label="Nova publicação">
          <div className="feed-composer-head">
            <Avatar name={myName} userId={access.userId} />
            <div>
              <strong className="feed-composer-title">
                O que vamos compartilhar hoje?
              </strong>
              <p>Atualizações, boas ideias e conquistas da sua equipe.</p>
            </div>
          </div>
          <form onSubmit={(event) => void publish(event)}>
            <label>
              <span className="sr-only">Escrever publicação</span>
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Compartilhe uma novidade com a empresa…"
                maxLength={8000}
                rows={4}
                disabled={publishing}
              />
            </label>
            <div className="feed-composer-footer">
              <span className="feed-character-count">
                {draft.length.toLocaleString("pt-BR")}/8.000
              </span>
              <span className="feed-status">
                <span className="feed-status-dot" data-live={live} />
                {live ? "Atualização ao vivo" : "Atualização automática"}
              </span>
              <button
                className="btn btn-primary"
                disabled={publishing || !draft.trim()}
              >
                {publishing ? (
                  <LoaderCircle className="spinner" size={16} />
                ) : (
                  <Send size={16} />
                )}
                {publishing ? "Publicando…" : "Publicar"}
              </button>
            </div>
          </form>
        </section>
        {error && (
          <div className="feed-error" role="alert">
            <span>{error}</span>
            <button
              className="feed-icon-button"
              aria-label="Atualizar feed"
              onClick={() => void refresh()}
              disabled={refreshing}
            >
              <RefreshCw size={16} />
            </button>
          </div>
        )}
        {notice && (
          <div className="feed-notice" role="status">
            <Check size={16} />
            {notice}
          </div>
        )}
        <div
          className="feed-list"
          aria-label="Publicações da empresa"
          aria-busy={loading}
        >
          {loading ? (
            <div className="feed-loading" role="status">
              <LoaderCircle className="spinner" size={22} />
              Carregando as novidades…
            </div>
          ) : !posts.length ? (
            <div className="feed-empty">
              <Megaphone size={34} />
              <h2>Uma empresa, muitas boas conversas.</h2>
              <p>
                Compartilhe a primeira novidade com os colaboradores do CRM.
              </p>
            </div>
          ) : (
            posts.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                revision={revision}
                pending={!!pending[post.id]}
                onChange={async (path, method, body) => {
                  setPending((value) => ({ ...value, [post.id]: true }));
                  try {
                    await change(path, method, body);
                  } finally {
                    setPending((value) => ({ ...value, [post.id]: false }));
                  }
                }}
                onRemove={(target) => {
                  setRemoveError("");
                  setRemoveTarget(target);
                }}
                onReaction={(target, reaction) =>
                  void postAction(
                    target,
                    `${postPath(target.id)}/reactions`,
                    {
                      reaction:
                        target.myReaction === reaction ? null : reaction,
                    },
                    "Reação atualizada.",
                  )
                }
                onPin={(target) =>
                  void postAction(
                    target,
                    `${postPath(target.id)}/pin`,
                    { pinned: !target.pinned },
                    target.pinned
                      ? "Publicação desafixada."
                      : "Comunicado fixado no feed.",
                  )
                }
              />
            ))
          )}
        </div>
        {cursor && (
          <button
            className="feed-load-more"
            disabled={loadingMore || refreshing}
            onClick={() => void older()}
          >
            {loadingMore ? (
              <LoaderCircle className="spinner" size={16} />
            ) : (
              <ChevronDown size={16} />
            )}
            {loadingMore ? "Carregando…" : "Ver publicações anteriores"}
          </button>
        )}
      </div>
      <aside className="feed-aside">
        <section className="feed-help-card">
          <span className="feed-help-icon">
            <Sparkles size={21} />
          </span>
          <h2 className="feed-help-title">As boas ideias circulam.</h2>
          <p className="feed-help-copy">
            Este é o espaço da {access.workspaceName} para compartilhar
            novidades, reconhecer conquistas e manter todo mundo por perto.
          </p>
          <span className="feed-live-pill">
            <Users size={14} />
            {collaboratorCount}{" "}
            {collaboratorCount === 1
              ? "colaborador com acesso"
              : "colaboradores com acesso"}
          </span>
        </section>
        <section className="feed-help-card">
          <span className="feed-help-icon">
            <ShieldCheck size={20} />
          </span>
          <h3 className="feed-help-title">Uma conversa para a equipe.</h3>
          <p className="feed-help-copy">
            As publicações são visíveis aos membros ativos da organização. Para
            conversar em particular, use o chat interno.
          </p>
          {access.role === "admin" && (
            <p className="feed-help-copy">
              <Pin size={13} />
              Você pode fixar os comunicados que a equipe precisa encontrar
              primeiro.
            </p>
          )}
        </section>
      </aside>
      {removeTarget && (
        <RemoveConfirmation
          target={removeTarget}
          busy={removeBusy}
          error={removeError}
          onCancel={() => {
            if (!removeBusy) setRemoveTarget(null);
          }}
          onConfirm={() => void remove()}
        />
      )}
    </div>
  );
}
