import { useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  CheckCheck,
  Clock3,
  Copy,
  Download,
  FolderKanban,
  GanttChart,
  LayoutGrid,
  List,
  LoaderCircle,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Save,
  Square,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { useAccess } from "./AccessGate";
import { authorizedFetch } from "./auth-client";
import { useSuite } from "./suite-client";
import type { SuiteItem } from "./suite-client";
import "./work-suite.css";

type ItemData = Record<string, unknown>;
type WorkSection = "projects" | "calendar";
type TaskStatus = "backlog" | "todo" | "doing" | "done";
type Editor = {
  kind: "project" | "task" | "event" | "booking" | "template";
  item?: SuiteItem;
  date?: string;
} | null;
const STATUSES: { id: TaskStatus; label: string }[] = [
  { id: "backlog", label: "Backlog" },
  { id: "todo", label: "A fazer" },
  { id: "doing", label: "Em andamento" },
  { id: "done", label: "Concluídas" },
];
const PRIORITIES: Record<string, string> = {
  low: "Baixa",
  medium: "Média",
  high: "Alta",
};
const PROJECT_STATES: Record<string, string> = {
  planning: "Planejamento",
  active: "Em andamento",
  completed: "Concluído",
};
const DAY = 86_400_000;
const str = (value: unknown, fallback = "") =>
  typeof value === "string" ? value : fallback;
const num = (value: unknown, fallback = 0) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;
const strings = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];
const localDay = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const today = () => localDay();
const addDays = (date: string, days: number) => {
  const parsed = new Date(`${date}T12:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
};
const shortDate = (date: string) =>
  date
    ? new Date(`${date}T12:00:00Z`).toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "short",
        timeZone: "UTC",
      })
    : "Sem data";
const duration = (seconds: number) =>
  `${String(Math.floor(Math.max(0, seconds) / 3600)).padStart(2, "0")}:${String(Math.floor((Math.max(0, seconds) % 3600) / 60)).padStart(2, "0")}:${String(Math.floor(Math.max(0, seconds) % 60)).padStart(2, "0")}`;
const secondsFor = (entry: SuiteItem, now: number) =>
  str(entry.data.endedAt)
    ? num(entry.data.durationSeconds)
    : Math.max(
        0,
        Math.floor((now - Date.parse(str(entry.data.startedAt))) / 1000),
      ) || 0;

function zonedParts(date: Date, timeZone: string) {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
}
function zonedInstant(value: string, zone: string) {
  const naive = Date.parse(`${value}:00Z`);
  if (!Number.isFinite(naive))
    throw new Error("Informe uma data e um horário válidos.");
  let result = naive;
  for (let n = 0; n < 3; n += 1) {
    const represented = Date.parse(`${zonedParts(new Date(result), zone)}:00Z`);
    result += naive - represented;
  }
  if (zonedParts(new Date(result), zone) !== value)
    throw new Error(
      "Esse horário não existe no fuso selecionado. Escolha outro horário.",
    );
  return new Date(result).toISOString();
}
function dateTimeLabel(value: unknown, timeZone: string) {
  const date = new Date(str(value));
  return Number.isFinite(date.getTime())
    ? date.toLocaleString("pt-BR", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        timeZone,
      })
    : "Horário não informado";
}
function friendlyError(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Não foi possível salvar. Tente novamente.";
}
async function action(path: string, values: unknown) {
  const response = await authorizedFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(values),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      result?.error || "Não foi possível atualizar este registro.",
    );
  return result;
}

function WorkModal({
  title,
  children,
  onClose,
  busy,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  busy: boolean;
}) {
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
      if (event.key === "Tab") {
        const focusable = Array.from(
          document.querySelectorAll<HTMLElement>(
            ".ws-modal button:not(:disabled), .ws-modal input:not(:disabled), .ws-modal select:not(:disabled), .ws-modal textarea:not(:disabled), .ws-modal a[href]",
          ),
        );
        const first = focusable[0];
        const last = focusable.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", listener);
    const prior = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", listener);
      document.body.style.overflow = previousOverflow;
      prior?.focus();
    };
  }, [busy, onClose]);
  return (
    <div
      className="ws-modal-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        className="ws-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="work-modal-title"
      >
        <header>
          <h2 id="work-modal-title">{title}</h2>
          <button
            type="button"
            className="ws-icon"
            aria-label="Fechar formulário"
            onClick={onClose}
            disabled={busy}
          >
            <X size={19} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

function Empty({
  icon = <FolderKanban size={32} />,
  title,
  text,
  children,
}: {
  icon?: ReactNode;
  title: string;
  text: string;
  children?: ReactNode;
}) {
  return (
    <div className="ws-empty">
      {icon}
      <h3>{title}</h3>
      <p>{text}</p>
      {children}
    </div>
  );
}

export default function WorkSuite({ section }: { section: WorkSection }) {
  const suite = useSuite();
  const { access } = useAccess();
  const projects = suite.items.filter((item) => item.kind === "projects");
  const [projectId, setProjectId] = useState("");
  const [view, setView] = useState<"board" | "list" | "gantt" | "scrum">(
    "board",
  );
  const [sprint, setSprint] = useState("all");
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState<Editor>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [now, setNow] = useState(Date.now());
  const [month, setMonth] = useState(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  );
  const [calendarView, setCalendarView] = useState<
    "month" | "agenda" | "bookings"
  >("month");
  const [calendarScope, setCalendarScope] = useState("all");
  const [timeZone, setTimeZone] = useState(
    () =>
      Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Sao_Paulo",
  );
  useEffect(() => {
    setNotice("");
    setError("");
    setEditor(null);
  }, [section]);
  const canManage = access.role === "admin" || access.role === "manager";
  const canEdit = (item: SuiteItem) =>
    item.kind === "calendar_events" && item.data.visibility === "personal"
      ? item.ownerId === access.userId
      : canManage || item.ownerId === access.userId;
  const canMoveTask = (item: SuiteItem) =>
    canEdit(item) || item.data.assigneeId === access.userId;
  const activeMembers = access.members.filter((member) => member.active);
  const memberName = (id: string) =>
    activeMembers.find((member) => member.userId === id)?.displayName ||
    (id === access.userId ? "Você" : "Colaborador");
  const timeEntries = suite.items.filter(
    (item) => item.kind === "time_entries",
  );
  const running = timeEntries.find(
    (item) => item.ownerId === access.userId && !str(item.data.endedAt),
  );
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [running?.id]);
  useEffect(() => {
    if (
      projects.length &&
      !projects.some((project) => project.id === projectId)
    )
      setProjectId(projects[0].id);
    if (!projects.length && projectId) setProjectId("");
  }, [projects.map((project) => project.id).join(","), projectId]);
  const project = projects.find((item) => item.id === projectId);
  const tasks = suite.items.filter(
    (item) =>
      item.kind === "project_tasks" && item.data.projectId === projectId,
  );
  const templates = suite.items.filter(
    (item) => item.kind === "project_templates",
  );
  const visibleTasks = tasks.filter(
    (task) =>
      task.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()) &&
      (view !== "scrum" ||
        sprint === "all" ||
        str(task.data.sprint) === sprint),
  );
  const doneCount = tasks.filter((task) => task.data.status === "done").length;
  const totalSeconds = timeEntries
    .filter((entry) => tasks.some((task) => task.id === entry.data.taskId))
    .reduce((sum, entry) => sum + secondsFor(entry, now), 0);
  const events = suite.items
    .filter((item) => item.kind === "calendar_events")
    .filter(
      (item) =>
        calendarScope === "all" ||
        (calendarScope === "team"
          ? item.data.visibility === "team"
          : item.ownerId === access.userId ||
            strings(item.data.attendees).includes(access.userId)),
    );
  const bookings = suite.items.filter((item) => item.kind === "booking_pages");
  const zoneOptions = Array.from(
    new Set([
      timeZone,
      "America/Sao_Paulo",
      "America/Manaus",
      "Europe/Lisbon",
      "UTC",
    ]),
  );

  const perform = async (operation: () => Promise<unknown>, message = "") => {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await operation();
      if (message) setNotice(message);
    } catch (cause) {
      setError(friendlyError(cause));
    } finally {
      setBusy(false);
    }
  };
  const updateStatus = (task: SuiteItem, status: TaskStatus) =>
    void perform(async () => {
      await suite.update(task, { data: { ...task.data, status } });
    });
  const timer = (task: SuiteItem) =>
    void perform(async () => {
      if (running && running.data.taskId !== task.id)
        throw new Error(
          "Encerre o cronômetro atual antes de iniciar outra tarefa.",
        );
      await action(
        running
          ? "/api/suite/actions/time_stop"
          : "/api/suite/actions/time_start",
        running
          ? { id: running.id, revision: running.revision }
          : { taskId: task.id },
      );
      await suite.refresh();
      setNow(Date.now());
    });
  const remove = (item: SuiteItem) => {
    if (!window.confirm(`Excluir “${item.title}”?`)) return;
    void perform(async () => {
      await suite.remove(item);
    }, "Registro excluído.");
  };
  const saveTemplate = () => {
    if (!project || !tasks.length) return;
    setEditor({ kind: "template" });
  };
  const copyBooking = (item: SuiteItem) =>
    void perform(async () => {
      if (item.data.enabled !== true)
        throw new Error("Ative a página antes de compartilhar o link.");
      await navigator.clipboard.writeText(
        `${window.location.origin}/agendar/${item.id}`,
      );
    }, "Link de agendamento copiado.");
  const downloadCalendar = () => {
    const escape = (value: string) =>
      value
        .replace(/\\/g, "\\\\")
        .replace(/\n/g, "\\n")
        .replace(/,/g, "\\,")
        .replace(/;/g, "\\;");
    const instant = (value: string) =>
      new Date(value)
        .toISOString()
        .replace(/[-:]/g, "")
        .replace(/\.\d{3}/, "");
    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Vox CRM//Agenda//PT-BR",
      "CALSCALE:GREGORIAN",
    ];
    for (const item of events) {
      if (
        !Number.isFinite(Date.parse(str(item.data.startAt))) ||
        !Number.isFinite(Date.parse(str(item.data.endAt)))
      )
        continue;
      lines.push(
        "BEGIN:VEVENT",
        `UID:${item.id}@voxcrm`,
        `DTSTAMP:${instant(new Date().toISOString())}`,
        `DTSTART:${instant(str(item.data.startAt))}`,
        `DTEND:${instant(str(item.data.endAt))}`,
        `SUMMARY:${escape(item.title)}`,
        `DESCRIPTION:${escape(str(item.data.description))}`,
        `LOCATION:${escape(str(item.data.location))}`,
        "END:VEVENT",
      );
    }
    lines.push("END:VCALENDAR");
    const url = URL.createObjectURL(
      new Blob([lines.join("\r\n") + "\r\n"], {
        type: "text/calendar;charset=utf-8",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "agenda-vox-crm.ics";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const taskCard = (task: SuiteItem, compact = false) => {
    const currentTimer = running?.data.taskId === task.id;
    const tracked = timeEntries
      .filter((entry) => entry.data.taskId === task.id)
      .reduce((sum, entry) => sum + secondsFor(entry, now), 0);
    const blocked = strings(task.data.dependsOn).some((id) =>
      tasks.some(
        (dependency) =>
          dependency.id === id && dependency.data.status !== "done",
      ),
    );
    return (
      <article
        key={task.id}
        className={`ws-task${compact ? " ws-task-list" : ""}${currentTimer ? " ws-task-timing" : ""}`}
        draggable={!busy && canMoveTask(task)}
        onDragStart={(event) =>
          event.dataTransfer.setData("text/plain", task.id)
        }
      >
        <div className="ws-task-top">
          <span
            className={`ws-priority ws-priority-${str(task.data.priority, "medium")}`}
          >
            {PRIORITIES[str(task.data.priority)] || "Média"}
          </span>
          {str(task.data.sprint) && (
            <span className="ws-tag">{str(task.data.sprint)}</span>
          )}
          {canEdit(task) && (
            <button
              type="button"
              className="ws-icon"
              onClick={() => setEditor({ kind: "task", item: task })}
              aria-label={`Editar tarefa ${task.title}`}
            >
              <Pencil size={14} />
            </button>
          )}
        </div>
        <h3>{task.title}</h3>
        {str(task.data.description) && <p>{str(task.data.description)}</p>}
        {blocked && (
          <span className="ws-dependency">Aguardando uma tarefa anterior</span>
        )}
        <div className="ws-task-meta">
          <span>
            <Users size={12} />
            {memberName(str(task.data.assigneeId, task.ownerId))}
          </span>
          <span>
            <CalendarDays size={12} />
            {shortDate(str(task.data.endDate))}
          </span>
        </div>
        <div className="ws-task-bottom">
          <label className="ws-sr-only" htmlFor={`status-${task.id}`}>
            Etapa de {task.title}
          </label>
          <select
            id={`status-${task.id}`}
            value={str(task.data.status, "todo")}
            onChange={(event) =>
              updateStatus(task, event.target.value as TaskStatus)
            }
            disabled={busy || !canMoveTask(task)}
          >
            {STATUSES.map((status) => (
              <option key={status.id} value={status.id}>
                {status.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={`ws-timer-button${currentTimer ? " active" : ""}`}
            onClick={() => timer(task)}
            disabled={busy || (!!running && !currentTimer)}
            aria-label={`${currentTimer ? "Parar" : "Iniciar"} cronômetro de ${task.title}`}
            title={currentTimer ? "Parar cronômetro" : "Iniciar cronômetro"}
          >
            {currentTimer ? <Square size={12} /> : <Play size={12} />}
            <span>{tracked ? duration(tracked) : "Cronômetro"}</span>
          </button>
        </div>
      </article>
    );
  };

  const gantt = () => {
    const dated = visibleTasks.filter(
      (task) =>
        /^\d{4}-\d{2}-\d{2}$/.test(str(task.data.startDate)) &&
        /^\d{4}-\d{2}-\d{2}$/.test(str(task.data.endDate)),
    );
    if (!dated.length)
      return (
        <Empty
          icon={<GanttChart size={30} />}
          title="Defina as datas das tarefas"
          text="O Gantt usa as datas de início e entrega e mostra as dependências cadastradas."
        />
      );
    const starts = dated.map((task) => str(task.data.startDate)).sort();
    const ends = dated.map((task) => str(task.data.endDate)).sort();
    const start = starts[0];
    const count = Math.min(
      366,
      Math.max(
        7,
        Math.round(
          (Date.parse(`${ends.at(-1)}T12:00:00Z`) -
            Date.parse(`${start}T12:00:00Z`)) /
            DAY,
        ) + 2,
      ),
    );
    const scale = count > 90 ? 14 : count > 40 ? 23 : 36;
    return (
      <div className="ws-gantt-scroll">
        <div className="ws-gantt" style={{ minWidth: 220 + count * scale }}>
          <div className="ws-gantt-head">
            <strong>Tarefa / dependências</strong>
            <div
              className="ws-gantt-days"
              style={{ gridTemplateColumns: `repeat(${count}, ${scale}px)` }}
            >
              {Array.from({ length: count }, (_, index) => (
                <span
                  key={index}
                  title={shortDate(addDays(start, index))}
                  className={addDays(start, index) === today() ? "today" : ""}
                >
                  {count > 90 && index % 7
                    ? ""
                    : new Date(
                        `${addDays(start, index)}T12:00:00Z`,
                      ).getUTCDate()}
                </span>
              ))}
            </div>
          </div>
          {dated.map((task) => {
            const offset = Math.max(
              0,
              Math.round(
                (Date.parse(`${str(task.data.startDate)}T12:00:00Z`) -
                  Date.parse(`${start}T12:00:00Z`)) /
                  DAY,
              ),
            );
            const length = Math.max(
              1,
              Math.round(
                (Date.parse(`${str(task.data.endDate)}T12:00:00Z`) -
                  Date.parse(`${str(task.data.startDate)}T12:00:00Z`)) /
                  DAY,
              ) + 1,
            );
            const dependencies = strings(task.data.dependsOn)
              .map(
                (id) => tasks.find((candidate) => candidate.id === id)?.title,
              )
              .filter(Boolean)
              .join(", ");
            return (
              <div key={task.id} className="ws-gantt-row">
                <button
                  type="button"
                  onClick={() => setEditor({ kind: "task", item: task })}
                  disabled={!canEdit(task)}
                >
                  <strong>{task.title}</strong>
                  {dependencies && <small>Após: {dependencies}</small>}
                </button>
                <div
                  className="ws-gantt-track"
                  style={{ backgroundSize: `${scale}px 100%` }}
                >
                  <span
                    className={`ws-gantt-bar ${task.data.status === "done" ? "done" : ""}`}
                    style={{
                      left: offset * scale,
                      width: Math.min(length, count - offset) * scale - 4,
                    }}
                    title={`${task.title}: ${shortDate(str(task.data.startDate))} até ${shortDate(str(task.data.endDate))}`}
                  />
                </div>
              </div>
            );
          })}
        </div>
        {dated.length !== visibleTasks.length && (
          <p className="ws-hint">
            {visibleTasks.length - dated.length} tarefa(s) sem datas completas
            não aparecem no cronograma.
          </p>
        )}
        {count === 366 && (
          <p className="ws-hint">
            A janela exibe até 366 dias a partir do primeiro início.
          </p>
        )}
      </div>
    );
  };

  const eventCard = (item: SuiteItem) => (
    <article className="ws-event" key={item.id}>
      <div className="ws-event-date">
        <CalendarDays size={18} />
        <strong>
          {new Date(str(item.data.startAt)).toLocaleDateString("pt-BR", {
            day: "2-digit",
            timeZone,
          })}
        </strong>
        <small>
          {new Date(str(item.data.startAt)).toLocaleDateString("pt-BR", {
            month: "short",
            timeZone,
          })}
        </small>
      </div>
      <div className="ws-event-info">
        <h3>{item.title}</h3>
        <p>
          {dateTimeLabel(item.data.startAt, timeZone)} —{" "}
          {dateTimeLabel(item.data.endAt, timeZone)}
        </p>
        {str(item.data.location) && <small>{str(item.data.location)}</small>}
        <span className="ws-tag">
          {item.data.visibility === "team" ? "Equipe" : "Pessoal"}
        </span>
        {strings(item.data.attendees).length > 0 && (
          <small>
            {strings(item.data.attendees).map(memberName).join(", ")}
          </small>
        )}
      </div>
      {canEdit(item) && (
        <button
          className="ws-icon"
          aria-label={`Editar evento ${item.title}`}
          onClick={() => setEditor({ kind: "event", item })}
        >
          <Pencil size={16} />
        </button>
      )}
    </article>
  );

  const monthGrid = () => {
    const year = month.getFullYear(),
      monthNumber = month.getMonth();
    const first = new Date(year, monthNumber, 1);
    const offset = (first.getDay() + 6) % 7;
    const cells = Array.from(
      { length: 42 },
      (_, index) => new Date(year, monthNumber, 1 - offset + index),
    );
    return (
      <div className="ws-calendar">
        <div className="ws-weekdays">
          {["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"].map((day) => (
            <span key={day}>{day}</span>
          ))}
        </div>
        <div className="ws-month-grid">
          {cells.map((date) => {
            const day = localDay(date);
            const dayEvents = events
              .filter((item) => {
                const start = Date.parse(str(item.data.startAt)),
                  end = Date.parse(str(item.data.endAt));
                return (
                  Number.isFinite(start) &&
                  Number.isFinite(end) &&
                  zonedParts(new Date(start), timeZone).slice(0, 10) <= day &&
                  zonedParts(new Date(end - 1), timeZone).slice(0, 10) >= day
                );
              })
              .sort((a, b) =>
                str(a.data.startAt).localeCompare(str(b.data.startAt)),
              );
            return (
              <div
                key={day}
                className={`ws-day${date.getMonth() !== monthNumber ? " outside" : ""}${day === today() ? " today" : ""}`}
              >
                <button
                  className="ws-day-number"
                  aria-label={`Criar evento em ${shortDate(day)}`}
                  onClick={() => setEditor({ kind: "event", date: day })}
                >
                  {date.getDate()}
                </button>
                <div className="ws-day-events">
                  {dayEvents.slice(0, 3).map((item) => (
                    <button
                      key={item.id}
                      className={`ws-calendar-event ${item.data.visibility === "team" ? "team" : ""}`}
                      title={`${item.title} — ${dateTimeLabel(item.data.startAt, timeZone)}`}
                      onClick={() => setEditor({ kind: "event", item })}
                    >
                      <span>
                        {new Date(str(item.data.startAt)).toLocaleTimeString(
                          "pt-BR",
                          { hour: "2-digit", minute: "2-digit", timeZone },
                        )}
                      </span>
                      {item.title}
                    </button>
                  ))}
                  {dayEvents.length > 3 && (
                    <button
                      className="ws-more"
                      onClick={() => {
                        setCalendarView("agenda");
                      }}
                    >
                      {dayEvents.length - 3} mais
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  if (suite.loading && !suite.items.length)
    return (
      <div className="loading-screen" role="status">
        <LoaderCircle className="spinner" />
        <span>
          Carregando {section === "projects" ? "projetos" : "agenda"}…
        </span>
      </div>
    );

  return (
    <div className="work-suite">
      {(error || suite.error) && (
        <div className="ws-message error" role="alert">
          {error || suite.error}
          <button
            className="ws-icon"
            aria-label="Tentar carregar novamente"
            onClick={() => void suite.refresh()}
          >
            <RefreshCw size={15} />
          </button>
        </div>
      )}
      {notice && (
        <div className="ws-message success" role="status">
          <Check size={15} />
          {notice}
        </div>
      )}
      {section === "projects" ? (
        <>
          <div className="ws-stats">
            <div>
              <FolderKanban size={20} />
              <span>
                Projetos ativos
                <strong>
                  {
                    projects.filter((item) => item.data.status !== "completed")
                      .length
                  }
                </strong>
              </span>
            </div>
            <div>
              <CheckCheck size={20} />
              <span>
                Tarefas concluídas
                <strong>
                  {doneCount}
                  <small> / {tasks.length}</small>
                </strong>
              </span>
            </div>
            <div>
              <Clock3 size={20} />
              <span>
                Tempo registrado no projeto
                <strong>{duration(totalSeconds)}</strong>
              </span>
            </div>
          </div>
          {running && (
            <div className="ws-running" role="status">
              <span className="ws-live-dot" />
              <span>
                Cronômetro ativo:{" "}
                <strong>
                  {suite.items.find((item) => item.id === running.data.taskId)
                    ?.title || "Tarefa"}
                </strong>
              </span>
              <strong>{duration(secondsFor(running, now))}</strong>
              <button
                className="btn btn-secondary"
                disabled={busy}
                onClick={() =>
                  void perform(async () => {
                    await action("/api/suite/actions/time_stop", {
                      id: running.id,
                      revision: running.revision,
                    });
                    await suite.refresh();
                  })
                }
              >
                <Square size={13} />
                Encerrar
              </button>
            </div>
          )}
          <div className="ws-project-layout">
            <aside className="ws-project-sidebar">
              <header>
                <h2>Projetos</h2>
                <button
                  className="ws-icon"
                  aria-label="Criar projeto"
                  onClick={() => setEditor({ kind: "project" })}
                >
                  <Plus size={17} />
                </button>
              </header>
              {projects.length ? (
                <div className="ws-project-options">
                  {projects.map((item) => (
                    <button
                      className={projectId === item.id ? "selected" : ""}
                      key={item.id}
                      onClick={() => {
                        setProjectId(item.id);
                        setQuery("");
                      }}
                    >
                      <FolderKanban size={17} />
                      <span>
                        <strong>{item.title}</strong>
                        <small>
                          {PROJECT_STATES[str(item.data.status)] ||
                            "Planejamento"}
                        </small>
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="ws-hint">Seus projetos aparecerão aqui.</p>
              )}
              <div className="ws-template-note">
                <Save size={16} />
                <strong>Modelos de projeto</strong>
                <p>
                  Reutilize tarefas de um projeto ou comece com um modelo já
                  salvo.
                </p>
                <span>{templates.length} modelo(s) disponível(is)</span>
                <button
                  className="btn btn-secondary"
                  onClick={() => setEditor({ kind: "project" })}
                >
                  Novo projeto
                </button>
              </div>
            </aside>
            <section className="ws-project-content">
              {project ? (
                <>
                  <div className="ws-project-heading">
                    <div>
                      <span className="ws-tag">
                        {PROJECT_STATES[str(project.data.status)] ||
                          "Planejamento"}
                      </span>
                      <h2>{project.title}</h2>
                      <p>
                        {str(project.data.description) ||
                          "Organize tarefas, prazos e as próximas entregas da equipe."}
                      </p>
                    </div>
                    <div className="ws-action-row">
                      {canEdit(project) && (
                        <button
                          className="ws-icon"
                          onClick={() =>
                            setEditor({ kind: "project", item: project })
                          }
                          aria-label="Editar projeto"
                        >
                          <Pencil size={17} />
                        </button>
                      )}
                      <button
                        className="btn btn-primary"
                        onClick={() => setEditor({ kind: "task" })}
                      >
                        <Plus size={15} />
                        Nova tarefa
                      </button>
                    </div>
                  </div>
                  <div className="ws-project-progress">
                    <span
                      style={{
                        width: `${tasks.length ? (doneCount / tasks.length) * 100 : 0}%`,
                      }}
                    />
                  </div>
                  <div className="ws-project-dates">
                    <span>
                      {shortDate(str(project.data.startDate))} →{" "}
                      {shortDate(str(project.data.endDate))}
                    </span>
                    <span>
                      {tasks.length
                        ? Math.round((doneCount / tasks.length) * 100)
                        : 0}
                      % concluído
                    </span>
                  </div>
                  <div className="ws-toolbar">
                    <div
                      className="ws-view-tabs"
                      role="group"
                      aria-label="Visualização de tarefas"
                    >
                      {(
                        [
                          { id: "board", label: "Kanban", icon: LayoutGrid },
                          { id: "list", label: "Lista", icon: List },
                          { id: "gantt", label: "Gantt", icon: GanttChart },
                          { id: "scrum", label: "Scrum", icon: CheckCheck },
                        ] as const
                      ).map(({ id, label, icon: Icon }) => (
                        <button
                          key={id}
                          className={view === id ? "active" : ""}
                          onClick={() => setView(id)}
                        >
                          <Icon size={14} />
                          {label}
                        </button>
                      ))}
                    </div>
                    <label className="ws-search">
                      <span className="ws-sr-only">Buscar tarefas</span>
                      <input
                        placeholder="Buscar tarefa…"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                      />
                    </label>
                    <button
                      className="ws-text-button"
                      disabled={!tasks.length}
                      onClick={saveTemplate}
                    >
                      <Save size={13} />
                      Salvar modelo
                    </button>
                  </div>
                  {view === "scrum" && (
                    <div className="ws-sprint-filter">
                      <label>
                        Sprint
                        <select
                          value={sprint}
                          onChange={(event) => setSprint(event.target.value)}
                        >
                          <option value="all">
                            Todos os sprints e backlog
                          </option>
                          {Array.from(
                            new Set(
                              tasks
                                .map((task) => str(task.data.sprint))
                                .filter(Boolean),
                            ),
                          ).map((value) => (
                            <option key={value} value={value}>
                              {value}
                            </option>
                          ))}
                        </select>
                      </label>
                      <span>
                        Defina o sprint ao criar ou editar uma tarefa. O backlog
                        reúne o que ainda será planejado.
                      </span>
                    </div>
                  )}
                  {!tasks.length ? (
                    <Empty
                      title="Um projeto começa pelo próximo passo"
                      text="Adicione a primeira tarefa, escolha um responsável e acompanhe as entregas em diferentes visões."
                    >
                      <button
                        className="btn btn-primary"
                        onClick={() => setEditor({ kind: "task" })}
                      >
                        <Plus size={15} />
                        Criar primeira tarefa
                      </button>
                    </Empty>
                  ) : !visibleTasks.length ? (
                    <Empty
                      title="Nenhuma tarefa neste filtro"
                      text="Tente outro nome ou selecione todos os sprints."
                    />
                  ) : view === "gantt" ? (
                    gantt()
                  ) : view === "list" ? (
                    <div className="ws-task-list-wrap">
                      {visibleTasks.map((task) => taskCard(task, true))}
                    </div>
                  ) : (
                    <div className="ws-board">
                      {STATUSES.map((status) => (
                        <section
                          className={`ws-column ws-column-${status.id}`}
                          key={status.id}
                          onDragOver={(event) => event.preventDefault()}
                          onDrop={(event) => {
                            event.preventDefault();
                            const task = tasks.find(
                              (item) =>
                                item.id ===
                                event.dataTransfer.getData("text/plain"),
                            );
                            if (task && canMoveTask(task) && !busy)
                              updateStatus(task, status.id);
                          }}
                        >
                          <header>
                            <span />
                            <h3>{status.label}</h3>
                            <b>
                              {
                                visibleTasks.filter(
                                  (task) => task.data.status === status.id,
                                ).length
                              }
                            </b>
                          </header>
                          <div>
                            {visibleTasks
                              .filter(
                                (task) =>
                                  task.data.status === status.id ||
                                  (status.id === "todo" &&
                                    !STATUSES.some(
                                      (candidate) =>
                                        candidate.id === task.data.status,
                                    )),
                              )
                              .map((task) => taskCard(task))}
                          </div>
                        </section>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <Empty
                  title="Planeje e acompanhe suas entregas"
                  text="Crie um projeto, divida o trabalho em tarefas e escolha a melhor visão para a sua equipe."
                >
                  <button
                    className="btn btn-primary"
                    onClick={() => setEditor({ kind: "project" })}
                  >
                    <Plus size={15} />
                    Criar projeto
                  </button>
                </Empty>
              )}
            </section>
          </div>
        </>
      ) : (
        <>
          <div className="ws-calendar-toolbar">
            <div
              className="ws-view-tabs"
              role="group"
              aria-label="Visualização do calendário"
            >
              {(
                [
                  { id: "month", title: "Mês", icon: CalendarDays },
                  { id: "agenda", title: "Agenda", icon: List },
                  { id: "bookings", title: "Agendamento", icon: Users },
                ] as const
              ).map(({ id, title, icon: Icon }) => (
                <button
                  className={calendarView === id ? "active" : ""}
                  key={id}
                  onClick={() => setCalendarView(id)}
                >
                  <Icon size={15} />
                  {title}
                </button>
              ))}
            </div>
            <div className="ws-action-row">
              <button
                className="btn btn-secondary"
                onClick={downloadCalendar}
                disabled={!events.length}
              >
                <Download size={14} />
                Exportar agenda
              </button>
              <button
                className="btn btn-primary"
                onClick={() =>
                  setEditor({
                    kind: calendarView === "bookings" ? "booking" : "event",
                  })
                }
              >
                <Plus size={15} />
                {calendarView === "bookings"
                  ? "Página de agendamento"
                  : "Novo evento"}
              </button>
            </div>
          </div>
          <div className="ws-calendar-filters">
            <label>
              Agenda
              <select
                value={calendarScope}
                onChange={(event) => setCalendarScope(event.target.value)}
              >
                <option value="all">Todas as disponíveis</option>
                <option value="mine">Minha agenda</option>
                <option value="team">Agenda da equipe</option>
              </select>
            </label>
            <label>
              Fuso horário
              <select
                value={timeZone}
                onChange={(event) => setTimeZone(event.target.value)}
              >
                {zoneOptions.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </label>
            <span>{events.length} evento(s)</span>
          </div>
          {calendarView === "bookings" ? (
            <div className="ws-booking-grid">
              {bookings.length ? (
                bookings.map((item) => (
                  <article className="ws-booking-card" key={item.id}>
                    <span className="ws-booking-icon">
                      <CalendarDays size={23} />
                    </span>
                    <div className="ws-action-row">
                      <span
                        className={`ws-tag ${item.data.enabled === true ? "positive" : ""}`}
                      >
                        {item.data.enabled === true
                          ? "Página ativa"
                          : "Pausada"}
                      </span>
                      {canEdit(item) && (
                        <button
                          className="ws-icon"
                          aria-label={`Editar agendamento ${item.title}`}
                          onClick={() => setEditor({ kind: "booking", item })}
                        >
                          <Pencil size={15} />
                        </button>
                      )}
                    </div>
                    <h3>{item.title}</h3>
                    <p>
                      {num(item.data.durationMinutes, 30)} minutos ·{" "}
                      {str(item.data.timeZone, timeZone).replaceAll("_", " ")}
                    </p>
                    <small>
                      {String(num(item.data.startHour, 9)).padStart(2, "0")}:00
                      às {String(num(item.data.endHour, 18)).padStart(2, "0")}
                      :00 ·{" "}
                      {strings(item.data.weekdays).join(", ") ||
                        (Array.isArray(item.data.weekdays)
                          ? item.data.weekdays
                              .map(
                                (day) =>
                                  [
                                    "Dom",
                                    "Seg",
                                    "Ter",
                                    "Qua",
                                    "Qui",
                                    "Sex",
                                    "Sáb",
                                  ][Number(day)],
                              )
                              .join(", ")
                          : "Dias úteis")}
                    </small>
                    <button
                      className="btn btn-secondary"
                      disabled={busy || item.data.enabled !== true}
                      onClick={() => copyBooking(item)}
                    >
                      <Copy size={14} />
                      Copiar link público
                    </button>
                  </article>
                ))
              ) : (
                <Empty
                  icon={<CalendarDays size={32} />}
                  title="Facilite o próximo encontro"
                  text="Defina seus horários disponíveis e compartilhe uma página para seus clientes reservarem um horário."
                >
                  <button
                    className="btn btn-primary"
                    onClick={() => setEditor({ kind: "booking" })}
                  >
                    <Plus size={15} />
                    Criar página
                  </button>
                </Empty>
              )}
            </div>
          ) : calendarView === "month" ? (
            <>
              <div className="ws-month-heading">
                <h2>
                  {month.toLocaleDateString("pt-BR", {
                    month: "long",
                    year: "numeric",
                  })}
                </h2>
                <div>
                  <button
                    className="ws-icon"
                    aria-label="Mês anterior"
                    onClick={() =>
                      setMonth(
                        new Date(month.getFullYear(), month.getMonth() - 1, 1),
                      )
                    }
                  >
                    <ArrowLeft size={17} />
                  </button>
                  <button
                    className="ws-text-button"
                    onClick={() =>
                      setMonth(
                        new Date(
                          new Date().getFullYear(),
                          new Date().getMonth(),
                          1,
                        ),
                      )
                    }
                  >
                    Hoje
                  </button>
                  <button
                    className="ws-icon"
                    aria-label="Próximo mês"
                    onClick={() =>
                      setMonth(
                        new Date(month.getFullYear(), month.getMonth() + 1, 1),
                      )
                    }
                  >
                    <ArrowRight size={17} />
                  </button>
                </div>
              </div>
              {monthGrid()}
            </>
          ) : (
            <div className="ws-agenda">
              {events.length ? (
                [...events]
                  .sort((a, b) =>
                    str(a.data.startAt).localeCompare(str(b.data.startAt)),
                  )
                  .map(eventCard)
              ) : (
                <Empty
                  icon={<CalendarDays size={32} />}
                  title="Sua agenda está livre"
                  text="Crie eventos pessoais ou de equipe e mantenha os compromissos no mesmo lugar."
                />
              )}
            </div>
          )}
        </>
      )}
      {editor && (
        <WorkEditor
          key={`${editor.kind}-${editor.item?.id || editor.date || "new"}`}
          editor={editor}
          project={project}
          tasks={tasks}
          projects={projects}
          templates={templates}
          events={suite.items.filter((item) => item.kind === "calendar_events")}
          members={activeMembers}
          userId={access.userId}
          timeZone={timeZone}
          canManage={canManage}
          canEdit={canEdit}
          busy={busy}
          setBusy={setBusy}
          onClose={() => setEditor(null)}
          onSuccess={(message) => {
            setNotice(message);
            setEditor(null);
          }}
          onSelectProject={setProjectId}
          create={suite.create}
          update={suite.update}
          remove={suite.remove}
        />
      )}
    </div>
  );
}

type SuiteHook = ReturnType<typeof useSuite>;
function WorkEditor({
  editor,
  project,
  tasks,
  projects,
  templates,
  events,
  members,
  userId,
  timeZone,
  canManage,
  canEdit,
  busy,
  setBusy,
  onClose,
  onSuccess,
  onSelectProject,
  create,
  update,
  remove,
}: {
  editor: NonNullable<Editor>;
  project?: SuiteItem;
  tasks: SuiteItem[];
  projects: SuiteItem[];
  templates: SuiteItem[];
  events: SuiteItem[];
  members: { userId: string; displayName: string; active: boolean }[];
  userId: string;
  timeZone: string;
  canManage: boolean;
  canEdit: (item: SuiteItem) => boolean;
  busy: boolean;
  setBusy: (value: boolean) => void;
  onClose: () => void;
  onSuccess: (message: string) => void;
  onSelectProject: (id: string) => void;
  create: SuiteHook["create"];
  update: SuiteHook["update"];
  remove: SuiteHook["remove"];
}) {
  const item = editor.item;
  const data = item?.data || {};
  const kind = editor.kind;
  const readOnly = !!item && !canEdit(item);
  const [title, setTitle] = useState(
    item?.title ||
      (kind === "template" ? `${project?.title || "Projeto"} — modelo` : ""),
  );
  const [description, setDescription] = useState(str(data.description));
  const [status, setStatus] = useState(
    str(data.status, kind === "project" ? "active" : "todo"),
  );
  const [startDate, setStartDate] = useState(str(data.startDate, today()));
  const [endDate, setEndDate] = useState(
    str(data.endDate, addDays(today(), 7)),
  );
  const [assigneeId, setAssigneeId] = useState(str(data.assigneeId, userId));
  const [projectId, setProjectId] = useState(
    str(data.projectId, project?.id || ""),
  );
  const [priority, setPriority] = useState(str(data.priority, "medium"));
  const [sprint, setSprint] = useState(str(data.sprint));
  const [dependencies, setDependencies] = useState(strings(data.dependsOn));
  const [selectedMembers, setSelectedMembers] = useState(
    strings(kind === "project" ? data.members : data.attendees),
  );
  const [templateId, setTemplateId] = useState("");
  const [zone, setZone] = useState(str(data.timeZone, "America/Sao_Paulo"));
  const [startAt, setStartAt] = useState(() =>
    str(data.startAt)
      ? zonedParts(
          new Date(str(data.startAt)),
          str(data.timeZone, "America/Sao_Paulo"),
        )
      : `${editor.date || today()}T09:00`,
  );
  const [endAt, setEndAt] = useState(() =>
    str(data.endAt)
      ? zonedParts(
          new Date(str(data.endAt)),
          str(data.timeZone, "America/Sao_Paulo"),
        )
      : `${editor.date || today()}T10:00`,
  );
  const [visibility, setVisibility] = useState(
    str(data.visibility, "personal"),
  );
  const [location, setLocation] = useState(str(data.location));
  const [durationMinutes, setDurationMinutes] = useState(
    num(data.durationMinutes, 30),
  );
  const [weekdays, setWeekdays] = useState<number[]>(
    Array.isArray(data.weekdays)
      ? data.weekdays.filter((day): day is number => typeof day === "number")
      : [1, 2, 3, 4, 5],
  );
  const [startHour, setStartHour] = useState(
    `${String(num(data.startHour, 9)).padStart(2, "0")}:00`,
  );
  const [endHour, setEndHour] = useState(
    `${String(num(data.endHour, 18)).padStart(2, "0")}:00`,
  );
  const [enabled, setEnabled] = useState(data.enabled !== false);
  const [error, setError] = useState("");
  const zoneOptions = ["America/Sao_Paulo"];
  const titleLabel =
    kind === "project"
      ? "Nome do projeto"
      : kind === "task"
        ? "Título da tarefa"
        : kind === "event"
          ? "Título do evento"
          : kind === "booking"
            ? "Nome da página"
            : "Nome do modelo";
  let conflictCount = 0;
  if (kind === "event") {
    try {
      const start = Date.parse(zonedInstant(startAt, zone)),
        end = Date.parse(zonedInstant(endAt, zone));
      conflictCount = events.filter(
        (event) =>
          event.id !== item?.id &&
          Date.parse(str(event.data.startAt)) < end &&
          Date.parse(str(event.data.endAt)) > start &&
          (event.ownerId === userId ||
            strings(event.data.attendees).includes(userId) ||
            selectedMembers.some(
              (id) =>
                strings(event.data.attendees).includes(id) ||
                event.ownerId === id,
            )),
      ).length;
    } catch {
      /* Invalid form values are explained on submit. */
    }
  }
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || readOnly) return;
    setError("");
    setBusy(true);
    try {
      if (!title.trim()) throw new Error("Informe um título.");
      let next: ItemData = {};
      let recordKind: string = "";
      if (kind === "project") {
        if (endDate && startDate && endDate < startDate)
          throw new Error("A entrega precisa ser posterior ao início.");
        recordKind = "projects";
        next = {
          description: description.trim(),
          startDate,
          endDate,
          status,
          members: selectedMembers,
        };
      } else if (kind === "task") {
        if (!projectId) throw new Error("Selecione o projeto desta tarefa.");
        if (endDate && startDate && endDate < startDate)
          throw new Error("A entrega precisa ser posterior ao início.");
        recordKind = "project_tasks";
        next = {
          projectId,
          description: description.trim(),
          status,
          priority,
          assigneeId,
          startDate,
          endDate,
          sprint: sprint.trim(),
          dependsOn: dependencies,
        };
      } else if (kind === "event") {
        const start = zonedInstant(startAt, zone),
          end = zonedInstant(endAt, zone);
        if (end <= start)
          throw new Error("O término precisa ser posterior ao início.");
        recordKind = "calendar_events";
        next = {
          startAt: start,
          endAt: end,
          timeZone: zone,
          visibility,
          attendees: selectedMembers,
          description: description.trim(),
          location: location.trim(),
        };
      } else if (kind === "booking") {
        if (!weekdays.length)
          throw new Error("Escolha ao menos um dia da semana.");
        if (endHour <= startHour)
          throw new Error(
            "O fim da disponibilidade precisa ser posterior ao início.",
          );
        recordKind = "booking_pages";
        next = {
          durationMinutes,
          weekdays,
          startHour: Number(startHour.slice(0, 2)),
          endHour: Number(endHour.slice(0, 2)),
          timeZone: zone,
          enabled,
        };
      } else {
        recordKind = "project_templates";
        next = {
          description: description.trim(),
          tasks: tasks.map((task) => ({
            title: task.title,
            description: str(task.data.description),
            durationDays:
              Math.max(
                1,
                Math.round(
                  (Date.parse(`${str(task.data.endDate, today())}T12:00:00Z`) -
                    Date.parse(
                      `${str(task.data.startDate, today())}T12:00:00Z`,
                    )) /
                    DAY,
                ) + 1,
              ) || 1,
            priority: str(task.data.priority, "medium"),
          })),
        };
      }
      const result = item
        ? await update(item, { title: title.trim(), data: next })
        : await create(recordKind, title.trim(), next);
      if (kind === "project") {
        onSelectProject(result.id);
        if (!item && templateId) {
          const template = templates.find(
            (candidate) => candidate.id === templateId,
          );
          const templateTasks = Array.isArray(template?.data.tasks)
            ? template.data.tasks
            : [];
          let created = 0;
          try {
            for (const candidate of templateTasks) {
              if (!candidate || typeof candidate !== "object") continue;
              const model = candidate as ItemData;
              await create("project_tasks", str(model.title, "Nova tarefa"), {
                projectId: result.id,
                description: str(model.description),
                status: "todo",
                priority: str(model.priority, "medium"),
                assigneeId: userId,
                startDate,
                endDate: addDays(
                  startDate,
                  Math.max(1, num(model.durationDays, 1)) - 1,
                ),
                sprint: "",
                dependsOn: [],
              });
              created += 1;
            }
          } catch (cause) {
            onSuccess(
              `Projeto criado com ${created} tarefa(s) do modelo. As demais não foram criadas: ${friendlyError(cause)}`,
            );
            return;
          }
        }
      }
      onSuccess(
        kind === "template"
          ? "Modelo salvo. Ele pode ser escolhido ao criar um projeto."
          : "Alterações salvas.",
      );
    } catch (cause) {
      setError(friendlyError(cause));
    } finally {
      setBusy(false);
    }
  };
  const deleteItem = async () => {
    if (!item || busy || !window.confirm(`Excluir “${item.title}”?`)) return;
    setBusy(true);
    setError("");
    try {
      await remove(item);
      onSuccess("Registro excluído.");
    } catch (cause) {
      setError(friendlyError(cause));
    } finally {
      setBusy(false);
    }
  };
  const selectPeople = (label: string) => (
    <fieldset className="ws-members-field">
      <legend>{label}</legend>
      {members.length ? (
        members.map((member) => (
          <label key={member.userId}>
            <input
              type="checkbox"
              checked={selectedMembers.includes(member.userId)}
              disabled={readOnly || busy}
              onChange={(event) =>
                setSelectedMembers((previous) =>
                  event.target.checked
                    ? [...previous, member.userId]
                    : previous.filter((id) => id !== member.userId),
                )
              }
            />
            {member.displayName}
            {member.userId === userId ? " (você)" : ""}
          </label>
        ))
      ) : (
        <small>Seu perfil participa deste espaço.</small>
      )}
    </fieldset>
  );
  return (
    <WorkModal
      title={`${readOnly ? "Detalhes" : item ? "Editar" : kind === "task" ? "Nova" : "Novo"} ${kind === "project" ? "projeto" : kind === "task" ? "tarefa" : kind === "event" ? "evento" : kind === "booking" ? "agendamento" : "modelo"}`}
      onClose={onClose}
      busy={busy}
    >
      <form onSubmit={(event) => void submit(event)}>
        <div className="ws-form-body">
          <label>
            {titleLabel}
            <input
              autoFocus
              required
              maxLength={120}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              disabled={readOnly || busy}
            />
          </label>
          {(kind === "project" ||
            kind === "task" ||
            kind === "event" ||
            kind === "template") && (
            <label>
              Descrição
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={3}
                maxLength={4000}
                disabled={readOnly || busy}
              />
            </label>
          )}
          {(kind === "project" || kind === "task") && (
            <>
              <div className="ws-form-grid">
                <label>
                  Início
                  <input
                    type="date"
                    required
                    value={startDate}
                    onChange={(event) => setStartDate(event.target.value)}
                    disabled={readOnly || busy}
                  />
                </label>
                <label>
                  Entrega
                  <input
                    type="date"
                    required
                    min={startDate}
                    value={endDate}
                    onChange={(event) => setEndDate(event.target.value)}
                    disabled={readOnly || busy}
                  />
                </label>
              </div>
              <label>
                Status
                <select
                  value={status}
                  onChange={(event) => setStatus(event.target.value)}
                  disabled={readOnly || busy}
                >
                  {kind === "project"
                    ? Object.entries(PROJECT_STATES).map(([id, label]) => (
                        <option value={id} key={id}>
                          {label}
                        </option>
                      ))
                    : STATUSES.map((candidate) => (
                        <option key={candidate.id} value={candidate.id}>
                          {candidate.label}
                        </option>
                      ))}
                </select>
              </label>
            </>
          )}
          {kind === "project" && (
            <>
              {!item && templates.length > 0 && (
                <label>
                  Começar com um modelo
                  <select
                    value={templateId}
                    onChange={(event) => setTemplateId(event.target.value)}
                    disabled={busy}
                  >
                    <option value="">Projeto em branco</option>
                    {templates.map((template) => (
                      <option value={template.id} key={template.id}>
                        {template.title}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {selectPeople("Participantes do projeto")}
            </>
          )}
          {kind === "task" && (
            <>
              <label>
                Projeto
                <select
                  value={projectId}
                  onChange={(event) => setProjectId(event.target.value)}
                  disabled={!!item || readOnly || busy}
                  required
                >
                  <option value="">Selecione</option>
                  {projects.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.title}
                    </option>
                  ))}
                </select>
              </label>
              <div className="ws-form-grid">
                <label>
                  Responsável
                  <select
                    value={assigneeId}
                    onChange={(event) => setAssigneeId(event.target.value)}
                    disabled={readOnly || busy}
                  >
                    <option value={userId}>Você</option>
                    {members
                      .filter((member) => member.userId !== userId)
                      .map((member) => (
                        <option key={member.userId} value={member.userId}>
                          {member.displayName}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Prioridade
                  <select
                    value={priority}
                    onChange={(event) => setPriority(event.target.value)}
                    disabled={readOnly || busy}
                  >
                    {Object.entries(PRIORITIES).map(([id, label]) => (
                      <option key={id} value={id}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label>
                Sprint
                <input
                  placeholder="Ex.: Sprint 1 (opcional)"
                  maxLength={80}
                  value={sprint}
                  onChange={(event) => setSprint(event.target.value)}
                  disabled={readOnly || busy}
                />
              </label>
              {tasks.filter(
                (task) =>
                  task.id !== item?.id && task.data.projectId === projectId,
              ).length > 0 && (
                <fieldset className="ws-members-field">
                  <legend>Depende de</legend>
                  {tasks
                    .filter(
                      (task) =>
                        task.id !== item?.id &&
                        task.data.projectId === projectId,
                    )
                    .map((task) => (
                      <label key={task.id}>
                        <input
                          type="checkbox"
                          checked={dependencies.includes(task.id)}
                          disabled={readOnly || busy}
                          onChange={(event) =>
                            setDependencies((previous) =>
                              event.target.checked
                                ? [...previous, task.id]
                                : previous.filter((id) => id !== task.id),
                            )
                          }
                        />
                        {task.title}
                      </label>
                    ))}
                </fieldset>
              )}
            </>
          )}
          {(kind === "event" || kind === "booking") && (
            <label>
              Fuso horário
              <select
                value={zone}
                onChange={(event) => setZone(event.target.value)}
                disabled={readOnly || busy}
              >
                {zoneOptions.map((candidate) => (
                  <option key={candidate} value={candidate}>
                    {candidate.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </label>
          )}
          {kind === "event" && (
            <>
              <div className="ws-form-grid">
                <label>
                  Início
                  <input
                    type="datetime-local"
                    required
                    value={startAt}
                    onChange={(event) => setStartAt(event.target.value)}
                    disabled={readOnly || busy}
                  />
                </label>
                <label>
                  Término
                  <input
                    type="datetime-local"
                    required
                    value={endAt}
                    min={startAt}
                    onChange={(event) => setEndAt(event.target.value)}
                    disabled={readOnly || busy}
                  />
                </label>
              </div>
              <label>
                Visibilidade
                <select
                  value={visibility}
                  onChange={(event) => setVisibility(event.target.value)}
                  disabled={readOnly || busy}
                >
                  <option value="personal">Pessoal — você e convidados</option>
                  <option value="team">Equipe — membros ativos</option>
                </select>
              </label>
              {selectPeople("Convidados")}
              <label>
                Local ou link da reunião
                <input
                  value={location}
                  onChange={(event) => setLocation(event.target.value)}
                  maxLength={500}
                  disabled={readOnly || busy}
                />
              </label>
              {conflictCount > 0 && (
                <div className="ws-conflict" role="status">
                  <Clock3 size={15} />
                  {conflictCount} compromisso(s) já ocupa(m) esse horário na
                  agenda dos participantes. Confira a disponibilidade antes de
                  salvar.
                </div>
              )}
            </>
          )}
          {kind === "booking" && (
            <>
              <label>
                Duração da reunião
                <select
                  value={durationMinutes}
                  onChange={(event) =>
                    setDurationMinutes(Number(event.target.value))
                  }
                  disabled={readOnly || busy}
                >
                  {[15, 20, 30, 45, 60, 90, 120].map((minutes) => (
                    <option key={minutes} value={minutes}>
                      {minutes} minutos
                    </option>
                  ))}
                </select>
              </label>
              <fieldset className="ws-members-field ws-weekday-picker">
                <legend>Dias disponíveis</legend>
                {[
                  "Domingo",
                  "Segunda",
                  "Terça",
                  "Quarta",
                  "Quinta",
                  "Sexta",
                  "Sábado",
                ].map((label, index) => (
                  <label key={label}>
                    <input
                      type="checkbox"
                      checked={weekdays.includes(index)}
                      disabled={readOnly || busy}
                      onChange={(event) =>
                        setWeekdays((previous) =>
                          event.target.checked
                            ? [...previous, index].sort()
                            : previous.filter((day) => day !== index),
                        )
                      }
                    />
                    {label}
                  </label>
                ))}
              </fieldset>
              <div className="ws-form-grid">
                <label>
                  Disponível a partir de
                  <input
                    type="time"
                    step={3600}
                    required
                    value={startHour}
                    onChange={(event) => setStartHour(event.target.value)}
                    disabled={readOnly || busy}
                  />
                </label>
                <label>
                  Até
                  <input
                    type="time"
                    step={3600}
                    required
                    min={startHour}
                    value={endHour}
                    onChange={(event) => setEndHour(event.target.value)}
                    disabled={readOnly || busy}
                  />
                </label>
              </div>
              <label className="ws-check-label">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(event) => setEnabled(event.target.checked)}
                  disabled={readOnly || busy}
                />
                Permitir agendamentos pelo link público
              </label>
              <p className="ws-hint">
                A página pública mostra horários disponíveis. Dados da sua
                agenda e nomes dos participantes não são exibidos aos
                visitantes.
              </p>
            </>
          )}
          {kind === "template" && (
            <div className="ws-template-preview">
              <strong>{tasks.length} tarefa(s) neste modelo</strong>
              <ul>
                {tasks.map((task) => (
                  <li key={task.id}>{task.title}</li>
                ))}
              </ul>
              <p>
                O modelo guarda descrição, prioridade e duração das tarefas.
                Responsáveis e datas serão definidos no novo projeto.
              </p>
            </div>
          )}
          {error && (
            <div className="ws-message error" role="alert">
              {error}
            </div>
          )}
        </div>
        <footer>
          {item && !readOnly && (
            <button
              type="button"
              className="ws-delete"
              onClick={() => void deleteItem()}
              disabled={busy}
            >
              <Trash2 size={15} />
              Excluir
            </button>
          )}
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            disabled={busy}
          >
            {readOnly ? "Fechar" : "Cancelar"}
          </button>
          {!readOnly && (
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? (
                <LoaderCircle size={15} className="spinner" />
              ) : (
                <Check size={15} />
              )}
              {busy
                ? "Salvando…"
                : kind === "template"
                  ? "Salvar modelo"
                  : item
                    ? "Salvar alterações"
                    : "Criar"}
            </button>
          )}
        </footer>
      </form>
    </WorkModal>
  );
}
