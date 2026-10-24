// Regras puras da tela Clientes de obra (Hub). Sem React nem banco, para o gate provar.
// PDCA 23/10: o auditor viu "J" em todo cliente — a DEMO grava tipo_pessoa 'J'/'F' (legado) e a
// tela só conhecia 'PJ'/'PF'. O tipo agora sai normalizado; sem tipo, o documento decide.
import { tipoPessoaPorDocumento } from '@/lib/banco/documento'

export type TipoPF = 'PF' | 'PJ'

export function tipoPessoaNormal(tipo: string | null | undefined, documento?: string | null): TipoPF {
  const t = (tipo ?? '').trim().toUpperCase()
  if (t === 'PF' || t === 'F' || t === 'FISICA' || t === 'FÍSICA') return 'PF'
  if (t === 'PJ' || t === 'J' || t === 'JURIDICA' || t === 'JURÍDICA') return 'PJ'
  return tipoPessoaPorDocumento(documento) === 'FISICA' ? 'PF' : 'PJ'
}

// Iniciais do nome real (até 2 letras), ignorando conectivos: "Clínica Bem Viver" → "CB".
const CONECTIVOS = new Set(['da', 'de', 'do', 'das', 'dos', 'e', '&'])
export function iniciais(nome: string | null | undefined): string {
  const partes = (nome ?? '').trim().split(/\s+/).filter((p) => p && !CONECTIVOS.has(p.toLowerCase()))
  if (partes.length === 0) return '?'
  const letras = partes.slice(0, 2).map((p) => p.match(/[\p{L}\p{N}]/u)?.[0] ?? '').join('')
  return (letras || '?').toUpperCase()
}

// Conta obras por cliente a partir das linhas de erp_obra_planta (uma consulta por tela).
export function obrasPorCliente(linhas: { cliente_id: string | null }[]): Record<string, number> {
  const m: Record<string, number> = {}
  for (const l of linhas) if (l.cliente_id) m[l.cliente_id] = (m[l.cliente_id] ?? 0) + 1
  return m
}

export const temContato = (c: { telefone?: string | null; celular?: string | null; email?: string | null }) =>
  !!((c.telefone ?? '').trim() || (c.celular ?? '').trim() || (c.email ?? '').trim())

// PDCA 24/10 (auditor: "funil/oportunidade, visita e orçamento ligados ao cliente"): resumo comercial por cliente,
// montado na tela a partir de 3 consultas (oportunidades, propostas, visitas) — sem uma consulta por cliente.
export const ETAPAS_FECHADAS = new Set(['ganho', 'perdido'])
export type OpLinha = { id: string; cliente_id: string | null; etapa: string | null; valor_estimado: number | null; valor_proposta: number | null }
export type OrcLinha = { cliente_id: string | null }
export type VisitaLinha = { oportunidade_id: string | null }
export type Comercial = { abertas: number; valorAberto: number; ganhas: number; propostas: number; visitas: number }

// Valor de uma oportunidade: o da proposta, quando já existe; senão o estimado.
export const valorOportunidade = (o: Pick<OpLinha, 'valor_estimado' | 'valor_proposta'>) =>
  Number(o.valor_proposta ?? o.valor_estimado ?? 0) || 0

export function comercialPorCliente(ops: OpLinha[], orcs: OrcLinha[], visitas: VisitaLinha[]): Record<string, Comercial> {
  const m: Record<string, Comercial> = {}
  const de = (id: string) => (m[id] ??= { abertas: 0, valorAberto: 0, ganhas: 0, propostas: 0, visitas: 0 })
  const clienteDaOp = new Map<string, string>()
  for (const o of ops) {
    if (!o.cliente_id) continue
    clienteDaOp.set(o.id, o.cliente_id)
    const c = de(o.cliente_id)
    if (o.etapa === 'ganho') c.ganhas++
    else if (!ETAPAS_FECHADAS.has(o.etapa ?? '')) { c.abertas++; c.valorAberto += valorOportunidade(o) }
  }
  for (const x of orcs) if (x.cliente_id) de(x.cliente_id).propostas++
  for (const v of visitas) {
    const cli = v.oportunidade_id ? clienteDaOp.get(v.oportunidade_id) : undefined
    if (cli) de(cli).visitas++
  }
  return m
}

export const brlCurto = (v: number) =>
  v >= 1_000_000 ? `R$ ${(v / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`
  : v >= 1000 ? `R$ ${(v / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil` : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
