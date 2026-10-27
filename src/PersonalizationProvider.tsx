import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { authorizedFetch, refreshAuthIdentity } from "./auth-client";
import { useAccess } from "./AccessGate";
import {
  DEFAULT_PREFERENCES,
  parsePersonalization,
  parsePreferences,
} from "./personalization-types";
import type {
  PersonalizationData,
  PersonalPreferences,
  PreferencesPatch,
  ProfilePatch,
} from "./personalization-types";
import "./personalization.css";

interface PersonalizationContextValue {
  me: PersonalizationData | null;
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
  saveProfile: (values: ProfilePatch) => Promise<PersonalizationData>;
  savePreferences: (values: PreferencesPatch) => Promise<PersonalizationData>;
  previewPreferences: (values: PersonalPreferences) => void;
  resetPreview: () => void;
  refreshWorkspace: (name: string) => Promise<void>;
}

const PersonalizationContext =
  createContext<PersonalizationContextValue | null>(null);
export const usePersonalizationOptional = () =>
  useContext(PersonalizationContext);
export function usePersonalization() {
  const context = usePersonalizationOptional();
  if (!context)
    throw new Error("As preferências pessoais não foram inicializadas.");
  return context;
}

function cacheKey(userId: string) {
  return `vox-preferences:${userId}`;
}
function cachedPreferences(userId: string): PersonalPreferences {
  try {
    const value = localStorage.getItem(cacheKey(userId));
    if (!value) return { ...DEFAULT_PREFERENCES };
    return parsePreferences({
      ...JSON.parse(value),
      backgroundPath: null,
      backgroundUrl: null,
    });
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}
function cachePreferences(userId: string, preferences: PersonalPreferences) {
  try {
    const { backgroundPath: _path, backgroundUrl: _url, ...safe } = preferences;
    localStorage.setItem(cacheKey(userId), JSON.stringify(safe));
  } catch {
    /* Cloud preferences still persist when local storage is unavailable. */
  }
}

async function request(path: string, method = "GET", values?: unknown) {
  const response = await authorizedFetch(path, {
    method,
    ...(values === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(values),
        }),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      result?.error ||
        "Não foi possível salvar suas preferências. Tente novamente.",
    );
  return result;
}

export default function PersonalizationProvider({
  children,
}: {
  children: ReactNode;
}) {
  const { access } = useAccess();
  return (
    <PersonalizationSession key={access.userId}>
      {children}
    </PersonalizationSession>
  );
}

function PersonalizationSession({ children }: { children: ReactNode }) {
  const { access, refreshAccess } = useAccess();
  const [me, setMe] = useState<PersonalizationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<PersonalPreferences | null>(null);
  const [cached] = useState(() => cachedPreferences(access.userId));
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const sequence = useRef(0);
  const mutationSequence = useRef(0);
  const pendingMutations = useRef(0);
  const mounted = useRef(true);
  const refresh = useCallback(async () => {
    if (pendingMutations.current) return;
    const version = ++sequence.current;
    try {
      const next = parsePersonalization(await request("/api/me"));
      if (!mounted.current || version !== sequence.current) return;
      if (next.userId !== access.userId)
        throw new Error("A configuração recebida pertence a outra conta.");
      setMe(next);
      cachePreferences(access.userId, next.preferences);
      setError("");
    } catch (cause) {
      if (mounted.current && version === sequence.current)
        setError(
          cause instanceof Error
            ? cause.message
            : "Não foi possível carregar suas preferências.",
        );
    } finally {
      if (mounted.current && version === sequence.current) setLoading(false);
    }
  }, [access.userId]);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    const focus = () => {
      void refresh();
    };
    const timer = window.setInterval(() => void refresh(), 45 * 60_000);
    window.addEventListener("focus", focus);
    return () => {
      mounted.current = false;
      sequence.current++;
      clearInterval(timer);
      window.removeEventListener("focus", focus);
    };
  }, [refresh]);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const changed = () => setSystemDark(media.matches);
    media.addEventListener("change", changed);
    return () => media.removeEventListener("change", changed);
  }, []);
  const preferences = preview || me?.preferences || cached;
  useEffect(() => {
    const html = document.documentElement;
    html.dataset.theme =
      preferences.theme === "system"
        ? systemDark
          ? "dark"
          : "light"
        : preferences.theme;
    html.dataset.accent = preferences.accent;
    html.dataset.wallpaper = preferences.backgroundUrl
      ? "photo"
      : preferences.backgroundPreset === "none"
        ? "none"
        : "preset";
    html.dataset.backgroundPreset = preferences.backgroundPreset;
    html.style.setProperty(
      "--personal-wallpaper-opacity",
      String(preferences.backgroundOpacity),
    );
    if (preferences.backgroundUrl)
      html.style.setProperty(
        "--personal-wallpaper",
        `url(${JSON.stringify(preferences.backgroundUrl)})`,
      );
    else html.style.removeProperty("--personal-wallpaper");
  }, [preferences, systemDark]);
  useEffect(
    () => () => {
      const html = document.documentElement;
      delete html.dataset.theme;
      delete html.dataset.accent;
      delete html.dataset.wallpaper;
      delete html.dataset.backgroundPreset;
      html.style.removeProperty("--personal-wallpaper");
      html.style.removeProperty("--personal-wallpaper-opacity");
    },
    [],
  );
  const save = async (
    path: string,
    values: unknown,
  ): Promise<PersonalizationData> => {
    sequence.current += 1;
    const mutation = ++mutationSequence.current;
    pendingMutations.current += 1;
    try {
      const next = parsePersonalization(await request(path, "PATCH", values));
      if (next.userId !== access.userId)
        throw new Error("A configuração recebida pertence a outra conta.");
      if (mounted.current && mutation === mutationSequence.current) {
        sequence.current += 1;
        setMe(next);
        setPreview(null);
        setError("");
        setLoading(false);
        cachePreferences(access.userId, next.preferences);
      }
      return next;
    } finally {
      pendingMutations.current -= 1;
      if (
        mounted.current &&
        !pendingMutations.current &&
        mutation !== mutationSequence.current
      )
        void refresh();
    }
  };
  const saveProfile = async (values: ProfilePatch) => {
    const next = await save("/api/me/profile", values);
    // The profile was saved already; a delayed session refresh must not undo it.
    await refreshAuthIdentity().catch(() => {});
    void refreshAccess();
    return next;
  };
  const savePreferences = (values: PreferencesPatch) =>
    save("/api/me/preferences", values);
  const refreshWorkspace = async (name: string) => {
    sequence.current += 1;
    const result = await request("/api/workspace/settings", "PATCH", { name });
    const workspace = result?.workspace;
    if (
      !workspace ||
      workspace.id !== access.workspaceId ||
      typeof workspace.name !== "string"
    )
      throw new Error("A resposta da organização é inválida.");
    if (mounted.current) {
      sequence.current += 1;
      setMe((previous) =>
        previous
          ? {
              ...previous,
              workspace: { ...previous.workspace, name: workspace.name },
            }
          : previous,
      );
    }
    await refreshAccess();
  };
  return (
    <PersonalizationContext.Provider
      value={{
        me,
        loading,
        error,
        refresh,
        saveProfile,
        savePreferences,
        previewPreferences: setPreview,
        resetPreview: () => setPreview(null),
        refreshWorkspace,
      }}
    >
      {children}
    </PersonalizationContext.Provider>
  );
}
