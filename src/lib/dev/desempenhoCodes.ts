// Aba Codes · gráficos de desempenho (CEO 09/10). Regras PURAS sobre os eventos de erp_dev_entrega: publicações por hora e
// por dia (total e por Code), pilha de PRs prontas ao longo do tempo e vazão (tempo pronta → publicada). Sem rede nem Date.now().
import { diaSP, type Entrega } from './painelCodes'

export type Periodo = 'hoje' | '7d' | '30d'
export const PERIODOS: { id: Periodo; rotulo: string }[] = [{ id: 'hoje', rotulo: 'Hoje' }, { id: '7d', rotulo: '7 dias' }, { id: '30d', rotulo: '30 dias' }]
export const PERIODO_DIAS: Record<Periodo, number> = { hoje: 1, '7d': 7, '30d': 30 }

const H = 36e5
const D = 864e5
const ms = (s: string) => new Date(s).getTime()

export type Ponto = { chave: string; rotulo: string; total: number; porCode: Record<string, number> }

const fmtH = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false })
const fmtD = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' })

/** Publicações por hora nas últimas `horas` horas (cada ponto = uma hora cheia, até a hora atual). */
export function publicacoesPorHora(entregas: Entrega[], agora: Date, horas = 24): Ponto[] {
  const fim = Math.floor(agora.getTime() / H) * H
  const pontos: Ponto[] = []
  for (let i = horas - 1; i >= 0; i--) {
    const ini = fim - i * H
    pontos.push({ chave: String(ini), rotulo: `${fmtH.format(new Date(ini))}h`, total: 0, porCode: {} })
  }
  for (const e of entregas) {
    if (e.evento !== 'publicada') continue
    const idx = Math.floor(ms(e.ocorrido_em) / H) * H
    const p = pontos.find((x) => x.chave === String(idx))
    if (!p) continue
    p.total++
    p.porCode[e.code] = (p.porCode[e.code] ?? 0) + 1
  }
  return pontos
}

/** Publicações por dia (fuso de São Paulo) nos últimos `dias` dias, incluindo hoje. */
export function publicacoesPorDia(entregas: Entrega[], agora: Date, dias: number): Ponto[] {
  const pontos: Ponto[] = []
  for (let i = dias - 1; i >= 0; i--) {
    const d = new Date(agora.getTime() - i * D)
    pontos.push({ chave: diaSP(d), rotulo: fmtD.format(d), total: 0, porCode: {} })
  }
  for (const e of entregas) {
    if (e.evento !== 'publicada') continue
    const p = pontos.find((x) => x.chave === diaSP(new Date(e.ocorrido_em)))
    if (!p) continue
    p.total++
    p.porCode[e.code] = (p.porCode[e.code] ?? 0) + 1
  }
  return pontos
}

type Ciclo = { pr: number; code: string; pronta: number | null; fim: number | null; fimTipo: 'publicada' | 'fechada' | null }

/** Uma linha por PR: quando ficou pronta e quando terminou (publicada ou fechada). */
export function ciclos(entregas: Entrega[]): Ciclo[] {
  const por = new Map<number, Ciclo>()
  for (const e of entregas) {
    const c = por.get(e.pr_numero) ?? { pr: e.pr_numero, code: e.code, pronta: null, fim: null, fimTipo: null }
    const t = ms(e.ocorrido_em)
    if (e.evento === 'pronta' && (c.pronta === null || t < c.pronta)) c.pronta = t
    if (e.evento === 'publicada' || e.evento === 'fechada') { c.fim = t; c.fimTipo = e.evento }
    if (e.code !== 'não identificado') c.code = e.code
    por.set(e.pr_numero, c)
  }
  return [...por.values()]
}

/** Pilha de PRs prontas e ainda não publicadas/fechadas, de hora em hora. */
export function pilhaProntas(entregas: Entrega[], agora: Date, horas: number): { rotulo: string; chave: string; prontas: number }[] {
  const cs = ciclos(entregas).filter((c) => c.pronta !== null)
  const fim = Math.floor(agora.getTime() / H) * H
  const out: { rotulo: string; chave: string; prontas: number }[] = []
  for (let i = horas - 1; i >= 0; i--) {
    const t = fim - i * H + H - 1
    const n = cs.filter((c) => (c.pronta as number) <= t && (c.fim === null || c.fim > t)).length
    out.push({ chave: String(t), rotulo: horas <= 48 ? `${fmtH.format(new Date(t))}h` : fmtD.format(new Date(t)), prontas: n })
  }
  return out
}

export type VazaoDia = { chave: string; rotulo: string; medianaMin: number | null; n: number }

function mediana(v: number[]): number | null {
  if (!v.length) return null
  const s = [...v].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2)
}

/** Vazão: mediana (em minutos) do tempo pronta → publicada, por dia da publicação. */
export function vazaoPorDia(entregas: Entrega[], agora: Date, dias: number): VazaoDia[] {
  const base = publicacoesPorDia([], agora, dias)
  const acc = new Map<string, number[]>()
  for (const c of ciclos(entregas)) {
    if (c.fimTipo !== 'publicada' || c.pronta === null || c.fim === null || c.fim < c.pronta) continue
    const k = diaSP(new Date(c.fim))
    acc.set(k, [...(acc.get(k) ?? []), Math.round((c.fim - c.pronta) / 6e4)])
  }
  return base.map((p) => ({ chave: p.chave, rotulo: p.rotulo, medianaMin: mediana(acc.get(p.chave) ?? []), n: (acc.get(p.chave) ?? []).length }))
}

export const totalPeriodo = (pts: Ponto[]) => pts.reduce((s, p) => s + p.total, 0)
