import { useEffect, useState } from "react";
import { Copy, FileAudio, LoaderCircle, Sparkles } from "lucide-react";
import { authorizedFetch } from "./auth-client";
import { suiteRequest, useSuite } from "./suite-client";
import "./suite-shell.css";

export default function CopilotPanel() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [task, setTask] = useState("summarize");
  const [text, setText] = useState("");
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const { items } = useSuite();
  useEffect(() => {
    let active = true;
    suiteRequest("/api/integrations/status")
      .then((status) => {
        if (active) setConfigured(Boolean(status.ai?.configured));
      })
      .catch((cause) => {
        if (active) setError(cause.message);
      });
    return () => {
      active = false;
    };
  }, []);
  const run = async (file?: File) => {
    setBusy(true);
    setError("");
    setCopied(false);
    try {
      let result;
      if (file) {
        if (file.size > 3 * 1024 * 1024)
          throw new Error("Use um áudio de até 3 MB.");
        const response = await authorizedFetch("/api/copilot/transcribe", {
          method: "POST",
          headers: { "Content-Type": file.type },
          body: file,
        });
        result = await response.json();
        if (!response.ok)
          throw new Error(
            result.error || "Não foi possível transcrever o áudio.",
          );
      } else
        result = await suiteRequest("/api/copilot", "POST", { task, text });
      setAnswer(result.text);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível concluir a solicitação.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="copilot-layout">
      <div className="suite-card">
        <div className="suite-section-heading">
          <Sparkles size={22} />
          <h2>Seu assistente de trabalho</h2>
        </div>
        {configured === false && (
          <div className="suite-notice" role="status">
            O provedor de IA ainda não foi conectado. Peça ao administrador para
            ativar o Copilot.
          </div>
        )}
        <p className="suite-muted">
          Escolha uma ação, revise o conteúdo e envie ao assistente. Você decide
          como usar o resultado.
        </p>
        <label className="suite-field">
          O que você quer fazer?
          <select
            value={task}
            onChange={(event) => setTask(event.target.value)}
          >
            <option value="summarize">Resumir conversa ou conteúdo</option>
            <option value="draft">Criar um texto</option>
            <option value="suggest">Sugerir próximos passos</option>
          </select>
        </label>
        <label className="suite-field">
          Usar informações de um projeto ou tarefa
          <select
            defaultValue=""
            onChange={(event) => {
              const item = items.find(
                (entry) => entry.id === event.target.value,
              );
              if (item)
                setText(
                  `${item.title}\n${String(item.data.description || "")}\nStatus: ${String(item.data.status || "")}`,
                );
            }}
          >
            <option value="">Selecione um registro acessível</option>
            {items
              .filter((item) =>
                ["projects", "project_tasks", "leads"].includes(item.kind),
              )
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
          </select>
        </label>
        <label className="suite-field">
          Conteúdo ou instruções
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={10}
            maxLength={30_000}
            placeholder="Cole uma conversa ou descreva o texto que deseja criar…"
          />
        </label>
        {error && (
          <p className="suite-error" role="alert">
            {error}
          </p>
        )}
        <div className="suite-actions">
          <button
            className="btn btn-primary"
            onClick={() => void run()}
            disabled={busy || !configured || text.trim().length < 3}
          >
            {busy ? <LoaderCircle className="spinner" /> : <Sparkles />}Gerar
            resposta
          </button>
          <label
            className={`btn btn-secondary${!configured || busy ? " disabled" : ""}`}
          >
            <FileAudio /> Transcrever áudio
            <input
              type="file"
              accept="audio/mpeg,audio/wav,audio/webm,audio/ogg,audio/mp4"
              aria-label="Selecionar áudio para transcrever"
              disabled={busy || !configured}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void run(file);
                event.target.value = "";
              }}
              hidden
            />
          </label>
        </div>
      </div>
      <div className="suite-card">
        <h2>Resposta do assistente</h2>
        {answer ? (
          <>
            <p className="copilot-answer">{answer}</p>
            <button
              className="btn btn-secondary"
              onClick={() =>
                void navigator.clipboard
                  .writeText(answer)
                  .then(() => setCopied(true))
                  .catch(() =>
                    setError(
                      "Não foi possível copiar. Selecione o texto da resposta.",
                    ),
                  )
              }
            >
              <Copy />
              {copied ? "Copiado" : "Copiar texto"}
            </button>
          </>
        ) : (
          <p className="suite-muted">
            A resposta aparecerá aqui depois da sua solicitação.
          </p>
        )}
      </div>
    </section>
  );
}
