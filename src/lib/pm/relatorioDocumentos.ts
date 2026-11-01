// P&M · Relatório de Documentos (blueprint v8, item 4 da ordem SIGA): fee e orçamento (a PI entra com o PM-L).
// Valores do DOCUMENTO comercial; nada é lançado no financeiro. Colunas configuráveis (máx. 11). Regras puras, sem rede.
export const MAX_COLUNAS = 11
export type TipoDoc = 'fee' | 'orcamento'
export interface Documento {
  id: string; tipo: TipoDoc; numero: string | null; titulo: string | null; cliente_id: string | null
  valor: number | null; desconto: number | null; valor_a_faturar: number | null
  status: string | null; data_inicio: string | null; data_fim: string | null; responsavel_id: string | null
}
export interface Coluna { chave: keyof Documento | 'cliente' | 'responsavel'; rotulo: string; padrao: boolean }
export const COLUNAS: Coluna[] = [
  { chave: 'tipo', rotulo: 'Tipo', padrao: true }, { chave: 'numero', rotulo: 'Número', padrao: true },
  { chave: 'titulo', rotulo: 'Título', padrao: true }, { chave: 'cliente', rotulo: 'Cliente', padrao: true },
  { chave: 'responsavel', rotulo: 'Responsável', padrao: false }, { chave: 'valor', rotulo: 'Valor', padrao: true },
  { chave: 'desconto', rotulo: 'Desconto', padrao: false }, { chave: 'valor_a_faturar', rotulo: 'Valor a faturar', padrao: true },
  { chave: 'status', rotulo: 'Situação', padrao: true }, { chave: 'data_inicio', rotulo: 'Início', padrao: false },
  { chave: 'data_fim', rotulo: 'Fim', padrao: false },
]
const num = (n: number | null | undefined) => (typeof n === 'number' && isFinite(n) ? n : 0)

/** Limita a escolha a colunas conhecidas, sem repetir, no máximo 11; vazio = padrão. */
export function colunasValidas(escolhidas: string[] | null | undefined): string[] {
  const conhecidas = new Set(COLUNAS.map((c) => c.chave as string))
  const uniq = [...new Set((escolhidas ?? []).filter((c) => conhecidas.has(c)))].slice(0, MAX_COLUNAS)
  return uniq.length ? uniq : COLUNAS.filter((c) => c.padrao).map((c) => c.chave as string)
}

export interface FiltroDoc { tipo?: TipoDoc; clientes?: string[]; status?: string[]; de?: string; ate?: string }
export function filtrarDocs(docs: Documento[], f: FiltroDoc): Documento[] {
  return docs.filter((d) =>
    (!f.tipo || d.tipo === f.tipo) &&
    (!f.clientes?.length || (d.cliente_id !== null && f.clientes.includes(d.cliente_id))) &&
    (!f.status?.length || (d.status !== null && f.status.includes(d.status))) &&
    (!f.de || (d.data_inicio ?? '9999') >= f.de) && (!f.ate || (d.data_inicio ?? '0000') <= f.ate))
}
export function totais(docs: Documento[]) {
  const r = (n: number) => Math.round(n * 100) / 100
  return { quantidade: docs.length, valor: r(docs.reduce((s, d) => s + num(d.valor), 0)), aFaturar: r(docs.reduce((s, d) => s + num(d.valor_a_faturar), 0)) }
}
/** Contrato de fee: valor = fee mensal (ou valor do projeto). Proposta: valor_final já é líquido do desconto. */
export function deContrato(c: { id: string; tipo: string | null; fee_mensal: number | null; valor_projeto: number | null; status: string | null; data_inicio: string | null; data_fim: string | null; cliente_id: string | null; responsavel_id: string | null }): Documento {
  const v = num(c.fee_mensal) || num(c.valor_projeto)
  return { id: c.id, tipo: 'fee', numero: null, titulo: c.tipo, cliente_id: c.cliente_id, valor: v, desconto: null, valor_a_faturar: v, status: c.status, data_inicio: c.data_inicio, data_fim: c.data_fim, responsavel_id: c.responsavel_id }
}
export function dePropostas(p: { id: string; numero: string | null; titulo: string | null; cliente_id: string | null; valor_total: number | null; desconto: number | null; valor_final: number | null; status: string | null; created_at: string | null; validade_proposta: string | null; responsavel_id: string | null }): Documento {
  return { id: p.id, tipo: 'orcamento', numero: p.numero, titulo: p.titulo, cliente_id: p.cliente_id, valor: num(p.valor_total), desconto: p.desconto, valor_a_faturar: num(p.valor_final) || num(p.valor_total) - num(p.desconto), status: p.status, data_inicio: p.created_at?.slice(0, 10) ?? null, data_fim: p.validade_proposta, responsavel_id: p.responsavel_id }
}
const esc = (s: string) => (/[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
export function linhasCsv(docs: Documento[], colunas: string[], nomes: { clientes: Record<string, string>; responsaveis: Record<string, string> }): string {
  const cols = colunasValidas(colunas).map((k) => COLUNAS.find((c) => c.chave === k)!)
  const cel = (d: Documento, c: Coluna): string => {
    if (c.chave === 'cliente') return nomes.clientes[d.cliente_id ?? ''] ?? ''
    if (c.chave === 'responsavel') return nomes.responsaveis[d.responsavel_id ?? ''] ?? ''
    if (c.chave === 'tipo') return d.tipo === 'fee' ? 'Fee' : 'Orçamento'
    const v = d[c.chave]; return v === null || v === undefined ? '' : String(v).replace('.', ',')
  }
  return [cols.map((c) => esc(c.rotulo)).join(';'), ...docs.map((d) => cols.map((c) => esc(cel(d, c))).join(';'))].join('\n')
}
