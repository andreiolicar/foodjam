import type { LlmPort, LlmRequest } from '../ports.js';
import { TAG_OPCOES } from '../prompts/ajuste.js';
import type { EntradaLote } from '../prompts/coleta.js';
import { TAG_LOTE, TAG_MENSAGEM, TAG_PREFERENCIAS, desescaparDados, montarPromptColeta } from '../prompts/coleta.js';
import { TAG_CATALOGO, TAG_PARTICIPANTES } from '../prompts/proposta.js';

export type Responder = (request: LlmRequest, index: number) => unknown;

/**
 * Modelo fake para testes: nunca chama rede. Responde com uma fila de saídas
 * roteirizadas ou com uma função. Uma resposta que é Error vira rejeição.
 */
export class FakeLlm implements LlmPort {
  readonly requests: LlmRequest[] = [];

  constructor(private readonly responder: Responder | readonly unknown[]) {}

  async generate(request: LlmRequest): Promise<unknown> {
    const index = this.requests.length;
    this.requests.push(request);
    const response = typeof this.responder === 'function' ? this.responder(request, index) : this.responder[index];
    if (response === undefined) {
      throw new Error(`FakeLlm sem resposta roteirizada para a chamada ${index + 1}`);
    }
    if (response instanceof Error) throw response;
    return structuredClone(response);
  }
}

// ---------------------------------------------------------------------------
// Responder heurístico para o simulador: imita a coleta com palavras-chave.
// Não é um modelo; serve só para exercitar o fluxo pelo terminal.
// ---------------------------------------------------------------------------

export const normalizar = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

const COMIDAS: Record<string, string> = {
  hamburguer: 'hambúrguer',
  burger: 'hambúrguer',
  lanche: 'lanche',
  pizza: 'pizza',
  bolo: 'bolo',
  doce: 'doce',
  sobremesa: 'doce',
  salada: 'salada',
  leve: 'algo leve',
  cafe: 'café',
  sushi: 'japonês',
  japones: 'japonês',
  japa: 'japonês',
  'qualquer coisa': 'qualquer coisa',
  'tanto faz': 'qualquer coisa',
};

const RESTRICOES: Record<string, string> = {
  vegetarian: 'vegetariano',
  vegan: 'vegano',
  lactose: 'sem lactose',
  gluten: 'sem glúten',
  amendoim: 'alergia a amendoim',
};

const BARATO = /sem grana|duro|liso|barato|economic/;
const NEGACAO = /(?:menos|sem|nada de|nao quero)\s+(\p{L}+)/gu;
const MUDANCA = /na verdade|prefiro|mudei de ideia|troca/;
/** Imita um modelo que segue o prompt de sistema e ignora instruções dentro da mensagem. */
const INJECAO = /ignore|sistema:|instruc/;

const tag = (prompt: string, name: string) =>
  desescaparDados(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(prompt)?.[1] ?? '');

/** Imita o modelo nas três fases (coleta, proposta e ajuste) só com palavras-chave. */
export function responderHeuristico(request: LlmRequest): unknown {
  switch (request.outputName) {
    case 'coleta':
      return heuristicaColeta(request);
    case 'coleta_lote': {
      // Uma "coleta individual" por pessoa do lote, com as mensagens dela juntas.
      const lote = JSON.parse(tag(request.prompt, TAG_LOTE) || '[]') as EntradaLote[];
      return {
        resultados: lote.map((e) => {
          const prompt = montarPromptColeta(e.mensagens.join('\n'), (e as { preferenciasAtuais?: object }).preferenciasAtuais ?? {});
          return { participantId: e.participantId, ...(heuristicaColeta({ ...request, outputName: 'coleta', prompt }) as object) };
        }),
      };
    }
    case 'proposta':
      return heuristicaProposta(request);
    case 'ajuste':
      return heuristicaAjuste(request);
    default:
      throw new Error(`responderHeuristico não cobre "${request.outputName}"`);
  }
}

interface ItemPrompt {
  id: string;
  nome: string;
  descricao: string;
  loja?: string;
}

const palavrasDe = (texto: string) => normalizar(texto).split(/[^\p{L}]+/u).filter((w) => w.length >= 4);

/** Quantas palavras (4+ letras) do item aparecem no texto. */
const afinidade = (item: ItemPrompt, texto: string) => {
  const alvo = normalizar(texto);
  return palavrasDe(`${item.nome} ${item.descricao}`).filter((w) => alvo.includes(w)).length;
};

