export type ThemeChoice = "light" | "dark" | "system";
export type AccentChoice =
  | "teal"
  | "blue"
  | "purple"
  | "rose"
  | "amber"
  | "green";
export type BackgroundChoice =
  | "none"
  | "aurora"
  | "ocean"
  | "sunset"
  | "forest";

export interface PersonalProfile {
  fullName: string;
  jobTitle: string;
  department: string;
  phone: string;
  location: string;
  bio: string;
  avatarPath: string | null;
  avatarUrl: string | null;
}

export interface PersonalPreferences {
  theme: ThemeChoice;
  accent: AccentChoice;
  backgroundPreset: BackgroundChoice;
  backgroundPath: string | null;
  backgroundUrl: string | null;
  backgroundOpacity: number;
}

export interface PersonalizationData {
  userId: string;
  email: string;
  profile: PersonalProfile;
  preferences: PersonalPreferences;
  directory: {
    userId: string;
    displayName: string;
    avatarUrl: string | null;
  }[];
  workspace: { id: string; name: string; canEdit: boolean };
}

export type ProfilePatch = Omit<PersonalProfile, "avatarUrl">;
export type PreferencesPatch = Omit<PersonalPreferences, "backgroundUrl">;

export const DEFAULT_PREFERENCES: PersonalPreferences = {
  theme: "light",
  accent: "teal",
  backgroundPreset: "none",
  backgroundPath: null,
  backgroundUrl: null,
  backgroundOpacity: 0.25,
};

const THEMES = ["light", "dark", "system"];
const ACCENTS = ["teal", "blue", "purple", "rose", "amber", "green"];
const BACKGROUNDS = ["none", "aurora", "ocean", "sunset", "forest"];

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("A configuração pessoal recebida é inválida.");
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  if (typeof value !== "string")
    throw new Error("As informações pessoais recebidas estão incompletas.");
  return value;
}

function nullableText(value: unknown): string | null {
  return value === null ? null : text(value);
}

function mediaUrl(value: unknown): string | null {
  if (value === null) return null;
  const url = text(value);
  if (
    url.startsWith("/api/me/media/") &&
    !url.startsWith("//") &&
    !url.includes("\\")
  )
    return url;
  const parsed = new URL(url);
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    !parsed.hostname.endsWith(".supabase.co") ||
    !parsed.pathname.startsWith("/storage/v1/object/sign/crm-personal-media/")
  ) {
    throw new Error("O endereço da imagem pessoal é inválido.");
  }
  return parsed.href;
}

export function parsePreferences(value: unknown): PersonalPreferences {
  const data = object(value);
  if (
    !THEMES.includes(String(data.theme)) ||
    !ACCENTS.includes(String(data.accent)) ||
    !BACKGROUNDS.includes(String(data.backgroundPreset)) ||
    typeof data.backgroundOpacity !== "number" ||
    !Number.isFinite(data.backgroundOpacity) ||
    data.backgroundOpacity < 0 ||
    data.backgroundOpacity > 0.7
  )
    throw new Error("As preferências pessoais recebidas são inválidas.");
  return {
    theme: data.theme as ThemeChoice,
    accent: data.accent as AccentChoice,
    backgroundPreset: data.backgroundPreset as BackgroundChoice,
    backgroundPath: nullableText(data.backgroundPath),
    backgroundUrl: mediaUrl(data.backgroundUrl),
    backgroundOpacity: data.backgroundOpacity,
  };
}

export function parsePersonalization(value: unknown): PersonalizationData {
  const data = object(value);
  const profile = object(data.profile);
  const workspace = object(data.workspace);
  if (!Array.isArray(data.directory) || typeof workspace.canEdit !== "boolean")
    throw new Error("A configuração pessoal recebida está incompleta.");
  return {
    userId: text(data.userId),
    email: text(data.email),
    profile: {
      fullName: text(profile.fullName),
      jobTitle: text(profile.jobTitle),
      department: text(profile.department),
      phone: text(profile.phone),
      location: text(profile.location),
      bio: text(profile.bio),
      avatarPath: nullableText(profile.avatarPath),
      avatarUrl: mediaUrl(profile.avatarUrl),
    },
    preferences: parsePreferences(data.preferences),
    directory: data.directory.map((entry) => {
      const person = object(entry);
      return {
        userId: text(person.userId),
        displayName: text(person.displayName),
        avatarUrl: mediaUrl(person.avatarUrl),
      };
    }),
    workspace: {
      id: text(workspace.id),
      name: text(workspace.name),
      canEdit: workspace.canEdit,
    },
  };
}
