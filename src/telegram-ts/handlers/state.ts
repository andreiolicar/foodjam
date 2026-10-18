const organizadores = new Map<number, string>();
const aguardandoEndereco = new Set<number>();

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

export function setAguardandoEndereco(chatId: number): void {
  aguardandoEndereco.add(chatId);
}

export function isAguardandoEndereco(chatId: number): boolean {
  return aguardandoEndereco.has(chatId);
}

export function clearAguardandoEndereco(chatId: number): void {
  aguardandoEndereco.delete(chatId);
}