import { describe, expect, it } from 'vitest';
import { categoriaDoDesejo, categoriaDoItem } from '../../../src/core/regras/categoria.js';

const item = (name: string, description?: string, category?: 'food' | 'drink') => ({
  name,
  ...(description !== undefined && { description }),
  ...(category && { category }),
});

describe('categoriaDoItem', () => {
  it.each([
    ['Café com Leite', undefined, 'drink'],
    ['Refrigerante Lata', undefined, 'drink'],
    ['Suco de Laranja', '300 ml', 'drink'],
    ['Chá gelado', undefined, 'drink'],
    ['Chocolate Quente', undefined, 'drink'],
    ['Misto Quente', 'Lanche de presunto e queijo na chapa', 'food'],
    ['Bolo de Cenoura', 'Fatia com cobertura de chocolate', 'food'],
    ['Café da manhã completo', 'pão, ovos e frutas', 'food'],
    ['Bowl de Quinoa', 'Leve, vegano', 'food'],
    ['Brigadeiro Gourmet', 'Unidade', 'food'],
    ['Combo X-Salada + refri', undefined, 'food'],
    ['Item sem pista', undefined, 'food'],
  ] as const)('%s → %s', (nome, descricao, esperado) => {
    expect(categoriaDoItem(item(nome, descricao))).toBe(esperado);
  });

  it('a categoria do catálogo vence a inferência', () => {
    expect(categoriaDoItem(item('Café com Leite', undefined, 'food'))).toBe('food');
    expect(categoriaDoItem(item('Açaí 500 ml', undefined, 'drink'))).toBe('drink');
  });
});

describe('categoriaDoDesejo', () => {
  it.each([
    ['algo leve', 'food'],
    ['lanche', 'food'],
    ['bolo de cenoura', 'food'],
    ['qualquer comida', 'food'],
    ['um suco', 'drink'],
    ['café', 'drink'],
    ['refri', 'drink'],
  ] as const)('%s → %s', (desejo, esperado) => {
    expect(categoriaDoDesejo(desejo)).toBe(esperado);
  });
});
