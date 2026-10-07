// PM-K · Painel de Jobs — regras puras (sem banco), testadas no build (scripts/gates/check-pm-k-painel-jobs.ts).
// Blueprint P&M v8, tela 15: 6 indicadores, 8 gráficos, filtro de 13 campos, opções salvas por usuário, PDF/Excel.
// Decisão CEO 05/10: job sem movimento há mais de 180 dias e não concluído = "Encerrado (legado)", fora dos indicadores.

export const DIAS_LEGADO = 180
export const SITUACOES_FIM = ['concluida', 'publicado']

export interface JobPainel {
  id: string; numero: string | null; titulo: string | null; status: string; prioridade: string | null
  cliente_id: string | null; campanha_id: string | null; responsavel_id: string | null; servico_id: string | null; tipo: string | null
  data_inicio: string | null; data_prazo: string | null; data_entrega: string | null; created_at: string; updated_at: string | null
  rodada_ajuste: number | null; horas_estimadas: number | null; horas_realizadas: number | null
}
export interface Rodada { job_id: string; motivo: string | null }
export interface Hora { user_id: string | null; cliente_id: string | null; horas: number | null }
export interface Nomes { clientes: Record<string, string>; responsaveis: Record<string, string>; servicos: Record<string, string>; grupoDoCliente: Record<string, string | null> }

// 13 campos do filtro (SIGA tela 15)
export interface FiltroPainel {
  clientes?: string[]; grupos?: string[]; campanhas?: string[]; responsaveis?: string[]; servicos?: string[]
  status?: string[]; prioridades?: string[]; titulo?: string; codigo?: string
  data_tipo?: 'prazo' | 'criacao' | 'entrega'; data_de?: string; data_ate?: string; atrasados?: 'sim' | 'nao'
  incluir_legado?: boolean
}
export const CAMPOS_FILTRO = ['clientes', 'grupos', 'campanhas', 'responsaveis', 'servicos', 'status', 'prioridades', 'titulo', 'codigo', 'data_tipo', 'data_de', 'data_ate', 'atrasados'] as const

export const SITUACOES: { v: string; l: string }[] = [
  { v: 'nao_iniciada', l: 'Não iniciada' }, { v: 'em_producao', l: 'Em produção' }, { v: 'aguardando', l: 'Aguardando' },
  { v: 'em_aprovacao', l: 'Em aprovação' }, { v: 'concluida', l: 'Concluída' }, { v: 'publicado', l: 'Publicado' },
]
export const rotuloSituacao = (s: string) => SITUACOES.find((x) => x.v === s)?.l ?? s

export const hojeISO = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
export const diasEntre = (de: string, ate: string) => Math.round((Date.parse(ate.slice(0, 10)) - Date.parse(de.slice(0, 10))) / 86400000)

export const concluido = (j: Pick<JobPainel, 'status'>) => SITUACOES_FIM.includes(j.status)
export function atrasado(j: Pick<JobPainel, 'status' | 'data_prazo'>, hoje = hojeISO()) {
  return !concluido(j) && !!j.data_prazo && j.data_prazo < hoje
}
export function legado(j: Pick<JobPainel, 'status' | 'updated_at' | 'created_at'>, hoje = hojeISO()) {
  if (concluido(j)) return false
  return diasEntre((j.updated_at ?? j.created_at).slice(0, 10), hoje) > DIAS_LEGADO
}
export const codigoPainel = (j: Pick<JobPainel, 'numero' | 'rodada_ajuste'>) => {
  const r = Number(j.rodada_ajuste ?? 0)
  return `${j.numero ?? ''}${r > 0 ? String.fromCharCode(64 + Math.min(r, 26)) : ''}`
}

export function limparFiltroPainel(f: FiltroPainel): FiltroPainel {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(f)) {
    if (v === undefined || v === null || v === '' || v === false) continue
    if (Array.isArray(v) && v.length === 0) continue
    if (typeof v === 'string' && !v.trim()) continue
    out[k] = typeof v === 'string' ? v.trim() : v
  }
  if (!out.data_de && !out.data_ate) delete out.data_tipo
  return out as FiltroPainel
}
export const contarFiltroPainel = (f: FiltroPainel) => Object.keys(limparFiltroPainel(f)).filter((k) => k !== 'data_tipo' && k !== 'incluir_legado').length

