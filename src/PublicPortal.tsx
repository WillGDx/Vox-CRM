import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  CalendarDays,
  Check,
  LoaderCircle,
  MessageCircle,
  Send,
} from "lucide-react";
import "./public-portal.css";

async function call(path: string, body?: unknown, token?: string) {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const value = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      value?.error || "Não foi possível concluir. Tente novamente.",
    );
  return value;
}
function slotISO(date: string, minute: number, zone: string) {
  const [year, month, day] = date.split("-").map(Number);
  const desired = Date.UTC(
    year,
    month - 1,
    day,
    Math.floor(minute / 60),
    minute % 60,
  );
  let instant = desired;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hourCycle: "h23",
  });
  for (let attempt = 0; attempt < 3; attempt++) {
    const parts = Object.fromEntries(
      formatter
        .formatToParts(new Date(instant))
        .map((part) => [part.type, part.value]),
    );
    const represented = Date.UTC(
      +parts.year,
      +parts.month - 1,
      +parts.day,
      +parts.hour,
      +parts.minute,
      +parts.second,
    );
    instant += desired - represented;
  }
  return new Date(instant).toISOString();
}
interface Booking {
  id: string;
  title: string;
  data: {
    durationMinutes: number;
    weekdays: number[];
    startHour: number;
    endHour: number;
    timeZone: string;
  };
  busyStartTimes: string[];
  busyIntervals?: { startAt: string; endAt: string }[];
}
function BookingPage({ id }: { id: string }) {
  const [page, setPage] = useState<Booking | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const refresh = () =>
    call(`/api/booking/${id}`)
      .then((data) => {
        setPage(data);
      })
      .catch((cause) => setError(cause.message));
  useEffect(() => {
    void refresh();
  }, [id]);
  const choices: string[] = [];
  if (
    page &&
    date &&
    page.data.weekdays.includes(new Date(date + "T12:00:00Z").getUTCDay())
  ) {
    for (
      let minute = page.data.startHour * 60;
      minute + page.data.durationMinutes <= page.data.endHour * 60;
      minute += page.data.durationMinutes
    ) {
      const iso = slotISO(date, minute, page.data.timeZone);
      if (
        Date.parse(iso) > Date.now() + 15 * 60_000 &&
        !page.busyIntervals?.some(
          (busy) =>
            Date.parse(busy.startAt) <
              Date.parse(iso) + page.data.durationMinutes * 60_000 &&
            Date.parse(busy.endAt) > Date.parse(iso),
        ) &&
        !page.busyStartTimes.some(
          (occupied) => Date.parse(occupied) === Date.parse(iso),
        )
      )
        choices.push(iso);
    }
  }
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await call(`/api/booking/${id}`, { name, email, startAt: time });
      setSuccess(true);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Não foi possível agendar.",
      );
      void refresh();
      setTime("");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="public-card">
      <CalendarDays className="public-icon" />
      <h1>{page?.title || "Agende uma conversa"}</h1>
      {success ? (
        <div className="public-success" role="status">
          <Check />
          <h2>Agendamento confirmado</h2>
          <p>
            {new Date(time).toLocaleString("pt-BR", {
              timeZone: page?.data.timeZone,
            })}
          </p>
          <p>Seu horário já está reservado na agenda da equipe.</p>
        </div>
      ) : page ? (
        <form onSubmit={(event) => void submit(event)}>
          <p>
            {page.data.durationMinutes} minutos · Fuso: {page.data.timeZone}
          </p>
          <label>
            Escolha o dia
            <input
              aria-label="Dia do agendamento"
              type="date"
              min={new Intl.DateTimeFormat("en-CA", {
                timeZone: page.data.timeZone,
              }).format(new Date())}
              max={new Date(Date.now() + 60 * 86400000)
                .toISOString()
                .slice(0, 10)}
              required
              value={date}
              onChange={(event) => {
                setDate(event.target.value);
                setTime("");
              }}
            />
          </label>
          <div
            className="public-slots"
            role="group"
            aria-label="Horários disponíveis"
          >
            {choices.map((iso) => (
              <button
                type="button"
                className={time === iso ? "selected" : ""}
                key={iso}
                onClick={() => setTime(iso)}
                aria-pressed={time === iso}
              >
                {new Date(iso).toLocaleTimeString("pt-BR", {
                  timeZone: page.data.timeZone,
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </button>
            ))}
          </div>
          {date && !choices.length && (
            <p>Nenhum horário disponível neste dia. Escolha outra data.</p>
          )}
          <label>
            Seu nome
            <input
              maxLength={120}
              minLength={2}
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="name"
              required
            />
          </label>
          <label>
            E-mail
            <input
              type="email"
              maxLength={254}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
            />
          </label>
          <button className="public-primary" disabled={busy || !time}>
            {busy ? <LoaderCircle className="spinner" /> : <Check />}Confirmar
            horário
          </button>
        </form>
      ) : !error ? (
        <p role="status">Carregando horários…</p>
      ) : null}
      {error && (
        <p className="public-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
interface ChatState {
  title: string;
  status: string;
  messages: {
    id: string;
    text: string;
    direction: string;
    createdAt: string;
  }[];
  hasMore?: boolean;
}
interface Session {
  id: string;
  token: string;
}
function CustomerChat({ id }: { id: string }) {
  const [title, setTitle] = useState("Fale com nossa equipe");
  const [session, setSession] = useState<Session | null>(() => {
    try {
      return JSON.parse(sessionStorage.getItem(`vox-webchat:${id}`) || "null");
    } catch {
      return null;
    }
  });
  const [state, setState] = useState<ChatState | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    call(`/api/public/chat/${id}`)
      .then((value) => {
        if (active) setTitle(value.title);
      })
      .catch((cause) => {
        if (active) setError(cause.message);
      });
    return () => {
      active = false;
    };
  }, [id]);
  useEffect(() => {
    if (!session) return;
    let active = true;
    const refresh = () =>
      call(`/api/public/chat/session/${session.id}`, undefined, session.token)
        .then((value) => {
          if (active) {
            setState(value);
            setError("");
          }
        })
        .catch((cause) => {
          if (active) setError(cause.message);
        });
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [session]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (session)
        setState(
          await call(
            `/api/public/chat/session/${session.id}`,
            { message },
            session.token,
          ),
        );
      else {
        const value = await call(`/api/public/chat/${id}`, {
          name,
          email,
          message,
        });
        const next = { id: value.id, token: value.token };
        setSession(next);
        try {
          sessionStorage.setItem(`vox-webchat:${id}`, JSON.stringify(next));
        } catch {
          /* The conversation still works for this open page. */
        }
      }
      setMessage("");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível enviar sua mensagem.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="public-card">
      <MessageCircle className="public-icon" />
      <h1>{title}</h1>
      <p>Converse com a equipe de atendimento.</p>
      {session && (
        <div className="public-messages" aria-live="polite">
          {state?.hasMore && <p>Exibindo as 200 mensagens mais recentes.</p>}
          {state?.messages.map((entry) => (
            <div key={entry.id} className={`public-message ${entry.direction}`}>
              <strong>
                {entry.direction === "inbound" ? "Você" : "Equipe"}
              </strong>
              <p>{entry.text}</p>
              <time>
                {new Date(entry.createdAt).toLocaleTimeString("pt-BR", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </time>
            </div>
          ))}
          {!state?.messages.length && <p>Carregando conversa…</p>}
        </div>
      )}
      {state?.status === "closed" ? (
        <p className="public-success">Este atendimento foi encerrado.</p>
      ) : (
        <form onSubmit={(event) => void submit(event)}>
          {!session && (
            <>
              <label>
                Seu nome
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  autoComplete="name"
                  minLength={2}
                  maxLength={120}
                  required
                />
              </label>
              <label>
                E-mail (opcional)
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  maxLength={254}
                />
              </label>
            </>
          )}
          <label>
            Sua mensagem
            <textarea
              maxLength={4000}
              rows={3}
              required
              value={message}
              onChange={(event) => setMessage(event.target.value)}
            />
          </label>
          <button className="public-primary" disabled={busy || !message.trim()}>
            {busy ? <LoaderCircle className="spinner" /> : <Send />}Enviar
            mensagem
          </button>
        </form>
      )}
      {error && (
        <p className="public-error" role="alert">
          {error}
        </p>
      )}
      {session && (state?.status === "closed" || error) && (
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => {
            setSession(null);
            setState(null);
            setError("");
            try {
              sessionStorage.removeItem(`vox-webchat:${id}`);
            } catch {
              /* In-memory reset still works. */
            }
          }}
        >
          Iniciar outro atendimento
        </button>
      )}
    </div>
  );
}
export default function PublicPortal({
  kind,
  id,
}: {
  kind: "booking" | "chat";
  id: string;
}) {
  return (
    <main className="public-portal">
      <a className="public-brand" href="/">
        vox <span>crm</span>
      </a>
      {kind === "booking" ? <BookingPage id={id} /> : <CustomerChat id={id} />}
      <p className="public-credit">Organizado com Vox CRM</p>
    </main>
  );
}
