import type { Bot } from 'grammy';

import type { Agente, Agrupador } from '../../core/index.js';
import { registrarIniciar } from './iniciar.js';
import { registrarConversaPrivada } from './conversa-privada.js';
import { registrarMontar } from './montar.js';
import { registrarProposta, type ExecutorPedido } from './proposta.js';
import { registrarMensagens } from './mensagens.js';
import { registrarCancelar } from './cancelar.js';

// A ordem importa: comandos e botões antes da coleta de mensagens do grupo.
export function registerHandlers(bot: Bot, iris: Agente, agrupador: Agrupador, aoAutorizar: ExecutorPedido): void {
  registrarIniciar(bot, iris);
  registrarConversaPrivada(bot, iris);
  registrarMontar(bot, iris, agrupador);
  registrarProposta(bot, iris, agrupador, aoAutorizar);
  registrarCancelar(bot, iris, agrupador);
  registrarMensagens(bot, iris, agrupador);
}
