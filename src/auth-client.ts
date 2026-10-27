import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

export type PublicConfig =
  | { storage: "sqlite"; authRequired: false; configured: true }
  | {
      storage: "supabase";
      authRequired: true;
      configured: true;
      url: string;
      publishableKey: string;
    };

let client: SupabaseClient | null = null;
let identity = "";

export function getSupabaseClient(): SupabaseClient | null {
  return client;
}

export function parsePublicConfig(value: unknown): PublicConfig {
  if (!value || typeof value !== "object")
    throw new Error("A configuração da aplicação é inválida.");
  const config = value as Record<string, unknown>;
  if (
    config.storage === "sqlite" &&
    config.authRequired === false &&
    config.configured === true
  )
    return { storage: "sqlite", authRequired: false, configured: true };
  if (
    config.storage === "supabase" &&
    config.authRequired === true &&
    config.configured === true &&
    typeof config.url === "string" &&
    typeof config.publishableKey === "string" &&
    config.publishableKey.trim().length > 0
  ) {
    const url = new URL(config.url);
    if (
      url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(url.hostname)
      )
    )
      throw new Error("A conexão do Supabase precisa usar HTTPS.");
    return {
      storage: "supabase",
      authRequired: true,
      configured: true,
      url: config.url,
      publishableKey: config.publishableKey,
    };
  }
  throw new Error("A configuração do banco de dados está incompleta.");
}

export function configureAuth(config: PublicConfig): SupabaseClient | null {
  if (!config.authRequired) {
    client = null;
    identity = "";
    return null;
  }
  const nextIdentity = `${config.url}\n${config.publishableKey}`;
  if (!client || identity !== nextIdentity) {
    client = createClient(config.url, config.publishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
    identity = nextIdentity;
  }
  return client;
}

export async function authorizedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (client) {
    const destination = new URL(
      input instanceof Request ? input.url : String(input),
      window.location.origin,
    );
    if (destination.origin !== window.location.origin)
      throw new Error(
        "As requisições autenticadas precisam usar a origem do CRM.",
      );
    const { data, error } = await client.auth.getSession();
    if (error || !data.session) {
      throw new Error("Sua sessão expirou. Entre novamente para continuar.");
    }
    headers.set("Authorization", `Bearer ${data.session.access_token}`);
  }
  return fetch(input, { ...init, headers });
}

export async function refreshAuthIdentity(): Promise<void> {
  if (!client) return;
  const { error } = await client.auth.refreshSession();
  if (error)
    throw new Error(
      "O perfil foi salvo, mas não foi possível atualizar a sessão agora.",
    );
}

async function preparePersonalImage(file: File, kind: "avatar" | "background") {
  if (file.size <= 0 || file.size > 12 * 1024 * 1024) {
    throw new Error("Escolha uma imagem de até 12 MB.");
  }
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const png =
    bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71;
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const webp =
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  if (!png && !jpeg && !webp)
    throw new Error("Use uma foto PNG, JPEG ou WebP válida.");
  let image: ImageBitmap;
  try {
    image = await createImageBitmap(file);
  } catch {
    throw new Error("Não foi possível abrir a imagem selecionada.");
  }
  try {
    if (
      image.width < 1 ||
      image.height < 1 ||
      image.width * image.height > 40_000_000
    ) {
      throw new Error("Escolha uma imagem com até 40 megapixels.");
    }
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 1920 / image.width, 1600 / image.height);
    canvas.width =
      kind === "avatar" ? 512 : Math.max(1, Math.round(image.width * scale));
    canvas.height =
      kind === "avatar" ? 512 : Math.max(1, Math.round(image.height * scale));
    const drawing = canvas.getContext("2d");
    if (!drawing)
      throw new Error("Seu navegador não conseguiu preparar a imagem.");
    if (kind === "avatar") {
      const side = Math.min(image.width, image.height);
      drawing.drawImage(
        image,
        (image.width - side) / 2,
        (image.height - side) / 2,
        side,
        side,
        0,
        0,
        512,
        512,
      );
    } else drawing.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", 0.88),
    );
    const limit = (kind === "avatar" ? 2 : 8) * 1024 * 1024;
    if (!blob || blob.size > limit)
      throw new Error("A imagem ficou muito grande. Escolha uma foto menor.");
    return blob;
  } finally {
    image.close();
  }
}

