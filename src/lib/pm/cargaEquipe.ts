// P&M · Carga da equipe em horas × capacidade (onda 3 da P&M da Pdois, mapeamento do SIGA, Parte S).
// Regras puras, sem rede. Só horas — nunca custo (custo/hora é restrito a quem vê salário, LGPD 03/10).
//
// Capacidade da pessoa = jornada (h/dia, agency_equipe) × dias úteis (seg–sex) da janela [hoje, hoje + N − 1].
// Comprometido = saldo (estimado − realizado, nunca negativo) do trabalho aberto da pessoa que cai na janela:
//   · só job aberto e fora do legado (sem movimento há mais de 180 dias, decisão do CEO 05/10 — mesma regra do Painel de Jobs);
//   · tarefa aberta com horas estimadas → saldo vai para o responsável da tarefa;
//   · job aberto SEM tarefa com estimativa → saldo do job vai para o responsável do job (nunca os dois: sem contar dobrado);
//   · prazo dentro da janela, vencido ou sem prazo → o saldo inteiro conta agora;
//     prazo depois da janela → conta a parte proporcional aos dias úteis da janela até o prazo.
// Previsão (equipe toda, ainda sem dono): horas estimadas das propostas enviadas e das aprovadas que ainda não viraram job,
// mais as horas mensais dos fees ativos (itens da proposta do fee) proporcionais à janela, descontado o que os jobs do fee
// já comprometem.
// A pessoa é casada pelo usuário (user_id); quem está na equipe sem usuário ligado é casado pelo nome.
import { concluido, hojeISO, legado } from './painel'

export const JORNADA_PADRAO = 8
export const LIMITE_ATENCAO = 0.8 // a partir de 80% da capacidade: atenção
export const LIMITE_FOLGA = 0.5 // abaixo de 50%: folga

export interface MembroCarga { id: string; user_id: string | null; nome: string; jornada_horas_dia: number | null; ativo: boolean }
export interface JobCarga {
  id: string; status: string; responsavel_id: string | null; responsavel_nome?: string | null; data_prazo: string | null
  horas_estimadas: number | null; horas_realizadas: number | null; proposta_id?: string | null; fee_id?: string | null; contrato_id?: string | null
  created_at: string; updated_at: string | null
}
export interface TarefaCarga { job_id: string | null; status: string; responsavel_id: string | null; data_prazo: string | null; horas_estimadas: number | null; horas_realizadas: number | null }
export interface PropostaCarga { id: string; status: string; horas: number }
export interface FeeCarga { id: string; status: string; tipo: string | null; horas_mes: number }

export type Situacao = 'sobrecarga' | 'atencao' | 'ok' | 'folga'
export interface LinhaCarga {
  chave: string; nome: string; capacidade: number; comprometido: number; pct: number | null; situacao: Situacao
  itens: number; naEquipe: boolean; jornadaPadrao: boolean
}
export interface ResumoCarga {
  de: string; ate: string; diasUteis: number; linhas: LinhaCarga[]
  capacidade: number; comprometido: number; semDono: number; previsao: { propostas: number; fees: number }; livre: number
}

