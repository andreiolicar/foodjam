import type { LlmPort, LlmRequest } from '../ports.js';
import { TAG_ITENS_ATUAIS, TAG_OPCOES } from '../prompts/ajuste.js';
import type { EntradaLote } from '../prompts/coleta.js';
import { TAG_LOTE, TAG_MENSAGEM, TAG_PREFERENCIAS, desescaparDados, montarPromptColeta } from '../prompts/coleta.js';
import { TAG_ITENS, TAG_PESSOAS } from '../prompts/proposta.js';

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
    case 'proposta_classificacao':
      return heuristicaClassificacao(request);
    case 'proposta_justificativa':
      return { justification: 'Escolhi a combinação de lojas que mais atende o pedido de cada um.' };
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

/**
 * Classificação por palavras-chave: "atende" = itens com palavras do desejo
 * (ou do gosto, para desejos genéricos), do mais parecido para o menos;
 * "substitutos" = alguns outros itens permitidos.
 */
function heuristicaClassificacao(request: LlmRequest): unknown {
  const pessoas = JSON.parse(tag(request.prompt, TAG_PESSOAS) || '[]') as {
    participantId: string;
    desejos: string[];
    gosta: string[];
    itensPermitidos: string[];
  }[];
  const itens = new Map((JSON.parse(tag(request.prompt, TAG_ITENS) || '[]') as ItemPrompt[]).map((i) => [i.id, i]));

  return {
    pessoas: pessoas.map((p) => ({
      participantId: p.participantId,
      desejos: p.desejos.map((desejo) => {
        const notas = p.itensPermitidos
          .map((id) => ({ id, nota: afinidade(itens.get(id) ?? { id, nome: '', descricao: '' }, `${desejo} ${p.gosta.join(' ')}`) }))
          .sort((a, b) => b.nota - a.nota);
        return {
          atende: notas.filter((n) => n.nota > 0).slice(0, 8).map((n) => n.id),
          substitutos: notas.filter((n) => n.nota === 0).slice(0, 3).map((n) => n.id),
        };
      }),
    })),
  };
}

function heuristicaAjuste(request: LlmRequest): unknown {
  const mensagem = tag(request.prompt, TAG_MENSAGEM);
  const opcoes = JSON.parse(tag(request.prompt, TAG_OPCOES) || '[]') as ItemPrompt[];
  const atuais = JSON.parse(tag(request.prompt, TAG_ITENS_ATUAIS) || '[]') as ItemPrompt[];
  const vazio = { menuItemId: null, replaceMenuItemId: null, quantity: null, clarification: null };

  if (!/troc|mud|prefir|quero|em vez|no lugar/.test(normalizar(mensagem))) return { kind: 'not_adjustment', ...vazio };

  // "troca o meu bolo por um café": antes de "por" é o que sai, depois é o que entra.
  const [antes = '', depois] = mensagem.split(/\b(?:por|pelo|pela)\b/i);
  const novoTexto = depois ?? mensagem;
  const [melhor, segundo] = opcoes
    .map((item) => ({ item, afinidade: afinidade(item, novoTexto) }))
    .filter((o) => o.afinidade > 0)
    .sort((a, b) => b.afinidade - a.afinidade);
  if (!melhor) {
    const sugestoes = opcoes.slice(0, 3).map((o) => o.nome).join(', ');
    return { kind: 'ambiguous', ...vazio, clarification: `Pelo que você quer trocar? Tenho, por exemplo: ${sugestoes}.` };
  }
  if (segundo && segundo.afinidade === melhor.afinidade) {
    return { kind: 'ambiguous', ...vazio, clarification: `Você quer ${melhor.item.nome} ou ${segundo.item.nome}?` };
  }

  const citados = atuais.filter((i) => afinidade(i, antes) > 0);
  const sai = citados.length === 1 ? citados[0]?.id : atuais.length === 1 ? atuais[0]?.id : null;
  const quantidade = /\b([2-9]|10)\b/.exec(mensagem)?.[1];
  return {
    kind: 'swap',
    menuItemId: melhor.item.id,
    replaceMenuItemId: sai ?? null,
    quantity: quantidade ? Number(quantidade) : null,
    clarification: null,
  };
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
    // Itens a receber: o que a pessoa quer comer, sem atributos como "barato".
    wishes: [...food].filter((f) => f !== 'barato' && f !== 'qualquer coisa'),
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
