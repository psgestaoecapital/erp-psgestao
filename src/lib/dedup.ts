/**
 * Utilitário de deduplicação para lançamentos financeiros.
 * Garante que registros duplicados (por ID ou por chave composta)
 * não apareçam nas tabelas do dashboard.
 *
 * PS Gestão ERP — v1.0 — 16/04/2026
 * Caminho: src/lib/dedup.ts
 */

export interface Lancamento {
  id?: string | number;
  omie_id?: string | number;
  fornecedor?: string;
  cliente?: string;
  descricao?: string;
  valor?: number;
  data_previsao?: string;
  data_emissao?: string;
  [key: string]: any;
}

/**
 * Remove registros duplicados de um array de lançamentos.
 * Estratégia em 2 camadas:
 *   1. Se o registro tem `id`, dedup por id (mais confiável)
 *   2. Fallback: dedup por chave composta (nome+descrição+valor+data)
 */
export function deduplicarLancamentos<T extends Lancamento>(
  lancamentos: T[]
): T[] {
  if (!lancamentos || lancamentos.length === 0) return [];

  const seen = new Set<string>();
  const result: T[] = [];

  for (const lanc of lancamentos) {
    // Camada 1: dedup por ID único
    if (lanc.id) {
      const idKey = String(lanc.id);
      if (seen.has(idKey)) continue;
      seen.add(idKey);
      result.push(lanc);
      continue;
    }

    // Camada 2: dedup por chave composta
    const nome = (lanc.fornecedor || lanc.cliente || '').trim().toLowerCase();
    const desc = (lanc.descricao || '').trim().toLowerCase();
    const valor = String(lanc.valor || 0);
    const data = lanc.data_previsao || lanc.data_emissao || '';
    const compositeKey = `${nome}|${desc}|${valor}|${data}`;

    if (seen.has(compositeKey)) continue;
    seen.add(compositeKey);
    result.push(lanc);
  }

  return result;
}

/**
 * Versão genérica: dedup por qualquer campo(s).
 * Uso: deduplicarPor(items, (item) => item.omie_id)
 */
export function deduplicarPor<T>(
  items: T[],
  keyFn: (item: T) => string
): T[] {
  if (!items || items.length === 0) return [];
  const seen = new Set<string>();
  return items.filter(item => {
    const key = keyFn(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
