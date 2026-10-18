const organizadores = new Map<number, string>();

export function setOrganizador(
  chatId: number,
  participantId: string,
): void {
  organizadores.set(chatId, participantId);
}

export function getOrganizador(
  chatId: number,
): string | undefined {
  return organizadores.get(chatId);
}

export function clearOrganizador(chatId: number): void {
  organizadores.delete(chatId);
}