export function filtrarJobs(jobs: JobPainel[], f: FiltroPainel, nomes: Nomes, hoje = hojeISO()): JobPainel[] {
  const L = limparFiltroPainel(f)
  const tipoData = L.data_tipo ?? 'prazo'
  const dataDe = (j: JobPainel) => (tipoData === 'criacao' ? j.created_at.slice(0, 10) : tipoData === 'entrega' ? j.data_entrega : j.data_prazo)
  const titulo = L.titulo?.toLowerCase(); const codigo = L.codigo?.toLowerCase()
  return jobs.filter((j) => {
    if (!L.incluir_legado && legado(j, hoje)) return false
    if (L.clientes && !(j.cliente_id && L.clientes.includes(j.cliente_id))) return false
    if (L.grupos && !(j.cliente_id && nomes.grupoDoCliente[j.cliente_id] && L.grupos.includes(nomes.grupoDoCliente[j.cliente_id] as string))) return false
    if (L.campanhas && !(j.campanha_id && L.campanhas.includes(j.campanha_id))) return false
    if (L.responsaveis && !(j.responsavel_id && L.responsaveis.includes(j.responsavel_id))) return false
    if (L.servicos && !(j.servico_id && L.servicos.includes(j.servico_id))) return false
    if (L.status && !L.status.includes(j.status)) return false
    if (L.prioridades && !(j.prioridade && L.prioridades.includes(j.prioridade))) return false
    if (titulo && !(j.titulo ?? '').toLowerCase().includes(titulo)) return false
    if (codigo && !codigoPainel(j).toLowerCase().includes(codigo)) return false
    if (L.atrasados === 'sim' && !atrasado(j, hoje)) return false
    if (L.atrasados === 'nao' && atrasado(j, hoje)) return false
    if (L.data_de || L.data_ate) {
      const d = dataDe(j)
      if (!d) return false
      if (L.data_de && d < L.data_de) return false
      if (L.data_ate && d > L.data_ate) return false
    }
    return true
  })
}

// ── 6 indicadores ──────────────────────────────────────────────────────────────────────────────────
export interface Indicadores {
  total: number; alteracoes: number; mediaAlteracoes: number
  realizado: number; estimado: number; realizadoSobreEstimado: number | null
  diasConclusao: number | null; diasAtraso: number | null
}
const media = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
const r1 = (n: number) => Math.round(n * 10) / 10

export function indicadores(jobs: JobPainel[], rodadas: Rodada[], hoje = hojeISO()): Indicadores {
  const ids = new Set(jobs.map((j) => j.id))
  const alteracoes = rodadas.filter((r) => ids.has(r.job_id)).length
  const realizado = jobs.reduce((a, j) => a + Number(j.horas_realizadas ?? 0), 0)
  const estimado = jobs.reduce((a, j) => a + Number(j.horas_estimadas ?? 0), 0)
  // dias da conclusão: da criação (ou início) até a entrega, só dos concluídos
  const conc = jobs.filter((j) => concluido(j) && (j.data_entrega || j.updated_at))
    .map((j) => diasEntre(j.data_inicio ?? j.created_at, (j.data_entrega ?? j.updated_at) as string)).filter((n) => n >= 0)
  // dias de atraso: dos ainda abertos e vencidos
  const atr = jobs.filter((j) => atrasado(j, hoje)).map((j) => diasEntre(j.data_prazo as string, hoje))
  const m1 = media(conc); const m2 = media(atr)
  return {
    total: jobs.length, alteracoes, mediaAlteracoes: jobs.length ? r1(alteracoes / jobs.length) : 0,
    realizado: r1(realizado), estimado: r1(estimado), realizadoSobreEstimado: estimado > 0 ? r1((realizado / estimado) * 100) : null,
    diasConclusao: m1 === null ? null : r1(m1), diasAtraso: m2 === null ? null : r1(m2),
  }
}

// ── 8 gráficos ─────────────────────────────────────────────────────────────────────────────────────
export interface Barra { nome: string; valor: number }
const contar = (chaves: (string | null | undefined)[], limite = 10): Barra[] => {
  const m = new Map<string, number>()
  for (const k of chaves) { const n = (k ?? '').trim() || 'Sem informação'; m.set(n, (m.get(n) ?? 0) + 1) }
  return [...m.entries()].map(([nome, valor]) => ({ nome, valor })).sort((a, b) => b.valor - a.valor || a.nome.localeCompare(b.nome)).slice(0, limite)
}
const somar = (pares: [string | null | undefined, number][], limite = 10): Barra[] => {
  const m = new Map<string, number>()
  for (const [k, v] of pares) { const n = (k ?? '').trim() || 'Sem informação'; m.set(n, (m.get(n) ?? 0) + v) }
  return [...m.entries()].map(([nome, valor]) => ({ nome, valor: r1(valor) })).filter((b) => b.valor > 0).sort((a, b) => b.valor - a.valor).slice(0, limite)
}

export interface Graficos {
  pecas: Barra[]; classificacao: Barra[]; motivos: Barra[]; clientesAlteracoes: Barra[]
  dispersao: { cliente: string; jobs: number; alteracoes: number }[]
  porResponsavel: Barra[]; horasColaborador: Barra[]; horasCliente: Barra[]
}

