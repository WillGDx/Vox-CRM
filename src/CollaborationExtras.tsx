import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  BarChart3,
  Check,
  Download,
  FilePlus,
  Files,
  LoaderCircle,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  Users,
  Video,
  X,
} from "lucide-react";
import { useAccess } from "./AccessGate";
import { authorizedFetch, getSupabaseClient } from "./auth-client";
import UserAvatar from "./UserAvatar";
import "./collaboration-extra.css";

type Group = {
  id: string;
  title: string;
  memberIds: string[];
  creatorId: string;
  createdAt: string;
  videoRoom: string;
};
type Message = {
  id: string;
  groupId: string;
  body: string;
  senderId: string;
  senderName: string;
  createdAt: string;
};
type Poll = {
  id: string;
  question: string;
  options: { id: string; label: string; votes: number }[];
  myOptionId: string | null;
  closed: boolean;
  authorId: string;
  authorName: string;
  createdAt: string;
};
type SharedFile = {
  id: string;
  name: string;
  path: string;
  mime: string;
  size: number;
  authorId: string;
  createdAt: string;
};
type State = { groups: Group[]; polls: Poll[]; files: SharedFile[] };
const prefix = "/api/collaboration-extra";
const mimeExtensions: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "application/pdf": "pdf",
  "text/plain": "txt",
  "text/csv": "csv",
};
async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await authorizedFetch(prefix + path, {
    method,
    ...(body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(data?.error || "Não foi possível atualizar a colaboração.");
  return data as T;
}
const errorText = (cause: unknown) =>
  cause instanceof Error ? cause.message : "Não foi possível concluir a ação.";
const dateText = (value: string) =>
  new Date(value).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
async function uploadFile(file: File, workspaceId: string | null) {
  if (!file.size || file.size > 10485760)
    throw new Error("Selecione um arquivo de até 10 MB.");
  const ext = file.name.split(".").at(-1)?.toLowerCase();
  const mime = Object.hasOwn(mimeExtensions, file.type)
    ? file.type
    : ext === "csv"
      ? "text/csv"
      : ext === "txt"
        ? "text/plain"
        : "";
  if (!mime || file.name.length > 160)
    throw new Error(
      "Use PNG, JPEG, WebP, PDF, TXT ou CSV; nome de até 160 caracteres.",
    );
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const valid =
    mime === "image/png"
      ? bytes[0] === 137 &&
        bytes[1] === 80 &&
        bytes[2] === 78 &&
        bytes[3] === 71
      : mime === "image/jpeg"
        ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        : mime === "image/webp"
          ? String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
            String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
          : mime === "application/pdf"
            ? String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-"
            : true;
  if (!valid)
    throw new Error(
      "O conteúdo do arquivo não corresponde ao formato selecionado.",
    );
  if (mime.startsWith("text/")) {
    const text = new Uint8Array(await file.arrayBuffer());
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(text);
    } catch {
      throw new Error("Use texto UTF-8.");
    }
    if (text.includes(0)) throw new Error("Use um arquivo de texto válido.");
  }
  const client = getSupabaseClient();
  if (!client) {
    const response = await authorizedFetch(
      prefix + "/upload?name=" + encodeURIComponent(file.name),
      { method: "PUT", headers: { "Content-Type": mime }, body: file },
    );
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "O envio falhou.");
    return data as { path: string; name: string; mime: string; size: number };
  }
  if (!workspaceId) throw new Error("A organização não está disponível.");
  const path =
    workspaceId + "/" + crypto.randomUUID() + "." + mimeExtensions[mime];
  const { error } = await client.storage
    .from("crm-shared-files")
    .upload(path, file, {
      contentType: mime,
      cacheControl: "300",
      upsert: false,
    });
  if (error)
    throw new Error("O envio falhou. Confira sua conexão e tente novamente.");
  return { path, name: file.name, mime, size: file.size };
}
async function removeUpload(path: string) {
  const client = getSupabaseClient();
  if (client) {
    const { error } = await client.storage
      .from("crm-shared-files")
      .remove([path]);
    if (error) throw error;
  } else {
    const response = await authorizedFetch(
      prefix + "/uploads?path=" + encodeURIComponent(path),
      { method: "DELETE" },
    );
    await response.arrayBuffer();
    if (!response.ok) throw new Error("Não foi possível limpar o arquivo.");
  }
}

