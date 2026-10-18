export interface CollectedMessage {
  message_id: number;
  user_id: number | null;
  first_name: string | null;
  username: string | null;
  date: number;
  content_type: string;
  text: string;
  file_id?: string;
}

const sessions = new Map<number, CollectedMessage[]>();

export function start(chatId: number): boolean {
  if (sessions.has(chatId)) return false;

  sessions.set(chatId, []);
  return true;
}

export function isActive(chatId: number): boolean {
  return sessions.has(chatId);
}

export function add(
  chatId: number,
  message: CollectedMessage,
): boolean {
  const session = sessions.get(chatId);

  if (!session) return false;

  session.push(message);
  return true;
}

export function getMessages(
  chatId: number,
): CollectedMessage[] {
  return [...(sessions.get(chatId) ?? [])];
}

export function finish(
  chatId: number,
): CollectedMessage[] | undefined {
  const messages = sessions.get(chatId);

  if (!messages) return undefined;

  sessions.delete(chatId);
  return messages;
}

export function restore(
  chatId: number,
  messages: CollectedMessage[],
): void {
  sessions.set(chatId, [...messages]);
}