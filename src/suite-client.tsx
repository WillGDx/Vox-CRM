import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { authorizedFetch } from "./auth-client";
import { useAccess } from "./AccessGate";

export interface SuiteItem {
  id: string;
  workspaceId: string;
  kind: string;
  title: string;
  data: Record<string, unknown>;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
}

export async function suiteRequest(
  path: string,
  method = "GET",
  body?: unknown,
) {
  const response = await authorizedFetch(path, {
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
    throw new Error(data?.error || "Não foi possível concluir esta operação.");
  return data;
}

interface SuiteContextValue {
  items: SuiteItem[];
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
  create: (
    kind: string,
    title: string,
    data: Record<string, unknown>,
  ) => Promise<SuiteItem>;
  update: (
    item: SuiteItem,
    patch: { title?: string; data?: Record<string, unknown> },
  ) => Promise<SuiteItem>;
  remove: (item: SuiteItem) => Promise<void>;
}
const Context = createContext<SuiteContextValue | null>(null);
export function useSuite(): SuiteContextValue {
  const value = useContext(Context);
  if (!value) throw new Error("O espaço de trabalho não foi inicializado.");
  return value;
}
export function SuiteProvider({ children }: { children: ReactNode }) {
  const { access } = useAccess();
  return (
    <SuiteSession key={access.userId} userId={access.userId}>
      {children}
    </SuiteSession>
  );
}
function SuiteSession({
  children,
  userId,
}: {
  children: ReactNode;
  userId: string;
}) {
  const [items, setItems] = useState<SuiteItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const alive = useRef(true);
  const version = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++version.current;
    try {
      const result = await suiteRequest("/api/suite/state");
      if (!Array.isArray(result?.items))
        throw new Error("A resposta do espaço de trabalho está incompleta.");
      if (alive.current && current === version.current) {
        setItems(result.items);
        setError("");
      }
    } catch (cause) {
      if (alive.current && current === version.current)
        setError(
          cause instanceof Error
            ? cause.message
            : "Não foi possível carregar os módulos.",
        );
    } finally {
      if (alive.current && current === version.current) setLoading(false);
    }
  }, [userId]);
  useEffect(() => {
    alive.current = true;
    void refresh();
    const focus = () => void refresh();
    const timer = window.setInterval(focus, 30_000);
    window.addEventListener("focus", focus);
    return () => {
      alive.current = false;
      version.current++;
      clearInterval(timer);
      window.removeEventListener("focus", focus);
    };
  }, [refresh]);
  const retain = (result: unknown): SuiteItem => {
    const item = (result as { item?: SuiteItem })?.item;
    if (!item?.id || typeof item.revision !== "number")
      throw new Error("O registro salvo retornou uma resposta inválida.");
    version.current++;
    if (alive.current)
      setItems((previous) => [
        item,
        ...previous.filter((entry) => entry.id !== item.id),
      ]);
    return item;
  };
  const create = async (
    kind: string,
    title: string,
    data: Record<string, unknown>,
  ) =>
    retain(
      await suiteRequest(`/api/suite/${encodeURIComponent(kind)}`, "POST", {
        title,
        data,
      }),
    );
  const update = async (
    item: SuiteItem,
    patch: { title?: string; data?: Record<string, unknown> },
  ) =>
    retain(
      await suiteRequest(
        `/api/suite/${encodeURIComponent(item.kind)}/${encodeURIComponent(item.id)}`,
        "PATCH",
        { ...patch, revision: item.revision },
      ),
    );
  const remove = async (item: SuiteItem) => {
    await suiteRequest(
      `/api/suite/${encodeURIComponent(item.kind)}/${encodeURIComponent(item.id)}?revision=${item.revision}`,
      "DELETE",
    );
    version.current++;
    if (alive.current)
      setItems((previous) => previous.filter((entry) => entry.id !== item.id));
  };
  return (
    <Context.Provider
      value={{ items, loading, error, refresh, create, update, remove }}
    >
      {children}
    </Context.Provider>
  );
}
