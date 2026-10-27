export interface ChatConversation {
  id: string;
  kind: "team" | "direct";
  title: string;
  peerId: string | null;
  lastMessage: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  senderId: string | null;
  senderName: string;
  body: string;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
}

export interface ChatHistory {
  items: ChatMessage[];
  nextCursor: string | null;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(
      "A resposta do chat é inválida. Tente atualizar a conversa.",
    );
  }
  return value as Record<string, unknown>;
}

function text(value: unknown): value is string {
  return typeof value === "string";
}

function date(value: unknown): value is string {
  return text(value) && Number.isFinite(Date.parse(value));
}

function optionalDate(value: unknown): value is string | null {
  return value === null || date(value);
}

export function parseConversation(value: unknown): ChatConversation {
  const item = object(value);
  if (
    !text(item.id) ||
    !item.id ||
    !["team", "direct"].includes(String(item.kind)) ||
    !text(item.title) ||
    !(item.peerId === null || text(item.peerId)) ||
    !(item.lastMessage === null || text(item.lastMessage)) ||
    !optionalDate(item.lastMessageAt) ||
    !Number.isSafeInteger(item.unreadCount) ||
    Number(item.unreadCount) < 0
  ) {
    throw new Error("Não foi possível carregar a lista de conversas.");
  }
  return item as unknown as ChatConversation;
}

export function parseConversationList(value: unknown) {
  const data = object(value);
  if (
    !Array.isArray(data.conversations) ||
    !Number.isSafeInteger(data.totalUnread) ||
    Number(data.totalUnread) < 0
  ) {
    throw new Error("Não foi possível carregar a lista de conversas.");
  }
  return {
    conversations: data.conversations.map(parseConversation),
    totalUnread: Number(data.totalUnread),
  };
}

export function parseMessage(value: unknown): ChatMessage {
  const item = object(value);
  if (
    !text(item.id) ||
    !item.id ||
    !text(item.conversationId) ||
    !(item.senderId === null || text(item.senderId)) ||
    !text(item.senderName) ||
    !text(item.body) ||
    !date(item.createdAt) ||
    !optionalDate(item.editedAt) ||
    !optionalDate(item.deletedAt)
  ) {
    throw new Error("Não foi possível ler uma mensagem desta conversa.");
  }
  return item as unknown as ChatMessage;
}

export function parseHistory(value: unknown): ChatHistory {
  const data = object(value);
  if (
    !Array.isArray(data.items) ||
    !(data.nextCursor === null || text(data.nextCursor))
  ) {
    throw new Error("Não foi possível carregar as mensagens.");
  }
  return {
    items: data.items.map(parseMessage),
    nextCursor: data.nextCursor as string | null,
  };
}
