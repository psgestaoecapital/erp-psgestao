// Regras puras da seção "Avanço por vertical" do Painel de Codes (CEO 16/10). Sem rede: testadas em
// scripts/gates/check-avanco-vertical.ts. Fonte dos dados: fn_dev_avanco_vertical().
export type Tela = { tela_num: number | string; tela_nome: string; pct: number | null; pct_essenciais: number | null; requisitos: number; provado_por_jornada: number }
export type Cobertura = {
  ok: boolean; vertical?: string; geral_pct: number | null; essenciais_pct: number | null
  total_requisitos: number; total_provado_por_jornada: number; por_tela: Tela[] | null
}
export type OndaHub = { onda: number; concluidos: number; em_andamento: number; planejados: number }
export type PontoHistorico = { dia: string; vertical: string; geral_pct: number | null }

export const NOME_VERTICAL: Record<string, string> = {
  hub_projetos: 'Hub de Projetos', gestao_empresarial: 'Gestão Empresarial', revenda_veiculos: 'Revenda de Veículos',
  pm: 'P&M', ehs: 'EHS', corretora_seguros: 'Corretora de Seguros', ecommerce: 'E-commerce',
}
export const nomeVertical = (v: string) => NOME_VERTICAL[v] ?? v

// Semáforo do % (verde/amarelo/vermelho só aqui): ≥ 70 verde, ≥ 30 amarelo, abaixo vermelho; sem dado = neutro.
export function semaforo(pct: number | null | undefined): 'verde' | 'amarelo' | 'vermelho' | 'neutro' {
  if (pct === null || pct === undefined || Number.isNaN(Number(pct))) return 'neutro'
  const n = Number(pct)
  return n >= 70 ? 'verde' : n >= 30 ? 'amarelo' : 'vermelho'
}
export const fmtPct = (p: number | null | undefined) => (p === null || p === undefined ? '—' : `${Number(p).toFixed(1).replace('.', ',')}%`)

// Ordem fixa: o Hub (desenvolvimento ativo) primeiro; o resto em ordem alfabética do nome.
export function ordenar(cobs: Cobertura[]): Cobertura[] {
  return cobs.filter((c) => c && c.ok && c.vertical).sort((a, b) => {
    if (a.vertical === 'hub_projetos') return -1
    if (b.vertical === 'hub_projetos') return 1
    return nomeVertical(a.vertical!).localeCompare(nomeVertical(b.vertical!), 'pt-BR')
  })
}

// Linha do tempo: uma linha por dia, uma chave por vertical (recharts).
export function serieHistorico(h: PontoHistorico[]): Record<string, string | number | null>[] {
  const porDia = new Map<string, Record<string, string | number | null>>()
  for (const p of h) {
    const l = porDia.get(p.dia) ?? { dia: p.dia }
    l[p.vertical] = p.geral_pct === null ? null : Number(p.geral_pct)
    porDia.set(p.dia, l)
  }
  return [...porDia.values()].sort((a, b) => String(a.dia).localeCompare(String(b.dia)))
}

export const totalOnda = (o: OndaHub) => o.concluidos + o.em_andamento + o.planejados
export function resumoOndas(o: OndaHub[]) {
  const t = o.reduce((s, x) => ({ c: s.c + x.concluidos, a: s.a + x.em_andamento, p: s.p + x.planejados }), { c: 0, a: 0, p: 0 })
  const total = t.c + t.a + t.p
  return { concluidos: t.c, em_andamento: t.a, planejados: t.p, total, pct: total ? Math.round((1000 * t.c) / total) / 10 : 0 }
}