const num = (n: number | null | undefined) => (typeof n === 'number' && isFinite(n) ? n : 0)
const r1 = (n: number) => Math.round(n * 10) / 10
export const normalizarNome = (s: string | null | undefined) =>
  (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()

const addDias = (iso: string, d: number) => { const x = new Date(`${iso}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10) }
/** Dias úteis (seg–sex) de `de` a `ate`, inclusive. 0 se ate < de. */
export function diasUteis(de: string, ate: string): number {
  let n = 0
  for (let d = de; d <= ate; d = addDias(d, 1)) { const w = new Date(`${d}T12:00:00Z`).getUTCDay(); if (w !== 0 && w !== 6) n++ }
  return n
}
export const janelaFrente = (dias: number, hoje = hojeISO()) => ({ de: hoje, ate: addDias(hoje, Math.max(1, dias) - 1) })

/** Parte do saldo que cai na janela: 1 com prazo vencido, dentro da janela ou sem prazo; proporcional se o prazo é depois. */
export function fracaoNaJanela(prazo: string | null, de: string, ate: string): number {
  if (!prazo || prazo <= ate) return 1
  const ate_prazo = diasUteis(de, prazo)
  return ate_prazo > 0 ? Math.min(1, diasUteis(de, ate) / ate_prazo) : 1
}

export const situacaoDe = (pct: number | null): Situacao =>
  pct == null ? 'ok' : pct > 1 ? 'sobrecarga' : pct >= LIMITE_ATENCAO ? 'atencao' : pct < LIMITE_FOLGA ? 'folga' : 'ok'

const saldo = (x: { horas_estimadas: number | null; horas_realizadas: number | null }) => Math.max(0, num(x.horas_estimadas) - num(x.horas_realizadas))

export function cargaEquipe(args: {
  membros: MembroCarga[]; jobs: JobCarga[]; tarefas: TarefaCarga[]; usuarios?: Record<string, string>
  propostas?: PropostaCarga[]; fees?: FeeCarga[]; dias: number; hoje?: string
}): ResumoCarga {
  const { membros, jobs, tarefas, usuarios = {}, propostas = [], fees = [], dias } = args
  const hoje = args.hoje ?? hojeISO()
  const { de, ate } = janelaFrente(dias, hoje)
  const uteis = diasUteis(de, ate)
  const ativos = membros.filter((m) => m.ativo)

  // chave da pessoa: membro da equipe (por usuário, senão pelo nome) ou o usuário responsável fora da equipe
  const porUsuario = new Map<string, MembroCarga>(); const porNome = new Map<string, MembroCarga>()
  for (const m of ativos) { if (m.user_id) porUsuario.set(m.user_id, m); porNome.set(normalizarNome(m.nome), m) }
  const chaveDe = (userId: string | null, nomeAlt?: string | null): { chave: string; nome: string } | null => {
    if (userId && porUsuario.has(userId)) { const m = porUsuario.get(userId)!; return { chave: `m:${m.id}`, nome: m.nome } }
    const nome = (userId && usuarios[userId]) || nomeAlt || null
    const m = nome ? porNome.get(normalizarNome(nome)) : undefined
    if (m) return { chave: `m:${m.id}`, nome: m.nome }
    if (userId) return { chave: `u:${userId}`, nome: nome || 'Usuário' }
    return null
  }

  const linhas = new Map<string, LinhaCarga>()
  for (const m of ativos) {
    const jornada = num(m.jornada_horas_dia) > 0 ? num(m.jornada_horas_dia) : JORNADA_PADRAO
    linhas.set(`m:${m.id}`, { chave: `m:${m.id}`, nome: m.nome, capacidade: r1(jornada * uteis), comprometido: 0, pct: null, situacao: 'ok', itens: 0, naEquipe: true, jornadaPadrao: !(num(m.jornada_horas_dia) > 0) })
  }
  let semDono = 0
  const somar = (k: { chave: string; nome: string } | null, horas: number) => {
    if (horas <= 0) return
    if (!k) { semDono += horas; return }
    let l = linhas.get(k.chave)
    if (!l) { l = { chave: k.chave, nome: k.nome, capacidade: 0, comprometido: 0, pct: null, situacao: 'ok', itens: 0, naEquipe: false, jornadaPadrao: false }; linhas.set(k.chave, l) }
    l.comprometido += horas; l.itens++
  }

  const abertos = jobs.filter((j) => !concluido(j) && !legado(j, hoje))
  const jobsAbertos = new Map(abertos.map((j) => [j.id, j]))
  const jobsComTarefa = new Set<string>()
  const porFee = new Map<string, number>()
  for (const t of tarefas) {
    if (t.status === 'concluida' || !t.job_id || !jobsAbertos.has(t.job_id) || num(t.horas_estimadas) <= 0) continue
    jobsComTarefa.add(t.job_id)
    const job = jobsAbertos.get(t.job_id)!
    const h = saldo(t) * fracaoNaJanela(t.data_prazo ?? job.data_prazo, de, ate)
    somar(chaveDe(t.responsavel_id ?? job.responsavel_id, t.responsavel_id ? null : job.responsavel_nome), h)
    const fee = job.fee_id ?? job.contrato_id; if (fee) porFee.set(fee, (porFee.get(fee) ?? 0) + h)
  }
  for (const j of abertos) {
    if (jobsComTarefa.has(j.id)) continue
    const h = saldo(j) * fracaoNaJanela(j.data_prazo, de, ate)
    somar(chaveDe(j.responsavel_id, j.responsavel_nome), h)
    const fee = j.fee_id ?? j.contrato_id; if (fee && h > 0) porFee.set(fee, (porFee.get(fee) ?? 0) + h)
  }

  // previsão sem dono: propostas enviadas + aprovadas que ainda não têm job; fees ativos pela fração da janela
  const comJob = new Set(jobs.map((j) => j.proposta_id).filter(Boolean) as string[])
  const hPropostas = propostas.filter((p) => p.status === 'enviada' || (p.status === 'aprovada' && !comJob.has(p.id))).reduce((s, p) => s + num(p.horas), 0)
  const fracMes = Math.min(1, uteis / 22) // ~22 dias úteis no mês
  const hFees = fees.filter((f) => f.status === 'ativo' && f.tipo !== 'projeto')
    .reduce((s, f) => s + Math.max(0, num(f.horas_mes) * fracMes - (porFee.get(f.id) ?? 0)), 0)

  const lista = [...linhas.values()].map((l) => {
    const comprometido = r1(l.comprometido)
    const pct = l.capacidade > 0 ? comprometido / l.capacidade : (comprometido > 0 ? null : 0)
    return { ...l, comprometido, pct, situacao: l.capacidade > 0 ? situacaoDe(pct) : (comprometido > 0 ? 'sobrecarga' as Situacao : 'folga' as Situacao) }
  }).sort((a, b) => Number(a.naEquipe) - Number(b.naEquipe) // fora da equipe (sem capacidade) primeiro
    || (b.pct ?? 0) - (a.pct ?? 0) || b.comprometido - a.comprometido || a.nome.localeCompare(b.nome))

  const capacidade = r1(lista.reduce((s, l) => s + l.capacidade, 0))
  const comprometido = r1(lista.reduce((s, l) => s + l.comprometido, 0) + semDono)
  const previsao = { propostas: r1(hPropostas), fees: r1(hFees) }
  return { de, ate, diasUteis: uteis, linhas: lista, capacidade, comprometido, semDono: r1(semDono), previsao, livre: r1(capacidade - comprometido - previsao.propostas - previsao.fees) }
}
