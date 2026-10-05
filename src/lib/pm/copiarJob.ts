// "Copiar de um job pronto" (P&M · spec aprovada pelo CEO, 03/10) — regras puras da tela, testadas no build
// (scripts/gates/check-pm-copiar-job.ts). A cópia de verdade é do banco (fn_pm_job_copiar, migration 20261003110000);
// aqui fica o que a tela mostra ANTES de copiar (prazo previsto, o que vai e o que não vai) e o espelho da busca.

// Peça/tipo do job (#144 · Pdois): as peças do dia a dia da agência primeiro, depois os projetos maiores.
// agency_jobs.tipo é texto livre — as chaves antigas (site, video, arte…) continuam valendo.
// O banco tem o mesmo mapa (fn_pm_peca_rotulo) para a busca achar "landing page" num job com tipo "lp".
export const TIPOS_PECA: Array<[string, string]> = [
  ['post_rede_social', 'Post de rede social'], ['arte_avulsa', 'Arte avulsa'], ['capa_rede_social', 'Capa de rede social (Facebook, YouTube…)'],
  ['story', 'Story / Reels'], ['arte', 'Arte/Design'], ['social_media', 'Social Media (pacote)'], ['campanha', 'Campanha'],
  ['video', 'Vídeo'], ['site', 'Site'], ['lp', 'Landing Page'], ['logomarca', 'Logomarca'], ['catalogo', 'Catálogo'],
  ['assessoria', 'Assessoria'], ['outro', 'Outro'],
]
export const rotuloPeca = (tipo: string | null | undefined): string =>
  !tipo ? '' : (TIPOS_PECA.find(([k]) => k === tipo)?.[1] ?? tipo.replace(/_/g, ' '))

// Espelho de public.fn_pm_busca_normalizar: sem acento, minúsculo, só letras/números separados por um espaço.
export function normalizarBusca(texto: string | null | undefined): string {
  return (texto ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

// ── prazo do job novo (mesma regra da fn_pm_job_copiar) ──────────────────────────────────────────────────────────
export type RegraPrazo = 'informado' | 'duracao' | 'peca' | 'sem_prazo'
export interface JobOrigemPrazo { data_inicio: string | null; data_prazo: string | null; criado_em: string | null }

const DIA = 86_400_000
const paraDia = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10))
const deDia = (ms: number) => new Date(ms).toISOString().slice(0, 10)
// data (AAAA-MM-DD) de um instante no fuso de São Paulo — "hoje" e a data de criação do job
export const diaEmSaoPaulo = (instante: Date | string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(instante))

// duração do original em dias (início → prazo; sem início, criação → prazo). null se não dá para saber ou não faz
// sentido (negativa ou acima de um ano — típico de job importado, criado depois do prazo).
export function duracaoOriginal(o: JobOrigemPrazo): number | null {
  if (!o.data_prazo) return null
  const inicio = o.data_inicio ?? (o.criado_em ? diaEmSaoPaulo(o.criado_em) : null)
  if (!inicio) return null
  const d = Math.round((paraDia(o.data_prazo) - paraDia(inicio.slice(0, 10))) / DIA)
  return d >= 0 && d <= 365 ? d : null
}

// prazo escolhido na tela > hoje + duração do original > hoje + prazo padrão da peça (catálogo) > sem prazo
export function prazoDaCopia(o: JobOrigemPrazo, hoje: string, prazoPecaDias?: number | null, informado?: string | null):
  { data_prazo: string | null; regra: RegraPrazo; dias: number | null } {
  if (informado) return { data_prazo: informado, regra: 'informado', dias: Math.round((paraDia(informado) - paraDia(hoje)) / DIA) }
  const dur = duracaoOriginal(o)
  if (dur !== null) return { data_prazo: deDia(paraDia(hoje) + dur * DIA), regra: 'duracao', dias: dur }
  if (prazoPecaDias != null && prazoPecaDias >= 0) return { data_prazo: deDia(paraDia(hoje) + prazoPecaDias * DIA), regra: 'peca', dias: prazoPecaDias }
  return { data_prazo: null, regra: 'sem_prazo', dias: null }
}

export function explicarPrazo(p: { regra: RegraPrazo; dias: number | null }): string {
  const dias = (n: number | null) => (n === 1 ? '1 dia' : `${n ?? 0} dias`)
  switch (p.regra) {
    case 'duracao': return p.dias === 0 ? 'Mesmo dia — o original foi feito no dia.' : `Hoje + ${dias(p.dias)} (o tempo que o original levou).`
    case 'peca': return `Hoje + ${dias(p.dias)} (prazo padrão da peça no catálogo).`
    case 'informado': return 'Prazo escolhido por você.'
    default: return 'O original não tem prazo — defina depois no job.'
  }
}

// ── o que vai e o que não vai (a tela mostra antes de copiar) ───────────────────────────────────────────────────
export interface OpcoesCopia { responsaveis: boolean; anexos: boolean }
export const OPCOES_PADRAO: OpcoesCopia = { responsaveis: false, anexos: false }

export function oQueCopia(op: OpcoesCopia): { vai: string[]; naoVai: string[] } {
  const vai = ['Briefing', 'Peça e tipo de serviço', 'Tempo estimado', 'Cliente (pode trocar)', 'Tarefas com o checklist desmarcado']
  const naoVai = ['Datas', 'Situação (nasce "Não iniciada")', 'Rodada de ajuste (volta para 0)', 'Comentários', 'Aprovações', 'Horas lançadas']
  ;(op.responsaveis ? vai : naoVai).push('Responsáveis (job e tarefas)')
  ;(op.anexos ? vai : naoVai).push('Anexos e links')
  return { vai, naoVai }
}

// parâmetro p_opcoes da fn_pm_job_copiar. Cliente: undefined = o do original; '' = sem cliente; id = troca.
export function montarOpcoes(op: OpcoesCopia & { cliente_id?: string | null; titulo?: string; data_prazo?: string | null }): Record<string, unknown> {
  const out: Record<string, unknown> = { responsaveis: !!op.responsaveis, anexos: !!op.anexos }
  if (op.cliente_id !== undefined) out.cliente_id = op.cliente_id ?? ''
  if (op.titulo && op.titulo.trim()) out.titulo = op.titulo.trim()
  if (op.data_prazo) out.data_prazo = op.data_prazo
  return out
}

// ── filtros da busca (p_filtros da fn_pm_jobs_buscar) ───────────────────────────────────────────────────────────
export interface FiltrosCopia { clientes?: string[]; pecas?: string[]; situacoes?: string[]; data_de?: string; data_ate?: string }
export function limparFiltrosCopia(f: FiltrosCopia): FiltrosCopia {
  const out: FiltrosCopia = {}
  if (f.clientes?.length) out.clientes = f.clientes
  if (f.pecas?.length) out.pecas = f.pecas
  if (f.situacoes?.length) out.situacoes = f.situacoes
  if (f.data_de) out.data_de = f.data_de
  if (f.data_ate) out.data_ate = f.data_ate
  return out
}
export const contarFiltrosCopia = (f: FiltrosCopia) => Object.keys(limparFiltrosCopia(f)).length

// "Jobs parecidos" só a partir de 4 letras úteis (o banco também corta)
export const tituloBuscavel = (titulo: string | null | undefined) => normalizarBusca(titulo).length >= 4
