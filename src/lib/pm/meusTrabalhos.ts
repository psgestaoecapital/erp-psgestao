// P&M · Meus Trabalhos (tela 25 do SIGA, blueprint V8): três agrupamentos (Por prazo / Por início / Por situação),
// 6 indicadores e a situação na própria linha. Regras puras, testadas no build (scripts/gates/check-pm-meus-trabalhos.ts).
// Lê a mesma lista da Pauta (atalho "meus"); nada de tabela nova.

export type Agrupamento = 'prazo' | 'inicio' | 'situacao'
export interface TrabalhoJob { id: string; codigo: string; titulo: string | null; cliente: string | null; status: string; data_prazo: string | null; data_inicio: string | null; atrasado: boolean }
export interface TrabalhoTarefa { id: string; job_id: string; titulo: string; status: string; data_prazo: string | null; data_inicio: string | null }

const FECHADOS = ['concluida', 'concluido', 'publicado', 'cancelado', 'cancelada']
export const ativo = (status: string) => !FECHADOS.includes((status || '').toLowerCase())
const dia = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : null)

export const SITUACAO: Record<string, string> = {
  nao_iniciada: 'Não iniciada', em_producao: 'Em produção', em_aprovacao: 'Em aprovação', concluida: 'Concluído', publicado: 'Publicado',
}
export const rotuloSituacao = (s: string) => SITUACAO[s] ?? (s ? s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : 'Sem situação')
const ORDEM_SITUACAO = ['nao_iniciada', 'em_producao', 'em_aprovacao']

export interface Indicadores { jobsAtivos: number; jobsAtrasados: number; tarefasAtivas: number; tarefasAtrasadas: number; inicioHoje: number; prazoHoje: number }
export function indicadores(jobs: TrabalhoJob[], tarefas: TrabalhoTarefa[], hoje: string): Indicadores {
  const ja = jobs.filter((j) => ativo(j.status)); const ta = tarefas.filter((t) => ativo(t.status))
  const atras = (p: string | null) => !!dia(p) && (dia(p) as string) < hoje
  return {
    jobsAtivos: ja.length,
    jobsAtrasados: ja.filter((j) => j.atrasado || atras(j.data_prazo)).length,
    tarefasAtivas: ta.length,
    tarefasAtrasadas: ta.filter((t) => atras(t.data_prazo)).length,
    inicioHoje: ja.filter((j) => dia(j.data_inicio) === hoje).length + ta.filter((t) => dia(t.data_inicio) === hoje).length,
    prazoHoje: ja.filter((j) => dia(j.data_prazo) === hoje).length + ta.filter((t) => dia(t.data_prazo) === hoje).length,
  }
}

const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']
export function rotuloData(iso: string | null | undefined, vazio: string): string {
  const d = dia(iso); if (!d) return vazio
  const dt = new Date(`${d}T12:00:00`); if (Number.isNaN(dt.getTime())) return vazio
  return `${DIAS[dt.getDay()]}, ${d.slice(8, 10)}/${d.slice(5, 7)}`
}

// Agrupa os jobs ativos. Por prazo: "Atrasados" no topo, depois por dia, "Sem prazo" no fim. Por início: por dia de início.
// Por situação: Não iniciada → Em produção → Em aprovação → demais.
export function agrupar(jobs: TrabalhoJob[], modo: Agrupamento, hoje: string): { grupo: string; itens: TrabalhoJob[] }[] {
  const lista = jobs.filter((j) => ativo(j.status))
  const mapa = new Map<string, { ordem: string; itens: TrabalhoJob[] }>()
  const por = (g: string, ordem: string, j: TrabalhoJob) => { const e = mapa.get(g) ?? { ordem, itens: [] }; e.itens.push(j); mapa.set(g, e) }
  for (const j of lista) {
    if (modo === 'situacao') { const i = ORDEM_SITUACAO.indexOf(j.status); por(rotuloSituacao(j.status), String(i < 0 ? 9 : i), j) }
    else if (modo === 'inicio') { const d = dia(j.data_inicio); por(rotuloData(d, 'Sem início'), d ?? '9999', j) }
    else { const d = dia(j.data_prazo); if (j.atrasado || (d && d < hoje)) por('Atrasados', '0000', j); else por(rotuloData(d, 'Sem prazo'), d ?? '9999', j) }
  }
  return [...mapa.entries()].sort((a, b) => a[1].ordem.localeCompare(b[1].ordem)).map(([grupo, v]) => ({ grupo, itens: v.itens }))
}

// Agenda semanal do painel: os 7 dias a partir de hoje, com o que vence (job ou tarefa) em cada um.
export interface DiaAgenda { data: string; rotulo: string; jobs: TrabalhoJob[]; tarefas: TrabalhoTarefa[] }
export function agendaSemana(jobs: TrabalhoJob[], tarefas: TrabalhoTarefa[], hoje: string): DiaAgenda[] {
  const base = new Date(`${hoje}T12:00:00`)
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(base.getTime() + i * 86_400_000); const data = d.toISOString().slice(0, 10)
    return {
      data, rotulo: rotuloData(data, ''),
      jobs: jobs.filter((j) => ativo(j.status) && dia(j.data_prazo) === data),
      tarefas: tarefas.filter((t) => ativo(t.status) && dia(t.data_prazo) === data),
    }
  })
}