export default function CollaborationExtras({
  section,
}: {
  section: "chat" | "feed";
}) {
  const { access } = useAccess();
  const [state, setState] = useState<State>({
    groups: [],
    polls: [],
    files: [],
  });
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false),
    [groupTitle, setGroupTitle] = useState(""),
    [memberIds, setMemberIds] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null),
    [messages, setMessages] = useState<Message[]>([]),
    [message, setMessage] = useState("");
  const [messageLoading, setMessageLoading] = useState(false),
    [hasOlder, setHasOlder] = useState(false);
  const [question, setQuestion] = useState(""),
    [choices, setChoices] = useState(["", ""]),
    [pollForm, setPollForm] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const uploadInput = useRef<HTMLInputElement>(null),
    mounted = useRef(true),
    selectedRef = useRef(selected),
    version = useRef(0);
  selectedRef.current = selected;
  const refresh = useCallback(async () => {
    const seq = ++version.current;
    try {
      const data = await api<State>("/state");
      if (
        !Array.isArray(data.groups) ||
        !Array.isArray(data.polls) ||
        !Array.isArray(data.files)
      )
        throw new Error("A colaboração retornou dados inválidos.");
      if (!mounted.current || seq !== version.current) return;
      setState(data);
      setError("");
    } catch (cause) {
      if (mounted.current && seq === version.current)
        setError(errorText(cause));
    } finally {
      if (mounted.current && seq === version.current) setLoading(false);
    }
  }, []);
  const history = useCallback(
    async (groupId: string, older = false) => {
      setMessageLoading(true);
      try {
        const first = older ? messages[0] : null;
        const query = first
          ? "?before=" +
            encodeURIComponent(first.createdAt) +
            "&beforeId=" +
            encodeURIComponent(first.id)
          : "";
        const data = await api<{ items: Message[] }>(
          "/groups/" + groupId + "/messages" + query,
        );
        if (!mounted.current || selectedRef.current !== groupId) return;
        setMessages((current) => {
          const merged = new Map(current.map((item) => [item.id, item]));
          for (const item of data.items) merged.set(item.id, item);
          return [...merged.values()].sort(
            (a, b) =>
              a.createdAt.localeCompare(b.createdAt) ||
              a.id.localeCompare(b.id),
          );
        });
        setHasOlder(data.items.length === 50);
        setError("");
      } catch (cause) {
        if (mounted.current && selectedRef.current === groupId)
          setError(errorText(cause));
      } finally {
        if (mounted.current && selectedRef.current === groupId)
          setMessageLoading(false);
      }
    },
    [messages],
  );
  const historyRef = useRef(history);
  historyRef.current = history;
  useEffect(() => {
    mounted.current = true;
    setState({ groups: [], polls: [], files: [] });
    setSelected(null);
    setMessages([]);
    void refresh();
    const onFocus = () => {
      void refresh();
      if (selectedRef.current) void historyRef.current(selectedRef.current);
    };
    const timer = setInterval(onFocus, 10000);
    window.addEventListener("focus", onFocus);
    return () => {
      mounted.current = false;
      version.current++;
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [access.userId, refresh]);
  useEffect(() => {
    setMessages([]);
    setMessage("");
    setHasOlder(false);
    if (selected) void historyRef.current(selected);
  }, [selected]);
  const perform = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const createGroup = (event: FormEvent) => {
    event.preventDefault();
    void perform(async () => {
      const result = await api<{ id: string }>("/groups", "POST", {
        title: groupTitle,
        memberIds,
      });
      setGroupTitle("");
      setMemberIds([]);
      setCreating(false);
      await refresh();
      setSelected(result.id);
    });
  };
  const send = (event: FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    void perform(async () => {
      await api("/groups/" + selected + "/messages", "POST", { body: message });
      setMessage("");
      await historyRef.current(selected);
    });
  };
  const createPoll = (event: FormEvent) => {
    event.preventDefault();
    void perform(async () => {
      await api("/polls", "POST", { question, options: choices });
      setQuestion("");
      setChoices(["", ""]);
      setPollForm(false);
      await refresh();
    });
  };
  const upload = (file: File | undefined) => {
    if (!file) return;
    void perform(async () => {
      const result = await uploadFile(file, access.workspaceId);
      try {
        await api("/files/register", "POST", result);
      } catch (cause) {
        await removeUpload(result.path).catch(() => {});
        throw cause;
      }
      await refresh();
    });
    if (uploadInput.current) uploadInput.current.value = "";
  };
  const download = (file: SharedFile) =>
    void perform(async () => {
      const result = await api<{ url: string }>(
        "/files/" + file.id + "/download",
      );
      const url = new URL(result.url, window.location.origin);
      if (
        url.origin !== window.location.origin &&
        !(
          url.protocol === "https:" &&
          url.pathname.startsWith("/storage/v1/object/sign/crm-shared-files/")
        )
      )
        throw new Error("Endereço de download inválido.");
      const a = document.createElement("a");
      a.href = url.href;
      a.download = file.name;
      a.rel = "noopener noreferrer";
      a.click();
    });
  const group = state.groups.find((g) => g.id === selected);
  return (
    <section
      className="extra-shell"
      aria-label={
        section === "chat" ? "Grupos e reuniões" : "Enquetes e arquivos"
      }
    >
      <header className="extra-head">
        <div>
          <h2>
            {section === "chat" ? (
              <>
                <Users size={19} />
                Grupos e reuniões
              </>
            ) : (
              <>
                <BarChart3 size={19} />
                Enquetes e arquivos da equipe
              </>
            )}
          </h2>
          <p>
            {section === "chat"
              ? "Grupos privados para os participantes e salas externas de reunião."
              : "Decida com a equipe e compartilhe documentos da organização."}
          </p>
        </div>
        <button
          className="btn btn-secondary"
          type="button"
          aria-label="Atualizar colaboração adicional"
          onClick={() => void refresh()}
          disabled={busy || loading}
        >
          <RefreshCw size={15} />
        </button>
      </header>
      {error && (
        <div className="extra-error" role="alert">
          {error}
        </div>
      )}
      {loading ? (
        <p className="extra-muted" role="status">
          <LoaderCircle className="spinner" size={16} />
          Carregando…
        </p>
      ) : section === "chat" ? (
        <>
          <div className="extra-tools">
            <button
              className="btn btn-secondary"
              disabled={busy}
              onClick={() => setCreating(!creating)}
            >
              <Plus size={16} />
              Novo grupo
            </button>
            <span className="extra-muted">
              Atualização automática a cada 10 segundos
            </span>
          </div>
          {creating && (
            <form className="extra-form" onSubmit={createGroup}>
              <label>
                Nome do grupo
                <input
                  value={groupTitle}
                  maxLength={120}
                  required
                  onChange={(e) => setGroupTitle(e.target.value)}
                />
              </label>
              <fieldset>
                <legend>Participantes</legend>
                <p className="extra-muted">
                  Você participa automaticamente. Somente as pessoas
                  selecionadas terão acesso.
                </p>
                <div className="extra-members">
                  {access.members
                    .filter((m) => m.active && m.userId !== access.userId)
                    .map((m) => (
                      <label key={m.userId}>
                        <input
                          type="checkbox"
                          checked={memberIds.includes(m.userId)}
                          onChange={(e) =>
                            setMemberIds((ids) =>
                              e.target.checked
                                ? [...ids, m.userId]
                                : ids.filter((id) => id !== m.userId),
                            )
                          }
                        />
                        {m.displayName}
                      </label>
                    ))}
                </div>
              </fieldset>
              <div className="extra-tools">
                <button
                  className="btn btn-primary"
                  disabled={busy || memberIds.length > 29}
                >
                  Criar grupo
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setCreating(false)}
                >
                  Cancelar
                </button>
              </div>
            </form>
          )}
          {state.groups.length === 0 ? (
            <p className="extra-empty">
              Crie um grupo para reunir os colegas de um projeto.
            </p>
          ) : (
            <div className="extra-group-layout">
              <div className="extra-group-list" aria-label="Seus grupos">
                {state.groups.map((g) => (
                  <button
                    className={
                      selected === g.id ? "extra-group active" : "extra-group"
                    }
                    key={g.id}
                    onClick={() => setSelected(g.id)}
                  >
                    <Users size={17} />
                    <span>
                      <strong>{g.title}</strong>
                      <small>
                        {g.memberIds.length} participante
                        {g.memberIds.length === 1 ? "" : "s"}
                      </small>
                    </span>
                  </button>
                ))}
              </div>
              {group ? (
                <div className="extra-group-chat">
                  <div className="extra-group-title">
                    <strong>{group.title}</strong>
                    <a
                      className="btn btn-secondary"
                      href={"https://meet.jit.si/VoxCRM-" + group.videoRoom}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Video size={16} />
                      Abrir sala de vídeo
                    </a>
                  </div>
                  <p className="extra-muted extra-video-note">
                    A reunião abre no Jitsi, um serviço externo. O anfitrião
                    pode precisar entrar no Jitsi; use a sala de espera e
                    compartilhe o link apenas com os participantes.
                  </p>
                  <div className="extra-messages" aria-live="polite">
                    {hasOlder && (
                      <button
                        className="btn btn-secondary"
                        disabled={messageLoading}
                        onClick={() => void historyRef.current(group.id, true)}
                      >
                        Carregar anteriores
                      </button>
                    )}
                    {messageLoading && messages.length === 0 ? (
                      <p className="extra-muted">Carregando mensagens…</p>
                    ) : messages.length === 0 ? (
                      <p className="extra-empty">
                        Envie a primeira mensagem para este grupo.
                      </p>
                    ) : (
                      messages.map((m) => (
                        <article
                          className={
                            m.senderId === access.userId
                              ? "extra-message self"
                              : "extra-message"
                          }
                          key={m.id}
                        >
                          <UserAvatar
                            userId={m.senderId}
                            name={m.senderName}
                            className="extra-avatar"
                          />
                          <div>
                            <header>
                              <strong>{m.senderName}</strong>
                              <time>{dateText(m.createdAt)}</time>
                            </header>
                            <p>{m.body}</p>
                          </div>
                        </article>
                      ))
                    )}
                  </div>
                  <form className="extra-composer" onSubmit={send}>
                    <label className="sr-only" htmlFor="extra-group-body">
                      Mensagem para o grupo
                    </label>
                    <textarea
                      id="extra-group-body"
                      value={message}
                      maxLength={4000}
                      required
                      onChange={(e) => setMessage(e.target.value)}
                      placeholder="Escreva para os participantes…"
                    />
                    <button
                      className="btn btn-primary"
                      disabled={busy || !message.trim()}
                    >
                      <Send size={16} />
                      Enviar
                    </button>
                  </form>
                </div>
              ) : (
                <p className="extra-empty">
                  Selecione um grupo para conversar.
                </p>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="extra-feed-grid">
          <section>
            <div className="extra-subhead">
              <h3>
                <BarChart3 size={17} />
                Enquetes
              </h3>
              <button
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => setPollForm(!pollForm)}
              >
                <Plus size={15} />
                Criar enquete
              </button>
            </div>
            {pollForm && (
              <form className="extra-form" onSubmit={createPoll}>
                <label>
                  Pergunta
                  <input
                    value={question}
                    maxLength={300}
                    required
                    onChange={(e) => setQuestion(e.target.value)}
                  />
                </label>
                {choices.map((choice, index) => (
                  <label key={index}>
                    Opção {index + 1}
                    <div className="extra-option-input">
                      <input
                        value={choice}
                        maxLength={100}
                        required
                        onChange={(e) =>
                          setChoices((old) =>
                            old.map((v, i) =>
                              i === index ? e.target.value : v,
                            ),
                          )
                        }
                      />
                      {choices.length > 2 && (
                        <button
                          type="button"
                          className="btn btn-secondary"
                          aria-label={"Remover opção " + (index + 1)}
                          onClick={() =>
                            setChoices((old) =>
                              old.filter((_, i) => i !== index),
                            )
                          }
                        >
                          <X size={15} />
                        </button>
                      )}
                    </div>
                  </label>
                ))}
                <div className="extra-tools">
                  {choices.length < 8 && (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => setChoices((old) => [...old, ""])}
                    >
                      Mais uma opção
                    </button>
                  )}
                  <button className="btn btn-primary" disabled={busy}>
                    Publicar enquete
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setPollForm(false)}
                  >
                    Cancelar
                  </button>
                </div>
              </form>
            )}
            {state.polls.length === 0 ? (
              <p className="extra-empty">Nenhuma enquete publicada.</p>
            ) : (
              state.polls.map((p) => {
                const total = p.options.reduce((sum, o) => sum + o.votes, 0);
                return (
                  <article className="extra-poll" key={p.id}>
                    <header>
                      <strong>{p.question}</strong>
                      <span>{p.closed ? "Encerrada" : "Aberta"}</span>
                    </header>
                    <p className="extra-muted">
                      {p.authorName} · {dateText(p.createdAt)}
                    </p>
                    <div className="extra-poll-options">
                      {p.options.map((o) => (
                        <button
                          key={o.id}
                          disabled={busy || p.closed}
                          aria-pressed={p.myOptionId === o.id}
                          onClick={() =>
                            void perform(async () => {
                              await api("/polls/" + p.id + "/vote", "POST", {
                                optionId: o.id,
                              });
                              await refresh();
                            })
                          }
                        >
                          <span
                            className="extra-poll-fill"
                            style={{
                              width: total
                                ? Math.round((o.votes / total) * 100) + "%"
                                : "0%",
                            }}
                          />
                          <span>
                            {p.myOptionId === o.id && <Check size={14} />}{" "}
                            {o.label}
                          </span>
                          <strong>
                            {o.votes} ·{" "}
                            {total ? Math.round((o.votes / total) * 100) : 0}%
                          </strong>
                        </button>
                      ))}
                    </div>
                    <footer>
                      <span className="extra-muted">
                        {total} voto{total === 1 ? "" : "s"} · Uma opção por
                        pessoa
                      </span>
                      {!p.closed &&
                        (p.authorId === access.userId ||
                          access.role === "admin") && (
                          <button
                            className="extra-text-button"
                            disabled={busy}
                            onClick={() =>
                              void perform(async () => {
                                await api(
                                  "/polls/" + p.id + "/close",
                                  "POST",
                                  {},
                                );
                                await refresh();
                              })
                            }
                          >
                            Encerrar enquete
                          </button>
                        )}
                    </footer>
                  </article>
                );
              })
            )}
          </section>
          <section>
            <div className="extra-subhead">
              <h3>
                <Files size={17} />
                Arquivos
              </h3>
              <button
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => uploadInput.current?.click()}
              >
                <FilePlus size={15} />
                Compartilhar
              </button>
              <input
                ref={uploadInput}
                className="sr-only"
                aria-label="Arquivo para compartilhar"
                type="file"
                accept=".png,.jpg,.jpeg,.webp,.pdf,.txt,.csv"
                onChange={(e) => upload(e.target.files?.[0])}
              />
            </div>
            <p className="extra-muted">
              PNG, JPEG, WebP, PDF, TXT e CSV, até 10 MB. Disponíveis aos
              membros ativos da organização.
            </p>
            {state.files.length === 0 ? (
              <p className="extra-empty">
                Os documentos compartilhados aparecerão aqui.
              </p>
            ) : (
              <div className="extra-files">
                {state.files.map((f) => (
                  <article key={f.id}>
                    <Files size={21} />
                    <div>
                      <strong>{f.name}</strong>
                      <small>
                        {f.size < 1024
                          ? `${f.size} B`
                          : `${(f.size / 1024).toLocaleString("pt-BR", {
                              maximumFractionDigits: 1,
                            })} KB`}{" "}
                        · {dateText(f.createdAt)}
                      </small>
                    </div>
                    <button
                      className="btn btn-secondary"
                      aria-label={"Baixar " + f.name}
                      disabled={busy}
                      onClick={() => download(f)}
                    >
                      <Download size={15} />
                    </button>
                    {(f.authorId === access.userId ||
                      access.role === "admin") && (
                      <button
                        className="btn btn-secondary"
                        aria-label={
                          deleting === f.id
                            ? "Confirmar exclusão de " + f.name
                            : "Remover " + f.name
                        }
                        disabled={busy}
                        onClick={() =>
                          deleting === f.id
                            ? void perform(async () => {
                                await api("/files/" + f.id, "DELETE");
                                setDeleting(null);
                                await refresh();
                              })
                            : setDeleting(f.id)
                        }
                      >
                        {deleting === f.id ? "Confirmar" : <Trash2 size={15} />}
                      </button>
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </section>
  );
}