export async function uploadPersonalImage(
  file: File,
  kind: "avatar" | "background",
): Promise<{ path: string }> {
  const blob = await preparePersonalImage(file, kind);
  if (!client) {
    const response = await authorizedFetch(`/api/me/media?kind=${kind}`, {
      method: "PUT",
      headers: { "Content-Type": blob.type },
      body: blob,
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || typeof data?.path !== "string")
      throw new Error(data?.error || "Não foi possível enviar a foto.");
    return { path: data.path };
  }
  const { data, error } = await client.auth.getSession();
  if (error || !data.session)
    throw new Error("Entre novamente para enviar sua foto.");
  const extension =
    blob.type === "image/png"
      ? "png"
      : blob.type === "image/jpeg"
        ? "jpg"
        : "webp";
  const path = `${data.session.user.id}/${kind}/${crypto.randomUUID()}.${extension}`;
  const result = await client.storage
    .from("crm-personal-media")
    .upload(path, blob, {
      contentType: blob.type,
      cacheControl: "3600",
      upsert: false,
    });
  if (result.error)
    throw new Error(
      "Não foi possível enviar a foto. Confira sua conexão e tente novamente.",
    );
  return { path };
}

export async function removePersonalImage(path: string): Promise<void> {
  if (!client) {
    const response = await authorizedFetch(
      `/api/me/media?path=${encodeURIComponent(path)}`,
      { method: "DELETE" },
    );
    if (!response.ok)
      throw new Error("Não foi possível remover a foto anterior.");
    return;
  }
  const { data, error } = await client.auth.getSession();
  if (error || !data.session)
    throw new Error("Entre novamente para remover a foto.");
  const owned = `${data.session.user.id}/`;
  if (
    !path.startsWith(owned) ||
    !/^(avatar|background)\/[0-9a-f-]+\.(png|jpg|jpeg|webp)$/i.test(
      path.slice(owned.length),
    )
  ) {
    throw new Error("A foto não pertence ao seu perfil.");
  }
  const result = await client.storage.from("crm-personal-media").remove([path]);
  if (result.error)
    throw new Error("Não foi possível remover a foto anterior.");
}

/** Subscribe with the signed-in user's JWT; table RLS still controls every row. */
export function subscribeWorkspaceChanges(
  tableNames: string[],
  onChange: () => void,
  onStatus?: (live: boolean) => void,
  workspaceId?: string | null,
): () => void {
  const instance = client;
  const tables = [...new Set(tableNames)].filter((name) =>
    [
      "crm_chat_conversations",
      "crm_chat_messages",
      "crm_chat_reads",
      "crm_feed_posts",
      "crm_feed_comments",
      "crm_feed_reactions",
    ].includes(name),
  );
  if (!instance || !tables.length) {
    onStatus?.(false);
    return () => {};
  }
  let active = true;
  const channel = instance.channel(`vox-collaboration-${crypto.randomUUID()}`);
  for (const table of tables) {
    channel.on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table,
        ...(workspaceId ? { filter: `workspace_id=eq.${workspaceId}` } : {}),
      },
      () => {
        if (active) onChange();
      },
    );
  }
  void instance.auth
    .getSession()
    .then(async ({ data, error }) => {
      if (!active) return;
      if (error || !data.session) {
        onStatus?.(false);
        return;
      }
      await instance.realtime.setAuth(data.session.access_token);
      if (!active) return;
      channel.subscribe((status) => {
        if (active) onStatus?.(status === "SUBSCRIBED");
      });
    })
    .catch(() => {
      if (active) onStatus?.(false);
    });
  return () => {
    active = false;
    void instance.removeChannel(channel).catch(() => {});
  };
}