function heuristicaProposta(request: LlmRequest): unknown {
  const participantes = JSON.parse(tag(request.prompt, TAG_PARTICIPANTES) || '[]') as {
    id: string;
    quer: string[];
    itensPermitidos: string[];
  }[];
  const catalogo = JSON.parse(tag(request.prompt, TAG_CATALOGO) || '[]') as {
    storeId: string;
    temPedidoMinimo: boolean;
    itens: ItemPrompt[];
  }[];
  const lojaDe = new Map(catalogo.flatMap((loja) => loja.itens.map((i) => [i.id, loja.storeId] as const)));
  const itemPorId = new Map(catalogo.flatMap((loja) => loja.itens.map((i) => [i.id, i] as const)));
  const comMinimo = new Set(catalogo.filter((l) => l.temPedidoMinimo).map((l) => l.storeId));

  // Guloso: cada pessoa pega o item mais parecido com o que quer, sem passar de 2 lojas.
  const guloso = (penalizarMinimo: boolean) => {
    const lojas = new Set<string>();
    const picks = [];
    for (const p of participantes) {
      const desejo = p.quer.join(' ');
      const candidatos = p.itensPermitidos
        .map((id) => {
          const base = afinidade(itemPorId.get(id) ?? { id, nome: '', descricao: '' }, desejo);
          return { id, base, nota: base - (penalizarMinimo && comMinimo.has(lojaDe.get(id) ?? '') ? 0.5 : 0) };
        })
        .sort((a, b) => b.nota - a.nota);
      const escolhido = candidatos.find((c) => lojas.has(lojaDe.get(c.id) ?? '') || lojas.size < 2);
      const storeId = escolhido && lojaDe.get(escolhido.id);
      if (!escolhido || !storeId) continue;
      lojas.add(storeId);
      picks.push({
        participantId: p.id,
        storeId,
        menuItemId: escolhido.id,
        quantity: 1,
        ...(escolhido.base === 0 && p.quer.length > 0 && { isSubstitute: true }),
      });
    }
    return picks;
  };

  const justification = 'Escolhi o que mais combina com o pedido de cada um, em poucas lojas.';
  return {
    options: [guloso(false), guloso(true)].filter((picks) => picks.length > 0).map((picks) => ({ picks, justification })),
  };
}

function heuristicaAjuste(request: LlmRequest): unknown {
  const mensagem = tag(request.prompt, TAG_MENSAGEM);
  const opcoes = JSON.parse(tag(request.prompt, TAG_OPCOES) || '[]') as ItemPrompt[];
  const vazio = { menuItemId: null, quantity: null, clarification: null };

  if (!/troc|mud|prefir|quero|em vez|no lugar/.test(normalizar(mensagem))) return { kind: 'not_adjustment', ...vazio };
  const [melhor, segundo] = opcoes
    .map((item) => ({ item, afinidade: afinidade(item, mensagem) }))
    .filter((o) => o.afinidade > 0)
    .sort((a, b) => b.afinidade - a.afinidade);
  if (!melhor) {
    const sugestoes = opcoes.slice(0, 3).map((o) => o.nome).join(', ');
    return { kind: 'ambiguous', ...vazio, clarification: `Pelo que você quer trocar? Tenho, por exemplo: ${sugestoes}.` };
  }
  if (segundo && segundo.afinidade === melhor.afinidade) {
    return { kind: 'ambiguous', ...vazio, clarification: `Você quer ${melhor.item.nome} ou ${segundo.item.nome}?` };
  }
  const quantidade = /\b([2-9]|10)\b/.exec(mensagem)?.[1];
  return { kind: 'swap', menuItemId: melhor.item.id, quantity: quantidade ? Number(quantidade) : null, clarification: null };
}

function heuristicaColeta(request: LlmRequest): unknown {
  const mensagem = normalizar(tag(request.prompt, TAG_MENSAGEM));
  const atuais = JSON.parse(tag(request.prompt, TAG_PREFERENCIAS) || '{}') as {
    foodPreferences?: string[];
    dietaryRestrictions?: string[];
    avoids?: string[];
  };
  const resultado = (kind: string) => ({
    kind,
    foodPreferences: [...food],
    dietaryRestrictions: [...restrictions],
    avoids: [...avoids],
    budgetText,
    clarification: null,
  });

  // Mudança de ideia substitui a lista de comidas em vez de acumular.
  const food = new Set(MUDANCA.test(mensagem) ? [] : (atuais.foodPreferences ?? []));
  const restrictions = new Set(atuais.dietaryRestrictions ?? []);
  const avoids = new Set(atuais.avoids ?? []);
  const budgetText = /\d/.test(mensagem) ? (/(?:r\$\s*)?\d[\d.,]*/.exec(mensagem)?.[0] ?? null) : null;

  if (mensagem.trimEnd().endsWith('?')) return resultado('question');
  if (INJECAO.test(mensagem)) return { ...resultado('irrelevant'), budgetText: null };

  let found = budgetText !== null;
  const negados = new Set<string>();
  for (const [, palavra = ''] of mensagem.matchAll(NEGACAO)) {
    if (/grana|dinheiro/.test(palavra) || palavra in RESTRICOES || palavra === 'lactose' || palavra === 'gluten') continue;
    negados.add(palavra);
    const comida = COMIDAS[palavra] ?? palavra;
    avoids.add(comida);
    food.delete(comida);
    found = true;
  }
  for (const [chave, comida] of Object.entries(COMIDAS)) {
    if (mensagem.includes(chave) && !negados.has(chave)) {
      food.add(comida);
      found = true;
    }
  }
  for (const [chave, restricao] of Object.entries(RESTRICOES)) {
    if (mensagem.includes(chave)) {
      restrictions.add(restricao);
      found = true;
    }
  }
  if (BARATO.test(mensagem)) {
    food.add('barato');
    found = true;
  }

  return resultado(found ? 'preference' : 'irrelevant');
}
