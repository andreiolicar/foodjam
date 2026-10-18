const organizadores = new Map<number, string>();
const aguardandoEndereco = new Set<number>();
const emProposta = new Set<number>();
const aguardandoOrcamento = new Set<number>();

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
  aguardandoEndereco.delete(chatId);
  emProposta.delete(chatId);
  aguardandoOrcamento.delete(chatId);
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

export function setEmProposta(chatId: number): void {
  emProposta.add(chatId);
}

export function isEmProposta(chatId: number): boolean {
  return emProposta.has(chatId);
}

export function clearEmProposta(chatId: number): void {
  emProposta.delete(chatId);
}

export function setAguardandoOrcamento(chatId: number): void {
  aguardandoOrcamento.add(chatId);
}

export function isAguardandoOrcamento(chatId: number): boolean {
  return aguardandoOrcamento.has(chatId);
}

export function clearAguardandoOrcamento(chatId: number): void {
  aguardandoOrcamento.delete(chatId);
}