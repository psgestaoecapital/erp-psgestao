// Importação da migração financeira: título que JÁ EXISTE no sistema não entra de novo (CEO 29/09 · virada FCR).
// A FCR já tem 21 títulos a receber (R$ 534.495,94). O importador só descartava repetido quando a DESCRIÇÃO era
// idêntica (hash company+tipo+valor+vencimento+descrição em fn_import_financeiro_v3) — a mesma parcela com outra
// descrição entrava em dobro, e só depois de gravar. Regra agora, na conferência: mesmo tipo + mesma pessoa (nome
// normalizado) + mesmo valor + mesmo vencimento ⇒ "já existe", não é importado.
// Conta repetições (multiconjunto): 2 títulos iguais no sistema e 3 na planilha ⇒ 2 "já existe" + 1 novo — parcelas
// legítimas do mesmo cliente, mesmo valor e mesmo dia (ex.: Somave, título 627) não somem.
// Gate: scripts/check-importador-ja-existe.ts.

export type TipoTitulo = 'pagar' | 'receber'

export interface TituloExistente { tipo: TipoTitulo; nome: string | null; valor: number; vencimento: string }
export interface LinhaPlanilha { tipo: string; nome_pessoa: string; valor: number | null; vencimento: string | null }

export function normNome(s: string | null | undefined): string {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '')   // "S/A", "S.A." e "SA" são a mesma pessoa
}

export function chaveTitulo(tipo: string, nome: string | null | undefined, valor: number, vencimento: string): string {
  return `${tipo}|${normNome(nome)}|${Math.round(valor * 100)}|${vencimento.slice(0, 10)}`
}

// Devolve os índices (em `linhas`) que já existem no sistema. Linhas sem tipo/valor/vencimento válidos nunca casam.
export function marcarJaExistentes(linhas: LinhaPlanilha[], existentes: TituloExistente[]): Set<number> {
  const saldo = new Map<string, number>()
  for (const e of existentes) {
    const k = chaveTitulo(e.tipo, e.nome, e.valor, e.vencimento)
    saldo.set(k, (saldo.get(k) ?? 0) + 1)
  }
  const ja = new Set<number>()
  linhas.forEach((l, i) => {
    if ((l.tipo !== 'pagar' && l.tipo !== 'receber') || l.valor == null || l.valor <= 0 || !l.vencimento) return
    const k = chaveTitulo(l.tipo, l.nome_pessoa, l.valor, l.vencimento)
    const n = saldo.get(k) ?? 0
    if (n > 0) { ja.add(i); saldo.set(k, n - 1) }
  })
  return ja
}

export const MSG_JA_EXISTE = 'Já existe no sistema (mesma pessoa, valor e vencimento) — não será importado'