export function graficos(jobs: JobPainel[], rodadas: Rodada[], horas: Hora[], nomes: Nomes): Graficos {
  const porId = new Map(jobs.map((j) => [j.id, j]))
  const nCli = (id: string | null) => (id ? nomes.clientes[id] : null)
  const rs = rodadas.filter((r) => porId.has(r.job_id))
  const cliHoras = new Set(jobs.map((j) => j.cliente_id).filter(Boolean) as string[])
  const alteracoesPorCli = new Map<string, number>(); const jobsPorCli = new Map<string, number>()
  for (const j of jobs) { const k = nCli(j.cliente_id) ?? 'Sem informação'; jobsPorCli.set(k, (jobsPorCli.get(k) ?? 0) + 1) }
  for (const r of rs) { const k = nCli(porId.get(r.job_id)?.cliente_id ?? null) ?? 'Sem informação'; alteracoesPorCli.set(k, (alteracoesPorCli.get(k) ?? 0) + 1) }
  const hs = horas.filter((h) => !h.cliente_id || cliHoras.has(h.cliente_id))
  return {
    pecas: contar(jobs.map((j) => (j.servico_id ? nomes.servicos[j.servico_id] : null) ?? j.tipo)),
    classificacao: contar(jobs.map((j) => rotuloSituacao(j.status)), 6),
    motivos: contar(rs.map((r) => r.motivo)),
    clientesAlteracoes: [...alteracoesPorCli.entries()].map(([nome, valor]) => ({ nome, valor })).sort((a, b) => b.valor - a.valor).slice(0, 10),
    dispersao: [...jobsPorCli.entries()].map(([cliente, n]) => ({ cliente, jobs: n, alteracoes: alteracoesPorCli.get(cliente) ?? 0 })),
    porResponsavel: contar(jobs.map((j) => (j.responsavel_id ? nomes.responsaveis[j.responsavel_id] : null))),
    horasColaborador: somar(hs.map((h) => [h.user_id ? nomes.responsaveis[h.user_id] : null, Number(h.horas ?? 0)])),
    horasCliente: somar(hs.map((h) => [nCli(h.cliente_id), Number(h.horas ?? 0)])),
  }
}

// ── lista "Fluxo de trabalho" e exportação ─────────────────────────────────────────────────────────
export interface LinhaFluxo {
  codigo: string; titulo: string; cliente: string; responsavel: string; situacao: string
  prazo: string; atraso: number; alteracoes: number; horas: string
}
export function linhasFluxo(jobs: JobPainel[], rodadas: Rodada[], nomes: Nomes, hoje = hojeISO()): LinhaFluxo[] {
  const alt = new Map<string, number>()
  for (const r of rodadas) alt.set(r.job_id, (alt.get(r.job_id) ?? 0) + 1)
  return [...jobs].sort((a, b) => (a.data_prazo ?? '9999').localeCompare(b.data_prazo ?? '9999')).map((j) => ({
    codigo: codigoPainel(j), titulo: j.titulo ?? '', cliente: (j.cliente_id && nomes.clientes[j.cliente_id]) || '',
    responsavel: (j.responsavel_id && nomes.responsaveis[j.responsavel_id]) || '', situacao: rotuloSituacao(j.status),
    prazo: j.data_prazo ?? '', atraso: atrasado(j, hoje) ? diasEntre(j.data_prazo as string, hoje) : 0, alteracoes: alt.get(j.id) ?? 0,
    horas: `${r1(Number(j.horas_realizadas ?? 0))}/${r1(Number(j.horas_estimadas ?? 0))}`,
  }))
}
export const CABECALHO_FLUXO = ['Código', 'Título', 'Cliente', 'Responsável', 'Situação', 'Prazo', 'Dias de atraso', 'Alterações', 'Horas real/estim.']
export const linhaParaArray = (l: LinhaFluxo) => [l.codigo, l.titulo, l.cliente, l.responsavel, l.situacao, l.prazo, l.atraso, l.alteracoes, l.horas]

// Resumo SEM nomes de pessoas nem dados pessoais — é só isto que vai para a IA (Insights).
export function resumoParaIA(i: Indicadores, g: Graficos): Record<string, unknown> {
  const topo = (b: Barra[]) => b.slice(0, 5)
  return {
    indicadores: i, situacoes: g.classificacao, pecas: topo(g.pecas), motivos_de_alteracao: topo(g.motivos),
    clientes_com_mais_alteracoes: topo(g.clientesAlteracoes), jobs_por_responsavel: topo(g.porResponsavel).map((b, n) => ({ nome: `Pessoa ${n + 1}`, valor: b.valor })),
    horas_por_cliente: topo(g.horasCliente),
  }
}
